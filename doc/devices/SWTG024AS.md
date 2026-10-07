### SWTG024AS

[English](SWTG024AS.en.md) | 简体中文

SWTG024AS 至少有 4 种外观相同的变体。

变体分为 `managed`（网管型）和 `unmanaged`（非网管型）两种版本。
但两者都有 PCB 版本 `v1.0` 和 `v2.0`。
此外，RJ45 接口可以是全塑料/非屏蔽的，也可以是带金属屏蔽的。

## 品牌
|品牌|型号|可网管|PCB|PCB 标签|Flash|RTL 芯片|
|---|---|---|---|---|---|---|
| LIANGUO |SWTG024AS |否|  SWTG024AS-v2.0-17452 | CM-23-11-2336 023-17453| 512 KiB | 8272 |
| Horaco |ZX-SWTG124AS | 是 |  SWTG024AS-v2.0 | ??? | ??? | 8272 |
| Xikestore |SKS3200M-4GPY2XF | 是 |  SWTG024AS-v1.0 | CM-23-08-2043 023-16721 | 2048 KiB | 8272 |
| Sodola | SL-SWTG124AS-D | 是 | SWTG024AS-v2.0-17452 | ??? | 2048 KiB | 8272 |

## PCB

<img src="photos/SWTG024AS-v2.0-unmanaged/SWTG024AS-v2.0-top-uman.png" width="300" />

# SWTG024AS-v2.0 网管型 vs 非网管型
下面是我在自己的板子与该 PCB 的[网管型版本](https://github.com/up-n-atom/SWTG118AS/tree/main/photos/SWGT024AS-v2.0)之间发现的差异。

### 底面
* R105：已安装，接到 R10 下拉，SFP2 (J2) -> TX-DISABLE
* R85：未安装（连接到 K1 复位按钮）
* R90：未安装（系统 LED）
* LED3：未安装（系统 LED）
### 顶面
* K1：未安装（复位按钮）
* R95：已安装（SFP2 (J2) 信号 RX-LOS），意味着网管型版本无法使用 RX-LOS 功能。
* R270：已安装（SFP1 (J4) 信号 RX-LOS），同上。
* R268：已安装（SFP2 (J2) 信号 TX-DISABLE，但 R262 的 200R 下拉阻值太小，SOC 驱动不了，需要改造！）
* U5：Flash 只有 512 KiB，而不是 2/4 MiB。

### 注意事项
* `TX-Disable`-SFP2 与按钮 `K1` 通过 `R105` 和 `R85` 共享同一个 GPIO 引脚。
  但通过 `R88`，`TX-Disable`-SFP2 可以映射到 `GPIO36`。
* 两颗 SFP 上的 `TX-Disable` 下拉电阻阻值太小，SOC 无法驱动这些引脚。
  我们需要制作一个 `Best`-BOM 变体才能用上全部功能。

# 连接器

## 端口概览

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                                       ┌──────────┐        ┌──────────┐ │
│     ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │ SFP (J4) │        │ SFP (J2) │ │
│     │  RJ45   │ │  RJ45   │ │  RJ45   │ │  RJ45   │   │ PORT   5 │        │ PORT   6 │ │
│     │  PORT 1 │ │  PORT 2 │ │  PORT 3 │ │  PORT 4 │   │ MAC    8 │        │ MAC    3 │ │
│  O  │  MAC  4 │ │  MAC  5 │ │  MAC  6 │ │  MAC  7 │   │ SerDes 1 │        │ SerDes 0 │ │
│ RST └─────────┘ └─────────┘ └─────────┘ └─────────┘   └──────────┘        └──────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## J4

* 位置：左侧 SFP 连接器 `J4`。
* 连接到：10GMAC 编号 8，第二个 SerDes。

|`J4` SFP1 引脚 | 信号 | 元件 | GPIO | 备注 |
|---|---|---|---|---|
|2| TX_FAULT | B-R262 | --- | |
|3| TX_DISABLE | B-R263, T-R268 | GPIO38 | R262 = 200R 下拉|
|4| MODDEF2 – SDA | B-R261, T-R266 | GPIO39 | |
|5| MODDEF1 – SCL | B-R260, T-R267 | GPIO40 | 两颗 SFP 共享 |
|6| MODDEF0 – PRESENT | B-R259, T-R296 | GPIO30 | |
|7| RATE SEL | B-R257 | --- | |
|8| LOS | B-R258, T-R270 | GPIO37 | |
|9| TO? | B-R256 | --- | |

## J2

* 位置：右侧 SFP 连接器 `J2`。
* 连接到：10GMAC 编号 3，第一个 SerDes。

|`J2` SFP2 引脚 | 信号 | 元件 | GPIO | 备注 |
|---|---|---|---|---|
|2| TX_FAULT | B-R70 | --- | |
|3| TX_DISABLE | B-R10, B-R105-R, T-R88-L | GPIO54 | R10 = 200R 下拉 |
|4| MODDEF2 – SDA | B-R26, T-R85 | GPIO41 | |
|5| MODDEF1 – SCL | B-R15, T-R87 | GPIO40 | 两颗 SFP 共享 |
|6| MODDEF0 – PRESENT | B-R14, T-R89 | GPIO50 | |
|7| RATE SEL | B-R12 | --- | |
|8| LOS | B-R13, T-R95 | GPIO51 | |
|9| TO? | B-R11 | --- | |

注意：元件编号格式为 `<L>-<REFDES>-<SIDE>`
* L：层，T=顶面，B=底面
* REFDES：完整丝印，如 `R123`
* SIDE：元件所在的一侧。当 RJ45 朝向你、丝印可以正常阅读时：
  L = 左，R = 右，B = 底，T = 顶，或 P 加引脚号。

### T3，从机接口（Slave Interface）
该连接器连接到 U4 `I2C EEPROM` 和 U10 `SPI FLASH`。
信号的推断基于 `U4` 很可能是一颗 I2C-EEPROM、`U10` 很可能是另一颗 SPI 芯片。
|`T3` 引脚|内容|信号|
|---|---|---|
|1| U4-P6, 33R U10-P6 | I2C-SCL, SPI-CLK, Slave SCK/SCL/MDC/EE_SCL |
|2| GND | --- |
|3| U4-P5, U10-P5 | I2C-SDA, SPI-DI/DO, Slave SDI/SDA/MDIO/EE_SDA |
|4| VCC |
|5| 33R -> U10-P2 | SPI-DO/D1 |
|6| U10-P1 | SPI-CS |
注意：1 号引脚为方形。

从机接口允许外部主机控制 SOC，即使内部 MCU 正被使用时也是如此。
根据 `IF_SEL` 启动配置电阻的不同，可以是 `I2C`、`SPI` 或 `SMI`。
在此设备上是 `I2C`，地址为 `0b1011100` 即 `0x5c`（7 位表示法）。

* I2C 读：必须是一次 write_read 操作 `<Dev-ADDR><RegAddr15:8><RegAddr7:0>` `<DevAddr><Data7:0><Data15:8><Data23:16><Data31:24>`。
* I2C 写：`<Dev-ADDR><RegAddr15:8><RegAddr7:0><DevAddr><Data7:0><Data15:8><Data23:16><Data31:24>`。

例如读取寄存器 `0x0004` 会返回芯片 ID `0x00, 0x00, 0x72, 0x83` = `0x83720000`。

### T5，串口控制台
|`T5` 引脚|GPIO|信号|
|---|---|---|
| 1 | GPIO31 | U0TXD（输出） |
| 2 | GND | |
| 3 | GPIO32 | U0RXD（输入） |
| 4 | 3V3 | |
注意：1 号引脚为方形。

### T8
|`T8` 引脚|内容|信号|
|---|---|---|
| 1 | GPIO46 | |
| 2 | GND    | |
| 3 | GPIO48 | |
| 4 | 3V3    | |
| 5 | GPIO47 | |
| 6 | GPIO49 | |
注意：1 号引脚为方形。

# 复位电路
| 元件 | 功能 |
|---|---|
| T-R78  | 33k 上拉      |
| T-D3   | 放电二极管 |
| T-C187 | RC 延时        |

复位线位于 `T-D3-D`，低电平有效。

# GPIO
| 十六进制值 | GPIO   | 元件 | 说明 |  | GPIO | 元件 | 说明 |
| -------- | ------ |  ---- | ---- | ---- | ---- | ---- | ---- |
| 00000001 | GPIO00 | T-C151-T, T-R28-T, T-R29-T |?    | | GPIO32 | T-R143-R | U0RXD |
| 00000002 | GPIO01 | T-C152-T                |?    | | GPIO33 |  |  |
| 00000004 | GPIO02 | T-C153-T                |?    | | GPIO34 |  |  |
| 00000008 | GPIO03 | T-R33-T                 |?    | | GPIO35 |  |  |
| 00000010 | GPIO04 | B-C155                  |?    | | GPIO36 | T-R88-L, T-R84-B | 可选的 SFP2 TX-DISABLE[^2]，复位 |
| 00000020 | GPIO05 | B-C156                  |?    | | GPIO37 | SFP1-8, T-R270 | SFP-LOS |
| 00000040 | GPIO06 | T-C157-T                |?    | | GPIO38 | SFP1-3, T-R268 | SFP1 TX-DISABLE[^2] |
| 00000080 | GPIO07 | T-C158-T, R165          |?    | | GPIO39 | SFP1-4, T-R266 | I2C-SDA4 |
| 00000100 | GPIO08 |                         |     |  | GPIO40 | SFP2-5, T-R87; SFP1-5, T-R267; | I2C-SCL |
| 00000200 | GPIO09 | SFP2-LED, T-R36-T       |LED-SFP2 | | GPIO41 | SFP2-4, T-R85 | I2C-SDA |
| 00000400 | GPIO10 |                         |     | | GPIO42 |  U8-P6, T-R124 | SPI-MEMORY, CLK |
| 00000800 | GPIO11 |                         |LEDx[^1] | | GPIO43 | U8-P5, T-R127 | SPI-MEMORY, DI,IO0 |
| 00001000 | GPIO12 |                         |LEDx[^1] | | GPIO44 | U8-P2, T-R128 | SPI-MEMORY, DO,IO1 |
| 00002000 | GPIO13 | PORT1-LED-GREEN         |LEDx[^1] | | GPIO45 | U8-P1, T-R123 | SPI-MEMORY, CS  |
| 00004000 | GPIO14 | PORT1-LED-YELLOW        |LEDx | | GPIO46 | T8-1, T-R188| ? |
| 00008000 | GPIO15 |                         |LEDx[^1] | | GPIO47 | T8-5, T-R190 | ? |
| 00010000 | GPIO16 | PORT2-LED-GREEN         |LEDx[^1] | | GPIO48 | T8-3, T-R189 | ? |
| 00020000 | GPIO17 | PORT2-LED-YELLOW        |LEDx | | GPIO49 | T8-6, T-R190 | ? |
| 00040000 | GPIO18 |                         |LEDx[^1] | | GPIO50 | SFP2-6, T-R89 | SFP-DETECT |
| 00080000 | GPIO19 | PORT3-LED-GREEN         |LEDx[^1] | | GPIO51 | SFP2-8, T-R95 | SFP-LOS |
| 00100000 | GPIO20 | PORT3-LED-YELLOW        |LEDx | | GPIO52 |  |  |
| 00200000 | GPIO21 |                         |LEDx[^1] | | GPIO53 |  |  |
| 00400000 | GPIO22 | PORT4-LED-GREEN         |LEDx[^1] | | GPIO54 | SFP2-3, T-R105-L | SFP2 TX-DISABLE[^2] 或经 T-R85 接复位[^3]，T-R84-T |
| 00800000 | GPIO23 | PORT4-LED-YELLOW        |LEDx | | GPIO55 | T-R78-B | |
| 01000000 | GPIO24 | SFP1-LED-J4, T-R35      |LED-SFP1 | | GPIO56 | | |
| 02000000 | GPIO25 |                         |     | | GPIO57 | | |
| 04000000 | GPIO26 | ?                       |LEDx | | GPIO58 | | |
| 08000000 | GPIO27 | R44L                    |?    | | GPIO59 | | |
| 10000000 | GPIO28 | LED-SYSTEM, T-R50-R     |LED-SYSTEM  | | GPIO60 | | |
| 20000000 | GPIO29 | T-R187-R                |     | | GPIO61 | | |
| 40000000 | GPIO30 | SFP1-6, T-R269          |SFP-DETECT | | GPIO62 | | |
| 80000000 | GPIO31 | T-R144-R                |U0TXD| | GPIO63 | | |

# LED

| 名称 | 元件 | GPIO | 有效电平 |
| ---- | ---------- | ---- | ------ |
| SYSTEM | T-R50-R (PU-4k2), T-R49-L, T-C185-L, B-R90 | GPIO28 | 低 |
| SFP1 | T-R35-L (PU-3k9), T-R34-L, T-C179-L | GPIO24 | 低 |
| SFP2 | T-R36-T (PD-4k0) | GPIO09 | 高 |
| PORT1-LED-YELLOW |  | GPIO14 | 低 |
| PORT2-LED-YELLOW |  | GPIO17 | 低 |
| PORT3-LED-YELLOW |  | GPIO20 | 低 |
| PORT4-LED-YELLOW |  | GPIO23 | 低 |

# 供电

板上有两条供电轨：
`0.95` 和 `3.3` 伏。

## `0.95` 核心电压

该电压由 `Richtek RT8120A` Buck 变换器产生。
0.95V 必须保持在 3% 以内。

## `3.3` 电压

该电压由 `TMI3244T` Buck 变换器产生。
3.3V 必须保持在 4.5% 以内。
芯片最大可输出 4A，最佳工作点在 1A。
因此功耗较高的 SFP 模块应该也能工作。


[^1]: 只需插入 RJ45 接头，然后用 `gpio` 命令观察状态变化，就能找到这些 LED。但端口 1、2 的位模式与端口 3、4 不同。
[^2]: 只有非网管型版本安装了 `R10` 和 `R268`。但阻值很低的下拉电阻 `R10` 和 `R262` 使 SOC 无法驱动这些引脚。需要进行改造。
[^3]: GPIO54 用于复位按钮。`T-R85` 已安装。
