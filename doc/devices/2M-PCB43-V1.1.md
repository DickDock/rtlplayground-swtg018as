# 2G040210GSM

[English](2M-PCB43-V1.1.en.md) | 简体中文

以下是由 Mokerlink 销售、标记为 `2G040210GSM` 的网管交换机的文档。

### 标签规格

- **名称**:4 端口 2.5G Web 网管交换机
- **端口**:
  - 4 × RJ45:10/100/1000/2500 Mbps
  - 2 × SFP+:1000 / 2500 / 10000 Mbps
- **电源**:12V DC,1A 桶形接头 

### 已验证可用的功能
该设备已被完整支持:
- 全部 4 个 2.5GBASE-T RJ45 端口可在 10/100/1000/2500 Mbps 下工作
- SFP+ 端口支持 1G、2.5G 和 10G 模块 
- LED 灯的指示方式与原厂固件相同(自行编译时请在 machine.h 中使用 KP_9000_6XHML_X2_V1_1,或使用对应的预编译二进制)
- 因缺少硬件未测试:装有 1G 或 2.5G SFP 的 SFP+ 端口。

### 硬件概览
正面

<img src="photos/2M-PCB43-V1.1-managed/2M-PCB43-V1.1-front.jpeg" width="300" />

标签

<img src="photos/2M-PCB43-V1.1-managed/2M-PCB43-V1.1-label.jpeg" width="300" />

### PCB 概览

**板卡标识**
- 顶面丝印:2M-PCB43-V1.1

顶面

<img src="photos/2M-PCB43-V1.1-managed/2M-PCB43-V1.1-top.jpeg" width="300" />

底面

<img src="photos/2M-PCB43-V1.1-managed/2M-PCB43-V1.1-bottom.jpeg" width="300" />

### J1,串口

| `J8` 针脚 | 信号        |
| -------- | ----------- |
| 1        | RX(输入)  |
| 2        | TX(输出) |
| 3        | GND         |
| 4        | 3V3         |


## 供电

输入电源通过桶形插头接入,随附 `12V 1A` 适配器。
