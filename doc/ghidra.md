# 使用 ghidra 理解固件镜像

[English](ghidra.en.md) | 简体中文

启动 ghidra，把文件从偏移 0x0002 开始加载到从 0x0000 开始的内存中，长度为 0x10000。选择 generic 8051、大端序（big endian）。

加载完成后，boot 向量位于 0x0000，它会跳转到 0x0100 处的启动例程。

由于固件相当短，它只使用了 RTL837x 的 bank 1。否则固件将按如下方式组织：
```
--------------------------- 0x0000 ---------------------------------
Boot-Vector
ISRs
Common Code
Trampoline for inter-bank calls
Inter-bank calls, calling trampoline, one for each callable function

----- Bank 1 0x4000 ------   ---- Bank 2 0x4000 -----  -------- .....
Overlay 1                    Overlay 2                 Overlay n

--------- 0xffff ---------   -------- 0xffff --------  -------- 0xffff
```
RTL837x 固件镜像的组织方式如下：
镜像的前 2 个字节表示 CPU 上电启动时在起始处预取数据的大小。默认值为 0x4000（字节：0x00 0x40），这意味着所有 bank 中代码存储器的整个共享区域——0x4000 字节——会被立即读入代码 RAM。

公共代码（Common code）从镜像中的 0x0002 开始，长度为 0x3ffd；第一个 bank 从镜像中的 0x4000 开始，被映射到 0x4000，长度为 0xc000；第二个 bank 从镜像中的 0x10000 开始，被映射到 0x4000，长度为 0xc000；第三个 bank 将从 0x1c000 开始，同样被映射到 0x4000。
网管型交换机大约会用到 30 个 bank，非网管型使用 2-3 个，而硬件最多允许使用 0x3f 个 bank，即最大 4 MB 的 flash。

当前镜像通过 sdcc 的 `__banked` 函数关键字，以及针对 RTL837x 用汇编编写的自定义 bank 切换 trampoline 代码，使用公共区加 10 个 bank（BANK1-BANK10，见 `flash-layout.md`）。
