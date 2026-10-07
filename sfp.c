#pragma codeseg BANK3
#pragma constseg BANK3

#include <8051.h>
#include <stdint.h>
#include <stdbool.h>

#include "rtl837x_sfr.h"
#include "rtl837x_regs.h"
#include "rtl837x_common.h"
#include "rtl837x_pins.h"
#include "rtl837x_phy.h"
#include "rtl837x_port.h"
#include "machine.h"
#include "phy.h"
#include "boot.h"
#include "sfp.h"

extern __code const struct machine machine;

// SFP1 b0 = 1 => module missing, b1 = 1 => LOS;
// SFP2 b4 = 1 => module missing, b5 = 1 => LOS;
extern volatile __xdata uint32_t ticks;

__xdata uint8_t sfp_pins_last;
__xdata uint8_t sfp_admin_disabled;
__xdata char sfp_module_vendor[2][17];
__xdata char sfp_module_model[2][17];
__xdata char sfp_module_serial[2][17];
__xdata uint8_t sfp_options[2];
__xdata uint8_t sfp_buf[16];	/* scratch for one I2C transaction, the controller reads at most 16 bytes */
__xdata uint8_t sfp_speed[2];
__xdata uint8_t sfp_quirks[2];
__xdata uint8_t sfp_wake_at[2];
__xdata uint8_t sfp_wake_pending[2];


__code enum sfp_quirk {
	SFP_QUIRK_DDM = (1 << 0),
};

struct sfp_quirk_entry {
	__code const char *vendor; // Set vendor or model to 0 to act as wildcard
	__code const char *model;
	uint8_t quirks;
};

static __code const struct sfp_quirk_entry sfp_quirk_table[] = {
	{ "QSFPTEK", "QT-SFP+-T", SFP_QUIRK_DDM },
};




static inline uint8_t sfp_rate_to_sds_config(uint8_t rate)
{
	if (rate == 0x1 || rate == 0x2)
		return SDS_100FX;
	if (rate == 0xc || rate == 0xd)
		return SDS_1000BX_FIBER;
	if (rate >= 0x19 && rate <= 0x20)  // Ethernet 2.5 GBit
		return SDS_HSG;
	if (rate >= 0x62 && rate < 0x70)
		return SDS_10GR;
	return 0xff;
}




bool sfp_print_info(uint8_t sfp) __banked
{
	// This loops over the Vendor-name, Vendor OUI, Vendor PN and Vendor rev ASCII fields
	for (uint8_t i = 16; i < 64; i++) {
		if (!(i & 0xf) && !sfp_read_block(sfp, i, 16))
			return false;
		if (i < 20 || i >= 60 || (i >= 36 && i < 40)) // Skip Non-ASCII codes
			continue;
		uint8_t c = sfp_buf[i & 0xf];
		if (c)
			write_char(c);
	}
	print_string("\n");

	return true;
}


// Normalize strings from EEPROM by removing any trailing spaces; this allows simpler comparisons
bool sfp_read_field(__xdata char *dst, uint8_t sfp, uint8_t start, uint8_t length) __banked __reentrant
{
	if (!sfp_read_block(sfp, start, length))
		return false;

	dst[length] = NUL;
	for (uint8_t i = 0; i < length; i++) {
		uint8_t c = sfp_buf[i];
		if (c && (c < 0x20 || c > 0x7e || c == '"' || c == '\\'))
			c = '.';
		dst[i] = c;
	}

	while (length-- > 0 && (dst[length] == ' ' || dst[length] == NUL))
		dst[length] = NUL;

	return true;
}



bool sfp_get_info(uint8_t sfp) __banked
{
	if (!sfp_read_field(sfp_module_vendor[sfp], sfp, 20, 16))
		return false;
	if (!sfp_read_field(sfp_module_model[sfp], sfp, 40, 16))
		return false;

	return sfp_read_field(sfp_module_serial[sfp], sfp, 68, 16);
}



void sfp_apply_quirks(uint8_t sfp) __banked __reentrant
{
	sfp_quirks[sfp] = 0;

	for (uint8_t i = 0; i < sizeof(sfp_quirk_table) / sizeof(*sfp_quirk_table); i++) {
		if (!sfp_quirk_table[i].vendor || !strcmp(sfp_module_vendor[sfp], sfp_quirk_table[i].vendor)) {
			if (!sfp_quirk_table[i].model || !strcmp(sfp_module_model[sfp], sfp_quirk_table[i].model)) {
				sfp_quirks[sfp] |= sfp_quirk_table[i].quirks;
			}
		}
	}

	if (sfp_quirks[sfp] & SFP_QUIRK_DDM) {
		if (!(sfp_options[sfp] & 0x40)) {
			// The module reports that DDM is not implemented, but try a dummy read to confirm
			// 0xff would mean a failed I2C read or an impossible (per spec) voltage greater than 6.5V
			if (sfp_read_block(sfp, 226, 1) && sfp_buf[0] != 0xff) {
				sfp_options[sfp] |= 0x40;
			}
		}
	}
}


/* 清除未就绪或已移除模块的数据，不改变管理状态和强制速率。 */
static void sfp_clear_info(uint8_t sfp)
{
	sfp_module_vendor[sfp][0] = NUL;
	sfp_module_model[sfp][0] = NUL;
	sfp_module_serial[sfp][0] = NUL;
	sfp_options[sfp] = 0;
	sfp_quirks[sfp] = 0;
}

/* 启动代码不自动清 XDATA，所有状态必须显式初始化。 */
void sfp_init(void) __banked
{
	sfp_pins_last = 0x33;
	sfp_admin_disabled = 0;
	for (uint8_t sfp = 0; sfp < 2; sfp++) {
		sfp_wake_at[sfp] = 0;
		sfp_wake_pending[sfp] = 0;
		sfp_speed[sfp] = SFP_SPEED_AUTO;
		sfp_clear_info(sfp);
	}
}

/* 重新读取模块前关闭旧模式；只有真实在位且管理允许才安排唤醒。 */
void sfp_schedule(__xdata uint8_t sfp) __banked
{
	if (sfp >= machine.n_sfp)
		return;
	sfp_wake_pending[sfp] = 0;
	sfp_clear_info(sfp);
	sds_config_mac(machine.sfp_port[sfp].sds, SDS_OFF);
	if (!(sfp_admin_disabled & (1 << sfp))
	    && !gpio_pin_test(machine.sfp_port[sfp].pin_detect)) {
		sfp_wake_at[sfp] = (uint8_t)ticks;
		sfp_wake_pending[sfp] = SFP_WAKE_PENDING;
	}
}

/* 禁用只关闭 MAC 侧 SerDes 模式，不操作模块 TX_DISABLE 或电源。 */
void sfp_set_enabled(uint8_t sfp, __xdata bool enabled) __banked
{
	if (sfp >= machine.n_sfp)
		return;
	if (enabled) {
		sfp_admin_disabled &= ~(1 << sfp);
		sfp_schedule(sfp);
	} else {
		sfp_admin_disabled |= 1 << sfp;
		sfp_wake_pending[sfp] &= SFP_WAKE_READY;
		sfp_wake_at[sfp] = 0;
		sds_config_mac(machine.sfp_port[sfp].sds, SDS_OFF);
	}
}

/* Inititalize SFP GPIOs */
void setup_sfp_gpio(void) __banked
{
	for (__xdata uint8_t sfp = 0; sfp < machine.n_sfp; sfp++) {
		gpio_input_setup(machine.sfp_port[sfp].pin_detect);
		gpio_input_setup(machine.sfp_port[sfp].pin_los);
		gpio_output_setup(machine.sfp_port[sfp].pin_tx_disable, 0);
	}
}



static bool sfp_module_read(uint8_t sfp)
{
	uint8_t rate;

	// Read Reg 11: Encoding, see SFF-8472 and SFF-8024
	// Read Reg 12: Signalling rate (including overhead) in 100Mbit: 0xd: 1Gbit, 0x67:10Gbit
	if (!sfp_read_block(sfp, 11, 2))
		return false;

	rate = sfp_buf[1];
	if (sfp_speed[sfp] == SFP_SPEED_100M)
		rate = 0x1;
	else if (sfp_speed[sfp] == SFP_SPEED_1G)
		rate = 0xc;
	else if (sfp_speed[sfp] == SFP_SPEED_2G5)
		rate = 0x19;
	else if (sfp_speed[sfp] == SFP_SPEED_10G)
		rate = 0x69;
	/* 后续读取会覆盖 scratch，只保留已解析的模式。 */
	rate = sfp_rate_to_sds_config(rate);

	if (!sfp_read_block(sfp, 92, 1))
		return false;
	sfp_options[sfp] = sfp_buf[0];
	if (!sfp_get_info(sfp))
		return false;

	sfp_apply_quirks(sfp);
	/* EEPROM 读取期间可能被拔出，不能启用刚移除模块的旧模式。 */
	if (gpio_pin_test(machine.sfp_port[sfp].pin_detect))
		return false;
	if (!(sfp_admin_disabled & (1 << sfp))) {
		/* ff 会越过模式位宽并污染相邻 SDS，未知速率保持 OFF。 */
		if (rate == 0xff) {
			sds_config_mac(machine.sfp_port[sfp].sds, SDS_OFF);
			print_string("SFP: unsupported rate\n");
		} else {
			sds_config(machine.sfp_port[sfp].sds, rate);
		}
	}

	return true;
}




void handle_sfp(void) __banked
{
	for (__xdata uint8_t sfp = 0; sfp < machine.n_sfp; sfp++) {
		if (!gpio_pin_test(machine.sfp_port[sfp].pin_detect)) {
			if (sfp_pins_last & (0x1 << (sfp << 2))) {
				sfp_pins_last &= ~(0x01 << (sfp << 2));
				print_string("\n<MODULE INSERTED>  Slot: "); write_char('1' + sfp);
				sfp_schedule(sfp);
			} else if ((sfp_wake_pending[sfp] & SFP_WAKE_PENDING)
				   && !(sfp_admin_disabled & (1 << sfp))
				   && (uint8_t)((uint8_t)ticks - sfp_wake_at[sfp]) >= SFP_WAKE_TICKS) {
				if (sfp_module_read(sfp)) {
					sfp_wake_pending[sfp] = SFP_WAKE_READY;
				} else {
					/* I2C 失败不改变真实 presence；清部分数据并延后重试。 */
					sfp_clear_info(sfp);
					sfp_wake_at[sfp] = (uint8_t)ticks;
					print_string("SFP: I2C read failed\n");
				}
			}
		} else {
			if (!(sfp_pins_last & (0x1 << (sfp << 2)))) {
				sfp_pins_last |= 0x01 << (sfp << 2);
				sfp_wake_pending[sfp] = 0;
				sfp_wake_at[sfp] = 0;
				sfp_clear_info(sfp);
				sds_config_mac(machine.sfp_port[sfp].sds, SDS_OFF);
				print_string("\n<MODULE REMOVED>  Slot: "); write_char('1' + sfp); write_char('\n');
			}
		}

		if (!gpio_pin_test(machine.sfp_port[sfp].pin_los)) {
			if (sfp_pins_last & (0x2 << (sfp << 2))) { // 0x2 0x08
				sfp_pins_last &= ~(0x02 << (sfp << 2));
				print_string("\n<SFP-RX OK>  Slot: "); write_char('1' + sfp); write_char('\n');
			}
		} else {
			if (!(sfp_pins_last & 0x2 << (sfp << 2))) {
				sfp_pins_last |= 0x02 << (sfp << 2);
				print_string("\n<SFP-RX LOS>  Slot: "); write_char('1' + sfp); write_char('\n');
			}
		}
	}
}
