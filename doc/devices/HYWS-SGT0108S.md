# Lianguo HYWS-SGT0108S

[English](HYWS-SGT0108S.en.md) | 简体中文

以下是丝印为 `HYWS-SGT0108S` 的非网管交换机的文档。

原厂软件运行时 UART 波特率为 9600。输出非常少。

使用 SPI 夹具夹住板载 Flash 颗粒是初次安装和升级的唯一方法。

原装 Flash 颗粒容量为 512KB。若想通过 Web 界面升级,建议更换颗粒。

- UART 排针的位置标识清晰。
- 红色 LED 灯用作通电指示灯。
- 没有 SYS LED 灯。
- 有一个重置(Reset)按键的焊盘,未焊接。不清楚是否已布线连接到 RTL8373。

### 标签规格

- **名称**:2.5G 以太网交换机 8+1
- **型号**:HYWS-SGT0108S
- **端口**:  
  - 8 × RJ45:10/100/1000/2500 Mbps  
  - 1 × SFP:1000 / 2500 / 10000 Mbps  

### 已实现的功能

- 全部 8 个 2.5GBASE-T RJ45 端口,支持 10/100/1000/2500 Mbps  
- SFP 端口,支持 1G、2.5G 和 10G 模块 
- RJ45 LED 灯(蓝+白)
- SFP 单颗 LED 灯(蓝色)

### 整机

顶面

<img src="photos/HYWS-SGT0108S-unmanaged\Assembled-top.jpg" width="300" />

正面

<img src="photos/HYWS-SGT0108S-unmanaged\Assembled-front.jpg" width="300" />

底面

<img src="photos/HYWS-SGT0108S-unmanaged\Assembled-bottom.jpg" width="300" />

### PCB 概览

**板卡丝印**  
- 顶面丝印:2G5F_20G_V1.01 / 2023-09-28  

顶面

<img src="photos/HYWS-SGT0108S-unmanaged\PCB-top.jpg" width="300" />

底面

<img src="photos/HYWS-SGT0108S-unmanaged\PCB-bot.jpg" width="300" />

原装 SPI Flash 颗粒

<img src="photos/HYWS-SGT0108S-unmanaged\og_spi_flash.jpg" width="300" />

## 供电

电源输入通过圆形插头(barell plug)提供,附带 `12V 1A` 适配器。
