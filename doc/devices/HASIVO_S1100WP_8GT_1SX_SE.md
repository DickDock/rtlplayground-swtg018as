# Hasivo S1100WP-8GT-1SX-SE

[English](HASIVO_S1100WP_8GT_1SX_SE.en.md) | 简体中文

基于 RTL8373 的 8×2.5G PoE + 1×SFP 交换机。

### 标签规格

- **制造商**:Hasivo
- **型号**:S1100WP-8GT-1SX-SE
- **端口**:
  - 8 × RJ45:10/100/1000/2500 Mbps,支持 PoE
  - 1 × SFP:1G / 2.5G / 10G
- **电源输入**:DC 52V 2.5A
- **原厂固件默认设置**:IP 192.168.0.1,用户名/密码 `admin`/`admin`

### 已实现的功能

- 全部 8 个 2.5GBASE-T RJ45 端口,支持 10/100/1000/2500 Mbps(PoE 无法通过 RTLPlayground 配置)
- SFP 端口,支持 1G、2.5G 和 10G 模块
- LED 灯:每个电口有绿色(2.5G)和琥珀色(1G/100M/10M)指示灯;SFP 端口为链路/活动合一指示灯

### 照片

前面板:

<img src="photos/HASIVO_S1100WP-8GT-1SX-SE/front.jpg" width="600" />

标签:

<img src="photos/HASIVO_S1100WP-8GT-1SX-SE/label.jpg" width="600" />

### PCB 概览

顶面:

<img src="photos/HASIVO_S1100WP-8GT-1SX-SE/pcb_top.jpg" width="600" />

底面:

<img src="photos/HASIVO_S1100WP-8GT-1SX-SE/pcb_bottom.jpg" width="600" />

### 端口布局

| 逻辑端口 | 物理端口 | 类型   |
|--------------|---------------|--------|
| 1-8          | 1-8           | 电口 |
| 9            | 9             | SFP    |

### LED 配置

电口使用 LED SET0,SFP 端口使用 LED SET1。

| SET  | LED0                                          | LED2                                                 |
|------|-----------------------------------------------|------------------------------------------------------|
| SET0 | 绿色——2.5G 链路且有活动时点亮     | 琥珀色——1G / 100M / 10M 链路且有活动时点亮 |
| SET1 | 全速率——任何链路有活动时点亮 | —                                                    |

### SFP GPIO 分配

| SFP(逻辑 9) | pin_detect (ModAbs) | pin_los | pin_tx_disable | SerDes | I2C SDA         | I2C SCL             |
|-----------------|---------------------|---------|----------------|--------|-----------------|---------------------|
| SFP             | GPIO30_ACL_BIT3_EN  | GPIO37  | GPIO_NA        | SDS1   | GPIO39_I2C_SDA4 | GPIO40_I2C_SCL3_MDC1 |

### 机型配置

- `reset_pin`: GPIO54_ACL_BIT2_EN
- 高位 LED(焊盘 27-29):mux = `LED_27 | LED_28_SYS | LED_29`,enable = `LED_28_SYS | LED_29`

### PoE

8 个电口支持 PoE,由 DC 52V 2.5A 输入供电。电源管理由两颗 HS104PTI 芯片通过 I2C(GPIO47_I2C_SDA0、GPIO46_I2C_SCL0)处理:

* 芯片 1(I2C 地址 0x1A):2.5G 端口 1–4
* 芯片 2(I2C 地址 0x2A):2.5G 端口 5–8

注意:当前实现尚不支持 PoE 管理。因此,PoE 目前以独立模式运行,不受软件控制。