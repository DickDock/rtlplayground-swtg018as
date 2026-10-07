# SFP+ 插槽

[English](sfp.md) | 简体中文

RTL8372/3 支持 1 或 2 个 SFP+ 插槽,支持速率为 1GBit、2.5GBit 和 10GBit 的光纤及以太网模块。5GBit 理论上可行,但由于缺乏合适的模块,尚未实现。

插入模块后,它会直接连接到 SoC 的 GPIO、I2C 以及 RX/TX 数据线。示例原理图可在此处找到:[SFP Module Schematics](https://sfp.by/source/manual/SCP6F44-GL-BWE.pdf)。另一份资料在[这里](https://www.sfptransceiver.com/product_pdf/SFP/SFP%20Design%20Guide.pdf)。SoC 能够检测到模块的插入,因为模块会把 MOD-DEF0 线拉低,RTL837X_REG_GPIO_B 或 RTL837X_REG_GPIO_C 中的对应位会从 1 变为 0。此时,代码会等待 100 个系统 tick（200 Hz 下为 500 ms）让模块完成上电,然后读取模块的 EEPROM,以获取模块类型,尤其是比特率。EEPROM 可通过 MOD-DEF1 和 MOD-DEF2 线读取,这两条线为标准 24C EEPROM 提供标准的 I2C 接口。SoC 内置了一个用于读取此类 EEPROM 的简单 I2C 控制器,因此接口对接非常简单。

## 管理状态与拔除

`port <物理端口> off` 关闭 SFP 插槽的主机侧 SerDes；`port <物理端口> on` 通过正常的延迟模块初始化重新启用。管理状态与模块是否存在相互独立。插入或更换模块，以及用 `sfp <插槽> <速率>` 修改配置速率，都不会覆盖管理禁用状态。自动/强制速率在 off/on 和拔除后保留。现有启动配置命令可以回放这些状态；Web 界面仍不自动保存 SFP 速率修改。

拔除仅将该槽的 SerDes 切换为 `SDS_OFF`，并使旧模块信息失效。不支持的 EEPROM 速率不会传给 SerDes 配置函数；在选择受支持的强制速率或更换模块之前，主机接口保持关闭。`/status.json` 的 `enabled` 表示管理允许状态，空槽也可以为启用；模块身份和诊断信息与之独立，只有有效时才出现。诊断读取失败表示不可用，而不是测量值为零。

这**不是模块电源控制**。例如 SWTG018AS-A V2.0 没有映射 TX_DISABLE 引脚，关闭主机接口不代表切断模块供电或关闭激光。对于引脚映射未知的机型，固件不会新增 TX_DISABLE 写入。

## I2C 控制器

RTL8372/3 的 I2C 控制器非常简单,很可能是专门为读取 24C EEPROM 而设计的。它的使用很直接:先在 RTL837X_REG_I2C_CTRL 寄存器中配置所使用的 I2C 总线(代码目前直接使用已设置的默认值,它决定的可能是时序)。然后将要读取的 EEPROM 寄存器地址写入 RTL837X_REG_I2C_IN(最低有效字节)。通过置位 RTL837X_REG_I2C_CTRL 的第 0 位来启动 I2C 传输。当该位被 SoC 的 ASIC 侧清零后,就可以从 RTL837X_REG_I2C_OUT 的最低字节读出结果。下方旧版单字节示例说明寄存器协议。当前 `rtl837x_pins.c` 中的 `sfp_read_block()` 一次读取最多 16 字节，并限制事务启动前和完成阶段的 busy 等待：以 tick 计时的 100 ms 截止时间，以及 tick 停止时的有限轮询预算。失败返回 `false`，不读取旧输出，也不覆盖仍 busy 的事务；重试会等待控制器空闲。这不能恢复底层 SFR 寄存器访问引擎故障，也不会写入未确认的复位位。
```
uint8_t sfp_read_reg(uint8_t slot, uint8_t reg)
{
        // Select I2C-bus according to slot
	if (slot == 0) {
		reg_read_m(RTL837X_REG_I2C_CTRL);
		sfr_mask_data(1, 0xff, 0x72);
		reg_write_m(RTL837X_REG_I2C_CTRL);
	} else {
		reg_read_m(RTL837X_REG_I2C_CTRL);
		sfr_mask_data(1, 0xff, 0x6e);
		reg_write_m(RTL837X_REG_I2C_CTRL);
	}

	REG_WRITE(RTL837X_REG_I2C_IN, 0, 0, 0, reg);

	// Execute I2C Read
	reg_bit_set(RTL837X_REG_I2C_CTRL, 0);

	// Wait for execution to finish
	do {
		reg_read_m(RTL837X_REG_I2C_CTRL);
	} while (sfr_data[3] & 0x1);

	reg_read_m(RTL837X_REG_I2C_OUT);
	return sfr_data[3];
}
```

EEPROM 中所存数据的说明见 [SFF-8472 标准](https://members.snia.org/document/dl/25916)。最相关的是字节 12(0x0c),它以 100MBit 为单位给出模块的信令速率,其中包含 25% 的纠错开销。目前的代码如下:
```
static inline uint8_t sfp_rate_to_sds_config(register uint8_t rate)
{
	if (rate == 0xd)
		return SDS_1000BX_FIBER;
	if (rate == 0x1f)  // Ethernet 2.5 GBit
		return SDS_HSG;
	if (rate > 0x65 && rate < 0x70)
		return SDS_10GR;
	return 0xff;
}
```
例如,一个 1000MBit 光纤模块的速率编码为 0xd = 13 = 1300Mbit,这是 1250MBit 向上取整后的值,即 1000BX 光纤模块经纠错后的比特率。

## 模块的 RX/TX 接口对接

为了向模块发送数据或从模块接收数据,SoC 上连接模块的 SerDes 需要得到正确配置。从 [SFP Module Schematics](https://sfp.by/source/manual/SCP6F44-GL-BWE.pdf) 可以看出,模块的光电晶体管经放大器优化后被量化为比特,以差分对的形式直接到达 SoC。这些数据仍带有光纤上纠错码带来的 25% 开销。交换机需要正确配置 SerDes(sds_config()),并在 SoC 上设置 MAC,使其以正确的比特率与 SDS 通信。

## 其他 SFP 模块 GPIO
SFP 模块还提供 RX-LOS GPIO,当光纤或以太网线缆未连接(在链路任一侧)时它会拉低;通常还提供一个 TX-disable GPIO,用于关闭激光器,从而切断链路供电。一般还有一个 TX-Fault GPIO,在激光器过热时拉低。RX-LOS 引脚连接到了 SoC,对于单 SFP+ 插槽的设备可以读取该引脚(对于双 SFP+ 插槽的 KP-9000-6HX-X2,似乎只有右侧插槽的 RX-LOS 引脚被连接),而其他 GPIO 尚未得到确认;从 PCB 上的走线数量来看,这些引脚很可能并未连接。

RX-LOS GPIO 并不会带来更多好处,因为链路状态同样可以从 MAC 或 SDS 的链路状态寄存器中读取。

确认 SFP 模块其他 GPIO 最简单的方法,是拆开一个廉价模块,把导线焊接到板上 PCB 的引脚上,再将导线从模块末端引出。在打印 GPIO 状态的同时把例如 TX-Fault 拉低,即可识别出正确的 GPIO。
