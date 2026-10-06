# 链路聚合(又称 Trunking)

[English](link_aggregation.md) | 简体中文

RTL827x 支持按照 IEEE 802.3ad 把多个端口组合成一条逻辑链路(链路聚合 / Trunking)。LAG 可以把一条条物理链路合并为一条链路,获得合计的吞吐量,并在其中一条链路失效时提供自动冗余。交换机设备上最多可以定义 4 个链路聚合组(LAG)。

## LAG 控制

4 个寄存器 `RTL837X_TRK_MBR_CTRL_BASE(lag) (0x4f38-0x4f44)` 通过由逻辑端口号组成的端口掩码来定义 LAG 的成员关系。

通过对报文的 L2、L3、L4 属性应用哈希算法,来决定由哪条链路(端口)传输该报文。哈希可以使用的属性有:

```
#define LAG_HASH_SOURCE_PORT_NUMBER	0x01
#define LAG_HASH_L2_SMAC		0x02
#define LAG_HASH_L2_DMAC		0x04
#define LAG_HASH_L3_SIP			0x08
#define LAG_HASH_L3_DIP			0x10
#define LAG_HASH_L4_SPORT		0x20
#define LAG_HASH_L4_DPORT		0x40
#define LAG_HASH_DEFAULT (LAG_HASH_L2_SMAC | LAG_HASH_L2_DMAC | LAG_HASH_L3_SIP | LAG_HASH_L3_DIP | LAG_HASH_L4_SPORT | LAG_HASH_L4_DPORT)
```

用于挑选链路(出口端口)的哈希算法在 `RTL837X_TRK_HASH_CTRL_BASE (0x4f48-0x4f54)` 中为每个 LAG 单独定义。

## 链路聚合 API

代码目前提供以下函数:

```
/*
 * Configure LAGs
 * Sets the members via port bitmask of a given Link Aggregation Group
 * The groups have numbers 0-3
 * The bitmask represents up to 10 ports
 * If currently no LAG has algorithm used, a default is applied
 */
void port_lag_members_set(__xdata uint8_t lag, __xdata uint16_t members) __banked;

/*
 * Configures the hash algorithm used for a LAG
 * lag is the Group to configure and hash is a bitmask
 */
void port_lag_hash_set(__xdata uint8_t lag, __xdata uint8_t hash_bits) __banked;
```

## 在串口控制台上配置 LAG

串口控制台提供以下命令用于测试:

```
> lag <LAG-ID> <p1> [p2]...
  Create or set a LAG. LAG-ID is 1 to 4. Ports are physical ports.

> lag <LAG-ID> d
  Delete the LAG.

> lag show
  Shows information on all 4 lags

> laghash 0 [hash1] [hash2]...
  Uses the given packet properties when hashing the packet to select the link
  Names for the hashes are spa, smac, dmac, sip, dip, sport, dport
```

LAG 创建之后,默认的哈希基于 smac、dmac、sip、dip、sport、dport。使用自定义哈希设置时,请确保哈希总是同时使用报文的源属性和目的属性,否则报文将无法对称地路由。

## 通过 Web 界面配置 LAG

在 Web 界面左侧的导航面板中选择 Link Aggregation(链路聚合)。页面如下所示:

![Alt text](images/LAG_config.png?raw=true "Link Aggregation Web-Page")

4 个 LAG 各自单独配置。网页加载完成后,可以通过点击端口图标把该端口加入或移出某个 LAG 来编辑当前配置。按下 Create/Update 按钮时,尚未创建的 LAG 会被自动创建,已存在的则被更新。如果一个 LAG 被更新到没有任何成员,它就实际上被删除了。

所有 LAG 都以默认哈希函数创建(见上文)。目前无法从 Web 端更改这一点。

## 用一台 Linux 桌面机做的测试

下面是一个简单的测试:使用 2 台 RTL 2.5 GBit 交换机,每台至少有 1 个 SFP+ 端口。你还需要 4 个 10GBit SFP+ 模块(DAC 或光纤),以及桌面机上的 2 个 SFP+ 端口。

下面展示网络配置:

```
                                -----------------             -----------------
    Linux Comuter               |                | 2.5 GBit   |                |         same Linux Computer
            ----------  10G     |            P1  |------------| P1             |   10G    ----------
192.168.9.1 |  SFP+  |==========| Switch 1       | 2.5 GBit   |    Switch 2    |==========|  SFP+  | 192.168.9.2
 enp1s0f0   ----------          |            P2  |------------| P2             |          ----------  enp1s0f1
                                |                |            |                |
                                ------------------            -----------------
```

在_两台_交换机上分别创建一个包含端口 1 和 2 的 LAG,并使用把源端口和目的端口都考虑在内的默认哈希算法,例如直接使用默认值即可:

```
> lag 1 1 2
```

下面展示桌面机上的配置,使用的是带 2 个 SFP+ 模块的双口 10GBit 网卡:

```
[234690.755634] ixgbe: Intel(R) 10 Gigabit PCI Express Network Driver
[234690.755637] ixgbe: Copyright (c) 1999-2016 Intel Corporation.
[234690.921614] ixgbe 0000:01:00.0: Multiqueue Enabled: Rx Queue count = 12, Tx Queue count = 12 XDP Queue count = 0
[234690.921914] ixgbe 0000:01:00.0: 32.000 Gb/s available PCIe bandwidth (5.0 GT/s PCIe x8 link)
[234690.921999] ixgbe 0000:01:00.0: MAC: 2, PHY: 19, SFP+: 5, PBA No: FFFFFF-0FF
[234690.922002] ixgbe 0000:01:00.0: 28:41:c6:xx:xx:aa
[234690.924946] ixgbe 0000:01:00.0: Intel(R) 10 Gigabit Network Connection
[234690.990024] ixgbe 0000:01:00.0 enp1s0f0: renamed from eth0
[234691.056447] ixgbe 0000:01:00.0: registered PHC device on enp1s0f0
[234691.089417] ixgbe 0000:01:00.1: Multiqueue Enabled: Rx Queue count = 12, Tx Queue count = 12 XDP Queue count = 0
[234691.089706] ixgbe 0000:01:00.1: 32.000 Gb/s available PCIe bandwidth (5.0 GT/s PCIe x8 link)
[234691.089788] ixgbe 0000:01:00.1: MAC: 2, PHY: 19, SFP+: 18, PBA No: FFFFFF-0FF
[234691.089790] ixgbe 0000:01:00.1: 28:41:c6:xx:xx:ab
[234691.160997] ixgbe 0000:01:00.1: Intel(R) 10 Gigabit Network Connection
[234691.166102] ixgbe 0000:01:00.1 enp1s0f1: renamed from eth0
[234691.231579] ixgbe 0000:01:00.1: registered PHC device on enp1s0f1
[234691.236965] ixgbe 0000:01:00.0 enp1s0f0: detected SFP+: 5
[234691.485031] ixgbe 0000:01:00.0 enp1s0f0: NIC Link is Up 10 Gbps, Flow Control: RX/TX
[234691.557003] ixgbe 0000:01:00.1 enp1s0f1: detected SFP+: 18
[234691.753061] ixgbe 0000:01:00.1 enp1s0f1: NIC Link is Up 10 Gbps, Flow Control: RX/TX
```

现在建立 2 个网络命名空间,并把每个接口放入其中之一:

```
sudo ip netns add netns_eth0
sudo ip netns add netns_eth1
sudo ip link set enp1s0f0 netns netns_eth0
sudo ip link set enp1s0f1 netns netns_eth1
```

在每个命名空间中分别配置网络接口地址 192.168.9.2 和 192.168.9.1:

```
sudo ip netns exec netns_eth0 ifconfig enp1s0f0 192.168.9.1 netmask 255.255.255.0

sudo ip netns exec netns_eth0 ip a
1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
24: enp1s0f0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    link/ether 28:41:c6:xx:xx:aa brd ff:ff:ff:ff:ff:ff
    altname enx2841c6xxxxaa
    inet 192.168.9.1/24 scope global enp1s0f0
       valid_lft forever preferred_lft forever
    inet6 fe80::2a41:c6ff:fexx:xxaa/64 scope link proto kernel_ll
       valid_lft forever preferred_lft forever

sudo ip netns exec netns_eth1 ifconfig enp1s0f1 192.168.9.2 netmask 255.255.255.0

sudo ip netns exec netns_eth1 ip a
1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
25: enp1s0f1: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 1000
    link/ether 28:41:c6:xx:xx:ab brd ff:ff:ff:ff:ff:ff
    altname enx2841c6xxxxab
    inet 192.168.9.2/24 scope global enp1s0f1
       valid_lft forever preferred_lft forever
    inet6 fe80::2a41:c6ff:fexx:xxab/64 scope link proto kernel_ll
       valid_lft forever preferred_lft forever
```

测试使用 ping。在两台交换机上,应当看到其中一条 2.5Gbit 链路以及所有 10GBit 链路上都有活动:

```
$ sudo ip netns exec netns_eth1 ping 192.168.9.1
PING 192.168.9.1 (192.168.9.1) 56(84) bytes of data.
64 bytes from 192.168.9.1: icmp_seq=1 ttl=64 time=0.082 ms
64 bytes from 192.168.9.1: icmp_seq=2 ttl=64 time=0.130 ms
^C
--- 192.168.9.1 ping statistics ---
2 packets transmitted, 2 received, 0% packet loss, time 1030ms
rtt min/avg/max/mdev = 0.082/0.106/0.130/0.024 ms
```

拔掉当前活跃的链路也可以验证冗余有效:ping 应当不受干扰地继续,报文改由另一条链路传送。

在 2 个 shell 中分别启动 2 个 iperf 实例,监听 2 个不同的端口。你需要确保哈希算法会为不同的端口号分配不同的交换机端口。可以针对每个服务器实例分别运行 iperf3 客户端来检查这一点,并确认不同的链路显示出活动:

```
sudo ip netns exec netns_eth0 iperf3 -s

sudo ip netns exec netns_eth0 iperf3 -s -p 5333
```

现在可以并行运行客户端:

```
$ sudo ip netns exec netns_eth1 iperf3 -c 192.168.9.1 & sudo ip netns exec netns_eth1 iperf3 -p 5333 -c 192.168.9.1
[1] 295484
Connecting to host 192.168.9.1, port 5201
[  5] local 192.168.9.2 port 60996 connected to 192.168.9.1 port 5201
Connecting to host 192.168.9.1, port 5333
[  5] local 192.168.9.2 port 39660 connected to 192.168.9.1 port 5333
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec   283 MBytes  2.37 Gbits/sec  485    272 KBytes
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec   283 MBytes  2.37 Gbits/sec  479    379 KBytes
[  5]   1.00-2.00   sec   280 MBytes  2.35 Gbits/sec  444    260 KBytes
[  5]   1.00-2.00   sec   280 MBytes  2.35 Gbits/sec  578    267 KBytes
[  5]   2.00-3.00   sec   281 MBytes  2.36 Gbits/sec  385    263 KBytes
[  5]   2.00-3.00   sec   280 MBytes  2.35 Gbits/sec  373    375 KBytes
[  5]   3.00-4.00   sec   280 MBytes  2.35 Gbits/sec  430    385 KBytes
[  5]   3.00-4.00   sec   280 MBytes  2.35 Gbits/sec  452    273 KBytes
[  5]   4.00-5.00   sec   281 MBytes  2.36 Gbits/sec  319    256 KBytes
[  5]   4.00-5.00   sec   281 MBytes  2.36 Gbits/sec  425    269 KBytes
[  5]   5.00-6.00   sec   280 MBytes  2.35 Gbits/sec  364    264 KBytes
[  5]   5.00-6.00   sec   281 MBytes  2.36 Gbits/sec  561    264 KBytes
[  5]   6.00-7.00   sec   281 MBytes  2.35 Gbits/sec  446    255 KBytes
[  5]   6.00-7.00   sec   280 MBytes  2.35 Gbits/sec  582    263 KBytes
[  5]   7.00-8.00   sec   281 MBytes  2.35 Gbits/sec  494    263 KBytes
[  5]   7.00-8.00   sec   280 MBytes  2.35 Gbits/sec  539    181 KBytes
[  5]   8.00-9.00   sec   281 MBytes  2.36 Gbits/sec  617    389 KBytes
[  5]   8.00-9.00   sec   280 MBytes  2.35 Gbits/sec  490    232 KBytes
[  5]   9.00-10.00  sec   281 MBytes  2.35 Gbits/sec  363    215 KBytes
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec  2.74 GBytes  2.36 Gbits/sec  4347            sender
[  5]   0.00-10.00  sec  2.74 GBytes  2.35 Gbits/sec                  receiver

iperf Done.
[  5]   9.00-10.00  sec   282 MBytes  2.36 Gbits/sec  536    380 KBytes
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec  2.74 GBytes  2.36 Gbits/sec  5015            sender
[  5]   0.00-10.00  sec  2.74 GBytes  2.35 Gbits/sec                  receiver

iperf Done.
[1]+  Done                    sudo ip netns exec netns_eth1 iperf3 -c 192.168.9.1
```

如你所见,总吞吐量为 4.71 GBit/sec,已经接近单条 5GBit 链路所能达到的最大值。

## LACP:PDU 如何到达 CPU

慢协议(slow-protocol)帧发往预留组 `01:80:C2:00:00:02`,而 ASIC 对它的默认动作是*丢弃*(drop)。*陷阱*(trap)动作同样帮不上忙:在本固件上,它永远到不了 8051 的接收环——这一点已在硬件上验证:partner 一直在发送,而接收计数器始终冻结。

因此投递采用*转发*(forward)动作,而它自身会把帧泛洪到整个入站 VLAN。这会把 LACPDU 泄露给无关端口,而且危害是实实在在的:bond 自己的端口会看到彼此的 PDU,Linux 报告 illegal loopback;同一台交换机上的第二个 bond 会被毒害;泛洪还会经由上行口外泄。预留的链路本地组绝不该被转发。

对它加以约束的,是针对该地址的一条静态 L2 组播表项,其成员掩码仅含 CPU。forward 查找会命中这条表项并使用它的端口掩码,而不是 VLAN 泛洪掩码,于是 PDU 只到达 CPU,不到任何别处。两个方向都验证过:掩码不含 CPU 位时,接收计数器冻结;掩码仅含 CPU 时,投递正常且任何端口上都没有出站流量。

这颗芯片上的查找采用 IVL,因此为 VID 0 建立的表项永远不会被匹配,需要在所有前面板端口涉及的每个 PVID 上各建一条表项,因为不带标签的 LACPDU 会归入入端口的 PVID,而 forward 动作并不限于 LACP 端口。失效 VID 的表项会遗留下来,这无害:它们只把慢协议帧引导到 CPU,而且查找表是易失的,重启即被清空。这些表项会在启动配置回放之后、以及每次从控制台设置 pvid 时重写。

表项本身通过与任何 L2 组播表项相同的 SMI 布局写入:

```
DATA_IN_A = MAC bytes 5..2                            -> c2 00 00 02
DATA_IN_B = MAC[1..0] | vid<<16 | IVL<<29 | pmask[1:0]<<30
DATA_IN_C = pmask[9:2]
```

掩码设为仅 CPU 端口时,它的低位为零,因此 DATA_IN_B 只携带地址、VID 和 IVL 标志,而 DATA_IN_C 是常量 0x80。

## LACP:实现省略了什么

第 43 章的 4 个状态机以简化形式存在。Mux 控制是耦合的而不是独立的,每个 LAG 只选举一个 partner 系统,并且没有 churn detection 状态机。

有一条互操作规则值得写明,因为弄错它不会有任何报错。发出 PDU 中的 Partner 块必须逐字回显对端自己的 actor 身份,包括 system 与 priority、key、port 与 port priority,以及聚合标志。只有当该块与 Linux 对端所发送的内容一致时,它的 `__record_pdu()` 才会接受我们的 SYNC 位。把优先级硬编码为 0 与 Linux 的默认值 0xffff 不符,这会清除 partner 的 SYNC,使状态字节从 0x3f 变为 0x37,bond 永远达不到 collecting 和 distributing。
