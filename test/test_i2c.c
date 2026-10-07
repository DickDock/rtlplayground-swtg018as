/* 直接测试固件 I²C 读取：正常、NACK、卡 busy 和恢复；不模拟底层 SFR 故障。 */
#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#undef __sfr
#undef __sfr16
#undef __sfr32
#undef __sbit
#define __sfr volatile uint8_t
#define __sfr16 volatile uint16_t
#define __sfr32 volatile uint32_t
#define __sbit bool
#include "rtl837x_sfr.h"

#include "rtl837x_common.h"
#include "rtl837x_regs.h"
#include "rtl837x_pins.h"
#include "machine.h"
#include "support.h"

const struct machine machine = {
	.n_sfp = 2,
	.sfp_port = {{.i2c = 0x72}, {.i2c = 0x6e}},
};
uint8_t sfr_data[4], sfp_buf[16];
volatile uint32_t ticks;
static uint32_t control, input;
static unsigned reads, writes, out_reads, remaining, completion_reads;
static bool running, frozen, stuck_before, nack;

void print_byte(uint8_t v) { (void)v; }
void reg_bit_clear(uint16_t addr, char bit) { (void)addr; (void)bit; }
void reg_bit_set(uint16_t addr, char bit) { (void)addr; (void)bit; }
void sfr_mask_data(uint8_t n, uint8_t mask, uint8_t set) { sfr_data[3-n] = (sfr_data[3-n] & ~mask) | set; }
static void load(uint32_t v)
{
	SFR_DATA_24 = v >> 24; SFR_DATA_16 = v >> 16;
	SFR_DATA_8 = v >> 8; SFR_DATA_0 = v;
}
void reg_read(uint16_t addr)
{
	if (addr == RTL837X_REG_I2C_CTRL) {
		if (!frozen && (++reads % 4) == 0) ticks++;
		else if (frozen) reads++;
		if (stuck_before) { load(control | 1); return; }
		if (running && remaining) remaining--;
		if (running && !remaining) { running = false; control = nack ? 2 : 0; }
		load(control);
	} else if (addr >= RTL837X_REG_I2C_OUT && addr < RTL837X_REG_I2C_OUT + 16) {
		out_reads++;
		uint32_t base = addr - RTL837X_REG_I2C_OUT + input;
		load(((base+3) << 24) | ((base+2) << 16) | ((base+1) << 8) | base);
	} else load(0);
}
void reg_read_m(uint16_t addr)
{
	reg_read(addr);
	sfr_data[0] = SFR_DATA_24; sfr_data[1] = SFR_DATA_16;
	sfr_data[2] = SFR_DATA_8; sfr_data[3] = SFR_DATA_0;
}
void reg_write(uint16_t addr)
{
	writes++;
	uint32_t word = ((uint32_t)SFR_DATA_24 << 24) | ((uint32_t)SFR_DATA_16 << 16) | ((uint32_t)SFR_DATA_8 << 8) | SFR_DATA_0;
	if (addr == RTL837X_REG_I2C_IN) input = word;
	if (addr == RTL837X_REG_I2C_CTRL) {
		control = word;
		running = true;
		remaining = completion_reads;
	}
}
void reg_write_m(uint16_t addr)
{
	load(((uint32_t)sfr_data[0] << 24) | ((uint32_t)sfr_data[1] << 16) | ((uint32_t)sfr_data[2] << 8) | sfr_data[3]);
	reg_write(addr);
}
static void reset(void)
{
	control = input = 0; reads = writes = out_reads = remaining = 0;
	completion_reads = 3; running = frozen = stuck_before = nack = false;
	ticks = 0; memset(sfp_buf, 0xa5, sizeof(sfp_buf));
}
static bool untouched(void)
{
	for (unsigned i = 0; i < sizeof(sfp_buf); i++) if (sfp_buf[i] != 0xa5) return false;
	return true;
}
int main(void)
{
	printf("== 固件 I²C 有界等待 ==\n");
	reset();
	CHECK(sfp_read_block(0, 12, 16), "正常 16 字节读取完成");
	CHECK(sfp_buf[0] == 12 && sfp_buf[15] == 27 && out_reads == 4, "控制器四字节读取顺序完整");
	reset();
	CHECK(sfp_read_block(1, 224, 2), "第二槽诊断页读取完成");
	CHECK(input == 96 && sfp_buf[0] == 96 && sfp_buf[1] == 97, "诊断地址去掉页标志");
	reset();
	CHECK(!sfp_read_block(0, 0, 0) && !sfp_read_block(0, 0, 17), "拒绝非法读取长度");
	CHECK(writes == 0 && untouched(), "非法长度不触碰总线或缓冲区");
	CHECK(!sfp_read_block(2, 0, 1) && writes == 0, "不存在的槽位不触碰 I²C 控制器");
	reset(); nack = true;
	CHECK(!sfp_read_block(0, 12, 2), "NACK 返回失败");
	CHECK(out_reads == 0 && untouched(), "NACK 不读取旧 OUT");
	reset(); stuck_before = true;
	watchdog_arm(2, "旧事务卡 busy");
	bool ok = sfp_read_block(0, 12, 2);
	watchdog_disarm();
	CHECK(!ok && writes == 0, "旧事务 busy 不覆盖正在执行的命令");
	CHECK(untouched() && out_reads == 0, "旧 busy 不污染诊断缓冲区");
	reset(); completion_reads = 1000000;
	watchdog_arm(2, "新事务卡 busy");
	ok = sfp_read_block(0, 12, 2);
	watchdog_disarm();
	CHECK(!ok && writes == 2 && reads < 100000, "新事务卡 busy 有限退出");
	CHECK(untouched() && out_reads == 0, "超时不消费旧结果");
	unsigned previous_writes = writes;
	ok = sfp_read_block(0, 12, 2);
	CHECK(!ok && writes == previous_writes, "超时后的重试不覆盖仍 busy 的事务");
	control = 0; running = false; completion_reads = 3;
	CHECK(sfp_read_block(0, 12, 2) && sfp_buf[0] == 12, "旧事务结束后恢复正常读取");
	reset(); frozen = true; stuck_before = true;
	watchdog_arm(2, "tick 停止时 busy 保护");
	ok = sfp_read_block(0, 12, 2);
	watchdog_disarm();
	CHECK(!ok && reads < 100000 && writes == 0, "tick 不推进时轮询预算仍能退出");
	reset(); ticks = 0xfffffff8; completion_reads = 40;
	CHECK(sfp_read_block(0, 12, 2), "tick 回绕期间正常完成");
	printf("\n%d checks, %d failed\n", tests_run, tests_failed);
	return tests_failed ? 1 : 0;
}
