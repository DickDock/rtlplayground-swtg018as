# PCB-K0402WS-V3.0

[English](PCB-K0402WS-V3.0.md) | 简体中文

以下是内部标记为 `PCB-K0402WS-V3.0` 的多款非网管交换机的文档。它们以许多品牌销售。

原厂软件的串口(UART)波特率为 9600。

拆机时注意:设备背面大标签正上方可能有一颗隐藏的第 5 颗螺丝,可能被 QC 贴纸盖住。

### 品牌

* Hisource Hi-K0402WS

<img src="photos/PCB-K0402WS-V3.0/HiSource_HI-K0402WS.jpg" width="300" />

* Ztyuav Z-QWYT0402

<img src="photos/PCB-K0402WS-V3.0/Ztyuav_Z-QWYT0402.jpg" width="300" />

<img src="photos/PCB-K0402WS-V3.0/Ztyuav_Z-QWYT0402_label.jpg" width="300" />

* Siscolink SL-G0402F

<img src="photos/PCB-K0402WS-V3.0/Siscolink SL-G0402F.jpg" width="300"/>
### 烧录

初次安装的唯一方法是在板上使用 SPI 夹具进行烧录。

板上有两颗 `BY25Q16BS` Flash 颗粒,容量为 16 Mbit。前面板上的开关可在两颗 Flash 颗粒之间切换。
借助该开关可以分别独立地对它们进行烧录——例如可以让原厂固件与新固件并存运行。
该开关实际控制的是每颗 Flash 颗粒的 HOLD 线,拨动开关会导致设备重启。

如果烧录夹具未连接 HOLD 线,那么无论夹具夹住的是哪颗颗粒,烧录都会在开关当前所选的颗粒上进行。

初次烧录时(至少使用 flashrom 是如此),构建产生的 bin 文件远小于 Flash 颗粒容量,建议先填充(padding)文件以免 flashrom 报错:`truncate -s 2097152 rtlplayground-*-PCB_K0402WS_V3.bin`。注意:之后不要把这个填充后的文件用于 Web 刷机(会导致设备变砖),请使用原始未填充的 .bin。

### 可用功能(根据标签及类似设备推断)

- 全部 4 个 2.5GBASE-T RJ45 端口,10/100/1000/2500 Mbps  
- 两个 SFP 端口均支持 1G、2.5G 和 10G 模块 
- LED 灯

### PCB 概览

**板卡标识**  
- 顶面丝印:PCB-KO4022W-V3.0 / DIP-KO4022WS-V3.0  

顶面

<img src="photos/PCB-K0402WS-V3.0/PCB-top.jpg" width="300" />

底面

<img src="photos/PCB-K0402WS-V3.0/PCB-bottom.jpg" width="300" />

### T2,串口

| `J2` 针脚 | 信号        |
| -------- | ----------- |
| 1        | 3V3         |
| 2        | RX(输入) |
| 3        | TX(输出)  |
| 4        | GND         |


## 供电

输入电源通过桶形插头接入,随附 `12V 1A` 适配器。
板上有两条供电轨。`0.95` 和 `3.3` 伏。

### `0.95` 核心电压

该电压由 `Techcode TD1720` 产生。

### `3.3` 电压

该电压由标记为 `Techcode TD1720` 的芯片产生。

**选型电感时似乎存在计算失误,改用 5V 电源供电时,设备的效率约提高 25%。**
