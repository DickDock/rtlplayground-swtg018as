# TrendNet TEG-S562

[English](TEG-S562.en.md) | 简体中文

以下是针对标识为 `TEG-S563/EU H/W: V1.0R` 的非网管型交换机的文档。

原厂软件的 UART 波特率为 57600。该软件不允许通过串口做太多复杂的操作。其中有 `IP` 配置，也可以打印出来。
可能还存在某种 flash 上传流程，但使用 SPI 夹具进行在板操作似乎是更简单的方法。

存储芯片为 `Winbond W25Q16JV`，容量 16M-bit。

## 可正常工作的功能

1. 2.5G 端口在所有标称速率下均正常工作。
2. SFP+ 通信。
3. 串口、Web UI。
4. 所有 LED。

## 已知问题

无。

## PCB

厂商信息可以在[产品页面](https://www.trendnet.com/support/support-detail.asp?prod=105_TEG-S562)找到。

顶面

<img src="photos/TEG-S562/TEG-S562-v1.0R-top.jpg" width="300" />

底面

<img src="photos/TEG-S562/TEG-S562-v1.0R-bottom.jpg" width="300" />

## 连接器

### 端口概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                   ┌──────────┐ ┌──────────┐ │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │ SFP    2 │ │ SFP    1 │ │
│ │  RJ45   │ │  RJ45   │ │  RJ45   │ │  RJ45   │   │ PORT   5 │ │ PORT   6 │ │
│ │  PORT 1 │ │  PORT 2 │ │  PORT 3 │ │  PORT 4 │   │ MAC    8 │ │ MAC    3 │ │
│ │  MAC  4 │ │  MAC  5 │ │  MAC  6 │ │  MAC  7 │   │ SerDes 0 │ │ SerDes 1 │ │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘   └──────────┘ └──────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### J2，串口控制台

| `J2` 引脚 | 信号        |
| -------- | ----------- |
| 1        | 3V3         |
| 2        | TX（输出） |
| 3        | RX（输入）  |
| 4        | GND         |

注意：1 号引脚为方形，朝向电源输入端。

### J5，供电直通（power pass-thru）

| `J5` 引脚 | 信号 |
| -------- | ------ |
| 1        | 12V    |
| 2        | 12V    |
| 3        | GND    |
| 4        | GND    |

注意：1 号引脚为方形。

### U5，I2C EEPROM 预留位

| `J5` 引脚 | 信号        |
| -------- | ------------- |
| 1        | GND           |
| 2        | GND           |
| 3        | GND           |
| 4        | GND           |
| 5        | 3V3           |
| 6        | ??? 逻辑低电平 |
| 7        | SCL           |
| 8        | SDA           |

SOC 的 I2C 地址是 0x5c。

### SW1，GPIO 开关？

未焊接，但看起来像是一个用于选择 GPIO 电平的开关。缺少电阻，位置空置。

GPIO 映射未知。

### S2 复位电路

未焊接，但看起来可以在 `S2` 连接器上加装一个按钮，
还需要额外加装 `R571` 电阻把信号拉到地。

GPIO 映射未知。

### GPIO

| 十六进制值 | GPIO   | 状态            | GPIO   | 状态                   |
| -------- | ------ | ----------------| ------ | -----------------------|
| 00000001 | GPIO00 |                 | GPIO32 |                        |
| 00000002 | GPIO01 |                 | GPIO33 |                        |
| 00000004 | GPIO02 |                 | GPIO34 | 随机变化         |
| 00000008 | GPIO03 |                 | GPIO35 |                        |
| 00000010 | GPIO04 |                 | GPIO36 | SFP2 在位           |
| 00000020 | GPIO05 |                 | GPIO37 | SFP2 RX 丢失            |
| 00000040 | GPIO06 |                 | GPIO38 | SFP1 在位           |
| 00000080 | GPIO07 |                 | GPIO39 |                        |
| 00000100 | GPIO08 |                 | GPIO40 |                        |
| 00000200 | GPIO09 |                 | GPIO41 |                        |
| 00000400 | GPIO10 |                 | GPIO42 | 随机变化         |
| 00000800 | GPIO11 |                 | GPIO43 |                        |
| 00001000 | GPIO12 | 端口 1 有链路      | GPIO44 |                        |
| 00002000 | GPIO13 | PORT1-LED-GREEN | GPIO45 |                        |
| 00004000 | GPIO14 | PORT1-LED-AMBER | GPIO46 | SFP1 I2C CLK           |
| 00008000 | GPIO15 | 端口 2 有链路      | GPIO47 | SFP1 I2C SDA           |
| 00010000 | GPIO16 | PORT2-LED-GREEN | GPIO48 | SFP2 I2C CLK           |
| 00020000 | GPIO17 | PORT2-LED-AMBER | GPIO49 | SFP2 I2C SDA           |
| 00040000 | GPIO18 | 端口 3 有链路      | GPIO50 | SFP1 Rx LOS            |
| 00080000 | GPIO19 | PORT3-LED-GREEN | GPIO51 | SFP2 TX Disable        |
| 00100000 | GPIO20 | PORT4-LED-AMBER | GPIO52 |                        |
| 00200000 | GPIO21 | 端口 4 有链路      | GPIO53 |                        |
| 00400000 | GPIO22 | PORT4-LED-GREEN | GPIO54 | SFP1 TX Disable        |
| 00800000 | GPIO23 | PORT4-LED-AMBER | GPIO55 |                        |
| 01000000 | GPIO24 |                 | GPIO56 |                        |
| 02000000 | GPIO25 |                 | GPIO57 |                        |
| 04000000 | GPIO26 |                 | GPIO58 |                        |
| 08000000 | GPIO27 |                 | GPIO59 |                        |
| 10000000 | GPIO28 |                 | GPIO60 |                        |
| 20000000 | GPIO29 |                 | GPIO61 |                        |
| 40000000 | GPIO30 |                 | GPIO62 |                        |
| 80000000 | GPIO31 |                 | GPIO63 |                        |

## LED

端口 1-4 在 100M/1G 链路下为琥珀色，2.5G 下为绿色。
端口 5-6 在 10G/1G 链路下为绿色。两者都应在有活动时闪烁。

| 名称             | 何时点亮       |
| ---------------- | ---------------|
| PWR              | 3V3            |
| SFP1             |                |
| SFP2             |                |
| PORT1-LED-GREEN  | -              |
| PORT2-LED-GREEN  | 端口 2 2.5G     |
| PORT3-LED-GREEN  | 端口 3 2.5G     |
| PORT4-LED-GREEN  | 端口 4 2.5G     |
| PORT1-LED-AMBER  | 端口 1 1GB/100M |
| PORT2-LED-AMBER  | 端口 2 1GB/100M |
| PORT3-LED-AMBER  | 端口 3 1GB/100M |
| PORT4-LED-AMBER  | 端口 4 1GB/100M |

## 供电

输入电源通过桶形插头提供，随附 `12V 1A` 适配器。
板上有两条供电轨：`0.95` 和 `3.3` 伏。

### `0.95` 核心电压

该电压由 `APW8713`（U3）产生。

### `3.3` 电压

该电压由丝印标记为 `GoIAT`（U2）的芯片稳压产生。

## SFP SPI

两颗 SFP 模块各有独立的时钟和数据线。需要启用 MSDA/MSCK 0 和 1。

SFP1 插槽连接到 SPI0。SFP2 插槽连接到 SPI1。
