# ZX310S-4T2XT

[English](ZX310S-4T2XT.en.md) | 简体中文

以下是由 Horaco 销售、标记为
`ZX310S-4T2XT` 的网管交换机的文档。

原厂软件的串口(UART)波特率为 57600,8N1。

CPU:RTL8372
Flash:2 MB 的 Winbond W25Q16DV(U3)
PHY:2 × RTL8261BE

### 标签规格

- **名称**:
- **端口**:
  - 4 × RJ45:10/100/1000/2500 Mbps
  - 2 x RJ45:10/100/1000/2500/5000/10000 Mbps
- **电源**:12V DC,2A 桶形接头

<img src="photos/ZX310S-4T2XT/label.jpg" width="300" />

### 已验证可用的功能
该设备已被完整支持:
- 全部 4 个 2.5GBASE-T RJ45 端口可在 10/100/1000/2500 Mbps 下工作,包括 EEE
- 两个 10G 端口可用,包括 EEE。
- LED 灯的指示方式与原厂固件相同

### PCB 概览

**板卡标识**
- 顶面丝印:PCB-SL310S-4T2XT-V1.0.0-22273

顶面

<img src="photos/ZX310S-4T2XT/pcb_top.jpg" width="300" />

底面

<img src="photos/ZX310S-4T2XT/pcb_bottom.jpg" width="300" />

### J1,串口

| `J1` 针脚 | 信号        |
| -------- | ----------- |
| 1        | TX(输出) |
| 2        | RX(输入)  |
| 3        | GND         |
| 4        | 3V3         |


## 供电

输入电源通过桶形插头接入,随附 `12V 2A` 适配器。
