# 出方向与入方向带宽控制

[English](bandwidth.md) | 简体中文

RTL8372/3 允许控制在任意给定端口上发送（出方向，egress）和/或接收准入（入方向，ingress）的数据带宽。报文一旦被准入，就会在线速下进行内部交换，因为这类设备的背板带宽为 60GBit/s。

设备通过把报文分配到每端口 8 个硬件实现的队列来调度报文的发送，这些队列共享 SoC 交换部分内部总共 8Mbit 的内存。报文依据被赋予的优先级被分配到相应队列，优先级可以基于报文的多种属性，例如 IEEE 802.1P 优先级、DSCP 值、物理端口号、目的或源 MAC、Ether-Type、CVID、SVID、IPv4 源或目的 IP、IPv4/IPv6 TOS 字段、IPv6 Flow Label，甚至 TCP/UDP 源/目的端口。报文进入队列后，会按照多种可配置的算法被调度发出。

RTLPlayground 目前只允许控制端口入方向的带宽，或在报文即将离开端口时加以限制；尚不支持对优先级分配或队列调度机制的控制。带宽控制范围为 16Kbit/s 到 10Gbp/s，步进为 16Kbit/s。

就目前的实现而言，带宽控制可以用来为接入的设备分配一定的带宽份额（例如共享一条上行链路），也可以模拟低带宽甚至恶劣的连接（丢包）——此时入方向不通过流量控制（Flow Control）来约束，而是直接丢弃报文。

## 入方向/出方向控制
控制端口入方向与出方向的相关寄存器如下：

```
#define RTL837X_IGBW_CTRL		0x4c10
#define IGBW_INC_BYPASS_PKT		0x100
#define IGBW_INC_IFG			0x80
#define IGBW_ADM_DHCP			0x20
#define IGBW_ADM_ARPREQ			0x10
#define IGBW_ADM_RMA			0x08
#define IGBW_ADM_BPDU			0x04
#define IGBW_ADM_RTKPKT			0x02
#define IGBW_ADM_IGMP			0x01
#define RTL837X_IGBW_PORT_CTRL		0x4C18
#define RTL837X_IGBW_PORT_FC_CTRL	0x4C8C
#define RTL837X_EGBW_PORT_CTRL		0x1c34
#define RTL837X_EGBW_CTRL		0x447c
#define EGBW_INC_IFG			0x02
#define EGBW_CPUMODE			0x01
```
`RTL837X_IGBW_CTRL/RTL837X_EGBW_CTRL` 控制入方向与出方向带宽控制的行为。`IGBW_ADM_DHCP` 等标志决定 DHCP 等特定类型的报文是否豁免入方向带宽控制。`IGBW_INC_IFG/EGBW_INC_IFG` 标志决定帧间隙（Inter Frame Gap）是否计入被控制的带宽。`EGBW_CPUMODE` 决定内部 CPU 生成的报文是否受出方向控制。

`RTL837X_IGBW_PORT_CTRL/RTL837X_EGBW_PORT_CTRL` 配置端口入方向与出方向的带宽。

`RTL837X_IGBW_PORT_FC_CTRL` 配置报文的带宽控制是通过流量控制（Flow Control）实现（置位端口位），还是直接丢弃（清除端口位）。

## 入方向/出方向带宽 API
代码目前提供以下函数：

```
void bandwidth_setup(void) __banked;
void bandwidth_ingress_set(uint8_t port, __xdata uint32_t bw) __banked;
void bandwidth_ingress_disable(uint8_t port) __banked;
void bandwidth_ingress_drop(uint8_t port) __banked;
void bandwidth_egress_set(uint8_t port, __xdata uint32_t bw) __banked;
void bandwidth_egress_disable(uint8_t port) __banked;
void bandwidth_status(uint8_t port) __banked;
```c

`bandwidth_setup()` 在启动时被调用，它把所有可能面向 CPU 的特殊报文以及 CPU 发出的报文配置为豁免带宽控制。IFG 不参与带宽计算。

`bandwidth_ingress_set()` 为指定端口启用入方向带宽控制，并设置指定的带宽。这同时也会在该端口上启用流量控制（Flow Control）。

`bandwidth_ingress_set()` 为指定端口启用出方向带宽控制，并设置指定的带宽。

`bandwidth_ingress_disable() / bandwidth_egress_disable()` 在给定端口上禁用入方向与出方向带宽控制。

`bandwidth_ingress_drop(port)` 把超过带宽限制的报文配置为直接丢弃。

`bandwidth_status(port)` 显示给定端口当前的带宽控制状态。

## 在串口控制台上配置带宽控制
串口控制台提供了以下命令：

```
> bw [in|out|status] <port> [<hexvalue>|off|drop]
  Configures or shows the status of bandwidth control
```
带宽以 `<hexvalue>` 形式给出，单位为 Kbit/s。注意控制的最小粒度为 16 Kbit/s，最小值同样是 16 Kbit/s。十六进制数必须按完整字节给出，即位数为偶数。

要把物理端口 2 的入方向带宽控制设置为 256 Kbit/s，执行：

```
> bw in 2 0100 
```

要在端口 2 超过带宽时丢弃报文，执行：

```
> bw in 2 drop 
```

要禁用端口 2 上入方向报文的带宽控制，执行：

```
> bw in 2 off
```

## 通过 Web 界面配置带宽
尚未实现！

## 使用 iperf3 做一个测试
下面的示例演示如何只用一台 Linux 设备测试带宽控制：利用网络命名空间（network namespaces），让同一台 Linux 设备上的客户端与服务器之间的报文经由一台外部交换机转发。

你需要在这台 Linux 设备上有 2 个网络接口，例如 2 个名为 eth0 和 eth1 的 USB 以太网控制器：

```
$ sudo ip netns add client
$ sudo ip netns add server

$ sudo ip link set dev eth0 netns client
$ sudo ip link set dev eth1 netns server

$ sudo ip netns exec client ip link set dev eth0 up
$ sudo ip netns exec server ip link set dev eth1 up

$ sudo ip netns exec client ip addr add dev eth0 192.168.99.1/24
$ sudo ip netns exec server ip addr add dev eth1 192.168.99.2/24

$ sudo ip netns exec server iperf3 -s
```
这会在上面的 shell 中启动一个 iperf3 服务器。

现在你可以在另一个 shell 中针对你的服务器运行 iperf3 客户端：

```
$ sudo ip netns exec client iperf -c 192.168.99.2
```
交换机上连接着网络适配器的那些端口的 LED 应该开始闪烁。在 1GBit 连接上，你会看到：

```
$ sudo ip netns exec client iperf3 -c 192.168.99.2
Connecting to host 192.168.99.2, port 5201
[  5] local 192.168.99.1 port 46776 connected to 192.168.99.2 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec   114 MBytes   952 Mbits/sec    0    339 KBytes       
[  5]   1.00-2.00   sec   113 MBytes   946 Mbits/sec    0    356 KBytes       
[  5]   2.00-3.00   sec   112 MBytes   937 Mbits/sec    0    390 KBytes       
[  5]   3.00-4.00   sec   112 MBytes   942 Mbits/sec    0    390 KBytes       
[  5]   4.00-5.00   sec   112 MBytes   943 Mbits/sec    0    390 KBytes       
[  5]   5.00-6.00   sec   112 MBytes   944 Mbits/sec    0    390 KBytes       
[  5]   6.00-7.00   sec   112 MBytes   938 Mbits/sec    0    390 KBytes       
[  5]   7.00-8.00   sec   112 MBytes   942 Mbits/sec    0    410 KBytes       
[  5]   8.00-9.00   sec   113 MBytes   947 Mbits/sec    0    410 KBytes       
[  5]   9.00-10.00  sec   112 MBytes   940 Mbits/sec    0    410 KBytes       
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec  1.10 GBytes   943 Mbits/sec    0            sender
[  5]   0.00-10.00  sec  1.10 GBytes   941 Mbits/sec                  receiver
```

现在，我们把端口 1（连接 eth0）的入方向限制为 4 MBit/s：

```> bw in 1 1000
bandwidth_ingress_set called, port 04
RTL837X_IGBW_PORT_CTRL:0x00100100
RTL837X_IGBW_PORT_FC_CTRL:0x00000010
```

我们得到：

```
$ sudo ip netns exec client iperf3 -c 192.168.99.2
[  5] local 192.168.99.1 port 43324 connected to 192.168.99.2 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec  1.12 MBytes  9.43 Mbits/sec    0    160 KBytes       
[  5]   1.00-2.00   sec   640 KBytes  5.24 Mbits/sec    0    160 KBytes       
[  5]   2.00-3.00   sec   384 KBytes  3.15 Mbits/sec    0    160 KBytes       
[  5]   3.00-4.00   sec   384 KBytes  3.15 Mbits/sec    0    160 KBytes       
[  5]   4.00-5.00   sec   640 KBytes  5.24 Mbits/sec    0    160 KBytes       
[  5]   5.00-6.00   sec   256 KBytes  2.10 Mbits/sec    0    160 KBytes       
[  5]   6.00-7.00   sec   640 KBytes  5.24 Mbits/sec    0    160 KBytes       
[  5]   7.00-8.00   sec   384 KBytes  3.15 Mbits/sec    0    160 KBytes       
[  5]   8.00-9.00   sec   640 KBytes  5.24 Mbits/sec    0    160 KBytes       
[  5]   9.00-10.00  sec   256 KBytes  2.10 Mbits/sec    0    160 KBytes       
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec  5.25 MBytes  4.40 Mbits/sec    0            sender
[  5]   0.00-10.16  sec  4.75 MBytes  3.92 Mbits/sec                  receiver

iperf Done.
```
这正是我们配置的 4Mbit/s。没有出现丢包（重传），因为流量控制（Flow Control）被用来通知入方向接口（路由器的端口 1）上的以太网适配器减速。

我们也可以只配置 256KBit/s 并配合丢包来模拟一条恶劣的连接：

```
> bw in 1 0100
bandwidth_ingress_set called, port 04
RTL837X_IGBW_PORT_CTRL:0x00100010
RTL837X_IGBW_PORT_FC_CTRL:0x00000010

> bw in 1 drop
RTL837X_IGBW_PORT_FC_CTRL:0x00000000
```

我们得到：

```
$ sudo ip netns exec client iperf3 -c 192.168.99.2
Connecting to host 192.168.99.2, port 5201
[  5] local 192.168.99.1 port 46060 connected to 192.168.99.2 port 5201
[ ID] Interval           Transfer     Bitrate         Retr  Cwnd
[  5]   0.00-1.00   sec   384 KBytes  3.14 Mbits/sec    2   1.41 KBytes       
[  5]   1.00-2.00   sec  0.00 Bytes  0.00 bits/sec   54   1.41 KBytes       
[  5]   2.00-3.00   sec  0.00 Bytes  0.00 bits/sec   31   29.7 KBytes       
[  5]   3.00-4.00   sec  0.00 Bytes  0.00 bits/sec    2   1.41 KBytes       
[  5]   4.00-5.00   sec  0.00 Bytes  0.00 bits/sec   23   1.41 KBytes       
[  5]   5.00-6.00   sec   128 KBytes  1.05 Mbits/sec   16   14.1 KBytes       
[  5]   6.00-7.00   sec  0.00 Bytes  0.00 bits/sec    2   1.41 KBytes       
[  5]   7.00-8.00   sec  0.00 Bytes  0.00 bits/sec   11   1.41 KBytes       
[  5]   8.00-9.00   sec   128 KBytes  1.05 Mbits/sec    9   8.48 KBytes       
[  5]   9.00-10.00  sec  0.00 Bytes  0.00 bits/sec    2   1.41 KBytes       
- - - - - - - - - - - - - - - - - - - - - - - - -
[ ID] Interval           Transfer     Bitrate         Retr
[  5]   0.00-10.00  sec   640 KBytes   524 Kbits/sec  152            sender
[  5]   0.00-10.00  sec   256 KBytes   210 Kbits/sec                  receiver

iperf Done.
```
可以看到，由于丢包产生了大量重传，而接收报文的平均速率（客户端把报文发给服务器，服务器再将其发回客户端）为 210 KBit/s；发送报文的数值更高，因为其中可能包含了被丢弃的报文。
