# ZX310S-4T2XH/

[English](ZX310S-4T2XH.md) | 简体中文

以下是由 Horaco 销售、标记为 `ZX310S-4T2XH` 的网管交换机的文档。

原厂软件的串口(UART)波特率为 57600。UART 排针的焊孔被焊锡填满。若要安装 UART 排针,
需要先把焊孔清开。可以使用 1.2mm 钻头,或者使用吸锡带。
原厂固件使用 57600 波特 8N1

CPU:RTL8372
Flash:2 MB 的 Winbond W25Q16DV(U3)
PHY:RTL8261BE

### 标签规格

- **名称**: 
- **端口**:
  - 4 × RJ45:10/100/1000/2500 Mbps
  - 1 x RJ45:10/100/1000/2500/5000/10000 Mbps
  - 1 × SFP+:1000 / 2500 / 10000 Mbps
- **电源**:12V DC,2A 桶形接头 

<img src="photos/ZX310S-4T2XH/label.jpg" width="300" />

### 已验证可用的功能
该设备已被完整支持:
- 全部 4 个 2.5GBASE-T RJ45 端口可在 10/100/1000/2500 Mbps 下工作
- 10G 端口可用。TODO:修复 EEE、速率选择
- SFP+ 端口支持 1G、2.5G 和 10G 模块 
- LED 灯的指示方式与原厂固件相同

### PCB 概览

**板卡标识**
- 顶面丝印:PCB-SL310S-4T1T1X-V1.0.1-24107

顶面

<img src="photos/ZX310S-4T2XH/pcb_top.jpg" width="300" />

底面

<img src="photos/ZX310S-4T2XH/pcb_bottom.jpg" width="300" />

### J1,串口

| `J1` 针脚 | 信号        |
| -------- | ----------- |
| 1        | TX(输出) |
| 2        | RX(输入)  |
| 3        | GND         |
| 4        | 3V3         |


## 供电

输入电源通过桶形插头接入,随附 `12V 2A` 适配器。
