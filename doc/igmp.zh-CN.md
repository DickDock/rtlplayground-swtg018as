# IGMP(Internet Group Management Protocol)与 MLD(Multicast Listener Discovery)

[English](igmp.md) | 简体中文

IGMP(用于 IPv4)和 MLD(用于 IPv6)是控制局域网上三层组播数据包分发的协议;如果没有这些协议,组播数据包将被泛洪到整个网络。为此,IGMP/MLD 消息会尤其由组播消费者(MC 消费者,例如播放 IP 组播流的视频播放器)发出,同时也由支持组播的路由器发出,以控制 IP-MC 或底层 L2-MC 数据包的交换。家庭网络中的主要用途是 IPTV。

RTL8372/3 SoC 支持通过两种方式管理 IPv4-MC:一种是基于目的 IP(IPv4 组播组地址)/源 IP(通常为 0.0.0.0)的匹配,另一种是控制底层 L2-MC 数据包的交换(即目的地址为 01:00:5e:xx:yy:zz 的数据包,其中 xx:yy:zz 是 IPv4-MC 地址的低位字节)。基于 DIP/SIP 的交换不感知 VLAN,这意味着一旦订阅了某个流,该流将出现在所有 VLAN 中。不过,在典型的家庭网络中这并不是问题。基于 L2 的方法可以感知 VLAN,但目前软件尚不支持。

尽管硬件支持基于 IPv6/MLD 的组播管理(即由交换机进行智能管理),当前软件并未实现 IPv6 组播管理。因此,所有 IPv6 组播数据包都会被泛洪到所有端口,就像一台非管理型交换机所做的那样。

当前软件支持的实现方式是把 IGMP 数据包(仅支持 v3,当今绝大多数网络都在使用 v3)捕获(trap)到交换机的 CPU,由 CPU 更新 L3 和 L2 交换表,把交换机端口加入某个流或从其中移除。这种向 CPU 的捕获也称为 IGMP Snooping。虽然硬件支持完全在硬件中处理 IGMP/MLD 数据包(对 v3 仅有有限支持)甚至发送报告,但目前尚不清楚其工作原理,因此 IGMP 完全由软件处理,这也使得能够完整支持 IGMPv3 数据包——它是当今网络的标准。

## IP-MC 控制
控制 IP-MC 交换的相关寄存器如下:
```
#define RTL837X_IPV4_PORT_MC_LM_ACT	0x4f78
#define RTL837X_IPV6_PORT_MC_LM_ACT	0x4f7c
#define RTL837X_IGMP_PORT_CFG		0x52a0
#define IGMP_MAX_GROUP			0x00ff0000
#define IGMP_PROTOCOL_ENABLE		0x00007c00
#define IGMP_TRAP			0x0000002a
#define IGMP_FLOOD			0x00000015
#define IGMP_ASIC			0x00000000
#define RTL837X_IGMP_ROUTER_PORT	0x529c
#define RTL837X_IPV4_UNKN_MC_FLD_PMSK	0x5368
#define RTL837X_IPV6_UNKN_MC_FLD_PMSK	0x536c
#define RTL837X_IGMP_TRAP_CFG		0x50bc
#define IGMP_TRAP_PRIORITY		0x7
#define IGMP_CPU_PORT			0x00010000
```
`RTL837X_IPV4_PORT_MC_LM_ACT`/`RTL837X_IPV6_PORT_MC_LM_ACT` 控制当交换机端口遇到 IP-MC 数据包且转发表中没有对应转发规则时所采取的动作。默认动作是把此类 Lookup-Miss 数据包泛洪到所有端口。这是未启用 IGMP/MLD 时的配置。

启用 IGMP/MLD 后,Lookup-Miss 动作将改为丢弃此类数据包,除非在转发表中找到规则;而这些规则需要由 IGMP 数据包来配置。

开启 IGMP 时,还会通过 `RTL837X_IGMP_PORT_CFG` 把所有端口配置为将所有传入的 IGMP 数据包捕获到 CPU。随后使用 `RTL837X_IGMP_TRAP_CFG` 配置被捕获 IGMP/MLD 数据包的优先级和 CPU 端口。

把 IP-MC 转发到监听端口的配置是通过管理交换机的转发表来完成的,参见 [L2 学习](l2.zh-CN.md)。


## IGMP API
代码目前提供以下函数:
```
void igmp_setup(void) __banked;
void igmp_enable(void) __banked;
void igmp_router_port_set(uint16_t pmask) __banked;
void igmp_packet_handler(void) __banked;
void igmp_show(void) __banked;
```c
`igmp_setup()` 在启动时被调用,默认把所有 IP-MC 数据包配置为泛洪,否则网络中将无法进行任何 IP-MC 传输。

`igmp_enable()` 启动 IGMP,使 IGMP 数据包交由 CPU 处理,并把 IP-MC 数据包的转发限制在仅已订阅的端口上。

`igmp_router_port_set()` 为 IGMP 消息配置转发端口。

`igmp_packet_handler()` 实现 CPU 对被捕获 IGMP 数据包的处理。

`igmp_show()` 在 CLI 上打印 IGMP 配置。


## 串口控制台上的 IGMP 配置
为便于测试,串口控制台提供了以下命令:
```
> igmp [on/off]
  Enables or disables IGMP

> igmp show
  Shows information on IGMP
```

## 通过 Web 界面进行 LAG 配置
尚未实现!

## 使用 vlc 进行 IP-MC 流媒体播放测试
下面是一个验证 IGMP 与 IP-MC 交换能力的简单测试。

你需要 2 台带图形界面的 Linux/Windows 设备和一台交换机。

把交换机连接到一台支持组播的路由器(例如连接到你的家庭网络),再把 2 台 Linux/Windows 设备连接到交换机。与路由器的这一连接可以确保 Linux/Windows 会在连接到交换机的端口上发出 IGMP 消息;只有当它们得知网络中存在支持组播的路由器时,它们才会这样做。请确保这 2 台带图形界面的设备位于家庭网络中(例如通过 DHCP)。

在其中一台 Linux/Windows 机器上开始推流:
```
$ vlc your_video.mp4 --sout="#std{access=udp, mux=ts, dst=239.255.0.1:8090}"
```
此时你应该会看到所有交换机端口剧烈闪烁,因为组播流正被交换到所有交换机端口,包括泛洪到你的家庭网络。如果看不到任何数据包到达交换机,可以用 `--miface=<ifname>` 强制指定 vlc 的输出接口。

在交换机 CLI 上启用 IGMP:
```
> igmp on
```
此时,除推流设备所连接的端口外,其余所有端口的闪烁都应当停止:由于没有监听者,交换机会丢弃所有 IP-MC 数据包。

现在,在第二台 Linux/Windows 设备上开始监听该流:
```
$ vlc udp://@239.255.0.1:8090
```
你应该会看到显示设备所连接端口的端口指示灯开始闪烁,经过一段同步时间后,视频应当开始播放。

停止 vlc 后,发往监听设备的 IP-MC 帧转发也应随之停止,即端口指示灯应当停止闪烁。
