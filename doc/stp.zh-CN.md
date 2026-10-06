# 生成树(STP / RSTP)

[English](stp.md) | 简体中文

交换机可以参与生成树(IEEE 802.1D / 802.1w),使网桥之间的冗余链路被阻塞,而不是形成环路。本实现从收到的 BPDU 中选举根网桥,在端口的侦听期结束后把端口提升为转发(forwarding),在根网桥沉默之后把它老化掉,并在看到自己 BPDU 的端口上将其阻塞。

STP 可以通过 Web 界面或命令行来启用和控制,方式如下:

## 快速上手

```
stp on                  # start participating
stp off                 # stop, all ports back to forwarding
```

实时状态在 Web 界面的 Spanning Tree(生成树)页面上(或 `/stp.json`),也可以在串口控制台上通过 `stp status` 查看。

周围没有其他网桥时,交换机会选举自己为根,所有端口最终都会进入转发状态——可以放心让它一直开着。把设置写入启动配置,即可让它们在重启之后依然生效:

```
stp prio 15
stp port 1 edge on
stp on
```

## 硬件背景

BPDU 发往 `01:80:C2:00:00:00`,一个预留的链路本地组。ASIC 为该地址设置的预留组播(Reserved-Multicast)动作决定这个帧的下场。

转发到 CPU 端口工作正常:8051 位于内部交换芯片一个普通端口的后面,是转发掩码中的一个普通成员。*陷阱*(trap)动作无法向它投递——trap 的目的地是连接在物理端口上的外部 CPU(厂商 SDK 中的 `cpuTag_externalCpuPort_set`、`EXT_CPU_CTRL`),而这些板卡并没有装配它。ACL 的 trap 和 redirect 动作同样无法把东西投递到 8051。

因此投递采用*转发*(forward)动作,并通过静态 L2 组播表项(`port_l2mc_set()`)把它约束到 CPU 端口,每个在用 VLAN 一条:

* STP 运行期间,表项的成员掩码仅含 CPU 端口——BPDU 到达 CPU 而不会泛洪到其他端口,这正是参与生成树的网桥所需要的;
* STP 关闭时,同样的表项被改指向所有端口,恢复非网管交换机应有的透明性,从而让周围的生成树能够*穿过*这台设备。

以这种方式投递的 BPDU,对端口的入站逻辑而言是一个普通帧,要经过它的可接受帧类型过滤器。BPDU 不带标签,因此被设置为只接受带标签帧的端口(`ingress <port>t`)永远不会把 BPDU 送到 CPU。`stp_setup()` 会对每一个处于这种状态的、启用了 STP 的端口打印警告。

## 链路聚合

STP 协议把 LAG(链路聚合组)当作一个附加端口处理,它有自己的定时器和状态。交换机设备最多支持 4 个 LAG,它们与物理端口一起显示在 STP 状态中。一个组拥有自己的路径开销、优先级、edge 与 guard 设置,并在 Spanning Tree 页面上有自己的行。

```
stp lag 1 cost 10000    # the group decides, not its members
stp lag 1 edge off
```

LAG 通过 `lag` 命令配置。端口一旦成为 LAG 的成员,就不能再为它单独配置 STP,因此在成员端口上执行 `stp port <n>` 会告诉你应该改为配置哪个组。成员关系每秒从聚合寄存器重新读取一次,所以在 LACP 之下发生变化的组会被自动感知,两者之间不需要任何协调。

交换机硬件不会把 LAG 当作整体来处理 STP 状态。成员的状态变化必须由固件完成,即更新每一个成员端口——这可以用一次寄存器写实现。BPDU 从编号最小的成员发出,并携带该组自己的端口 ID。存活中的 LAG 失去一个成员不算拓扑变化;逻辑端口要到最后一条链路断开才会失效。

端口状态存放在 `RTL837X_MSTP_STATES (0x5310)` 中,每个端口 2 位:`00` 禁用(disabled),`01` 阻塞(blocking),`10` 学习(learning),`11` 转发(forwarding)。处于阻塞状态的端口不在端口之间转发任何东西,但它仍然发送 CPU 交给它的帧,也仍然把收到的 BPDU 上送 CPU——这正是环路检测能够在它已经阻塞的端口上继续工作的原因。

## 定时器

`stp_timers()` 以 50 Hz 运行(主循环在 200 Hz 系统节拍上空转,STP 每四次循环被调用一次),这正是 `rtl837x_stp.h` 中 `STP_HZ` 所编码的内容。所有配置值均以秒为单位:

| 设置 | 默认值 | 范围 |
|---|---|---|
| `stp hello <n>` | 2 | 1–10 |
| `stp maxage <n>` | 20 | 6–40 |
| `stp fwd <n>` | 15 | 4–30 |
| `stp txhold <n>` | 6 | 1–10 |

新进入树的端口要先在阻塞状态度过 `fwd` 秒,然后才开始转发(edge 端口跳过这段等待)。连续 `maxage` 秒没有收到 BPDU 之后,根信息被丢弃,交换机随即重新夺取根角色。

## 拓扑变化

本地非 edge 端口上的变化(链路的来去、端口被提升为转发)会刷新该端口上学到的地址,并在我们的 BPDU 中置位 TC 标志,持续 `maxage + fwd` 秒。BPDU 中收到的 TC 标志会被继续传递:交换机把其他非 edge 端口刷新一次,并在自己的 BPDU 中保留这个标志,直到最后一个带标志的帧之后的一个 hello 周期,使通知得以穿过交换机,而不是在它这里终止。传统的 TCN 会以 TCA 应答,然后按本地变化处理。

## 网桥设置

```
stp prio <0-15>         # bridge priority = n * 4096, default 8 (32768)
stp version rstp|stp    # RST BPDUs (default) or legacy Config BPDUs
stp hello|maxage|fwd|txhold <seconds>
```

优先级最低的网桥在根选举中获胜;平局时由 MAC 地址决出。如果你不想让这台交换机成为现有网络的根,就给它一个比当前根更差的优先级——`stp prio 15`(61440)是常用的“绝不选我”取值。

## 每端口设置

```
stp port <1-9> on|off              # take part in STP, or stay plain forwarding
stp port <1-9> edge on|off|auto    # host-facing port handling (default: auto)
stp port <1-9> cost <0-200000000>  # path cost, 0 = automatic (20000)
stp port <1-9> prio <0-240>        # port priority, steps of 16
stp port <1-9> guard none|bpdu|root
stp port <1-9> filter on|off       # neither send nor accept BPDUs
stp port <1-9> p2p auto|on|off
```

**edge** —— edge 端口立即转发,并且其链路的来去不触发拓扑变化;`auto` 会在端口连续 3 秒没有收到 BPDU 之后把它提升为 edge,一旦收到 BPDU 就立即降级。只接主机的端口请使用 `edge on`。

**guard** —— `bpdu` 在端口上一收到 BPDU 就禁用该端口(主机端口本不应见到 BPDU);`root` 阻止端口成为通往根的路径,从而保护现有拓扑,免受声称拥有更佳优先级的新接入网桥的影响。

**filter** —— 该端口既不发送也不接受 BPDU。当对端设备对 BPDU 反应不佳(某些带环路防护的非网管交换机会切断链路)、但你仍然希望其余端口运行 STP 时,这个选项很有用。

## 状态

Spanning Tree 页面显示选出的根(优先级与 MAC)、到根的路径开销、根端口、拓扑变化计数,以及每个端口从 ASIC 读出的实时状态和已配置的选项。同样的数据也以 JSON 提供:

```
GET /stp.json
```

`stp status` 命令在串口控制台上打印同样的视图。

## 限制

* 只有一个生成树实例;没有 MSTP,没有按 VLAN 划分的树。
* 没有 proposal/agreement 握手——支持 RST 的邻居仍然会收敛,但走的是定时器,而不是快速迁移。
* 端口角色是近似的:区分根端口与指定端口(designated),不区分 alternate/backup。
* 拓扑变化只向远离根的方向传播:根端口上不宣告任何东西(完全没有 TCN,也没有 BPDU),因此上游网桥只能依靠自己的检测。
