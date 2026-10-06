### SWTG024AS-V2.0

[English](SWTG024AS-V2.0.md) | 简体中文

## 品牌
|品牌|类型|可管理|PCB|Flash|RTL 芯片|
|---|---|---|---|---|---|
| hongyavision | LG-SG5T1 | 否 | PCB-SWTG024AS-V2.0_16895 | 25Q40 | 8272 |

### 铭牌规格

- **名称**：
- **端口**：
  - 5 × RJ45 电口：10/100/1000/2500 Mbps
  - 1 × SFP+：1000 / 2500 / 10000 Mbps
- **供电**：12V DC，1A，5525 插头

<img src="photos/SWTG024AS-V2.0/label.jpg" width="300" />

### 已验证可用的功能
该机型已被完整支持：
- 全部 2.5GBASE-T RJ45 电口可在 10/100/1000/2500 Mbps 下工作
- SFP+ 口支持 1G、2.5G 和 10G 光模块
- LED 指示灯与 OEM 固件指示含义相同
- 在线升级不可用（Flash 仅 512KiB）。
### PCB 概览

**板载丝印**
- 顶面丝印：PCB-SWTG024AS-V2.0

顶面

<img src="photos/SWTG024AS-V2.0/pcb_top.jpg" width="300" />

底面

<img src="photos/SWTG024AS-V2.0/pcb_bottom.jpg" width="300" />

### J1 串口控制台

| `J1` 引脚 | 信号        |
| -------- | ----------- |
| 1        | GND         |
| 2        | RX（输入）  |
| 3        | TX（输出）  |

注意，`R52`、`R53` 可能未贴装，需要用焊锡桥接或补焊电阻。

## 供电

电源经由圆口（barrel）插头输入，随机附带 `12V 1A` 适配器。
