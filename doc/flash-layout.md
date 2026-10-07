# Flash 分区与内存映射

[English](flash-layout.en.md) | 简体中文

本文描述 1MB 镜像架构(2026-10 起)的 flash 分区、bank 映射机制与升级流程。布局常量的权威来源:根 `Makefile`(构建侧)与 `rtl837x_common.h`(固件侧),本文与两者保持同步。

## 总览

SWTG018AS-A V2.0 板载 2 MB SPI NOR flash(容量由固件启动时读 JEDEC ID 自动识别)。前 1 MB 是运行镜像,后 1 MB 是 Web 升级的上传暂存区:

```
0x00000 ┌────────────────────────────┐
        │ HOME(公共区,16KB 上限)      │  上电预取进代码 RAM,常驻可执行
0x04000 ├────────────────────────────┤
        │ bank 1(48KB 窗口)           │  网络栈:uip 全家 + httpd
0x10000 ├────────────────────────────┤ ← ihx 链接基址 0x14000
        │ bank 2                      │  页面生成:page_impl
0x1C000 ├────────────────────────────┤ ← 0x24000
        │ bank 3                      │  命令解析:cmd_parser/cmd_editor
0x28000 ├────────────────────────────┤ ← 0x44000
        │ bank 4                      │  芯片驱动 A:port/init/phy/pins
0x34000 ├────────────────────────────┤ ← 0x54000
        │ bank 5                      │  芯片功能 B:stp/leds/bandwidth/qos/storm/igmp/lacp
0x40000 ├────────────────────────────┤ ← 0x64000
        │ bank 6                      │  服务:boot/sfp/dhcp/syslog
0x4C000 ├────────────────────────────┤ ← 0x74000
        │ bank 7-10(哨兵预留)          │  每 bank 一条哨兵字符串,防构建静默丢 bank
0x7C000 ├────────────────────────────┤
        │ (零填充)                    │
0xB0000 ├────────────────────────────┤
        │ HTML 区(64KB 槽,gzip)       │  当前 ~42.5KB;fileadder 逐文件写入
0xC0000 ├────────────────────────────┤
        │ 预留(248KB)                 │  未来资源区
0xFE000 ├────────────────────────────┤
        │ 默认配置(4KB)               │  恢复出厂时复制到活动配置
0xFF000 ├────────────────────────────┤
        │ 活动配置(4KB)               │  Web「保存到 Flash」写入
0xFFFFE ├────────────────────────────┤
        │ CRC16(2B)                   │  全镜像 Modbus CRC 的补码
0x100000 ├───────────────────────────┤
        │ 上传暂存区(1MB)             │  Web「固件升级」先写这里
0x20000 └────────────────────────────┘
```

## Bank 映射机制

- 8051 的 16 位地址空间中,`0x4000-0xFFFF`(48KB)是代码窗口;`PSBANK` 寄存器(SFR 0x96)选择窗口映射到第几个 48KB bank,**bank 在 flash 里连续排列**(bank k 位于 `0x4000+(k-1)*0xC000`,无间隙)。
- `0x0000-0x3FFF`(HOME)上电时被预取进代码 RAM,与 PSBANK 无关、恒可执行。中断服务程序、flash 驱动与 CRC 执行体必须放这里:擦写 flash 期间控制器被切到命令模式,只有 HOME 能取指。
- 跨 bank 调用必须经过 `__sdcc_banked_call` trampoline(`crtbank.asm`,bank 号取通用指针高字节的低 5 位,即最多 32 个 bank)。函数用 `__banked` 关键字标注,模块用 `#pragma codeseg/constseg` 分配 bank。
- **`__code` 指针只在 PSBANK 指向其所在 bank 时有效**(MOVC 不做 bank 修正)。跨模块共享的 `__code` 对象必须放 HOME;`tools/check_banking.py`(CI)会拦截跨 bank 平调、codeseg/constseg 错配与字面量落点错误。
- `flash_read_bulk/flash_write_bytes`(rtl837x_flash.c)走 SPI 控制器命令 + 24 位地址,**不经 PSBANK**,可读写任意地址(HTML 区、暂存区由此访问)。

## 构建常量对照

| 位置 | Makefile(十进制,fileadder 用 atoi) | rtl837x_common.h | 值 |
|---|---|---|---|
| 镜像总大小 | `IMAGESIZE` | `FIRMWARE_IMAGE_SIZE`(= UPLOAD_START) | 0x100000 |
| HTML 区 | `HTML_LOCATION` | —(FDATA_START_* 自动生成) | 0xB0000 |
| 默认配置 | `DEFAULT_CONFIG_LOCATION` | `DEFAULT_CONFIG_START` | 0xFE000 |
| 活动配置 | `CONFIG_LOCATION` | `CONFIG_START` | 0xFF000 |
| 暂存区起点 | — | `FIRMWARE_UPLOAD_START` | 0x100000 |
| bank 链接基址 | `LDFLAGS_BANKS`(`-Wl-bBANKn`) | — | n*0x10000+0x4000 |

## 升级流程

1. Web「固件升级」把 `.bin`(512 KB 或 1 MB)上传到暂存区;浏览器与固件各自校验 magic(`00 40 02`)与全镜像 CRC16-Modbus(== 0xB001)。
2. 重启后 `check_and_flash_update_image()`(rtlplayground.c)重新校验暂存区,再把镜像搬回 `0x0`(活动配置扇区不触碰,配置跨升级保留),擦除暂存区后复位。
3. **升级过程中(LED 快闪)请勿断电**:原地搬运中途断电会导致半新半旧镜像,只能通过 SOIC-8 夹具(flashrom)或串口安装器恢复。
4. Web 升级要求 2 MB flash;1 MB 芯片的机型镜像本身放得下,但暂存区放不下,无法 Web 升级(只能夹具/串口)。

### 桥接固件(旧版 → 1MB 布局的一次性跳板)

旧版固件(512 KB 布局)的暂存区只有 512 KB,无法直接接受 1 MB 镜像。`make BRIDGE=1` 构建一个运行在旧布局上的桥接变体(`*-bridge.bin`):先刷桥接(旧固件接受),再在桥接态上传 1 MB 正式镜像——桥接版会把活动配置注入暂存镜像的新位置(`0x1FF000`)一并安装,配置无损。桥接态也接受 512 KB 旧镜像(刷回旧版;截断的 1 MB 上传会被「高半区必须全擦除」检查拒绝)。

## 守护机制

- `make`:imagebuilder 输出必须恰为 `(bank 数+1)×64 KB`(当前 0xB0000),bank 数漂移会在构建期报错;最终 `.bin` 大小断言为 `IMAGESIZE`。
- `tools/check_banking.py`(CI):跨 bank 平调、codeseg/constseg 错配、`__code` 字面量落点、ISR 位置、HOME 16 KB 预算。
- CI `firmware.yml`:对每个机型报告十个 bank 的余量与栈余量(最低 150 字节)。
