#!/usr/bin/env python3
# 从真实 CLI 源文件抽取最小闭包；不复制或改写待测实现。
import pathlib
import re
import sys

source = pathlib.Path(sys.argv[1]).read_text()
output = pathlib.Path(sys.argv[2])
names = ("cmd_compare", "atoi_byte", "cmd_is_space", "cmd_error", "name_char",
         "cmd_parse_port", "cmd_parse_port_separator", "parse_port",
         "sfp_print_measurements", "parse_sfp", "cmd_tokenize")
blocks = []
for name in names:
    match = re.search(r"^(?:static\s+)?(?:uint8_t|void|bool|__bit)\s+" + name +
                      r"\([^;]*?\)\s*(?:__banked\s*)?\{", source, re.MULTILINE)
    if not match:
        raise SystemExit("找不到真实函数: " + name)
    pos, depth, state = match.end(), 1, "code"
    while depth:
        c, nxt = source[pos], source[pos:pos + 2]
        if state == "code":
            if nxt == "//": state = "line"; pos += 1
            elif nxt == "/*": state = "comment"; pos += 1
            elif c == '"': state = "string"
            elif c == "'": state = "char"
            elif c == "{": depth += 1
            elif c == "}": depth -= 1
        elif state == "line":
            if c == "\n": state = "code"
        elif state == "comment":
            if nxt == "*/": state = "code"; pos += 1
        elif c == "\\": pos += 1
        elif (state == "string" and c == '"') or (state == "char" and c == "'"):
            state = "code"
        pos += 1
    blocks.append(source[match.start():pos])
output.write_text('''/* 自动从 cmd_parser.c 抽取；不维护实现副本。 */
#include "cmd_parser.h"
#include "machine.h"
#include "sfp.h"
#include "rtl837x_phy.h"
#include "rtl837x_port.h"
#include "phy.h"
#define N_WORDS 15
extern char port_names[9][PORT_NAME_SIZE];
extern const struct machine machine;
extern uint8_t cmd_words_len, cmd_words_b[N_WORDS], atoi_results_u8;
''' + "\n\n".join(blocks) + "\n")
