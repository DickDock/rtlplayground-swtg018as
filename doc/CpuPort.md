# CPU 端口

[English](CpuPort.en.md) | 简体中文

RTL827x 为 SoC 8051 一侧的 NIC 提供了一个 CPU 端口。

## 接收数据包
为了在 ASIC 侧接收数据包,必须置位 RTL837X_REG_RX_CTRL(0x785c)的第 0 位。该寄存器中的其他位用于启用各类以太网帧的接收。固件需要自行决定如何处理这些帧,因此这些位都应当置位。若要让 ASIC 在早期就丢弃以太网帧 CRC 不正确的数据包,清除此寄存器的第 2 位。

接收数据包的方式可以是轮询 RTL837X_REG_RX_AVAIL 寄存器(0x7874):当数据位于 SoC ASIC 侧的环形缓冲区中时,该值大于 0。另一种方式是触发中断(EX1)。

数据通过调用一个 SFR 函数传输到 8051 侧。首先,接收帧的帧头会被复制过来。为此,在 SFR B3 和 B4 中提供 xdata 存储器中的目标地址(小端序),在 SFR B5/B6 中提供 ASIC 侧的源地址(同样为小端序,可在 RTL837X_REG_RX_RINGPTR,0x787c 中找到),然后将 SFR_NIC_CTRL(B7)设置为要传输的长度除以 8,即 1,以执行该函数。

帧头的格式如下:
```
SS xx xx xP LL LH xx xx
SS:	8-bit sequence number
P:	Port number
LHLL:	Length of Ethernet frame (little endian)
xx:	Unknown
``` 

接着,再次调用该 SFR 函数传输实际的数据包:源指针指向 ASIC 上紧跟帧头之后的帧,长度取帧头中给出的长度加 7,同样再除以 8。

接收到的帧会在通常存放 IPv4 帧类型 0x0800 的位置,带有 RTL 私有以太网帧类型 0x8899(RRPC)。其后还有 6 个字节用于描述该帧,之后正常的 IPv4 数据才开始。相关文档见:[TAG8899_COMMIT](https://github.com/torvalds/linux/commit/1521d5adfc2b557e15f97283c8b7ad688c3ebc40)

复制完帧头和帧之后,向 RTL837X_REG_RX_DONE(0x784c)写入 0x1,即可把 ASIC 侧环形缓冲区中的该帧标记为已读。

## 发送数据包
发送数据包时,先在 xdata 存储器中准备好帧头加帧,然后通过 SFR 将两者一起传输到 ASIC 侧。置位 RTL837X_REG_TX_CTRL(0x7860)的第 0 位后,ASIC 就会发送数据包。

```
SS 07 00 00 LL LH 00 00 
SS:	8-bit sequence number
07:	Enables header and TCP checksum offloading to ASIC
LHLL:	Length of the Ethernet frame
```
以太网帧数据在 xdata 存储器中紧跟在帧头之后开始。把 SFR B3 和 B4 设置为帧头的 xdata 源地址,并把环形指针设置为寄存器 0x7890 所指示的空闲空间乘以 8 且最高位置位,即可把帧传输到 ASIC 侧。长度取帧的长度加 15,再除以 8。

向寄存器 0x7850 写入 0x1 即会发送该帧。以太网帧校验和与 TCP 校验和由 ASIC 在上线路发送之前自动计算(卸载)。


## RTL 标签字段

帧头采用 Realtek Remote Control Protocol(RRCP)格式或类似格式。

`flags` 字:

```
bit15 EFID_EN | 14:12 EFID | 11 PRI_EN | 10:8 PRI |
bit7  KEEP    | 6 VSEL     | 5 LEARN_DIS         | 4:0 VIDX
```

所有字段均为网络字节序。

与标签的每一个其他字段一样,这个字必须通过 `HTONS` 写入。直接写入原始常量会把各个位放进错误的字节,于是 `0x0020` 到达线路上时就成了 `0x2000`,即 EFID 而不是 LEARN_DIS。此时 ASIC 无法解析该标签,会带着 `0x8899` 头原样转发该帧。

* `EFID_EN`、`EFID`:使用此过滤 ID 而不是端口自己的过滤 ID 来查找目的地址
* `PRI_EN`、`PRI`:强制为帧设置指定的优先级
* `KEEP`:让帧的 802.1Q 标签保持注入时的原样,绕过端口的出口打标签规则
* `VSEL`、`VIDX`:把帧归类到 VLAN 表中此索引处的 VLAN
* `LEARN_DIS`:不从该帧学习源地址

`pmask` 字:第 15 位是 `ALLOW`,第 14 到 0 位是端口掩码。

* `ALLOW` 清零:掩码即出口集合,帧只发往所给出的端口
* `ALLOW` 置位:ASIC 照常查找目的地址,掩码只限制查找结果可以使用哪些端口
