# 端口镜像

[English](mirroring.en.md) | 简体中文

RTL827x 支持把来自多个端口的报文镜像（port mirroring）到一个镜像端口。对每个被镜像的端口，可以定义是镜像其接收的报文、发送的报文，还是两者都镜像。

## 镜像控制
通过设置 RTL837x_MIRROR_CTRL（0x6048） 来启用镜像：

```
RTL837x_MIRROR_CTRL = port << 1 | 0x1
```
端口编号为 0-9，其中 9 为 CPU 端口。
向该寄存器写入 0 即可停止镜像。

被镜像的端口在 RTL837x_MIRROR_CONF（0x604c） 中配置：

```
RTL837x_MIRROR_CONF = RRRR TTTT
RRRR: 16 bit mask for ports where received packets are mirrored
TTTT: 16 bit mask for ports where transmitted packets are mirrored
```

## 镜像 API
代码目前提供以下函数：

```
void port_mirror_set(register uint8_t port, __xdata uint16_t rx_pmask, __xdata uint16_t tx_pmask) __banked
void port_mirror_del(void)
```

# 在串口控制台上进行镜像
为便于测试，串口控制台提供了以下命令：

```
mirror <mirroring port> <P1>[r|t] [P2][r|t] ...
  mirror to port <mirroring port>, source ports are P1 with the givent packet types, P2 and so on

mirror d
  Deletes mirroring configuration
```
