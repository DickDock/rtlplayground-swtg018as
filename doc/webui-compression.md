# 压缩 Web UI 资源

[English](webui-compression.en.md) | 简体中文

Web UI（`html/` 下的所有文件）被嵌入 flash 镜像并通过 HTTP 提供。两个构建时步骤使它保持很小：一个安全的压缩器（minifier）以及对嵌入文件的 gzip 压缩。

## 工作原理

```
html/index.html html/login.html html/favicon.ico --\
                                                    +--(minify.py)-->  output/html_min/  --(fileadder -z)-->  flash image
html/app/*.js --(按文件名顺序拼接)------------------/
```

- `tools/minify.py` 移除注释（`<!-- -->`、`//`、`/* */`）和行首空白，且不会触碰字符串或正则表达式字面量，因此输出与输入在功能上完全相同。二进制文件（`.ico`）原样复制。`html/` 中的原始源码保持不变以供开发；`output/` 中的压缩副本只是纯粹的构建产物。
- 手写的 JavaScript 位于 `html/app/*.js`，按关注点一文件（`00-i18n.js` 放字典、`01-core.js` 放共享辅助函数、`02-config.js` 放 CLI 语法、每个标签页一文件）。`html_min` 目标把它们按文件名顺序拼接成一个 `app.js` 再压缩，浏览器只需获取一个脚本，gzip 也能覆盖整个文件。主机测试直接逐文件求值这些分片，这正是核心文件在顶层不得触碰 DOM 的原因（见 `01-core.js` 的注释头）。
- Web UI 是一个单页应用：`index.html` 以七个 section（`#dash`、`#ports`、`#vlan`、`#l2`、`#links`、`#flows`、`#system`）的形式容纳所有页面，侧边栏通过 URL hash 在它们之间切换；合并前的旧 hash（`#stp`、`#lag`、`#eee`、`#stats`、`#bw`、`#mirror`、`#fw`）会在启动时映射到新页面。`login.html` 保持独立，因为它是认证入口并且自包含（自带样式和字符串），因此登录之前不会提供任何其他内容。只有这两个页面加上 `app.js` 和 favicon 会被嵌入；样式表和主题引导脚本内联在 `index.html` 中。
- 一个 section 在显示时启动它的轮询器，离开时停止；重新进入某个 section 会重新获取数据。
- `fileadder -z` 在生成文件表（`html_data.c`/`html_data.h`）以及把文件嵌入最终镜像时，会对每个文件进行 gzip 压缩（zlib，gzip 格式，`Z_BEST_COMPRESSION`）。两次调用都作用于 `output/html_min/`，因此文件表和镜像始终一致。
- httpd 依据 `f_data` 条目中的 `gzip` 标志，以 `Content-Encoding: gzip` 提供每个文件。8051 只负责把压缩后的字节从 flash 复制到 socket；解压在浏览器中完成。
- 只有静态文件被压缩。JSON API 响应（`/information.json`、`/vlanlist` 等）是即时生成的，保持不压缩。

## 实测效果

在任何机器上构建即可（Web UI 与机器无关）：

| | 原始 | 压缩后 | gzip（flash + 线上传输） |
|---|---:|---:|---:|
| `app.js`（含双语字典） | 104,464 | 94,434 | 30,781 |
| `index.html` | 38,029 | 34,735 | 9,170 |
| `login.html` | 5,403 | 5,109 | 2,374 |
| `favicon.ico` | 378 | 378 | 214 |
| 合计 | 148,274 | 134,656 | 42,539（28.7 %） |

体积随 UI 本身变化；需要盯住的数字是 gzip 合计。HTML 槽位是 `HTML_LOCATION` 0xB0000 处对齐扇区的 64 KB 窗口，且单个文件必须低于文件表的 `uint16_t` 上限（gzip 后 64 KB）。整个槽位的 gzip 体积达到约 40 KB 时就应当着手瘦身。

## 说明

- `fileadder` 会在内容之后立即用一个 NUL 终止嵌入文件（之前是 `data_read + 1`），因此基于 `strlen()` 的大小计算不再依赖未初始化的缓冲区内容。
- `version.h` 现在由一条原子的 `printf` 写入（相对上游的改动），而不是五条独立的 `echo`，因此并行构建（`make -j`）不会再读到写到一半的副本。它保持在 `.PHONY` 中，因此每次构建都会重新生成。

## 验证

解压固件嵌入的内容，并与压缩后的源码进行比较：

```python
import gzip, re
h = open('html_data.h').read(); c = open('html_data.c').read()
starts = dict((k, int(v, 16)) for k, v in
              re.findall(r'#define FDATA_START_(\w+) 0x([0-9a-f]+)', h))
sizes = dict((k, int(v)) for k, v in
             re.findall(r'#define FDATA_SIZE_(\w+) (\d+)', h))
entries = [(p, sizes[z], starts[s]) for p, s, z in
           re.findall(r'\{"/([^"]+)", FDATA_START_(\w+), '
                      r'FDATA_SIZE_(\w+), \w+, 1\}', c)]
d = open('output/rtlplayground.bin', 'rb').read()
for name, size, start in entries:
    assert gzip.decompress(d[start:start+size]) == \
        open('output/html_min/' + name, 'rb').read()
```

`tools/httpd_sim output/html_min` 通过纯 HTTP 提供压缩后的文件，便于本地调试 UI（它不走 gzip 路径）；对着已刷机的交换机进行浏览器访问（或使用 `curl --compressed`）才是最终检验。
