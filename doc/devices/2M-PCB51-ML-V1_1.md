# MokerLink POE-2G080110GS

[English](2M-PCB51-ML-V1_1.en.md) | 简体中文

`POE-2G080110GS` 是 Mokerlink 销售的一款非网管 PoE 交换机,具有 8 个 2.5G RJ45 端口和 1 个 SFP+ 端口。另有网管版本 `POE-2G080110GSM`,可能与本机类似,但这尚未在实机硬件上验证过。

## 品牌
| 品牌    | 型号             | 网管 | PCB              | Flash           | RTL 芯片       |
|--------|------------------|-------|------------------|-----------------|---------------|
| Mokerlink | POE-2G080110GS | 否 | 2M-PCB51-ML-V1.1 | 4MB (W25Q32JV) | 8373N + 8224N |

## 硬件概览
正面

<img src="photos/POE-2G080110GS/POE-2G080110GS-front.jpg" width="300" />

标签

<img src="photos/POE-2G080110GS/POE-2G080110GS-label.jpg" width="300" />

一台 POE-2G080110GS 设备原厂固件的 sha256sum 为 `4c280853465eaad80e1772075c0f2d29c11fb8c561547f06353d3a5443c388e9`。

### PCB

顶面丝印标记为 `2M-PCB51-ML-V1.1`。PoE 由 RTL8238C 提供。Flash 颗粒为 4 MB 的 Winbond 25Q32JV(U8)。

<img src="photos/POE-2G080110GS/POE-2G080110GS-pcb.jpg" width="300" />

> [!CAUTION]
> 本设备使用市电电压,可能造成危险甚至致命的伤害。即使设备已经断电,高压电容在此之后仍可能带电,依然可能电击到你。除非你了解如何安全操作,否则不要尝试打开/拆解使用市电供电的设备。此外,打开设备可能导致保修失效。

## 备注

原厂固件在有流量时会同时闪烁 2.5G 和 1G 两个 LED 灯,尽管设备正面标示两个 LED 应各自独立。`POE_2G080110GS` 机型配置的行为与设备正面的标示一致(也更合乎逻辑)——每个端口的 LED 独立点亮和闪烁。
