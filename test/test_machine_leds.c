/* 执行真实 LED 初始化，验证触发位、打包、组选和 MUX；不模拟物理灯色。 */
#include <stdint.h>
#include <stdio.h>
#include "machine.h"
#include "rtl837x_common.h"
#include "rtl837x_leds.h"
#include "rtl837x_regs.h"
#include "hw_mock.h"

extern const struct machine machine;
static unsigned checks, failures;
#define CHECK(cond, msg) do { \
	checks++; \
	if (!(cond)) { failures++; printf("FAIL: %s\n", msg); } \
	else printf("PASS: %s\n", msg); \
} while (0)

/* 无设备输出；只链接驱动实际需要的控制台边界。 */
void print_string(const char *s) { (void)s; }
void write_char(char c) { (void)c; }
void print_byte(uint8_t v) { (void)v; }
void print_reg(uint16_t v) { (void)v; }
void print_sfr_data(void) {}

int main(void)
{
	const uint32_t speeds = LEDS_2G5 | LEDS_TWO_PAIR_1G | LEDS_1G | LEDS_500M |
		LEDS_100M | LEDS_10M | LEDS_10G | LEDS_TWO_PAIR_5G | LEDS_5G | LEDS_TWO_PAIR_2G5;
	const uint32_t green = machine.led_sets[0][0];
	const uint32_t yellow = machine.led_sets[0][1];
	CHECK((green & speeds) == LEDS_2G5, "LEDID0 实机绿灯仅选择 2.5G");
	CHECK((yellow & speeds) == (LEDS_1G | LEDS_100M | LEDS_10M), "LEDID1 实机黄灯仅选择 10M/100M/1G");
	CHECK((yellow & green & speeds) == 0, "两通道的速率选择互斥");
	CHECK((yellow & LEDS_LINK) && (green & LEDS_LINK), "两颗速率灯都必须启用 LINK 亮灯触发");
	CHECK((yellow & ~(speeds | LEDS_LINK)) == 0 && (green & ~(speeds | LEDS_LINK)) == 0, "不混入 ACT/FLASH/RX/TX 等额外触发");
	CHECK(green == 0x41 && yellow == 0x74, "实机确认的组合：绿灯 2G5|LINK，黄灯低速|LINK");
	for (unsigned port = 0; port < 8; port++)
		CHECK(machine.port_led_set[port] == 0, "八个 RJ45 均使用同一速率灯组");
	CHECK(machine.port_led_set[8] == 1, "SFP 保留独立灯组");
	CHECK(machine.led_sets[1][0] == (LEDS_2G5 | LEDS_1G | LEDS_100M | LEDS_10M | LEDS_LINK | LEDS_ACT | LEDS_10G), "SFP 单灯模式不变");
	CHECK(machine.led_sets[0][2] == 0 && machine.led_sets[0][3] == 0, "未使用的 RJ45 灯通道保持关闭");
	CHECK(machine.high_leds.mux == (LED_27 | LED_29) && machine.high_leds.enable == (LED_28_SYS | LED_29), "系统灯和高位引脚映射不变");

	hw_reset();
	const uint32_t initial_mux = 0x01001234;
	const uint32_t initial_io = 0x00ffffff;
	hw_reg_set(RTL837X_PIN_MUX_0, initial_mux);
	hw_reg_set(RTL837X_REG_LED_GLB_IO_EN, initial_io);
	hw_reg_set(RTL837X_REG_LED_RLDP_1, 0xaabbccff);
	hw_reg_set(RTL837X_REG_LED1_0_SET0, 0xffffffff);
	leds_setup();
	CHECK(hw_reg_get(RTL837X_REG_LED1_0_SET0) == 0x00740041, "真实驱动把实机确认的 LEDID0/1 打包成 SET0=00740041");
	CHECK(hw_reg_get(RTL837X_REG_LED3_2_SET0) == 0, "真实驱动关闭 SET0 的另外两路");
	CHECK(hw_reg_get(RTL837X_REG_LED1_0_SET1) == 0x00000175, "SFP SET1 低 16 位不变");
	CHECK(hw_reg_get(RTL837X_REG_LED3_0_SET1) == 0x00010000, "SFP 10G 扩展位不变");
	CHECK(hw_reg_get(RTL837X_LED_PORT_SET_SEL) == 0x00010000, "组选为 RJ45 SET0、SFP SET1");
	CHECK(hw_reg_get(RTL837X_REG_LED_MODE) == 0x0021e6b0, "系统模式保持原初始化值，正常常亮由主程序后续设置");
	CHECK(hw_reg_get(RTL837X_PIN_MUX_0) == ((initial_mux | (1u << 27) | (1u << 29)) & ~(1u << 28)), "高位 MUX 正确且保留其它引脚");
	CHECK(hw_reg_get(RTL837X_REG_LED_GLB_IO_EN) == ((initial_io | (1u << 28) | (1u << 29)) & ~(1u << 27)), "系统灯输出使能保留且未覆盖其它输出");
	CHECK(hw_reg_get(RTL837X_REG_LED_RLDP_1) == 0xaabbccfc, "仅清除 RLDP 的两位灯控制");
	CHECK(hw_reg_get(RTL837X_REG_LED_RLDP_2) == 0x0000ffff && hw_reg_get(RTL837X_REG_LED_RLDP_3) == 0x0f, "所有端口的原 RLDP 映射保持");
	const uint32_t expected_mux[6] = { 0x08144040, 0x10349309, 0x12454391, 0x19616555, 0x1c79d65a, 0x0002181d };
	for (unsigned i = 0; i < 6; i++)
		CHECK(hw_reg_get(RTL837X_REG_LED_GLB_MUX_1 + i * 4) == expected_mux[i], "真实驱动保留整组物理 LED MUX");
	printf("\n%u checks, %u failed\n", checks, failures);
	return failures ? 1 : 0;
}
