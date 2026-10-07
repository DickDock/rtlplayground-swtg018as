# LACP(链路聚合控制协议,IEEE 802.3ad)

[English](lacp.en.md) | 简体中文

静态链路聚合组只有在两端事先商定一致时才能工作。没有任何机制检查它们是否真的一致:把一个成员端口接到错误的邻居上,聚合组仍会继续把帧哈希到一条通向别处的链路上。LACP 就是让两端达成一致、并持续保持一致的协议——它会发现哪些链路连接到同一个 partner(对端),只聚合这些链路,并在 partner 停止应答时把相应链路移出聚合组。

交换机在 8051 上以软件方式运行 LACP。相关帧属于 Slow Protocols 组:目的地址 `01:80:C2:00:00:02`,ethertype `0x8809`,subtype 1。本实现覆盖了决定聚合能否形成的那些部分:802.3ad 第 43 章中的接收状态机(Receive machine)与 Selection、Mux 状态机(Mux machine)、`recordPDU` 与 `update_NTT`,以及当多条链路的 partner 互不相同时拒绝聚合它们的防错接保护。它没有实现 Churn Detection 状态机或 Marker 协议;Mux 状态机采用的是耦合(coupled)变体,因此收集(collecting)与分发(distributing)是同时启用,而不是依次启用。

最多可以有 `LACP_NUM_LAGS`(4)个组置于 LACP 之下;其余组保持静态。

## 将帧送达 CPU

这是耗时最久、也值得记录下来的部分,因为显而易见的路径在这颗芯片上行不通。

预留组播地址在 L2 查找发生之前由 RMA 块处理。每个地址都有自己的寄存器 `RMA0_CONF + index*4`,动作字段位于位 [5:4]:0 为转发(forward),1 为陷阱到 CPU(trap),2 为丢弃(drop),3 为向除 CPU 以外的端口转发。

```
#define RTL837X_RMA0_CONF	0x4ecc	/* 01:80:C2:00:00:00, +4 per address */
#define RTL837X_RMA2_CONF	0x4ed4	/* 01:80:C2:00:00:02, Slow Protocols */
#define RTL837X_RMA_ACT_FORWARD	0x00000000
#define RTL837X_RMA_ACT_DROP	0x00000020
```

对这个地址而言,`TRAP` 看起来是正确的动作,实则不是。被 trap 的帧会被移出转发路径,永远无法到达:把 `0x4ed4` 设为 trap 后接收计数器随即冻结,一旦改回 forward 就立刻恢复。带 `FWD_INT_TRAP` 的 ACL 规则、或指向 CPU 端口的重定向(redirect)也是一样:规则匹配了,帧离开了正常路径,却没有任何东西到达 8051。这个目的地看起来像是挂在物理端口上的*外部*(external)CPU(`cpuTag_externalCpuPort_set`、`EXT_CPU_CTRL 0x6724`),而这些板卡上并没有。

这是对**这一个地址**的结论,而不是对 RMA 块的结论。位于 `01:80:C2:00:00:0E` 的 LLDP 组被设为 trap 时,其帧能非常顺利地到达 CPU——这是在同一台交换机、同一次会话中实测得到的结果。同一块中相邻地址的表现各不相同,所以在把对某一个地址的结论推广到另一个之前,请先实测。

真正有效的是 `FORWARD`,因为 CPU 端口处于转发域之内,被转发的帧会落入固件本来就在轮询的网卡接收环(NIC receive ring)。但仅此而已还不够——它同样会把帧泛洪到 VLAN 中的其他所有端口,把邻居的 LACPDU 泄露给绝不该看到它们的主机;同一台交换机上挂着两个 bond 时,还会把两个都毒害。因此要对 forward 加以约束:`lacp_lag_set()` 会为 `01:80:C2:00:00:02` 写入一条**成员掩码仅含 CPU 端口的静态 L2 组播表项**,在所有前面板端口涉及的每个不同 pvid 上各写一条。forward 动作对每个端口上的这个地址都生效,所以 LACP 组之外的端口其 pvid 也需要被覆盖;否则到达那里的 LACPDU 会找不到表项而被泛洪到它的 VLAN。forward 查找命中该表项而不是 VLAN 泛洪掩码,于是帧只到达 CPU,不到任何别处。

这些表项通过表访问端口(`ITA_CTRL0 0x5CAC`)写入——L2 表和 VLAN 表用的也是同一个——并会以 CPU 端口上静态表项的形式出现在 L2 页面中,因此可以从 Web 界面核查这种隔离是否生效。这颗芯片上的查找采用 IVL,这正是每个 pvid 一条表项、而不是一条 VID 0 表项的原因——VID 0 的表项永远不会被匹配到。

当 LACP 被关闭时,动作切换为 `DROP`,它在 L2 查找之前就生效,因此遗留下来的静态表项不起作用。

## 成员之间必须一致的项目

802.3ad 要求聚合中的每条链路都是全双工并以相同速率运行。在标准之外,任何会改变帧处理方式的东西都必须在成员之间完全一致,因为哈希是按帧挑选成员的,一旦存在差异,行为就会取决于这次挑选:

* 必须一致:速率与双工、VLAN 成员关系与 pvid、入站过滤(ingress filtering)、端口隔离
* 可以不同:EEE、LED 配置、计数器、线缆诊断

以上这些目前都没有强制检查——`port_lag_members_set()` 只写入成员掩码和一个哈希设置,不做任何校验。关于出现不一致时应当拒绝还是应用到整个组的讨论,参见 #377。

## 协议定时

```
#define LACP_FAST_PERIODIC	0x0032	/* fast TX 1 s; partner expires at 3 s   */
#define LACP_SLOW_PERIODIC	0x05dc	/* slow TX 30 s; partner expires at 90 s */
#define LACP_SHORT_TIMEOUT	0x00c8	/* silent partner dropped after 4 s   (802.3ad: 3 s)  */
#define LACP_LONG_TIMEOUT	0x1770	/* long-timeout variant, after 120 s  (802.3ad: 90 s) */
```

1 个单位就是 LACP 定时器的一步,每 4 个系统节拍走一步,因此无论主循环快慢都是每秒 50 步;在一次两分钟的抓包中,全部 116 个间隔里 50 个单位在线路上都恰好是 1.00 s。

两个发送周期值得多说一句,因为它们是这里唯一不能由我们自由选择的东西。我们自己的超时只决定我们对一个沉默下去的 partner 有多少耐心,慢一点也不损失什么。发送周期则相反:它决定的是 *partner* 何时放弃我们。802.3ad 把 1 s 的快速周期与 3 s 的短超时配对,把 30 s 的慢速周期与 90 s 的长超时配对,这个比例正是全部要点所在。

弄错这一点并不会破坏聚合,这恰恰让它容易被忽视。本代码的一个早期版本在 partner 要求快速速率的情况下,仍然每 2 到 3 s 才发送一次。链路照样聚合、照样承载流量,但每当间隔跨过 3 s,partner 的接收状态机就把我们超时掉再恢复:partner 发来的 93 个 LACPDU 中有 13 个到达时携带 `EXPIRED`,并报告我们的 SYNC 已被清除。由于收到的 actor 状态会被原样记录为 partner 状态再发送出去,这种抖动从两端都看得见,bond 的 churn 状态机也始终无法安定。换用上文给出的周期之后,同样的抓包里完全看不到超时,两个 churn 状态都显示 `none`。

我们自己的超时比标准的 3 s 和 90 s 高出一个周期,用来吸收单个丢失的 LACPDU 加上节拍抖动。LACP 已经停止、链路却仍然连通的 partner 在此之后就会被移出 trunk;再长的话,流量就会继续被哈希到一个已不再同意承载它的成员上。

## LACP API

```
void lacp_init(void) __banked;	/* boot init: clear per-LAG state */
void lacp_off(void) __banked;
void lacp_lag_set(uint8_t lag, uint16_t ports) __banked;
void lacp_in(void) __banked;
void lacp_timers(void) __banked;
void lacp_show(void) __banked;
```

`lacp_init()` 必须在启动配置回放之前运行,因为 xdata 不会被清零,而端口到 LAG 的映射用 `0xff` 表示“无 LAG”;一个残留的零会让端口看起来像是属于 LAG 0。

## 在串口控制台上配置 LACP

在 `lag` 命令中加上 `lacp` 即可把一个组置于 LACP 之下:

```
lag 1 lacp 7 8      # ports 7 and 8 become LACP candidates of group 1
lag 1 lacp off      # group 1 goes back to static (so does "lag 1 lacp")
lag 1 7 8           # plain static aggregation, no protocol
```

置于 LACP 之下的组会交出它原本拥有的静态 trunk:硬件 trunk 被清除,再从收敛上来的端口重建。已被列入另一个 LACP 组的端口会移动到新组。协议从第一个置于 LACP 的组开始运行,在最后一个组被移出时停止;没有单独的开关控制它。有两条命令作用于整个引擎:

```
lacp off            # every group back to static, protocol stopped
lacp show
```

`lacp show` 先打印引擎状态,然后每个组一行,列出它的候选端口、选出的聚合器(aggregator)以及实际写入硬件的 trunk 成员;随后每个端口一行,列出 actor 与 partner 状态字节以及接收状态机(receive machine)的状态。

## 通过 Web 界面配置 LACP

LAG 页面上每个组在其成员端口旁都有一个 Static/LACP 模式选择;对 LACP 组,页面会显示选出的聚合器与当前活跃的成员。组列表下方有一张表,每个 LACP 端口一行,显示它所在的组、actor 与 partner 状态、接收状态、LACPDU 计数和 partner 系统。页面打开期间每 3 秒读取一次 `/lacp.json`。静态组的成员复选框来自 `/lag.json` 中的硬件寄存器。

## 用 Linux 802.3ad bond 做的测试

把交换机的两个端口接到同一台主机的两个接口:

```
ip link add bond0 type bond mode 802.3ad
ip link set enp1s0 down && ip link set enp1s0 master bond0
ip link set enp2s0 down && ip link set enp2s0 master bond0
ip link set bond0 up
```

在交换机上,以这两个端口作为该组:

```
lag 1 lacp 7 8
```

此时 `lacp show` 应当给出两个端口的 actor 状态均为 `0x3f`,即 ACTIVITY、TIMEOUT、AGGREGATION、SYNC、COLLECTING 与 DISTRIBUTING 同时置位;partner 状态中应含 SYNC,并带有 partner 的系统 MAC。`lag show` 应当把两个端口都列为 trunk 成员,因为它读取的是硬件,而不是协议对自己的看法。

值得信任的是主机端的视角,见 `/proc/net/bonding/bond0`。两个 slave 必须有**相同的 `Aggregator ID`**;出现两个不同的数字意味着 bond 根本没有完成聚合,每条链路各自待在自己的组里——乍看健康,实则不然。两个 churn 状态都应显示 `none`。一直安定不下来的 `monitoring`,正是我们的发送周期慢于 partner 所要求速率的标志。

收敛之外还有三件事值得检查,因为其中每一件都曾在某个时期坏过:

* 在每个 slave 上执行 `tcpdump -i enp1s0 ether proto 0x8809`,应当看到交换机的 LACPDU 与该 slave 自己的 LACPDU,而绝不应看到另一个 slave 的。兄弟端口之间的泄露正是 FDB 引导(steering)要防止的事情。
* 主机日志中不出现 `illegal loopback`。
* 在来自交换机的帧的十六进制转储中,actor 状态之后的 3 个保留字节应当为零。它们曾一度携带发送缓冲区里上一个帧残留的任意内容。

把一个 slave 拉下来再恢复是最便宜的故障测试。组会收窄到幸存的成员,并在几十秒内恢复;过渡期间的流量只在边缘损失百分之几,而不是损失掉一半——后者是 ASIC 继续向已死成员哈希时才会发生的。

## 已知限制

* 没有 Churn Detection 状态机,也没有 Marker 协议。
* 耦合的 Mux:收集(collecting)与分发(distributing)同时启用。
* 每个组一个聚合器。
* 静态 FDB 引导表项会在配置组时、启动配置回放之后以及每次执行 `pvid` 命令时重写;通过其他途径修改的 pvid 在上述事件之一发生之前不会被覆盖。
* 不校验成员兼容性;参见 #377。
