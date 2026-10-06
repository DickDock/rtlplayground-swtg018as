# 风暴控制

[English](storm_control.md) | 简体中文

风暴控制限制端口接收广播、组播、未知单播和未知组播帧的速率。某一类型的帧超过其限制后会在入方向（ingress）被丢弃，这样环路或行为异常的主机就无法经由该端口泛洪网络的其余部分。已知单播流量不受影响。

## 命令
```
storm <port> bcast|mcast|ucast|umcast <rate> pps
storm <port> bcast|mcast|ucast|umcast <rate> kbps
storm <port> bcast|mcast|ucast|umcast off
storm
```
`ucast` 指发往交换机尚未学习到的 MAC 地址的单播，`umcast` 指在地址表中没有表项的组播。组播组的表项来自 IGMP Snooping，因此在未执行 `igmp on` 时，所有组播都是未知组播，只有 `umcast` 限制对它生效；`mcast` 覆盖的是 IGMP 已经学习到的组。以每秒包数（pps）为单位的限制范围是 1 到 1048575，以 kbit/s 为单位的限制范围是 1 到 10000000。不带参数的 `storm` 会打印每个端口的限制。这些限制与其他设置一样保存在配置中，Web 界面的带宽（Bandwidth）页面上有一张风暴控制（Storm control）卡片可以对它们进行设置。

## 寄存器
每个端口和每种类型都有一个使能位和一个计量器（meter）索引，每条限制使用交换机 64 个共享计量器中的一个。RTLPlayground 为每个端口和类型的组合分配独立的计量器，索引为 `24 + port * 4 + type`，这样一个端口的风暴不会挤占另一个端口的限制额度。风暴控制使用 24 到 63 号计量器，把 0 到 23 留给 ACL。计量器的限制值位于 `RTL837X_METER_RATE + 4 * meter`，而 `RTL837X_METER_MODE + 4 * (meter / 32)` 的第 `meter % 32` 位选择以 pps 而不是 kbit/s 计量。
```
#define RTL837X_STORM_CTRL		0x54e4	/* + 4 * type, bit = port */
#define RTL837X_STORM_MIDX		0x54f4	/* + 8 * type + 4 * (port / 5), 6 bits per port */
#define RTL837X_METER_RATE		0x5cf0	/* + 4 * meter, 24 bits, kbit/s or pps */
#define RTL837X_METER_MODE		0x5ef0	/* + 4 * (meter / 32), bit set = pps */
```
在 kbit/s 模式下，速率的步进为 1 kbit/s。经 100 字节和 1000 字节帧实测，计量器对一帧计数时包含其 FCS，但不包含前导码和帧间隙。每个计量器都有一个把这两者计入的位，位于 `0x5f08 + 4 * (meter / 32)`，风暴控制将其保持为清零。`IGBW_INC_IFG` 和 `EGBW_INC_IFG` 是带宽控制中与之对应的位。

同一端口上的入方向带宽限制与风暴限制作用于同一批到达帧，而不是在风暴限制之后才生效，两者同时启用时通过的流量远少于单独任何一者：面对 1.4 Gbit/s 的流量，1 Mbit/s 的 `umcast` 限制配合 10 Mbit/s 的入方向限制只放行了 0.12 到 0.16 Mbit/s，而二者单独启用时分别放行 1.17 和 10.2 Mbit/s。

类型的编号为：0 是广播，1 是组播，2 是未知单播，3 是未知组播。计量器的突发大小（burst size，0x5df0 + 4 * meter）在 pps 模式下按包计数；其默认值 0x2000 允许在 pps 限制生效前通过 8192 帧，因此设置 pps 限制时会同时把突发大小设为一秒钟的流量。设置 kbit/s 限制则会恢复默认值。
