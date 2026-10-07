/* 真实 sfp.c、parse_sfp() 和 send_status() 的回归测试。 */
#include <stdio.h>
#include <string.h>
#include "rtl837x_common.h"
#include "rtl837x_regs.h"
#include "machine.h"
#include "sfp.h"
#include "page_impl.h"
#include "env.h"

extern const struct machine machine;

static bool present(uint8_t slot) { return !(sfp_pins_last & (1 << (slot << 2))); }
static void insert(uint8_t slot, uint8_t rate)
{
    set_module(slot, rate, "VENDOR", "MODULE");
    poll_after(0);
}
static const char *status_slot(uint8_t slot)
{
    static char entry[TCP_OUTBUF_SIZE];
    uint8_t port = slot ? 7 : 8;
    char key[32];
    send_status();
    CHECK(slen < TCP_OUTBUF_SIZE, "status.json 未超出固件输出缓冲区");
    outbuf[slen] = 0;
    snprintf(key, sizeof(key), "{\"portNum\":%u,", port + 1);
    const char *p = strstr((const char *)outbuf, key);
    const char *end = p ? strchr(p, '}') : NULL;
    CHECK(p && end, "status.json 含待测 SFP 端口");
    if (!p || !end) return "";
    size_t len = end - p + 1;
    memcpy(entry, p, len); entry[len] = 0;
    return entry;
}
static void no_metadata(uint8_t slot, const char *msg)
{
    const char *s = status_slot(slot);
    CHECK(!strstr(s, "sfp_vendor") && !strstr(s, "sfp_options"), msg);
}

static void t_explicit_init(void)
{
    puts("[test] XDATA 垃圾值由 sfp_init 显式清除");
    sfp_admin_disabled = sfp_pins_last = 0xff;
    memset(sfp_wake_pending, 0xff, 2);
    memset(sfp_wake_at, 0xff, 2);
    memset(sfp_speed, 0xff, 2);
    memset(sfp_options, 0xff, 2);
    memset(sfp_quirks, 0xff, 2);
    memset(sfp_module_vendor, 0xff, sizeof(sfp_module_vendor));
    memset(sfp_module_model, 0xff, sizeof(sfp_module_model));
    memset(sfp_module_serial, 0xff, sizeof(sfp_module_serial));
    sfp_init();
    CHECK(sfp_pins_last == 0x33 && !sfp_admin_disabled, "init 管理允许且 pins 为启动缺席值");
    for (unsigned slot = 0; slot < 2; slot++) {
        CHECK(!sfp_wake_at[slot] && !sfp_wake_pending[slot] && sfp_speed[slot] == SFP_SPEED_AUTO,
              "init 清 wait/ready 并设置 AUTO");
        CHECK(!sfp_options[slot] && !sfp_quirks[slot] && !sfp_module_vendor[slot][0]
              && !sfp_module_model[slot][0] && !sfp_module_serial[slot][0], "init 清 metadata 首字符/options/quirks");
    }
}

static void t_empty_admin(void)
{
    puts("[test] empty slot 的 enabled 独立于 presence");
    sfp_env_reset();
    CHECK(strstr(status_slot(0), "\"enabled\":1"), "empty allow = enabled 1");
    sfp_test_cli("sfp 1 off");
    CHECK(err_status == ERR_OK, "真实 CLI 接受 off");
    CHECK(strstr(status_slot(0), "\"enabled\":0"), "empty off = enabled 0");
    CHECK(sds_offs[1] == 1 && !bad_sds_calls, "off 只经 sds_config_mac 关闭 slot-mapped SDS");
    sfp_test_cli("sfp 1 on");
    CHECK(err_status == ERR_OK, "真实 CLI 接受 on");
    CHECK(strstr(status_slot(0), "\"enabled\":1"), "empty on 恢复 admin allow");
    CHECK(!sds_enables[1] && !reads[0], "空槽 on 不启动 SerDes 或读 EEPROM");
    CHECK(sds_mode[0] == SDS_QXGMII && sds_mode[2] == SDS_QXGMII, "单槽邻接 RTL8224 SDS0/2 不变");
}
static void t_disabled_hotplug(void)
{
    puts("[test] disabled 插拔与速率变更不启动 SerDes");
    sfp_env_reset();
    sfp_test_cli("sfp 1 off");
    sfp_test_cli("sfp 1 2g5");
    CHECK(sfp_speed[0] == SFP_SPEED_2G5, "disabled 保留 forced speed");
    insert(0, 0x69);
    poll_after(SFP_WAKE_TICKS);
    CHECK(present(0), "disabled 仍记录真实在位");
    CHECK(!sds_enables[1], "disabled insertion 不 enable");
    CHECK(strstr(status_slot(0), "\"enabled\":0"), "present off 的 JSON 仍 enabled 0");
    sfp_test_cli("sfp 1 1g");
    poll_after(SFP_WAKE_TICKS);
    sfp_test_cli("sfp");
    CHECK(!sds_enables[1], "disabled speed/poll/CLI reads 不 enable");
    module_present[0] = false; poll_after(0);
    CHECK(!present(0) && sfp_speed[0] == SFP_SPEED_1G, "disabled removal 保留 forced speed");
    insert(0, 0x69); poll_after(SFP_WAKE_TICKS);
    CHECK(!sds_enables[1], "disabled reinsert 不 enable");
    sfp_test_cli("sfp 1 on");
    unsigned before = reads[0];
    poll_after(SFP_WAKE_TICKS - 1);
    CHECK(!sds_enables[1] && reads[0] == before, "on 等待完整 500ms");
    poll_after(1);
    CHECK(sds_enables[1] == 1 && sds_mode[1] == SDS_1000BX_FIBER, "on 以保留速率初始化");
    CHECK(sfp_speed[0] == SFP_SPEED_1G && !bad_sds_calls, "off/on 不改变 speed 或传 OFF 给 sds_config");
}
static void t_cancel_pending(void)
{
    puts("[test] off/removal 取消 wake，removal 清理 metadata");
    sfp_env_reset();
    insert(0, 0x69);
    CHECK(present(0), "插入立即记录 presence");
    no_metadata(0, "wake 期间不发旧 metadata");
    sfp_test_cli("sfp 1 off");
    poll_after(SFP_WAKE_TICKS);
    CHECK(!sds_enables[1] && !reads[0], "off 取消待执行 wake");
    sfp_test_cli("sfp 1 on"); poll_after(SFP_WAKE_TICKS);
    CHECK(sds_enables[1] == 1, "on 能恢复被取消的 wake");
    CHECK(strstr(status_slot(0), "\"sfp_vendor\":\"VENDOR\""), "ready 后输出 metadata");
    sfp_quirks[0] = 1;
    sfp_test_cli("sfp 1 1g");
    CHECK(present(0), "speed 调度不伪造缺席");
    CHECK(sds_mode[1] == SDS_OFF, "speed 变更在 delay 期间关闭旧 mode");
    no_metadata(0, "speed reload 期间隐藏 metadata");
    module_present[0] = false; poll_after(0);
    CHECK(sds_mode[1] == SDS_OFF, "removal 关闭 SDS");
    CHECK(!sfp_wake_pending[0], "removal 取消 wait/ready");
    CHECK(!sfp_module_vendor[0][0] && !sfp_module_model[0][0] && !sfp_module_serial[0][0]
          && !sfp_options[0] && !sfp_quirks[0], "removal 清 metadata/options/quirks");
    CHECK(sfp_speed[0] == SFP_SPEED_1G, "removal 保留 forced speed");
    poll_after(SFP_WAKE_TICKS);
    CHECK(sds_enables[1] == 1, "removal 后取消的 wake 不复活");
    CHECK(sds_mode[0] == SDS_QXGMII && sds_mode[2] == SDS_QXGMII, "speed/removal 不触碰邻接 SDS");
}
static void t_retry(void)
{
    puts("[test] failed EEPROM reads 保持 presence 并按 wake deadline 节流");
    for (int reg_case = 0; reg_case < 5; reg_case++) {
        const int regs[] = { 11, 92, 20, 40, 68 };
        sfp_env_reset();
        insert(0, 0x69);
        fail_slot = 0; fail_reg = regs[reg_case]; fail_reads = -1;
        poll_after(SFP_WAKE_TICKS);
        CHECK(present(0), "I2C failure 不伪造 absent");
        CHECK(!sds_enables[1] && sds_mode[1] == SDS_OFF, "I2C failure 不 enable");
        no_metadata(0, "I2C failure 不发部分或旧 metadata");
        unsigned before = reads[0];
        for (unsigned i = 0; i < SFP_WAKE_TICKS - 1; i++) poll_after(1);
        CHECK(reads[0] == before, "retry deadline 前不重读");
        poll_after(1);
        CHECK(reads[0] > before && present(0), "500ms 后重试且仍在位");
        before = reads[0];
        sfp_test_cli("sfp 1 off"); poll_after(SFP_WAKE_TICKS);
        CHECK(reads[0] == before && !sds_enables[1], "off 停止失败读取的重试");
        fail_reads = 0;
        sfp_test_cli("sfp 1 on"); poll_after(SFP_WAKE_TICKS);
        CHECK(sds_enables[1] == 1, "I2C 恢复后 on 正常初始化");
        CHECK(strstr(status_slot(0), "\"sfp_vendor\":\"VENDOR\""), "恢复仅发送本模块 metadata");
    }
}
static void t_auto_recovery_and_removal(void)
{
    puts("[test] 不需 CLI 的 retry recovery，以及读取过程中拔出");
    sfp_env_reset(); insert(0, 0x69);
    fail_slot = 0; fail_reg = 68; fail_reads = 1;
    poll_after(SFP_WAKE_TICKS);
    CHECK(present(0) && !(sfp_wake_pending[0] & SFP_WAKE_READY), "部分读取失败保持在位且 not ready");
    poll_after(SFP_WAKE_TICKS);
    CHECK(sds_enables[1] == 1 && (sfp_wake_pending[0] & SFP_WAKE_READY), "无 CLI 的定时 retry 自动恢复");
    unsigned before = reads[0];
    for (unsigned i = 0; i < 30; i++) poll_after(10);
    CHECK(reads[0] == before && sds_enables[1] == 1, "ready bit 不误当 pending 重复初始化");
    sfp_test_cli("sfp 1 off");
    CHECK(strstr(status_slot(0), "\"sfp_vendor\":\"VENDOR\""), "已就绪模块 off 后可查看 metadata");
    CHECK(strstr(status_slot(0), "\"enabled\":0"), "off metadata 不影响 admin enabled");
    CHECK(sds_enables[1] == 1 && sds_mode[1] == SDS_OFF, "disabled metadata/DDM reads 不 enable");

    sfp_env_reset(); insert(0, 0x69);
    remove_slot = 0; remove_reg = 68;
    poll_after(SFP_WAKE_TICKS);
    CHECK(!sds_enables[1] && !(sfp_wake_pending[0] & SFP_WAKE_READY), "最后一笔读取后拔出也不会 enable");
    no_metadata(0, "读取期间拔出不发旧 metadata");
    poll_after(0);
    CHECK(!present(0) && !sfp_wake_pending[0] && sds_mode[1] == SDS_OFF, "下一轮 removal 清状态并关闭 SDS");
}

static void t_ddm_failure(void)
{
    puts("[test] DDM 失败保留既有空 hex，但不读取 stale scratch");
    sfp_env_reset(); insert(0, 0x69); poll_after(SFP_WAKE_TICKS);
    fail_slot = 0; fail_reg = 224; fail_reads = -1;
    const char *s = status_slot(0);
    CHECK(strstr(s, "\"sfp_temp\":\"0x\""), "DDM failure 为空 hex");
    CHECK(strstr(s, "\"sfp_vendor\":\"VENDOR\""), "DDM failure 不隐藏已成功读取的模块信息");
    CHECK(present(0) && sds_enables[1] == 1, "DDM read failure 不伪造 absent 或启动 SDS");
}

static void t_unknown(void)
{
    puts("[test] unknown rate 不污染 SDS，完成读取后不无限重试");
    sfp_env_reset();
    insert(0, 0xff); poll_after(SFP_WAKE_TICKS);
    CHECK(present(0) && !sds_enables[1] && !bad_sds_calls, "unknown mode 不传 ff 给 sds_config");
    CHECK(sds_mode[1] == SDS_OFF, "unknown mode 保持 OFF");
    CHECK(strstr(console, "unsupported"), "unknown mode 有简短 unsupported 提示");
    unsigned before = reads[0];
    for (unsigned i = 0; i < 40; i++) poll_after(10);
    CHECK(reads[0] == before, "ready 不是 pending，unknown 不每 poll retry");
    sfp_test_cli("sfp 1 10g"); poll_after(SFP_WAKE_TICKS);
    CHECK(sds_mode[1] == SDS_10GR && sds_enables[1] == 1, "unknown 可用强制速度恢复");
    sfp_test_cli("sfp 1 auto"); poll_after(SFP_WAKE_TICKS);
    CHECK(sds_mode[1] == SDS_OFF && !bad_sds_calls, "恢复 auto unknown 会安全关闭");
    module_present[0] = false; poll_after(0);
    insert(0, 0xc); poll_after(SFP_WAKE_TICKS);
    CHECK(sds_mode[1] == SDS_1000BX_FIBER, "替换为受支持模块可恢复 auto");
}
static void t_port_entry(void)
{
    puts("[test] Web 的 port <physical> off/on 真实入口与 slot 映射");
    sfp_env_reset();
    sfp_test_cli("port 9 off");
    CHECK(err_status == ERR_OK && (sfp_admin_disabled & 1), "port 9 off 设置 slot 0 admin disabled");
    CHECK(sds_offs[1] == 1 && !phy_speed_calls, "port SFP off 关闭 mapped SDS1，不调用 PHY");
    CHECK(strstr(status_slot(0), "\"enabled\":0"), "Web port off 改变 JSON enabled");
    sfp_test_cli("sfp 1 1g"); insert(0, 0x69); poll_after(SFP_WAKE_TICKS);
    CHECK(!sds_enables[1] && sfp_speed[0] == SFP_SPEED_1G, "port off -> sfp speed/reinsert 不 enable");
    sfp_test_cli("port 9 on");
    CHECK(err_status == ERR_OK && !(sfp_admin_disabled & 1), "port 9 on 清 slot 0 disabled");
    poll_after(SFP_WAKE_TICKS - 1);
    CHECK(!sds_enables[1], "Web port on 保留 500ms delay");
    poll_after(1);
    CHECK(sds_enables[1] == 1 && sds_mode[1] == SDS_1000BX_FIBER, "Web on 用保留 forced speed 初始化");
    sfp_test_cli("port 9 off");
    CHECK(sds_mode[1] == SDS_OFF && sfp_speed[0] == SFP_SPEED_1G, "运行中 port off 关闭但保留 speed");
    sfp_test_cli("port 9 on"); sfp_test_cli("sfp 1 2g5"); poll_after(SFP_WAKE_TICKS);
    CHECK(sds_mode[1] == SDS_HSG, "port on -> sfp speed 应用最终速率");
    sfp_test_cli("sfp 1 100m"); sfp_test_cli("port 9 off"); poll_after(SFP_WAKE_TICKS);
    CHECK(sds_mode[1] == SDS_OFF && sfp_speed[0] == SFP_SPEED_100M && sds_enables[1] == 2,
          "sfp speed -> port off 取消 wake");
    sfp_test_cli("port 9 on"); poll_after(SFP_WAKE_TICKS);
    CHECK(sds_mode[1] == SDS_100FX, "speed -> port off/on 保留配置速率");

    unsigned enables = sds_enables[1], offs = sds_offs[1];
    const char *unsupported[] = { "port 9 10m", "port 9 100m", "port 9 1g", "port 9 2g5",
                                  "port 9 5g", "port 9 10g", "port 9 auto", "port 9 duplex full" };
    for (unsigned i = 0; i < sizeof(unsupported) / sizeof(*unsupported); i++) {
        sfp_test_cli(unsupported[i]);
        CHECK(sfp_speed[0] == SFP_SPEED_100M && sds_enables[1] == enables && sds_offs[1] == offs
              && !phy_speed_calls && !phy_duplex_calls, "SFP 其它 port speed/duplex 保持原提示且不操作 PHY/SDS");
    }
    sfp_test_cli("port 9 show");
    CHECK(!phy_show_calls && media_show_calls == 1, "SFP port show 仍不调用 PHY show");
    sfp_test_cli("port 9 name optical");
    CHECK(!(sfp_admin_disabled & 1) && sfp_speed[0] == SFP_SPEED_100M, "port name 不改变 SFP admin/speed");

    sfp_env_reset();
    if (machine.n_sfp == 2) {
        insert(0, 0x69); insert(1, 0xc); poll_after(SFP_WAKE_TICKS);
        sfp_test_cli("port 8 off");
        CHECK(sfp_admin_disabled == 2 && sds_mode[0] == SDS_OFF && sds_mode[1] == SDS_10GR,
              "physical port 8 -> slot 1 -> SDS0，第一槽不变");
        CHECK(strstr(status_slot(1), "\"enabled\":0"), "第二槽 Web off JSON 独立");
        sfp_test_cli("port 9 off");
        CHECK(sfp_admin_disabled == 3 && sds_mode[2] == SDS_QXGMII, "dual off 不触碰 RTL8224 SDS2");
        sfp_test_cli("port 8 on"); poll_after(SFP_WAKE_TICKS);
        CHECK(sfp_admin_disabled == 1 && sds_mode[0] == SDS_1000BX_FIBER && sds_mode[1] == SDS_OFF,
              "physical port 8 on 只恢复 slot 1");
    } else {
        sfp_test_cli("port 8 off");
        CHECK(!sfp_admin_disabled && phy_speed_calls == 1 && !sds_offs[0] && !sds_offs[1],
              "单槽 physical port 8 仍走铜口 PHY，不误映射 SFP");
        CHECK(sds_mode[0] == SDS_QXGMII && sds_mode[2] == SDS_QXGMII, "单槽 port 分支不碰 RTL8224 SDS0/2");
    }
    sfp_env_reset();
    const char *invalid[] = { "port 0 off", "port 10 on", "port 9x off" };
    for (unsigned i = 0; i < sizeof(invalid) / sizeof(*invalid); i++) {
        sfp_test_cli(invalid[i]);
        CHECK(err_status != ERR_OK && !sfp_admin_disabled && !sds_offs[1], "非法 physical port 不改变 SFP 状态");
    }
    sfp_test_cli("port 1 off"); sfp_test_cli("port 1 on");
    CHECK(phy_speed_calls == 2 && !sfp_admin_disabled && !sds_offs[1], "铜口 off/on 行为不变");
}

static void t_replay(void)
{
    puts("[test] startup config 的 off/speed/on 顺序");
    sfp_env_reset(); insert(0, 0x69);
    sfp_test_cli("sfp 1 off"); sfp_test_cli("sfp 1 100m"); poll_after(SFP_WAKE_TICKS);
    CHECK(!sds_enables[1] && sfp_speed[0] == SFP_SPEED_100M, "off -> speed 不 enable");
    sfp_test_cli("sfp 1 on"); sfp_test_cli("sfp 1 2g5"); poll_after(SFP_WAKE_TICKS);
    CHECK(sds_mode[1] == SDS_HSG && sfp_speed[0] == SFP_SPEED_2G5, "on -> speed 应用最终速率");
    sfp_env_reset(); insert(0, 0x69);
    sfp_test_cli("sfp 1 1g"); sfp_test_cli("sfp 1 off"); poll_after(SFP_WAKE_TICKS);
    CHECK(!sds_enables[1] && sfp_speed[0] == SFP_SPEED_1G, "speed -> off 取消 wake 且保留 speed");
    sfp_test_cli("sfp 1 on"); poll_after(SFP_WAKE_TICKS);
    CHECK(sds_mode[1] == SDS_1000BX_FIBER, "speed -> off -> on 保留 forced speed");
}
static void t_wrap_and_slots(void)
{
    puts("[test] low-byte tick wrap、dual slot 和非法 CLI");
    sfp_env_reset(); ticks = 240;
    insert(0, 0x69); poll_after(SFP_WAKE_TICKS - 1);
    CHECK(!sds_enables[1], "tick wrap 前未提前唤醒");
    poll_after(1); CHECK(sds_enables[1] == 1, "tick wrap 后恰好 100 ticks 唤醒");
    sfp_env_reset();
    sfp_test_cli("sfp 1 off");
    insert(0, 0x69);
    if (machine.n_sfp == 2) {
        insert(1, 0xc); poll_after(SFP_WAKE_TICKS);
        CHECK(!sds_enables[1] && sds_enables[0] == 1, "dual slot admin 状态独立，按 1/0 映射");
        CHECK(strstr(status_slot(1), "\"enabled\":1"), "第二槽 admin allow 独立");
        unsigned second = sds_enables[0];
        sfp_test_cli("sfp 1 2g5"); poll_after(SFP_WAKE_TICKS);
        CHECK(sds_enables[0] == second && sds_mode[0] == SDS_1000BX_FIBER, "disabled 第一槽 speed 不改第二槽");
        module_present[0] = false; poll_after(0);
        CHECK(sds_mode[0] == SDS_1000BX_FIBER && sds_mode[2] == SDS_QXGMII, "第一槽 removal 不碰第二槽/RTL8224 SDS2");
    } else {
        sfp_test_cli("sfp 2 off"); CHECK(err_status != ERR_OK, "单槽拒绝不存在的 slot 2");
        CHECK(!sds_offs[0] && sds_mode[2] == SDS_QXGMII, "不存在槽不会关闭 RTL8224 SDS0/2");
    }
    uint8_t pins = sfp_pins_last;
    const char *invalid[] = { "sfp 0 off", "sfp 3 on", "sfp 256 off", "sfp 1 nope", "sfp 1 off extra" };
    for (unsigned i = 0; i < sizeof(invalid) / sizeof(*invalid); i++) {
        sfp_test_cli(invalid[i]);
        CHECK(err_status != ERR_OK && sfp_pins_last == pins, "非法 CLI 不修改真实 presence");
    }
    CHECK(!bad_sds_calls && !gpio_outputs, "不使用 invalid/full OFF 或新增 TX_DISABLE");
}

int main(void)
{
    t_explicit_init(); t_empty_admin(); t_disabled_hotplug(); t_cancel_pending(); t_retry();
    t_auto_recovery_and_removal(); t_ddm_failure(); t_unknown(); t_port_entry(); t_replay(); t_wrap_and_slots();
    printf("%d checks, %d failed (%u slots)\n", tests_run, tests_failed, machine.n_sfp);
    return tests_failed ? 1 : 0;
}
