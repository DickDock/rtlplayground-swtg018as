# LED GPIO 工具

[English](README.md) | 简体中文

本目录包含通过 I2C 总线与 RTL837x 交换芯片通信的工具。
这些脚本旨在帮助监控、调试 GPIO,以及识别 LED 配置。
(仅在 Linux 上测试过)

## 硬件要求

要使用这些工具,你需要:

  - 一个能与 I2C 设备通信的硬件适配器(dongle),例如提供 USB 转 I2C 连接的 [I2C-Pico-USB](https://github.com/dquadros/I2C-Pico-USB)。
  - 硬件适配器与 RTL837x 的 I2C 通信端口之间的连线。

## 脚本

### 1. `i2c_read_rtl_gpio.py`

该脚本通过 I2C 读取 RTL GPIO 寄存器的值,并显示 GPIO 状态的变化。

**功能:**

  - 通过 I2C 实时读取 RTL GPIO 寄存器值(默认地址 0x5C)
  - 以差量检测的方式监控 GPIO 变化
  - 允许指定 I2C 总线、休眠间隔和要忽略的 GPIO 引脚
  - 实时显示变化,并显示 GPIO 编号

**用法:**
```bash
# Basic usage (defaults to I2C bus 1, 2s sleep interval)
python3 i2c_read_rtl_gpio.py

# Specify I2C bus
python3 i2c_read_rtl_gpio.py --i2c-bus 0

# Specify sleep interval in seconds
python3 i2c_read_rtl_gpio.py --sleep-interval 5

# Ignore specific GPIO pins
python3 i2c_read_rtl_gpio.py --ignored-ios 28 31 34 44

# Combine options
python3 i2c_read_rtl_gpio.py --i2c-bus 2 --sleep-interval 1 --ignored-ios 28 31
```

**输出格式:**

  - 以十六进制格式显示寄存器地址和数据
  - 显示自上次读取以来发生变化的 GPIO 引脚
  - 示例:`0044: 00 00 00 00 00 00 00 00`

### 2. `i2c_dump_rtl_regs.py`

该脚本通过 I2C 转储 RTL 设备的所有寄存器值。

**功能:**

  - 从地址 0x0000 到 0xFFFF 顺序转储寄存器
  - 每次读取 16 字节以提高效率
  - I2C 总线号可配置
  - 以十六进制格式提供完整的寄存器转储

**用法:**
```bash
# Basic usage (defaults to I2C bus 1)
python3 i2c_dump_rtl_regs.py >reg_dump.txt

# Specify I2C bus
python3 i2c_dump_rtl_regs.py --bus 0 >reg_dump.txt

# Or using short option
python3 i2c_dump_rtl_regs.py -b 2 >reg_dump.txt
```

**输出格式:**

  - 以十六进制格式显示地址和 16 字节数据
  - 示例:`0000: 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00`

### 3. `dec_leds_from_dump.py`

该脚本从寄存器转储文件(`i2c_dump_rtl_regs.py` 的输出)中解码 LED 配置。

**功能:**

  - 解析寄存器转储文件(reg_dump.txt 格式)
  - 解码 LED 焊盘(pad)配置与 LED 组(set)
  - 根据配置将 LED 类型映射到相应的位位置
  - 输出 LED 复用(mux)配置与组映射

**用法:**
```bash
# Must be run in same directory as reg_dump.txt
python3 dec_leds_from_dump.py
```

**输出格式:**

  - LED 焊盘配置(每个焊盘的十六进制值)
  - LED 组配置及 LED 类型说明
  - 端口选择映射

**要求:**

  - 需要一个包含寄存器转储输出的 `reg_dump.txt` 文件

## 依赖要求

所有脚本都需要:

  - Python 3
  - `smbus2` Python 包

(取决于所用 Linux 发行版)安装命令:
```bash
apt install python3-smbus2
```
或
```bash
pip3 install smbus2
```


## 常见使用场景

`i2c_read_rtl_gpio.py` 和 `i2c_dump_rtl_regs.py` 都应在**原厂**固件下运行,而不是 RTLPlayground 固件。


### 监控 GPIO 变化
```bash
# Monitor GPIO changes on bus 1 with 1-second intervals
python3 i2c_read_rtl_gpio.py --i2c-bus 1 --sleep-interval 1
```

### 寄存器分析
```bash
# Dump all device registers
python3 i2c_dump_rtl_regs.py --bus 2 > reg_dump.txt

# Analyze the register dump to understand LED configuration
python3 dec_leds_from_dump.py
```

## 配置

所有脚本都支持通过命令行参数进行灵活配置:

  - `--i2c-bus` 或 `-b`:指定 I2C 总线(默认:1)
  - `--sleep-interval` 或 `-s`:两次读取之间的休眠秒数(默认:2)
  - `--ignored-ios` 或 `-i`:要忽略的 GPIO 引脚(默认:[28, 31, 34, 44])
