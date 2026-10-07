# VLAN

[English](vlan.en.md) | 简体中文

RTL827x 支持多达 4096 个 802.1Q VLAN，每个端口都可以被分配一个 PVID。

## VLAN 控制
VLAN 由 VLAN 表控制。表项的配置方式与 L2 表项相同，区别在于 ASIC 不会自行添加表项。

添加 VLAN 表项的方法是设置：

```
RTL837x_TBL_DATA_IN_A = 02 0v vv vv
```
其中 0x02 表示一个有效表项，而 vvvvv 是一个 20 位的字段，其低 10 位指示某个端口是否为该 VLAN 的成员。高 10 位对 tagged 端口为 '0'，对 untagged 端口为 '1'（位逻辑定义为 `v = (~members) ^ tagged ^ members`）。端口编号为 0-9，其中 9 为 CPU 端口。注意，对于 RTL8372 机型，端口的编号顺序与其物理顺序并不一致。

设置好 RTL837x_TBL_DATA_IN_A 之后，通过以下方式将表项加入表中：

```
RTL837X_TBL_CTRL = 0V VV TT CC
CC: TBL_WRITE | TBL_EXECUTE
VVV: VLAN-Id
TT: 0x02 (TBL_VLAN)
CC: 0x03 (TBL_WRITE | TBL_EXECUTE)
```
表项添加完成后，ASIC 会清除 bit 0。

删除表项的方法是添加一个无效表项（在 RTL837x_TBL_DATA_IN_A 中写入 00 而不是 0x02）。

为端口分配 PVID 的方法是设置该端口对应寄存器中的 PVID 位。2 个端口共用一个寄存器：奇数端口使用位 [23:12]，偶数端口使用位 [11:0]。基址寄存器为 RTL837x_PVID_BASE_REG（0x4e1c），寄存器一直用到 0x4e2c，这样 CPU 端口也可以拥有 PVID。

寄存器 RTL837x_REG_INGRESS（0x4e10）用于定义端口的入方向（ingress）规则。每 2 位定义一条规则，使用的是位 0-19。值 00 表示不做过滤，01（0x01）表示仅允许 tagged 报文进入端口，而 10（0x02）表示仅允许 untagged 报文进入端口。

寄存器 RTL837X_VLAN_PORT_IGR_FLTR（0x4e18）用于启用或禁用入方向 VLAN 过滤，每一位对应一个指定端口（port0 -> bit0，port9 -> bit9）。启用后，进入报文的 VLAN tag 会与该端口上的 VLAN 成员关系进行比对。若报文包含的 VLAN 不在成员列表中，报文将被丢弃。

所有端口的默认 PVID 均为 1，入方向 VLAN 过滤处于启用状态，并且所有端口在入方向接受所有类型的帧。

默认情况下，端口发送的以太网帧带有 Realtek 私有的 tag 格式。通过设置相应端口配置寄存器 0x1238、0x1338，……的 bit 6（0x40），……

## VLAN API
代码目前提供以下函数：

```
void port_pvid_set(uint8_t port, __xdata uint16_t pvid) __banked;
uint16_t port_pvid_get(uint8_t port) __banked;
void vlan_create(void) __banked;   // reads from global vlan_settings
int8_t vlan_get(register uint16_t vlan) __banked;  // returns data in sfr_data
void vlan_delete(uint16_t vlan) __banked;

```

# 在串口控制台上配置 VLAN
为便于测试，串口控制台提供了以下命令：

```
vlan <VLAN-ID> p[t]...
  create or set vlan with given ID and the list of ports as members, a `t`
  behind a port defines the port as a tagged member.

vlan <VLAN-ID> d
  deletes the VLAN

vlan show
  Dumps the current ingress vlan settings.

vlan <VLAN-ID> mgmt
  Restricts network access to the switch (web UI, syslog) to the given
  VLAN. Use `vlan 0 mgmt` to disable the filter. Default is `vlan 1 mgmt`.
  Warning: setting this to an unreachable VLAN locks out the web UI;
  recovery requires serial console.

pvid <port> <VLAN-ID>
  assigns PVID to a port. ports are numbered as on the casing

ingress [p]<t|u|a>...
  Allows ingress packages on port `p` only when `t`agged, `u`ntagged or `a`ny.
  Multiple ports can be given at once as in vlan. When `p` is missing, all ports
  are assigned the same mode. CPU port can not be changed.

  Use `vlan show` to see current configuration.

  Example:
  `ingress 1t 2a` -> Set port 1 as tagged input only, set port 2 accepting any frames.
  `ingress a` -> Set all ports to accept both tagged and untagged frames (default behaviour).
```
