# rtlplayground-swtg018as

[English](README.md) | 简体中文

[rtl837x-plus](https://github.com/HiroGitea/rtl837x-plus)([RTLPlayground](https://github.com/logicog/RTLPlayground) 的 LACP/QoS 分支)的个人构建版本,面向 **LIANGUO LG-SG8T1 (WEB)** / ZX903-SWTGW218AS 交换机 — PCB `SWTG018AS-A-V2.0`(8× 2.5GBit + 1× SFP+)。

本仓库已预配置:

- `machine.h`:`MACHINE_SWTG018AS_A_V_2_0`
- `config.txt`:静态管理 IP `192.168.31.3`,网关 `192.168.31.1`
- `tools/Makefile`、`installer/Makefile`、`Makefile`:macOS(Darwin)构建修复 — 按条件处理 `-largp`/json-c 路径,并为 GNU make < 4 转义 `#`

在 macOS 上构建(SDCC ≥ 4.5、提供 `objcopy` 的 binutils、json-c、argp-standalone):

    PATH="/opt/homebrew/opt/binutils/bin:$PATH" make

镜像输出到 `output/SWTG018AS_A_V_2_0/`(512 KiB,可通过 RTLPlayground 的“固件”页面进行 Web 升级;SOIC-8 夹具 + flashrom 转储仍是救砖的最后手段)。

---

# rtl837x-plus

[![Firmware images](https://github.com/HiroGitea/rtl837x-plus/actions/workflows/firmware.yml/badge.svg)](https://github.com/HiroGitea/rtl837x-plus/actions/workflows/firmware.yml)

rtl837x-plus 是 [RTLPlayground](https://github.com/logicog/RTLPlayground) 的一个分支,后者是面向基于 RTL8372/RTL8373 的 2.5 Gbit/s 交换机的开源固件。它为无损 RoCEv2 网络增加了 QoS、流量控制和链路聚合功能。

## 功能特性

- QoS:来自 DSCP、IEEE 802.1p 或端口的优先级,队列映射与调度([文档](doc/qos_pfc.zh-CN.md))
- IEEE 802.3x 流量控制与 IEEE 802.1Qbb 优先级流量控制(PFC)([文档](doc/qos_pfc.zh-CN.md))
- IEEE 802.3ad LACP,来自上游 pull request [#299](https://github.com/logicog/RTLPlayground/pull/299)([文档](doc/lacp.zh-CN.md))

> [!WARNING]
> 这些功能尚未在硬件上得到完整验证。安装镜像之前,请确保可以借助 SOIC-8 夹具恢复 Flash 内容;参见[直接烧写 ROM](#5-直接烧写-rom硬件方式也是救砖的唯一途径)。

## 下载

所有受支持设备的固件镜像都会自动构建。可以从 [Firmware images](https://github.com/HiroGitea/rtl837x-plus/actions/workflows/firmware.yml?query=branch%3Amain) 工作流最近一次运行中下载;带标签的版本可从 [Releases](https://github.com/HiroGitea/rtl837x-plus/releases) 下载。请选择与你的设备完全一致的镜像;参见[支持的设备](doc/supported_devices.zh-CN.md)。

## 构建

构建要求见下文第 (0) 节。为某台设备构建镜像:

```
make MACHINE=<device>
```

## 许可证

与 RTLPlayground 相同,采用 MIT 许可证。LACP 由 DrDoof 为 RTLPlayground 编写。QoS 与 PFC 寄存器定义基于 [rtl837x-dsa-driver](https://github.com/airjinkela/rtl837x-dsa-driver)。

---

*以下为 RTLPlayground 原始 README。*

# RTLPlayground
一个面向 RTL8372/RTL8373 2.5GBit 交换机高级用户的固件开发 Playground。

这类设备的每种硬件配置通常都有网管型(managed)与非网管型(unmanaged)两个在售版本,硬件基本相同。本项目旨在为非网管型设备也提供管理功能,并附加管理 VLAN、DHCP 服务器、多语言支持、IPv6 和 TLS 加密网页等特性。不过目前仅提供以下功能:
- 现代的 Web 界面,鼠标悬停可显示更多信息
- 用于配置所有功能的串口控制台接口
- 通过 IGMP 配置组播流
- 端口配置:显示本端与链路伙伴所通告速率设置的详细信息,并可在本端对这些设置进行配置
- 按端口配置帧长(MTU)以支持巨型帧(Jumbo Frame),或为特定设备限制 MTU
- 可按端口配置 EEE(节能以太网)。会提供链路伙伴所通告支持能力的详细信息,以及端口的 EEE 状态
- VLAN 配置
- 显示已插入模块的 SFP 信息,温度、RX/TX 功率等传感器数值会显示在 CLI 中,并在 Web 上以鼠标悬停方式显示
- 端口镜像配置
- 可创建链路聚合组
- 端口数据包统计的详细信息
- 通过 Web 界面将配置保存到 Flash
- 通过 Web 升级固件
- 可从原厂 Web 界面以固件升级方式安装

<img width="1673" height="977" alt="GUI" src="doc/images/gui.png" />

虽然该固件相比原厂网管固件已有长足改进,但仍缺少对专有环路防护协议以及 DHCP 的支持。生成树(Spanning Tree)功能可用(参见 doc/stp.md),但它是一个简化实现 — 在你通过网络管理的交换机上启用它之前,请先阅读该文档。如果你需要这些功能,请不要在网管型设备上安装本固件。无论如何,强烈不建议安装,除非你至少能够通过 SOIC 夹具(与 BIOS 备份所用相同)对原始 Flash 内容做好备份,并且在出问题时能重新刷回该固件。为此并不需要焊接技能。

本固件支持以下配置设备的全部硬件功能:
- 4 个 2.5GBit 端口 + 2 个 SFP+ 端口
- 5 个 2.5GBIT + 1 个 SFP+ 端口
- 8 个 2.5GBit + 1 个 SFP+ 端口
市售设备的设计通常大同小异,但 LED 配置可能存在差异(各交换机的 LED 颜色和 LED 类型不同)。已测试设备的列表见[支持的设备](doc/supported_devices.zh-CN.md)。

要进行有意义的开发,必须使用串口控制台,因此需要焊接技能。烧写必须通过 SOIC-8 测试夹(PatchClamp)完成,或为 Flash 芯片焊接一个插座。

如果不想拆开设备,你仍然可以利用本项目代码,用 Ghidra 之类的工具分析镜像来了解这些设备。如果你想参与 Web 界面的设计,或想先体验一下这个界面,项目还提供了一个独立的设备模拟器,它完全运行于 Linux 之上,作为一个本地 Web 服务器。

## (0) 编译要求

安装以下构建依赖(Debian 12/13);注意 Ubuntu 24.04 仍自带较旧版本的 sdcc,而代码需要 sdcc 4.5 才能编译:
```
sudo apt install make gcc sdcc xxd python-is-python3 libjson-c-dev zlib1g-dev
```

<details>
<summary>如果使用 Docker(点击展开)</summary>

### 前提条件

为你的平台安装 Docker:

- **Linux(Debian/Ubuntu)**:`sudo apt install docker.io`,然后执行 `sudo usermod -aG docker $USER`(注销并重新登录)
- **Linux(其他发行版)**:参照 [Docker Engine 安装指南](https://docs.docker.com/engine/install/)
- **Windows**:安装 [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)
- **macOS**:安装 [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/)

### 用法

项目提供了 Dockerfile,用于搭建可复现的构建环境:

```
docker build -t rtlplayground-dev .
```

构建固件(将 MACHINE 替换为你的目标机型,例如 `DEFAULT_8C_1SFP`):

```
docker run --rm -v $(pwd):/workspace rtlplayground-dev make MACHINE=DEFAULT_8C_1SFP
```

生成的 `.bin` 文件会出现在宿主机的 `output/` 目录中。

仅构建宿主机工具:

```
docker run --rm -v $(pwd):/workspace rtlplayground-dev make -C tools
```

在本地运行 Web 界面模拟器:

```
docker run --rm -p 8080:8080 -v $(pwd):/workspace rtlplayground-dev \
  tools/output/httpd_sim /workspace/html
```

在宿主机上编辑 `machine.h` 或 `config.txt`,然后重新运行 `make` — 源码目录被挂载进容器,更改会立即生效。要为其他机型构建,传入 `MACHINE=...` 即可。

</details>

## (1) 编译用于直接烧写芯片,以及升级已在运行 RTLPlayground 的设备

用 vi 或 nano 之类的编辑器编辑 machine.h,选择固件要构建的正确机型。

> [!TIP]
> 你可以把配置参数写在 config.txt 中(见下文),让交换机在首次启动时就拿到正确的 IP 配置。

现在应该可以构建固件镜像了:
```
make 
```
注意,生成的镜像以 .bin 结尾而不是 .img,这是为了让 IMSProg 满意。

镜像位置为 `RTLPlayground/output/rtlplayground_version_machine.bin`,
例如
```
rtlplayground-v0.1.0-12c98ba-dirty-LIANGUO_ZX_SWTGW215AS.bin
```

> [!CAUTION]
> 该镜像既可以直接烧写到芯片,也可以通过 RTLPlayground 的固件更新/升级界面刷入

## (2) 为带管理功能的 OEM 在用设备编译(Web 升级)

网管型交换机可以使用一个专用的升级镜像,从原有的原厂固件进行更新。你首先需要构建用于直接烧写芯片的固件:见下文 (1)

然后

```
cd installer
make 
```
镜像位置为  `RTLPlayground/installer/output/rtlplayground_oem_upgrade.bin`

> [!CAUTION]
> 该镜像只能用于原厂 OEM 固件 Web 界面的固件升级。
> 如果你已经在运行 RTLPlayground 固件,则不需要这个镜像。
> 除非你退回原厂 OEM 固件,否则这个专用镜像只会刷写一次。之后升级 RTLPlayground 只需按照 (1) 操作

编译控制台输出示例

```
RTLPlayground/installer$ make
mkdir -p output
gcc updatebuilder.c -o output/updatebuilder
sdas8051 -plosgff -o output/crtstart.rel crtstart.asm
sdcc -mmcs51 --code-loc 0x1000 -o output/installer.rel -c installer.c
sdcc -mmcs51 -Wl-bHOME=0x1100 -Wl-r -o output/rtlinstaller.ihx output/crtstart.rel output/installer.rel
./output/updatebuilder -i output/rtlinstaller.ihx -o output/rtlplayground_oem_upgrade.bin ../output/rtlplayground.bin
Input file size: 524288
Bytes read: 524288
EOF
Payload sum 1 is: 0x25100
Payload sum 2 is: 0x25100
Payload sum with header is: 0x264ec
Payload sum is: 0xf8fe94
Header checksum is: 0x5a1
```

## (3) 用 Ghidra 进行沙盒研究(可选)

你可以用 Ghidra 研究镜像,也可以烧写真实的交换机硬件。关于 Ghidra,参见 [Ghidra 镜像](doc/ghidra.zh-CN.md)的相关说明。

## (4) 通过 Web 界面安装(软件方式)

网管型交换机(OEM 固件或 RTLPlayground 固件)可以通过 Web 界面升级。
非网管型交换机无法用这种方式刷写(见 5)。

进入 “Firmware update” 标签页,选择正确的文件。

> [!IMPORTANT]
> 如果你的设备已经在运行 RTLPlayground,必须上传二进制文件 /RTLPlayground/output/rtlplayground_Version_Machine.bin
> 如果你的设备是 OEM,必须上传二进制文件 /RTLPlayground/installer/outputrtlplayground_oem_upgrade.bin

> [!CAUTION]
> 烧写之前,请再次确认你的设备与所选机型一致。
> 在深入折腾 RTLPlayground 之前,务必先备份原厂固件。

最后,点击 Upload File(上传文件)按钮,就完成了!


## (5) 直接烧写 ROM(硬件方式,也是救砖的唯一途径)

如果 ROM 芯片容量足够大,这是给非网管型交换机刷写的唯一方法。
如果出了问题,这也是让你的设备救砖的唯一途径。

> [!IMPORTANT]
> 要在板上直接烧写 ROM 芯片,你需要一个 SOIC-8 夹具。
> 或者,你也可以拆下 Flash 芯片,改装一个 SOIC 转接座)。
> 直接烧写芯片时,必须使用二进制文件 /RTLPlayground/output/rtlplayground_Version_Machine.bin

> [!CAUTION]
> 你需要拆开交换机外壳,请作好保修就此失效的心理准备。

- 断开交换机电源。
- 拆开交换机。
- 把夹具夹到 Flash 芯片上(红线对准引脚 1,引脚 1 上有一个圆点标记)。
- 连接编程器的 USB,交换机上的电源 LED 应当亮起;如果不亮,请检查接线。
- 别慌,把 GND 和 3.3V 接反通常不会损坏交换机。
- 用 IMSProg、Flashrom 或其他任意编程器检测芯片。
- 务必备份(转储)现有固件!
- 擦除 ROM(整片擦空)!
- 把固件载入 IMSProg。
- 将固件烧写到 ROM 芯片。
- 从 ROM 芯片上取下夹具。
- 完成,可以首次启动了。

## (6) 连接串口(可选)

所有设备上都有 UART 端口,可以连接串口线,设置为 8N1、115200 波特率。

## (7) 上电

交换机上电后,设备会执行一些示例,并提供一个最小控制台(如果接了串口),其文档可以在源码 rtlplayground.c` 中找到。

## (8) Web 界面

除非你在编译前已在 config.txt 中指定了 IP 地址,否则可以通过[默认地址 192.168.10.247](http://192.168.10.247) 访问 Web 界面。

> [!TIP]
> 默认密码为 `1234`。

## (9) 命令行

命令行非常简陋,主要用于测试。
下面是一段带示例的启动日志:
```
Detecting CPU
RTL8373 detected
Starting up...
  Flash controller

NIC reset
rtl8372_init called

RTL837X_REG_SDS_MODES: 0x00000bed

phy_config_8224 called

phy_config_8224 done

rtl8224_phy_enable called

rtl8224_phy_enable done

rtl8372_init done

A minimal prompt to explore the RTL8372:

CPU detected: RTL8373
Clock register: 0x00001101
Register 0x7b20/RTL837X_REG_SDS_MODES: 0x00000bed
Verifying PHY settings:

 Port   State   Link    TxGood          TxBad           RxGood          RxBad
1       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
2       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
3       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
4       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
5       On      2.5G    0x00000008      0x00000000      0x00000000      0x00000000
6       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
7       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
8       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
9       NO SFP  Down    0x00000000      0x00000000      0x00000000      0x00000000

> port 5 1g
  CMD: port 5 1g
PORT 04 1G

> stat
  CMD: stat
 Port   State   Link    TxGood          TxBad           RxGood          RxBad
1       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
2       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
3       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
4       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
5       On      1000M   0x00000035      0x00000000      0x00000017      0x00000000
6       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
7       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
8       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
9       NO SFP  Down    0x00000000      0x00000000      0x00000000      0x00000000

>
<SFP-RX OK>

<MODULE INSERTED>  Rate: 67  Encoding: 01
Lightron Inc.   WSPXG-ES3LC-IHA 0000

> stat
  CMD: stat
 Port   State   Link    TxGood          TxBad           RxGood          RxBad
1       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
2       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
3       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
4       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
5       On      1000M   0x00000065      0x00000000      0x0000003b      0x00000000
6       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
7       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
8       On      Down    0x00000000      0x00000000      0x00000000      0x00000000
9       SFP OK  10G     0x00000000      0x00000000      0x0000001c      0x00000000

> sfp
  CMD: sfp
Rate: 67  Encoding: 01
Lightron Inc.   WSPXG-ES3LC-IHA 0000
```

## (10) 高级配置

无需控制台模式,你也可以对交换机进行更深入的配置。

在编译阶段,你可以在生成二进制固件之前直接编辑 config.txt 文件

```
nano config.txt
```

如果想在刷写完成之后修改设置,请进入 System 标签页,找到 Startup Configuration。

<img width="1673" height="978" alt="ADVANCED SETTINGS" src="doc/images/advanced_settings.png" />

```
ip xxx.xxx.xxx.xxx      = IP address of the switch
gw yyy.yyy.yyy.yyy      = IP address of the gateway
netmask zzz.zzz.zzz.zzz = Network mask of the switch 
port x name xxx         = Name xxx the port number x
port z 1g               = Set 1g speed for port z
igmp on/off             = Turn IGMP on or off
session xxxx            = Web session timeout in seconds (default 200)
```
[未完待续]

祝玩得开心!

## (11) 其他文档

以下文档对 RTL837x SoC 的特定功能提供了更详细的说明:
- [RTL8372/3 功能支持](doc/hardware.zh-CN.md)
- [CPU 端口](doc/CpuPort.zh-CN.md)
- [L2 学习](doc/l2.zh-CN.md) 
- [IGMP(IP-MC 组播流)](doc/igmp.zh-CN.md)
- [SFP+ 端口](doc/sfp.zh-CN.md) 
- [链路聚合(Trunking,又称端口聚合)](doc/link_aggregation.zh-CN.md)
- [LACP(802.3ad 链路聚合)](doc/lacp.zh-CN.md)
- [QoS、流量控制与 PFC](doc/qos_pfc.zh-CN.md)
- [VLAN](doc/vlan.zh-CN.md)
- [风暴控制](doc/storm_control.zh-CN.md)
- [改动与 Flash 更换](doc/mods.zh-CN.md)
