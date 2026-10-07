# 独立 SFP host 回归；只编译真实固件源和专属 mock，不触碰设备。
CC = cc
PYTHON ?= python3
SRCROOT = ../..
BUILDDIR = ../build/sfp
CFLAGS = -std=gnu11 -g -O1 -Wall -Wextra -Werror -Wno-unused-parameter \
         -Wno-unknown-pragmas -Wno-pointer-sign -DRTLP_HOST_TEST \
         -fsanitize=address,undefined -fno-omit-frame-pointer \
         -ffunction-sections -fdata-sections -include ../sdcc_shim.h \
         -Istub -I../stub -I.. -I$(SRCROOT) -I$(SRCROOT)/httpd -I$(SRCROOT)/uip
LDFLAGS = -fsanitize=address,undefined
ifeq ($(shell uname -s),Darwin)
LDFLAGS += -Wl,-dead_strip
else
LDFLAGS += -Wl,--gc-sections
endif
ifeq ($(findstring clang,$(shell $(CC) --version 2>/dev/null)),)
CFLAGS += -Wno-builtin-declaration-mismatch
endif

SOURCES = test_sfp.c env.c ../hw_mock.c $(BUILDDIR)/sfp_cli.c \
          $(SRCROOT)/sfp.c $(SRCROOT)/httpd/page_impl.c
HEADERS = env.h stub/8051.h ../sdcc_shim.h $(SRCROOT)/sfp.h
TESTS = $(BUILDDIR)/test_sfp_dual $(BUILDDIR)/test_sfp_single

all: test

$(BUILDDIR):
	mkdir -p $@

# 每次 cmd_parser.c 变更重新抽取；测试实现不是手工副本。
$(BUILDDIR)/sfp_cli.c: extract_cli.py $(SRCROOT)/cmd_parser.c | $(BUILDDIR)
	$(PYTHON) -I $< $(SRCROOT)/cmd_parser.c $@

$(BUILDDIR)/test_sfp_dual: $(SOURCES) $(HEADERS) | $(BUILDDIR)
	$(CC) $(CFLAGS) $(SOURCES) -o $@ $(LDFLAGS)

$(BUILDDIR)/test_sfp_single: $(SOURCES) $(HEADERS) | $(BUILDDIR)
	$(CC) $(CFLAGS) -DSFP_HOST_SINGLE $(SOURCES) -o $@ $(LDFLAGS)

test: $(TESTS)
	@fail=0; for t in $(TESTS); do $$t || fail=1; done; exit $$fail

clean:
	rm -rf $(BUILDDIR)

.PHONY: all test clean
