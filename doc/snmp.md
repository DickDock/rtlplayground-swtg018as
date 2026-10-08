# SNMP

[English](snmp.en.md) | 简体中文

固件内置一个 SNMPv2c 只读 agent,用于接入 Zabbix、PRTG、LibreNMS 等监控平台。默认关闭,通过命令行或配置文本开启。暴露 MIB-II 的 system 组和 interfaces 组(含 IF-MIB 的 64 位八位组计数器与 ifHighSpeed),以及企业子树下的芯片温度标量,监听 UDP 161 端口,community 字符串认证。

## 命令
```
snmp
snmp on|off
snmp community <word>
snmp contact <text>
snmp location <text>
```
- `snmp` 不带参数打印当前状态(是否启用、community、contact、location)。
- `snmp on` / `snmp off` 启停 agent。`on` 会在 UDP 161 上开始监听。
- `snmp community` 设置 community 字符串:一个单词、1-16 个可打印字符,默认 `public`。修改立即生效,不需要重启 agent。
- `snmp contact` / `snmp location` 设置 `sysContact.0` 与 `sysLocation.0` 的内容,可含空格(多个单词以单个空格拼接),上限 23 字符。

配置文本示例(可通过 Web 界面的配置编辑或串口写入,保存后随配置回放自动生效):
```
snmp community zbx#read
snmp on
```

## 暴露的 OID

公共前缀为 `1.3.6.1.2.1`(MIB-II);ifXTable 各列位于 `1.3.6.1.2.1.31`(ifMIBObjects)子树下,下表中以 `1.` 开头即省略了 `1.3.6.1.2` 前缀。`ifIndex` 使用 1 起始的物理端口号,与 Web 界面端口编号一致;CPU 端口不在表内。

| OID | 名称 | 说明 |
|---|---|---|
| 1.1.0 | sysDescr | `RTLPlayground <版本> <机型>` |
| 1.2.0 | sysObjectID | `1.3.6.1.4.1.32473`(占位,见下) |
| 1.3.0 | sysUpTime | 设备启动以来的百分之一秒(无 RTC,基于 200Hz 系统节拍,约 497 天回绕,符合 TimeTicks 语义) |
| 1.4.0 | sysContact | `snmp contact` 设置的内容 |
| 1.5.0 | sysName | 主机名(`hostname` 命令设置) |
| 1.6.0 | sysLocation | `snmp location` 设置的内容 |
| 1.7.0 | sysServices | 2(二层) |
| 2.1.0 | ifNumber | 物理端口数(不含 CPU 口) |
| 2.2.1.1.N | ifIndex | = N |
| 2.2.1.2.N | ifDescr | 端口名(`port <n> name` 设置),未设置时为 `Port N` |
| 2.2.1.3.N | ifType | 6(ethernetCsmacd) |
| 2.2.1.4.N | ifMtu | 实时读取端口最大帧长寄存器 |
| 2.2.1.5.N | ifSpeed | 端口速率 bps;链路 down 为 0;≥4.29Gbps 的速率饱和为 4294967295(RFC 3635) |
| 2.2.1.6.N | ifPhysAddress | 管理 MAC(所有端口相同) |
| 2.2.1.7.N | ifAdminStatus | 恒为 up(1),未建模管理态 |
| 2.2.1.8.N | ifOperStatus | up(1)/down(2),实时读取链路状态 |
| 2.2.1.9.N | ifLastChange | 恒为 0(未跟踪) |
| 2.2.1.10.N | ifInOctets | Counter32,64 位硬件计数器的低 32 位 |
| 2.2.1.11.N | ifInUcastPkts | Counter32 |
| 2.2.1.13.N | ifInDiscards | Counter32 |
| 2.2.1.14.N | ifInErrors | Counter32 |
| 2.2.1.16.N | ifOutOctets | Counter32 |
| 2.2.1.17.N | ifOutUcastPkts | Counter32 |
| 2.2.1.19.N | ifOutDiscards | Counter32 |
| 2.2.1.20.N | ifOutErrors | Counter32 |
| 1.31.1.1.1.6.N | ifHCInOctets | Counter64,64 位全值,推荐用此列绘图 |
| 1.31.1.1.1.10.N | ifHCOutOctets | Counter64 |
| 1.31.1.1.1.15.N | ifHighSpeed | 端口速率 Mbps(2.5G/5G/10G 的真实值看这里) |

芯片温度位于企业子树 `1.3.6.1.4.1.32473.1`(与 sysObjectID 同一企业号),与 MIB-II 子树在一次遍历中按 OID 序自然衔接:

| OID | 名称 | 说明 |
|---|---|---|
| 1.3.6.1.4.1.32473.1.1.0 | chipTemp | 芯片温度,Integer32,单位 0.1 °C(如 737 = 73.7 °C),实时读取温度传感器寄存器 |
| 1.3.6.1.4.1.32473.1.2.0 | chipTempPowerOn | 上电时刻的芯片温度,同样以 0.1 °C 计;与当前温度对照可区分环境温升与自热 |

## 行为与限制

- **只读**。GetRequest、GetNextRequest、GetBulk 均支持;SetRequest 静默丢弃(不响应)。
- community 不匹配、报文畸形、未知版本同样静默丢弃——监控端表现为超时。
- v1 请求天然兼容:未命中返回 noSuchName(错误码 2,回显请求 varbind 列表);v2c 返回 per-varbind 的 noSuchInstance / endOfMibView 异常。
- 无 IP 分片重组:单个响应上限约 1500 字节。GetBulk 的重复次数按剩余空间自动封顶(RFC 允许少回);一次 GET 携带超过 16 个 varbind 时返回 tooBig。
- 计数器实时读取,每次请求最多访问几十个寄存器,与 Web 状态页同量级,不影响转发面。
- `ifInDiscards`/`ifOutDiscards` 对应芯片计数器 8 的两个半字,方向语义尚未在硬件上验证;如发现与实际丢包方向相反,反馈即可。
- sysObjectID 的企业号 `32473` 是**未注册占位值**;温度标量位于同一企业号下(`.1.1.0`/`.1.2.0`)。如需规范监控部署中的设备识别,可注册 PEN 后修改 `snmp.c` 中的 `SNMP_SYSOBJID_PEN`(`oid_prefix_ent` 同步)。

## 实现说明

代码在 `snmp.c`(1MB 布局位于 bank7,过渡 bridge 镜像不含 SNMP)。请求在 uIP 缓冲区原地解析,响应在原缓冲区向上构建后一次搬移到头部之后。由于内部 RAM 的 overlay 段已满,模块内部完全采用静态 XDATA 状态与全局传参,不使用函数参数。宿主侧单元测试见 `test/test_snmp.c`(67 项断言:BER 编码字节、请求校验负路径、v1/v2c 错误语义、全树 GETNEXT 遍历顺序、乱序端口映射、GetBulk 封顶、community 处理、温度换算与 MIB-II→企业子树的遍历衔接)。

## 验证

```
snmpwalk     -v2c -c public <ip> 1.3.6.1.2.1          # 全树遍历
snmpbulkwalk -v2c -c public <ip> 1.3.6.1.2.1.2.2      # ifTable
snmpget      -v1  -c public <ip> sysUpTime.0          # v1 兼容
snmpget      -v2c -c public <ip> 1.3.6.1.4.1.32473.1.1.0   # 芯片温度(0.1 °C)
snmpwalk     -v2c -c wrong  <ip> 1.3.6.1              # 应超时无响应
```
