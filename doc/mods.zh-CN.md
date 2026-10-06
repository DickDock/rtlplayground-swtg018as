# 改装

[English](mods.md) | 简体中文

## SPI Flash 存储器

SPI Flash 存储器可以更换为其他型号。可能是因为芯片损坏（如 #69 与 #70 所述），或者你手上的非网管型交换机 flash 容量太小，想把它改造成网管型版本以在其上运行 `RTLPlayground` 软件。目前 `RTLPlayground` 固件要求 `8 MBit / 1 MiB`。

### 容量

SOC（RTL837x 网络芯片）使用 24 位地址访问该器件。这意味着理论上最大可以使用 `2^24 x 8-bit = 16777216 x 8-bit = 128 MBit or 16 MiB` 的存储容量，但这是*未经测试*的！

### 速度

SOC（RTL837x 网络芯片）通过 SPI 总线连接到 flash 存储器。SPI 总线频率为 `62.5 MHz`。
在数据手册中查找 `AC Electrical Characteristics`（交流电气特性），找到符号 `Fr`。其最大值应等于或高于 `62.5 MHz`。
支持最高时钟速度的器件并不一定更好，SOC 也不会因此运行得更快。因此选择常见频率在 `80 MHz` 到 `133 MHz` 之间的即可。
存储器速度由 SPI 总线时钟频率决定，即 `62.5 MHz`。

### SPI 操作

默认情况下，SPI 总线使用 `CLK`、`CS`、`DI` 和 `DO`。为了在不提高总线频率的情况下增加数据吞吐量，单条命令可以运行在 `DUAL SPI operation` 模式下。这意味着对于特定命令，`DI` 和 `DO` 会同时用于与器件之间的数据传输，从而使数据传输速度最高翻一倍。虽然 SOC 数据手册没有提到这一点，但我们的软件确实使用了这种模式。

### 封装

最常用的封装是 `SO8` 类型，有时也称为 `SOIC8` 类型。它还可能有不同的宽度，例如 `150-mil`、`208-mil` 或 `300-mil`。最好先测量你需要的尺寸，并用器件数据手册核对测量结果。

### 规格

1. 容量：至少 `8 MBit / 1 MiB`（理论最大 `128 MBit / 16 MiB`，但*未经测试*！）
2. 速度：`62.5 MHz` 或更好。
3. 支持 `DUAL SPI operation`。
   器件需要支持命令 `BBh`，即 `Dual I/O Fast Read` 或 `Fast Read Dual I/O`。

### 已知可用的型号

此列表并不完整。

| 品牌      | 型号       |
| ---------- |----------- |
| GigaDevice | GD25Q32E   |
| Fundan     | FM25Q16A   |
| Puya       | P25D40SH   |
| Winbond    | W25Q16JV   |
| Winbond    | W25Q32FV   |
| Winbond    | W25Q32JV   |
| Winbond    | W25Q16JL   |
| Winbond    | W25Q16DV   |
| Winbond    | W25Q80DV   |

*注意*：型号列表并不完整。型号中可能包含附加信息，例如封装、温度规格，甚至一整盘料上的器件数量。因此请务必查阅数据手册，确保拿到正确的可订购型号。
