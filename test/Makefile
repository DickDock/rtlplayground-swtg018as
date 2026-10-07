# Host unit-test harness for RTLPlayground firmware logic.
#
# Compiles selected firmware translation units with host gcc + AddressSanitizer,
# force-including sdcc_shim.h to erase 8051 keywords, and links them against
# mocked hardware edges (support.c). No SDCC, no flashing, no hardware.
#
#   make        build + run all tests
#   make run    run tests
#   make clean

CC       = gcc
NODE    ?= node
SRCROOT  = ..
# -include shim first so __xdata/__code/__banked vanish before any firmware header.
CFLAGS   = -std=gnu11 -g -O1 -Wall -Wextra -Werror -Wno-unused-parameter -Wno-unknown-pragmas \
           -Wno-pointer-sign \
           -DRTLP_HOST_TEST \
           -fsanitize=address,undefined -fno-omit-frame-pointer \
           -include sdcc_shim.h -Istub -I. -I$(SRCROOT) -I$(SRCROOT)/httpd -I$(SRCROOT)/uip
ifeq ($(findstring clang,$(shell $(CC) --version 2>/dev/null)),)
CFLAGS  += -Wno-builtin-declaration-mismatch
endif
LDFLAGS  = -fsanitize=address,undefined

BUILDDIR = build

# One binary per subsystem under test.
TESTS = $(BUILDDIR)/test_cmd_editor \
        $(BUILDDIR)/test_port_tables \
        $(BUILDDIR)/test_page_json \
        $(BUILDDIR)/test_httpd_tx \
        $(BUILDDIR)/test_tick_gate \
        $(BUILDDIR)/test_qos \
        $(BUILDDIR)/test_i2c \
        $(BUILDDIR)/test_machine_leds

# The table tests link the register mock and one environment file; stub/
# stands in for the two headers a firmware build generates.
TABLE_ENV = support.c hw_mock.c env_tables.c $(SRCROOT)/cmd_editor.c \
            $(SRCROOT)/rtl837x_port.c $(SRCROOT)/httpd/page_impl.c

all: run

$(BUILDDIR):
	mkdir -p $(BUILDDIR)

# cmd_editor.c is compiled UNMODIFIED from the firmware tree.
$(BUILDDIR)/test_cmd_editor: test_cmd_editor.c support.c $(SRCROOT)/cmd_editor.c | $(BUILDDIR)
	$(CC) $(CFLAGS) $^ -o $@ $(LDFLAGS)

# rtl837x_port.c and httpd/page_impl.c are compiled UNMODIFIED from the firmware tree.
$(BUILDDIR)/test_port_tables: test_port_tables.c $(TABLE_ENV) hw_mock.h | $(BUILDDIR)
	$(CC) $(CFLAGS) $(filter %.c,$^) -o $@ $(LDFLAGS)

$(BUILDDIR)/test_tick_gate: test_tick_gate.c support.c $(SRCROOT)/cmd_editor.c $(SRCROOT)/tcp_tick_gate.h | $(BUILDDIR)
	$(CC) $(CFLAGS) $(filter %.c,$^) -o $@ $(LDFLAGS)

$(BUILDDIR)/test_page_json: test_page_json.c $(TABLE_ENV) hw_mock.h | $(BUILDDIR)
	$(CC) $(CFLAGS) $(filter %.c,$^) -o $@ $(LDFLAGS)

# httpd/httpd.c and uip/uip.c are compiled UNMODIFIED from the firmware tree;
# this test carries the environment below them itself.
$(BUILDDIR)/test_httpd_tx: test_httpd_tx.c $(SRCROOT)/httpd/httpd.c $(SRCROOT)/uip/uip.c | $(BUILDDIR)
	$(CC) $(CFLAGS) $(filter %.c,$^) -o $@ $(LDFLAGS)

# rtl837x_qos.c is compiled UNMODIFIED from the firmware tree.
$(BUILDDIR)/test_qos: test_qos.c support.c hw_mock.c env_tables.c $(SRCROOT)/cmd_editor.c $(SRCROOT)/rtl837x_qos.c hw_mock.h | $(BUILDDIR)
	$(CC) $(CFLAGS) $(filter %.c,$^) -o $@ $(LDFLAGS)

# I²C 事务 mock 直接驱动未修改的固件读取函数。
$(BUILDDIR)/test_i2c: test_i2c.c support.c $(SRCROOT)/cmd_editor.c $(SRCROOT)/rtl837x_pins.c | $(BUILDDIR)
	$(CC) $(CFLAGS) $^ -o $@ $(LDFLAGS)

# 执行真实 LED 驱动与板型常量；只有主机侧硬件/控制台 mock。
# 仅该 target 局部放宽：生产源为 SDCC 16-bit int 与 __code uint32_t 指针写法。
$(BUILDDIR)/test_machine_leds: test_machine_leds.c hw_mock.c $(SRCROOT)/machine.c $(SRCROOT)/rtl837x_leds.c $(SRCROOT)/machine.h $(SRCROOT)/rtl837x_leds.h hw_mock.h | $(BUILDDIR)
	$(CC) $(CFLAGS) -Wno-misleading-indentation -Wno-incompatible-pointer-types $(filter %.c,$^) -o $@ $(LDFLAGS)

# Sandboxes with a Makefile of their own; each fails the run when it fails.
SUBTESTS = lacp port_hash sfp

run: $(TESTS)
	@fail=0; for t in $(TESTS); do \
		echo "=== $$t ==="; \
		$$t || fail=1; \
		echo; \
	done; \
	for d in $(SUBTESTS); do \
		echo "=== $$d ==="; \
		$(MAKE) -C $$d test || fail=1; \
		echo; \
	done; \
	echo "=== Web 轮询与弹窗 ==="; \
	$(NODE) --test test_web_pollers.cjs || fail=1; \
	if [ $$fail -ne 0 ]; then echo "TESTS FAILED"; exit 1; else echo "ALL TESTS PASSED"; fi

clean:
	rm -rf $(BUILDDIR)
	@for d in $(SUBTESTS); do $(MAKE) -C $$d clean; done

.PHONY: all run clean
