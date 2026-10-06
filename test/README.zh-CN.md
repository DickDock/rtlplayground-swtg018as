# 宿主机单元测试框架

[English](README.md) | 简体中文

在构建主机上使用 **gcc + AddressSanitizer + UBSan** 编译并测试单个固件编译单元(translation unit)— 无需 SDCC、无需烧写、无需硬件。这是排查 `../../NOTES/08-findings.md` 中逻辑层缺陷(解析器、行编辑器、HTTP 头部、DHCP)的快速内环:编辑 → `make` → 几秒钟内看到红/绿结果,而不是动辄数分钟的“烧写—重启”循环。

## 运行
```
cd test
make            # build + run all tests (ASan/UBSan on)
make clean
```
只要任何检查失败、sanitizer 触发或看门狗超时,退出状态码就会非零 — 因此可以直接接入 CI。

## 工作原理
- **`sdcc_shim.h`**(强制包含)抹掉 SDCC 8051 关键字(`__xdata`、`__code`、`__banked` 等),使固件源码能在宿主机 gcc 下编译。它不改变任何逻辑 — 被测代码与固件源码逐字节一致。
- **`hw_mock.c` / `hw_mock.h`** 模拟 ASIC 边界:`reg_read`/`reg_write` 背后是一块平坦的寄存器文件和 `SFR_DATA_*` 寄存器,并配有一个表引擎 — 一旦写入 `TBL_CTRL` 就执行一次 VLAN 或 L2 操作,在 `STAT_GET` 时取出 MIB 计数器,在 `L2_TBL_FLUSH_CTRL` 时清除表项。任何东西都不会报告忙,因此轮询循环只跑一遍。该头文件独立于固件声明了 VLAN 和 L2 表项布局,测试因此可以把 `rtl837x_port.c` 写入的内容与 `page_impl.c` 读取的内容相互印证。
- **`env_tables.c`** 提供上述两个模块链接所需的全局变量和叶子调用;**`stub/`** 顶替了只有固件构建才会生成的两个头文件,因此该框架无需先做 SDCC 构建。
- **`support.c` / `support.h`** mock 硬件边界:16 字节串口环形缓冲(`sbuf`)、命令/历史缓冲,以及字符输出汇(`write_char` 等)。各缓冲区的大小与目标机**完全一致**,因此 ASan 红区能抓住 8051 上会触发的同类差一错误溢出。
- 构建时定义 **`RTLP_HOST_TEST`**,它会把固件中与 libc 同名的原型(`memset`/`strlen` 等)从 `rtl837x_common.h` 中隐藏起来,避免与 glibc 冲突。参数顺序与 libc 相同,宿主机上的调用方可以透明地使用 C 库。这个宏在正常固件构建中会被编译剔除 — 对目标机零影响。
- **SIGALRM 看门狗**(`watchdog_arm`)把死循环缺陷变成一次快速失败,而不是让测试运行器卡死。

## 当前覆盖范围
| 测试二进制 | 被测编译单元 | 验证的缺陷 |
|-------------|---------------|--------------------|
| `test_cmd_editor` | `cmd_editor.c` | **C4** — 整行输入挂死 + `cmd_buffer` 1 字节溢出;基本输入与退格回归 |
| `test_port_tables` | `rtl837x_port.c` | VLAN 表项布局与往返读写、PVID 寄存器共享、静态组播与管理表项、按端口清除、链路聚合(trunk)成员关系与哈希种子 |
| `test_page_json` | `httpd/page_impl.c` + `rtl837x_port.c` | `/vlan.json`、`/vlanlist`、`/l2.json`(遍历、回绕标记、`outbuf` 内分页),`/status.json` 和 `/counters.json` 中的 64 位计数器 |
| `test_httpd_tx` | `httpd/httpd.c` + `uip/uip.c` | 在接收窗口不断移动的客户端下 GET 一个静态文件:ACK 记账、从 Flash 取出的续传分块、重传 |
| `lacp/` | `rtl837x_lacp.c` | 针对模拟的 802.3ad 对端运行状态机:收敛、接线错误、超时、重新选举、双聚合组、LACPDU 捕获表项 |
| `port_hash/` | `port_lag_members_set()` | LAG 会设置自己哈希寄存器的种子 |

## 为其他模块添加测试
1. 编写 `test_<module>.c`,在 `main()` 中驱动该模块的各个入口,并使用 `CHECK(cond, msg)` 断言。
2. 把缺失的 mock 符号补入 `support.c`(只补链接器索要的那些)。
3. 在 `Makefile` 中添加一个目标,源文件列出 `test_<module>.c support.c ../<module>.c`。
4. 如果该模块调用了固件的 libc 同名函数(`memcpy`/`strcpy` 等),在宿主机上会直接使用 C 库(参数顺序兼容);只有当语义差异会影响测试结果时,才需要提供 `fw_*` 风格的 mock。

合适的下一个目标(纯逻辑、缺陷密度高):`cmd_parser.c`(C6/C8)、`httpd/httpd.c` 中的 HTTP 头解析器(S1)、`dhcp.c`(S5)。
