# 压缩 Web UI 资源

[English](webui-compression.md) | 简体中文

Web UI（`html/` 下的所有文件）被嵌入 flash 镜像并通过 HTTP 提供。两个构建时步骤使它保持很小：一个安全的压缩器（minifier）以及对嵌入文件的 gzip 压缩。

## 工作原理

```
html/  --(minify.py)-->  output/html_min/  --(fileadder -z)-->  flash image
```

- `tools/minify.py` 移除注释（`<!-- -->`、`//`、`/* */`）和行首空白，且不会触碰字符串或正则表达式字面量，因此输出与输入在功能上完全相同。二进制文件（`.ico`）原样复制。`html/` 中的原始源码保持不变以供开发；`output/` 中的压缩副本只是纯粹的构建产物。注释和缩进对传输的字节来说是纯开销，因此仅压缩这一步就能把传输大小从 109,814 字节降到 97,730 字节，与 gzip 无关。
- Web UI 是一个单页应用：`index.html` 以 section（`#ports`、`#vlan` 等）的形式容纳所有页面，侧边栏通过 URL hash 在它们之间切换。`login.html` 保持独立，因为它是认证入口并且自包含（自带样式和字符串），因此登录之前不会提供任何其他内容。只有这两个页面加上 `app.js` 和 favicon 会被嵌入；样式表和主题引导脚本内联在 `index.html` 中。
- 所有 JavaScript（翻译表、共享辅助函数、导航以及各 section 的代码）都位于一个 `html/app.js` 中，页面将其作为唯一的脚本加载，因此浏览器只需获取一次，gzip 也能对整个文件进行压缩。一个 section 在显示时启动它的轮询器，离开时停止；重新进入某个 section 会重新获取数据。
- `fileadder -z` 在生成文件表（`html_data.c`/`html_data.h`）以及把文件嵌入最终镜像时，会对每个文件进行 gzip 压缩（zlib，gzip 格式，`Z_BEST_COMPRESSION`）。两次调用都作用于 `output/html_min/`，因此文件表和镜像始终一致。
- httpd 依据 `f_data` 条目中的 `gzip` 标志，以 `Content-Encoding: gzip` 提供每个文件。8051 只负责把压缩后的字节从 flash 复制到 socket；解压在浏览器中完成。
- 只有静态文件被压缩。JSON API 响应（`/information.json`、`/vlanlist` 等）是即时生成的，保持不压缩。

## 实测效果

在任何机器上构建即可（Web UI 与机器无关）：

| | 字节 |
|---|---:|
| 原始源码 | 109,814 |
| 压缩后（移除注释和缩进） | 97,730 |
| gzip（flash + 线上传输） | 25,302（23.0 %） |

当 gzip 支持缺失或被禁用时，浏览器收到的就是压缩后的资源，因此两个阶段都能降低传输大小：压缩使其从 109,814 降到 97,730 字节，gzip 再降到 25,302 字节。

嵌入数据块在不压缩时结束于 `0x5b977`，压缩后结束于 `0x462d6`，在 512 KB 镜像中释放了约 86 KB。

这种整合在每一步都有帮助。17 个脚本作为独立文件 gzip 后为 23,302 字节，而合并成一个 `main.js` 后为 17,231 字节，因为 gzip 字典覆盖了所有文件。单页布局随后又去掉了每页的 HTML，更重要的是去掉了重复下载：在多页 UI 下，浏览器每次导航都要获取 `main.js`；SPA 只获取一次所有内容，section 切换就是纯粹的页内 JavaScript（在真实设备上实测：冷加载约 450 ms，section 切换约 60-160 ms，之后的唯一网络流量就是可见 section 的 JSON 轮询）。

## 说明

- 这些文件远低于文件表的 `uint16_t` 大小上限（最大的 gzip 输出：`app.js` 约 29 KB，包含三种语言）。
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

`tools/httpd_sim` 直接从 `html/` 提供原始文件，不会走到 gzip 路径；对着已刷机的交换机进行浏览器访问（或使用 `curl --compressed`）才是最终检验。
