# DIY 开发指南（rtlplayground-swtg018as）

> 本仓库 = rtl837x-plus fork（含 LACP/QoS）+ SWTG018AS_A_V_2_0 机型定制 + macOS 构建修复。
> 当前在役固件即本仓库 `main` 的构建产物，运行于 LIANGUO LG-SG8T1(WEB) / ZX903
> （PCB `SWTG018AS-A-V2.0`，8×2.5G + 1×SFP+），管理地址 `192.168.31.3`。

## 1. 目录导览（按需求找文件）

| 想改什么 | 去哪 |
|---|---|
| 机型/硬件差异（LED、引脚、口序） | `machine.h`（机型开关）、`machine.c`（参数实现） |
| 出厂默认 IP | `config.txt`（⚠️ 改后必须 `rm -rf output` 再 make，它不在 Makefile 依赖里） |
| 默认密码 | `cmd_parser.c` 的 `#define PASSWORD` |
| 新增/修改 CLI 命令 | `cmd_parser.c`（仿照 `parse_lag()` 的套路） |
| LACP 协议行为 | `rtl837x_lacp.c/.h`（RX 状态机、mux、聚合器选择；诊断金句见 `lacp_show()`） |
| LAG/端口逻辑 | `rtl837x_port.c` |
| WebUI 前端 | `html/app.js`（单页应用，内嵌多语言）+ `html/login.html` |
| Web API/页面路由 | `httpd/httpd.c`（端点表：`/cmd`、`/upload`、`/config`、`/login`…）+ `httpd/page_impl.c` |
| 上游文档 | `doc/`：`lacp.md`、`qos_pfc.md`、`automation.md`、`vlan.md`、`stp.md`、`link_aggregation.md`… |
| 主机侧测试 | `test/`（fork 带 lacp/port_hash/httpd_tx 的 shim 测试） |
| 构建产物 | `output/`（`rtlplayground.bin` 为软链，指向 `output/<MACHINE>/` 里的 512KiB 成品） |

## 2. 构建循环（macOS，环境已就绪）

前置依赖（已装）：`sdcc ≥4.5`、`brew binutils`（提供 objcopy）、`json-c`、`argp-standalone`。

```sh
PATH="/opt/homebrew/opt/binutils/bin:$PATH" make
```

- 产物：`output/rtlplayground.bin`（512 KiB，文件名含版本+commit）
- ⚠️ 改了 `config.txt` 或 `machine.h` 后先 `rm -rf output` 再 make（增量构建不会重新生成）
- push 到 GitHub 后 Actions 可自动构建全机型镜像（首次需在仓库 Settings → Actions 启用）

## 3. 刷入（二选一）

**浏览器**：`http://192.168.31.3` → 登录 → 「固件」页 → 选 `output/rtlplayground.bin` → 上传。
浏览器端会先做大小/魔数/CRC16 预校验；⚠️ 实测浏览器传 512KB 可能"传输中连接断开"（暂存区设计，失败无副作用），此时用下面的 curl 方案。

**curl（稳定，推荐）**：

```sh
# 登录拿会话（密码当前 1234，建议先在 WebUI 改掉）
curl -s -c /tmp/fw.cookie -X POST -H "Content-Type: application/x-www-form-urlencoded" \
  -d "pwd=1234" http://192.168.31.3/login
# 上传（必须禁用 Expect: 100-continue，嵌入式服务器吃不消）
curl -s -b /tmp/fw.cookie -H "Expect:" \
  -F "uploadedfile=@output/rtlplayground.bin" http://192.168.31.3/upload
# → 200 "OK: checksum verified, rebooting"，等 1-2 分钟自动重启
```

镜像写入是**暂存区设计**：上传/校验通过后重启，再二次校验才应用；上传中断不伤在役固件。
启动配置会被保留。**变砖兜底**：SOP8 夹子 + flashrom 回退（OEM dump 与命令见
homelab 仓库 `deploy/rtlplayground-20261006/` 与 `docs/20` 号文档）。

## 4. 运行时验证与配置 API

```sh
C=/tmp/fw.cookie
# fork 在线标志（主线无此端点）
curl -s -b $C http://192.168.31.3/lacp.json
# 执行任意 CLI 命令（纯文本 body）：诊断、配置全能干
curl -s -b $C -X POST --data-binary "lag show"  http://192.168.31.3/cmd
curl -s -b $C -X POST --data-binary "lacp show" http://192.168.31.3/cmd
# 读/写启动配置（写=完整命令文本，multipart 字段固定叫 configuration）
curl -s -b $C http://192.168.31.3/config
curl -s -b $C -F "configuration=@/tmp/startup_config.txt;filename=config.txt" http://192.168.31.3/config
```

- LACP 协商成功判据：`lacp show` 中 `aggregator` = 对端系统 MAC、`members` 非零、
  actor `3f`/partner `3d`、**rx 计数在增长**（rx 卡 0 = LACPDU 没到 CPU，先查对端模式）
- 串口控制台：J3 排针 3V3/GND/RX/TX，**115200 8N1**（功能同 /cmd，救砖时用）

## 5. 同步上游

```sh
git fetch plus            # plus = HiroGitea/rtl837x-plus（本仓库的基座）
git merge plus/main       # 同一条历史线，可正常 merge
```

注意：主线 `logicog/RTLPlayground` 与本线历史无关，其提交不可 cherry-pick；
想要主线的新改动，等 rtl837x-plus 同步后再 merge。

## 6. 已知坑（都已在本仓库修掉，别再踩）

- macOS 自带 GNU make 3.81 会被 `$(shell)` 里的裸 `#` 噎死 → 已转义（顶层 Makefile）
- host 工具的 argp/json-c 在 macOS 缺失 → 已做成 Darwin 条件开关（tools/installer Makefile）
- objcopy 不在默认 PATH → 构建时挂 `/opt/homebrew/opt/binutils/bin`
- `config.txt` 不触发重编 → `rm -rf output`
