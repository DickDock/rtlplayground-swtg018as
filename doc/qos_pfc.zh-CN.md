# QoS、流量控制与优先级流量控制（PFC）

[English](qos_pfc.md) | 简体中文

RTL8372/3 为每个报文确定一个 0-7 的内部优先级，把它映射到每端口 8 个出方向（egress）队列之一，并按严格（strict）或加权（weight）方式调度这些队列。每个端口都可以发送并响应暂停帧（IEEE 802.3x）。两个 10G MAC（芯片端口 3 和 8，在大多数机型上是 SFP+ 笼位）还额外支持优先级流量控制（PFC，IEEE 802.1Qbb），它可以单独暂停单个优先级，而这正是无损 RoCEv2 流量所需要的。交换机不能标记 ECN。

寄存器地址和字段布局取自 https://github.com/airjinkela/rtl837x-dsa-driver （GPL-2.0） 的 `rtl8373_reg_definition.h`。命令背后的寄存器写入值由 `test/test_qos.c` 覆盖；交换机的具体行为仍需在硬件上确认，参见[验证](#验证)。

除 `show` 和 `pfc <port> force` 之外，下面的所有命令都是配置命令，会随配置一起保存。端口与其他地方一样，使用物理端口号。

## QoS
```
qos show
qos trust dscp|1p|port
qos dscp <0-63> <prio 0-7>
qos 1p <pcp 0-7> <prio 0-7>
qos port <port> <prio 0-7>
qos queue <prio 0-7> <queue 0-7>
qos sched <port> <queue 0-7> strict|<weight 1-127>
```
内部优先级通过 one-hot 权重从多个来源（802.1p PCP、DSCP、端口默认值、ACL、SVLAN）中选出，权重最高者胜出。`qos trust` 把给定来源放到两张权重表的最顶端。`qos dscp` 和 `qos 1p` 把一个 DSCP 或 PCP 值映射到一个内部优先级；`qos port` 设置端口在没有其他来源适用时赋予的优先级；`qos queue` 把一个内部优先级映射到所有端口上的一个队列；`qos sched` 把某端口的一个队列设为严格调度，或设置其权重。

## 802.3x 流量控制
```
fc show
fc <port> auto|on|off
fc <port> set <0-3>
fc thr glb|<0-3> <on> <off>
fc guar <0-3> <pages>
```
`fc <port> on|off` 在 MAC 中强制开启或关闭暂停帧的发送与响应，`auto` 则回到自协商的结果。阈值以缓冲页为单位：已用页数超过 `<on>` 时发送暂停，低于 `<off>` 时解除。系统有一个全局阈值和 4 组带有保证页数的阈值组，每个端口选择其中一组。`fc show` 还会按端口和总计打印当前使用的页数及其峰值。

## 优先级流量控制（PFC）
```
pfc show
pfc <port> map
pfc <port> on <prio>[,<prio>..]
pfc <port> off
pfc <port> force <prio>[,<prio>..]|off
```
只接受那两个 10G 端口。`pfc <port> map` 把内部优先级和 PCP n 映射到优先级组（priority group，PG）n，`pfc <port> on` 依赖这一映射：它为所列出的优先级在两个方向上启用 PFC，并为相同编号的 PG 启用 PFC。`pfc <port> force` 把 PG 标记为拥塞，使交换机在没有任何负载的情况下为它们发送 PFC 帧；它只用于测试，不会被保存。

`pfc show` 打印原始控制字、优先级到 PG 的映射、PG 到优先级使能向量（priority-enable-vector）的表，以及每个 PG 使用的页数。

## 验证
以下内容尚未在硬件上确认：
1. 两份 PFC 寄存器各自属于哪个 MAC。代码假定第一份属于 MAC 3、第二份属于 MAC 8（`rtl837x_qos.c` 中的 `PFC_IDX()`）。执行 `pfc <port> force 3`，并在链路伙伴（link partner）上抓包（`tcpdump -i <if> ether proto 0x8808`，或 `ethtool -S <if> | grep -i pfc`）：帧必须出现在给定的端口上。
2. PG 到优先级使能向量的表（`RTL837X_PG_2_PEV_TABLE`）宽度为 64 位，目前不知道两个字中哪一个存放 PG 0-3。`pfc show` 会打印这两个字；由 `pfc <port> force` 发出的 PFC 帧可以显示某个 PG 暂停的是哪个优先级。
3. 802.3x HI/LO 阈值对的含义。目前只暴露了 HI 寄存器。
4. `fc <port> off`（清除 MAC 暂停位）之后 PFC 是否仍然工作。如果不能，请使用 `fc <port> auto`，并在链路伙伴上禁用暂停。

下面是在 10G 端口 9 上为标记了 DSCP 26 的 RoCEv2 流量配置无损传输的设置：
```
qos trust dscp
qos dscp 26 3
qos queue 3 3
pfc 9 map
pfc 9 on 3
```
该端口上的 802.3x 暂停应当关闭，以免它暂停所有优先级。在确认上面的第 4 点之前，请在链路伙伴上将其禁用（`ethtool -A <if> rx off tx off`），并让交换机保持在 `fc 9 auto`，而不要使用 `fc 9 off`。
