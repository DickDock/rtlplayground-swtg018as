CC = gcc
CCFLAGS = -Wall -o
BUILDDIR = output

# Linux glibc ships argp in libc; macOS needs brew argp-standalone.
# json-c lives under /usr/include/json-c on Debian and /opt/homebrew/include/json-c on macOS.
UNAME := $(shell uname)
ifeq ($(UNAME),Darwin)
ARGP_FLAGS = -I/opt/homebrew/include -L/opt/homebrew/lib -largp
JSONC_FLAGS = -I/opt/homebrew/include/json-c -L/opt/homebrew/lib -ljson-c
else
ARGP_FLAGS =
JSONC_FLAGS = -I/usr/include/json-c -ljson-c
endif

all: create_build_dir $(BUILDDIR)/injector $(BUILDDIR)/fileadder $(BUILDDIR)/httpd_sim\
	$(BUILDDIR)/crc_calculator $(BUILDDIR)/imagebuilder

create_build_dir:
	mkdir -p $(BUILDDIR)

clean:
	rm -rf $(BUILDDIR)

$(BUILDDIR)/injector: injector.c
	gcc $^ $(CCFLAGS) $@

$(BUILDDIR)/fileadder: fileadder.c
	gcc $^ $(CCFLAGS) $@ -lz $(ARGP_FLAGS)

$(BUILDDIR)/crc_calculator: crc_calculator.c
	gcc $^ $(CCFLAGS) $@ $(ARGP_FLAGS)

$(BUILDDIR)/httpd_sim: httpd_sim.c httpd_sim.h
	gcc $< $(CCFLAGS) $@ $(JSONC_FLAGS)

$(BUILDDIR)/imagebuilder: imagebuilder.c
	gcc $^ $(CCFLAGS) $@ $(ARGP_FLAGS)
