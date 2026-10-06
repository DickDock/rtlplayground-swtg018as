# ZX-SWTGW215AS

[English](SWTGW215AS.md) | 简体中文

## 品牌

|品牌|型号|可网管|PCB|Flash|RTL 芯片|
|---|---|---|---|---|---|
| Lianguo | ZX-SWTGW215AS | 是 | PCB-SWTG115AS-V2.0 | FM25Q16A | 8372 |
| 以 Lianguo 名义销售，实际设备无品牌 | ZX-SWTGW215AS | 是 | PCB-SWTG115AS-V2.1 | W25Q16JVSIQ (2MiB) | 8372 |

## RTLPlayground 目标

此设备请使用 machine target `MACHINE_LIANGUO_ZX_SWTGW215AS`。

实物硬件验证：5 个 RJ45 端口 + 1 个 SFP 端口。
RJ45 端口 5 通过一颗 RTL8221B 芯片接入。

## 标签（V2.0）

<img src="photos/ZX-SWTGW215AS-V2.0/label.jpg" width="300" />

## PCB（V2.0）

<img src="photos/ZX-SWTGW215AS-V2.0/pcb_top.jpg" width="300" />
<img src="photos/ZX-SWTGW215AS-V2.0/pcb_bottom.jpg" width="300" />

## PCB（V2.1）

<img src="photos/ZX-SWTGW215AS-V2.1/pcb-top.jpg" width="300" />
<img src="photos/ZX-SWTGW215AS-V2.1/pcb-bottom.jpg" width="300" />

## 连接器

### 端口概览

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                                                   ┌──────────┐   │
│     ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │ SFP (J4) │   │
│     │  RJ45   │ │  RJ45   │ │  RJ45   │ │  RJ45   │ │  RJ45   │   │  PORT 6  │   │
│     │  PORT 1 │ │  PORT 2 │ │  PORT 3 │ │  PORT 4 │ │  PORT 5 │   │  LOG  8  │   │
│  O  │  LOG  4 │ │  LOG  5 │ │  LOG  6 │ │  LOG  7 │ │  LOG  3 │   │ SerDes 1 │   │
│ RST └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   └──────────┘   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

| 类型 | RTLPlayground 逻辑端口 | 物理序号 |
|---|---|---|
| RJ45 | 3, 4, 5, 6, 7 | 1-5 |
| SFP | 8 | 6 |

### J4

* 位置：SFP 连接器 `J4`。
* 连接到：10GMAC 编号 8，SerDes 1。

|`J4` SFP 引脚 | 信号 | GPIO | 备注 |
|---|---|---|---|
|3| TX_DISABLE | GPIO_NA | 未连接 |
|4| MODDEF2 – SDA | GPIO39 | I2C SDA |
|5| MODDEF1 – SCL | GPIO40 | I2C SCL |
|6| MODDEF0 – PRESENT | GPIO30 | 在位检测 |
|8| LOS | GPIO37 | RX 信号丢失 |

#### 注意
* 并非所有信号都完成了实物核对，因此未纳入文档。

### T3，从机接口（Slave Interface）

该连接器连接到 U4 `I2C EEPROM` 和 U10 `SPI FLASH`（映射与 SWTG024AS 相同）。

有关从机接口功能与协议的详细信息，参见 [SWTG024AS.zh-CN.md 中的 T3 文档](SWTG024AS.zh-CN.md#t3-slave-interface)。

|`T3` 引脚|内容|信号|
|---|---|---|
|1| U4-P6, 33R U10-P6 | I2C-SCL, SPI-CLK, Slave SCK/SCL/MDC/EE_SCL |
|2| GND | --- |
|3| U4-P5, U10-P5 | I2C-SDA, SPI-DI/DO, Slave SDI/SDA/MDIO/EE_SDA |
|4| VCC |
|5| 33R -> U10-P2 | SPI-DO/D1 |
|6| U10-P1 | SPI-CS |

#### 注意
* 1 号引脚为方形。


### T5，串口控制台

|`T5` 引脚|GPIO|信号|
|---|---|---|
| 1 | GPIO31 | U0TXD（输出） |
| 2 | GND | |
| 3 | GPIO32 | U0RXD（输入） |
| 4 | 3V3 | |

#### 注意
* 1 号引脚为方形。

### T8

|`T8` 引脚|GPIO|信号|
|---|---|---|
| 1 | GPIO46 | |
| 2 | GND    | |
| 3 | GPIO48 | |
| 4 | 3V3    | |
| 5 | GPIO47 | |
| 6 | GPIO49 | |

#### 注意
* 1 号引脚为方形。
* 映射未经核实，但假定与 [LIANGUO SWTG024AS](SWTG024AS.zh-CN.md#t8) 相同。

## 复位电路
| 功能 | GPIO |
|---|---|
| 复位按钮 | GPIO54 |

### 注意
* 电路为低电平有效。

## GPIO

注意：下表中与 T3/U4/U10 相关的信号标注复制自 [LIANGUO SWTG024AS 的 T3 部分](SWTG024AS.zh-CN.md#t3-slave-interface)，T8 端口部分复制自 [LIANGUO SWTG024AS 的 T8 部分](SWTG024AS.zh-CN.md#t8)。目前尚未 100% 确认属实，应假定它们对 ZX-SWTGW215AS 同样适用。

| 十六进制值 | GPIO   | 元件 / 用途 | 备注 |  | GPIO | 元件 / 用途 | 备注 |
| -------- | ------ |  ---- | ---- | ---- | ---- | ---- | ---- |
| 00000001 | GPIO00 | | |  | GPIO32 | T5-3 | U0RXD |
| 00000002 | GPIO01 | | |  | GPIO33 |   |  |
| 00000004 | GPIO02 | | |  | GPIO34 |   |  |
| 00000008 | GPIO03 | | |  | GPIO35 |   |  |
| 00000010 | GPIO04 | | |  | GPIO36 |   |  |
| 00000020 | GPIO05 | | |  | GPIO37 | J4-8 | SFP LOS |
| 00000040 | GPIO06 | | |  | GPIO38 |   |  |
| 00000080 | GPIO07 | | |  | GPIO39 | J4-4 | SFP I2C SDA |
| 00000100 | GPIO08 | | |  | GPIO40 | J4-5 | SFP I2C SCL |
| 00000200 | GPIO09 | | |  | GPIO41 |   |  |
| 00000400 | GPIO10 | | |  | GPIO42 | U10-P6, U4-P6, T3-1 | SPI FLASH CLK / I2C-SCL（来自 [LIANGUO SWTG024AS](SWTG024AS.zh-CN.md#gpio)） |
| 00000800 | GPIO11 | | |  | GPIO43 | U10-P5, U4-P5, T3-3 | SPI FLASH DI/IO0 / I2C-SDA（来自 [LIANGUO SWTG024AS](SWTG024AS.zh-CN.md#gpio)） |
| 00001000 | GPIO12 | | |  | GPIO44 | U10-P2, T3-5 | SPI FLASH DO/IO1（来自 [LIANGUO SWTG024AS](SWTG024AS.zh-CN.md#gpio)） |
| 00002000 | GPIO13 | 端口 1 LED 绿色 |  |  | GPIO45 | U10-P1, T3-6 | SPI FLASH CS（来自 [LIANGUO SWTG024AS](SWTG024AS.zh-CN.md#gpio)） |
| 00004000 | GPIO14 | 端口 1 LED 橙色 |  |  | GPIO46 | T8-1 |（来自 [LIANGUO SWTG024AS](SWTG024AS.zh-CN.md#gpio)） |
| 00008000 | GPIO15 | | |  | GPIO47 | T8-5 |（来自 [LIANGUO SWTG024AS](SWTG024AS.zh-CN.md#gpio)） |
| 00010000 | GPIO16 | 端口 2 LED 绿色 |  |  | GPIO48 | T8-3 |（来自 [LIANGUO SWTG024AS](SWTG024AS.zh-CN.md#gpio)） |
| 00020000 | GPIO17 | 端口 2 LED 橙色 |  |  | GPIO49 | T8-6 |（来自 [LIANGUO SWTG024AS](SWTG024AS.zh-CN.md#gpio)） |
| 00040000 | GPIO18 | 端口 3 LED 绿色 |  |  | GPIO50 |   |  |
| 00080000 | GPIO19 | 端口 3 LED 橙色 |  |  | GPIO51 |   |  |
| 00100000 | GPIO20 | 端口 4 LED 绿色 |  |  | GPIO52 |   |  |
| 00200000 | GPIO21 | 端口 4 LED 橙色 |  |  | GPIO53 |   |  |
| 00400000 | GPIO22 | 端口 5 LED 绿色 |  |  | GPIO54 | 复位按钮 | GPIO54_ACL_BIT2_EN |
| 00800000 | GPIO23 | 端口 5 LED 橙色 |  |  | GPIO55 |   |  |
| 01000000 | GPIO24 | SFP LED 绿色 | J4 |  | GPIO56 |   |  |
| 02000000 | GPIO25 | | |  | GPIO57 |   |  |
| 04000000 | GPIO26 | | |  | GPIO58 |   |  |
| 08000000 | GPIO27 | | |  | GPIO59 |   |  |
| 10000000 | GPIO28 | LED-SYSTEM |  |  | GPIO60 |   |  |
| 20000000 | GPIO29 | | |  | GPIO61 |   |  |
| 40000000 | GPIO30 | J4-6 | SFP 在位检测 |  | GPIO62 |   |  |
| 80000000 | GPIO31 | T5-1 | U0TXD |  | GPIO63 |   |  |

## LED

| 名称 | GPIO | 端口 | 功能 | 备注 |
| ---- | ---- | ---- | ---- | ---- |
| 端口 1 LED 绿色 | GPIO13 |5| 活动 | LEDS_2G5, LEDS_LINK, LEDS_ACT |
| 端口 1 LED 橙色 | GPIO14 | 5 | 速率 | LEDS_1G, LEDS_100M, LEDS_10M, LEDS_LINK, LEDS_ACT |
| 端口 2 LED 绿色 | GPIO16 | 4 | 活动 | LEDS_2G5, LEDS_LINK, LEDS_ACT |
| 端口 2 LED 橙色 | GPIO17 | 4 | 速率 | LEDS_1G, LEDS_100M, LEDS_10M, LEDS_LINK, LEDS_ACT |
| 端口 3 LED 绿色 | GPIO18 | 3 | 活动 | LEDS_2G5, LEDS_LINK, LEDS_ACT |
| 端口 3 LED 橙色 | GPIO19 | 3 | 速率 | LEDS_1G, LEDS_100M, LEDS_10M, LEDS_LINK, LEDS_ACT |
| 端口 4 LED 绿色 | GPIO20 | 2 | 活动 | LEDS_2G5, LEDS_LINK, LEDS_ACT |
| 端口 4 LED 橙色 | GPIO21 | 2 | 速率 | LEDS_1G, LEDS_100M, LEDS_10M, LEDS_LINK, LEDS_ACT |
| 端口 5 LED 绿色 | GPIO22 | 1 | 活动 | LEDS_2G5, LEDS_LINK, LEDS_ACT |
| 端口 5 LED 橙色 | GPIO23 | 1 | 速率 | LEDS_1G, LEDS_100M, LEDS_10M, LEDS_LINK, LEDS_ACT |
| SFP LED 绿色 | GPIO24 | 6（SFP J4）| 多速率 | LEDS_10G, LEDS_5G, LEDS_2G5, LEDS_1G, LEDS_100M, LEDS_LINK, LEDS_ACT |
| LED-SYSTEM | GPIO28 | --- | 系统状态 | --- |

## 注意事项

虽然 [SWTG024AS.zh-CN.md](SWTG024AS.zh-CN.md) 可以作为硬件概念和接口规格的一般参考，但除了下文已明确指出的差异之外，不应假定本设备与之完全相同。并非所有信息都做过与 SWTG215AS 的兼容性验证。请谨慎参考 SWTG024AS 文档，并对任何关键细节以本设备为准进行核实。

## 刷机

对于搭载 Winbond 25Q16JVSIQ 的设备，可以例如使用 flashprog 并指定器件 “W25Q16.V” 来刷写。注意不要覆写整个 flash，以保留设备特定的数据（例如位于 0x1fc000 的 MAC 地址）。当然，事先对整个 flash 做一次备份是非常明智的做法。
