VERSION=0.1.0
# 1MB image: banks 1-10 in 0x4000-0x7BFFF, HTML slot 0xB0000, config
# double sector at the image tail.  fileadder's -a is atoi(): keep these
# decimal.
IMAGESIZE = 1048576
DEFAULT_CONFIG_LOCATION = 1040384
CONFIG_LOCATION = 1044480
HTML_LOCATION = 720896

ifeq ($(origin CC),default)
CC = sdcc
endif
CC_FLAGS = -mmcs51 -I. -Ihttpd -Iuip
ASM ?= sdas8051
AFLAGS= -plosgff

SUBDIRS := tools
SUBDIRSCLEAN=$(addsuffix clean,$(SUBDIRS))

ifeq ($(MACHINE),)
	MACHINE:= $(shell grep "^\s*\#define MACHINE_" machine.h | sed "s/^\s*\#define MACHINE_//" | awk '{print $$1}')
else
	CC_FLAGS += -DMACHINE_$(MACHINE)
endif
# Health instrumentation and the "health" console command: HEALTH=1 gmake ...
ifneq ($(HEALTH),)
	CC_FLAGS += -DHEALTH
endif

ifeq ($(CI),1)
	CC_FLAGS += --Werror
endif

# Bridge variant (make BRIDGE=1): runs in the legacy 512KB layout on a
# device that still has the pre-1MB firmware, so it can accept and
# install the 1MB image (see check_and_flash_update_image).  The regular
# build produces the full 1MB image for the new layout.
BRIDGE_SUFFIX :=
LDFLAGS_BANKS = -Wl-bBANK1=0x14000 -Wl-bBANK2=0x24000 -Wl-bBANK3=0x34000
ifeq ($(BRIDGE),1)
	CC_FLAGS += -DBRIDGE_LAYOUT
	IMAGESIZE = 524288
	DEFAULT_CONFIG_LOCATION = 454656
	CONFIG_LOCATION = 458752
	HTML_LOCATION = 262144
	BRIDGE_SUFFIX = -bridge
	BANK_SENTINELS =
	EXPECT_CODE_END = 262144
else
	BANK_SENTINELS = bank4.c bank5.c bank6.c bank7.c bank8.c bank9.c bank10.c
	EXPECT_CODE_END = 720896
	LDFLAGS_BANKS += -Wl-bBANK4=0x44000 -Wl-bBANK5=0x54000 -Wl-bBANK6=0x64000 -Wl-bBANK7=0x74000 -Wl-bBANK8=0x84000 -Wl-bBANK9=0x94000 -Wl-bBANK10=0xA4000
endif

BUILDDIR = output/$(MACHINE)
VERSION_HEADER := version.h

# Version string: v<VERSION>+<short hash>, a trailing ~ marks a dirty tree.
# Semver build-metadata style; the ~ is safe mid-filename (no tilde
# expansion outside word start).
GIT_VERSION := $(shell git rev-parse --short HEAD)
ifeq ($(shell git status --porcelain --untracked-files=no),)
else
	GIT_VERSION := $(GIT_VERSION)~
endif

VERSION_EXTENSION = v$(VERSION)+$(GIT_VERSION)
FILENAME_EXTENSION = $(VERSION_EXTENSION)$(BRIDGE_SUFFIX)-$(MACHINE)

# Deterministic build date: honor SOURCE_DATE_EPOCH, else the HEAD commit date,
# else wall-clock (no-git fallback). Keeps same-commit builds byte-identical
# (BUILD_DATE is baked into the image and covered by the trailing CRC).
SOURCE_DATE_EPOCH ?= $(shell git show -s --format=%ct HEAD 2>/dev/null)
ifeq ($(SOURCE_DATE_EPOCH),)
BUILD_DATE := $(shell date +"%Y-%m-%d %H:%M:%S")
else
BUILD_DATE := $(shell date -u -d @$(SOURCE_DATE_EPOCH) +"%Y-%m-%d %H:%M:%S" 2>/dev/null \
	|| date -u -r $(SOURCE_DATE_EPOCH) +"%Y-%m-%d %H:%M:%S")
endif

all: create_build_dir $(VERSION_HEADER) $(SUBDIRS) $(BUILDDIR)/rtlplayground-$(FILENAME_EXTENSION).bin

create_build_dir:
	mkdir -p "$(BUILDDIR)"
	mkdir -p "$(BUILDDIR)/uip"
	mkdir -p "$(BUILDDIR)/httpd"

# Keep machine.c in first position to fail immediately on invalid $MACHINE value
SRCS = \
	machine.c \
	machine_init.c \
	cmd_editor.c \
	cmd_parser.c \
	dhcp.c \
	html_data.c \
	rtlplayground.c \
	boot.c \
	sfp.c \
	snmp.c \
	syslog.c \
	udp_apps.c

# RTL837x
SRCS += \
	rtl837x_bandwidth.c \
	rtl837x_flash.c \
	rtl837x_igmp.c \
	rtl837x_init.c \
	rtl837x_leds.c \
	rtl837x_phy.c \
	rtl837x_pins.c\
	rtl837x_port.c \
	rtl837x_qos.c \
	rtl837x_stp.c \
	rtl837x_storm.c \
	rtl837x_lacp.c

# Reserved-bank sentinels: only exist in the full 1MB layout
SRCS += $(BANK_SENTINELS)
SRCS += \
	httpd/httpd.c \
	httpd/page_impl.c
SRCS += \
	uip/timer.c \
	uip/uip.c \
	uip/uiplib.c \
	uip/uip_arp.c \
	uip/uip-fw.c \
	uip/uip-neighbor.c \
	uip/uip-split.c

OBJS = ${SRCS:%.c=$(BUILDDIR)/%.rel}
DEPS := ${SRCS:%.c=$(BUILDDIR)/%.d}
HTML := $(shell find html -name '*.js' -or -name '*.html' -or -name '*.svg' -or -name '*.css' -or -name '*.ico')

# Minified copy of the web UI sources, used as the fileadder input.
# The raw html/ sources stay untouched for development; the minified
# copy is a build artifact under output/.
# html/app/*.js are the authored sources of the single app.js script;
# they are concatenated (filename order) and minified as one file.
APP_SRCS := $(sort $(wildcard html/app/*.js))
HTML_TOP := $(filter-out html/app/%,$(HTML))
HTML_MIN := output/html_min
.PHONY: html_min
html_min: $(HTML_TOP) $(APP_SRCS)
	rm -rf $(HTML_MIN)
	mkdir -p $(HTML_MIN)
	@test -n "$(APP_SRCS)" || { echo "error: html/app/ contains no JS sources" >&2; exit 1; }
	cat $(APP_SRCS) > output/app.concat.js
	python3 tools/minify.py output/app.concat.js $(HTML_MIN)/app.js
	rm -f output/app.concat.js
	@for f in $(HTML_TOP); do python3 tools/minify.py $$f $(HTML_MIN)/$$(basename $$f) || exit 1; done

HTML_DATA_STAMP := $(HTML_LOCATION)-$(IMAGESIZE)
html_data.stamp: FORCE
	@printf '%s' '$(HTML_DATA_STAMP)' | cmp -s - $@ 2>/dev/null || printf '%s' '$(HTML_DATA_STAMP)' > $@

html_data.c html_data.h &: $(HTML) html_data.stamp | tools html_min
	tools/output/fileadder -a $(HTML_LOCATION) -s $(IMAGESIZE) -b BANK1 -z -d $(HTML_MIN) -p html_data
	@touch html_data.stamp

$(VERSION_HEADER): FORCE
	@printf '%s\n' "#ifndef VERSION_H" "#define VERSION_H" \
		"#define VERSION_SW \"$(VERSION_EXTENSION)\"" \
		"#define BUILD_DATE \"$(BUILD_DATE)\"" \
		"#endif" > $(VERSION_HEADER).tmp
	@cmp -s $(VERSION_HEADER).tmp $(VERSION_HEADER) \
		&& rm -f $(VERSION_HEADER).tmp \
		|| mv $(VERSION_HEADER).tmp $(VERSION_HEADER)

httpd: html_data.h

$(SUBDIRS):
	$(MAKE) -C $@

clean: $(SUBDIRSCLEAN)
	-rm -f html_data.c html_data.h html_data.stamp $(VERSION_HEADER)
	-if [ -d $(BUILDDIR) ]; then find $(BUILDDIR) -type f ! -name "*.bin" -delete; fi

distclean: $(SUBDIRSCLEAN)
	-rm -f html_data.c html_data.h html_data.stamp $(VERSION_HEADER)
	-rm -rf $(BUILDDIR)

$(SUBDIRSCLEAN):
	$(MAKE) -C $(@:clean=) clean

# Objects depend on the flags they were built with, through a stamp file that
# is rewritten only when CC_FLAGS actually changes.
CCFLAGS_STAMP := $(BUILDDIR)/.ccflags

.PHONY: FORCE
FORCE:

$(CCFLAGS_STAMP): FORCE | create_build_dir
	@echo '$(CC_FLAGS)' | cmp -s - $@ 2>/dev/null || echo '$(CC_FLAGS)' > $@

$(BUILDDIR)/%.rel: %.c $(CCFLAGS_STAMP) | create_build_dir html_data.h
	$(CC) -MMD $(CC_FLAGS) -o $@ -c $<

$(BUILDDIR)/%.rel: %.asm $(CCFLAGS_STAMP) | create_build_dir
	${ASM} ${AFLAGS} -o $@ $<
#	mv -f $(addprefix $(basename $^), .lst .rel .sym) .

$(BUILDDIR)/rtlplayground.ihx: $(OBJS) $(BUILDDIR)/crtbank.rel $(BUILDDIR)/crc16.rel
	$(CC) $(CC_FLAGS) --xram-size 49151 -Wl-bHOME=0x00000 $(LDFLAGS_BANKS) -Wl-r -o $@ $^

$(BUILDDIR)/rtlplayground.img: $(BUILDDIR)/rtlplayground.ihx
	objcopy --input-target=ihex -O binary $< $@

$(BUILDDIR)/rtlplayground-$(FILENAME_EXTENSION).bin: $(BUILDDIR)/rtlplayground.img | tools
	if [ -e $@ ]; then rm $@; fi
	tools/output/imagebuilder -i $^ $@
	# The packed code area must end exactly at 0xB0000: banks 1-10 packed
	# into 0x4000-0x7BFFF.  If this drifts (bank count changed), the HTML
	# slot below would silently overwrite code.
	@test $$(wc -c < $@) -eq $(EXPECT_CODE_END) || { echo "error: packed image is $$(wc -c < $@) bytes, expected $(EXPECT_CODE_END) (bank count changed); update HTML_LOCATION" >&2; exit 1; }
	tools/output/fileadder -a $(DEFAULT_CONFIG_LOCATION) -s $(IMAGESIZE) -d config.txt $@
	tools/output/fileadder -a $(CONFIG_LOCATION) -s $(IMAGESIZE) -d config.txt $@
	tools/output/fileadder -a $(HTML_LOCATION) -s $(IMAGESIZE) -z -d $(HTML_MIN) -b BANK1 $@
	tools/output/crc_calculator -u $@
	@test $$(wc -c < $@) -eq $(IMAGESIZE) || { echo "error: final image is $$(wc -c < $@) bytes, expected $(IMAGESIZE)" >&2; exit 1; }
	ln -sf $(MACHINE)/rtlplayground-$(FILENAME_EXTENSION).bin output/rtlplayground.bin

.PHONY: clean distclean all $(SUBDIRS) $(SUBDIRSCLEAN) create_build_dir

.PHONY:
machine_check:
	@mkdir -p $(BUILDDIR)/tmp
	@set -eo pipefail; \
	for MACHINE in `grep -E '^[[:space:]]*(//[[:space:]]*)?#define MACHINE_' machine.h | sed -E 's%^[[:space:]]*(//[[:space:]]*)?#define MACHINE_%%' | awk '{print $$1}' | sort -u`; \
	do \
	echo "Checking $${MACHINE}"; \
	$(CC) $(CC_FLAGS) -DMACHINE_$${MACHINE} -MMD -o $(BUILDDIR)/tmp/machine_check -c machine.c; \
	$(CC) $(CC_FLAGS) -DMACHINE_$${MACHINE} -MMD -o $(BUILDDIR)/tmp/machine_check -c machine_init.c; \
	done
	@rm -rf $(BUILDDIR)/tmp

-include $(DEPS)
