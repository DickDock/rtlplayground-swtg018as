# Flash Partitioning and Memory Map

简体中文 | [English](flash-layout.en.md)

This document describes the flash partitioning of the 1MB image layout
(since 2026-10), the bank mapping mechanism and the upgrade flow.  The
authoritative source for the layout constants is the root `Makefile`
(build side) and `rtl837x_common.h` (firmware side); this document stays
in sync with both.

## Overview

The SWTG018AS-A V2.0 board carries 2 MB of SPI NOR flash (the capacity is
detected at boot from the JEDEC ID).  The first 1 MB is the running
image, the second 1 MB is the upload staging area for Web upgrades:

```
0x00000 ┌────────────────────────────┐
        │ HOME (common, 16KB max)     │  prefetched into code RAM, resident
0x04000 ├────────────────────────────┤
        │ bank 1 (48KB window)        │  network stack: uip family + httpd
0x10000 ├────────────────────────────┤ ← ihx link base 0x14000
        │ bank 2                      │  page generation: page_impl
0x1C000 ├────────────────────────────┤ ← 0x24000
        │ bank 3                      │  command parser: cmd_parser/cmd_editor
0x28000 ├────────────────────────────┤ ← 0x44000
        │ bank 4                      │  switch drivers A: port/init/phy/pins
0x34000 ├────────────────────────────┤ ← 0x54000
        │ bank 5                      │  switch features: stp/leds/bandwidth/qos/storm/igmp/lacp
0x40000 ├────────────────────────────┤ ← 0x64000
        │ bank 6                      │  services: boot/sfp/dhcp/syslog
0x4C000 ├────────────────────────────┤ ← 0x74000
        │ banks 7-10 (sentinels)      │  one marker string each, guards the build
0x7C000 ├────────────────────────────┤
        │ (zero padding)              │
0xB0000 ├────────────────────────────┤
        │ HTML slot (64KB, gzip)      │  currently ~42.5KB; written file by file
0xC0000 ├────────────────────────────┤
        │ reserved (248KB)            │  future resource area
0xFE000 ├────────────────────────────┤
        │ default config (4KB)        │  copied to the active slot on factory reset
0xFF000 ├────────────────────────────┤
        │ active config (4KB)         │  written by Web "Save to flash"
0xFFFFE ├────────────────────────────┤
        │ CRC16 (2B)                  │  complement of the whole-image Modbus CRC
0x100000 ├───────────────────────────┤
        │ upload staging (1MB)        │  Web "Firmware update" writes here first
0x20000 └────────────────────────────┘
```

## Bank mapping

- Within the 8051's 16-bit address space, `0x4000-0xFFFF` (48KB) is the
  code window; the `PSBANK` register (SFR 0x96) selects which 48KB bank
  the window maps to.  Banks are packed contiguously in flash: bank k
  lives at `0x4000+(k-1)*0xC000` with no gaps.
- `0x0000-0x3FFF` (HOME) is prefetched into code RAM at power-on and is
  executable regardless of PSBANK.  Interrupt service routines, the
  flash driver and the CRC execution body must live here: during flash
  erase/write the controller is switched to command mode and only HOME
  can fetch instructions.
- Cross-bank calls must go through the `__sdcc_banked_call` trampoline
  (`crtbank.asm`; the bank number is the low 5 bits of the generic
  pointer's high byte, i.e. up to 32 banks).  Functions are annotated
  `__banked`, modules are assigned with `#pragma codeseg/constseg`.
- **`__code` pointers are only valid while PSBANK points at the bank
  holding the target** (MOVC does no bank correction).  `__code` objects
  shared across modules must live in HOME; `tools/check_banking.py`
  (CI) rejects cross-bank plain calls, codeseg/constseg mismatches and
  mislanded literals.
- `flash_read_bulk/flash_write_bytes` (rtl837x_flash.c) use the SPI
  controller's command interface with a 24-bit address and bypass
  PSBANK entirely - this is how the HTML slot and the staging area are
  accessed.

## Build constants

| What | Makefile (decimal, fileadder uses atoi) | rtl837x_common.h | Value |
|---|---|---|---|
| Image size | `IMAGESIZE` | `FIRMWARE_IMAGE_SIZE`(= UPLOAD_START) | 0x100000 |
| HTML slot | `HTML_LOCATION` | — (FDATA_START_* generated) | 0xB0000 |
| Default config | `DEFAULT_CONFIG_LOCATION` | `DEFAULT_CONFIG_START` | 0xFE000 |
| Active config | `CONFIG_LOCATION` | `CONFIG_START` | 0xFF000 |
| Staging base | — | `FIRMWARE_UPLOAD_START` | 0x100000 |
| Bank link bases | `LDFLAGS_BANKS`(`-Wl-bBANKn`) | — | n*0x10000+0x4000 |

## Upgrade flow

1. Web "Firmware update" uploads the `.bin` (512KB or 1MB) to the
   staging area; browser and firmware each verify the magic
   (`00 40 02`) and the whole-image CRC16-Modbus (== 0xB001).
2. After reboot `check_and_flash_update_image()` (rtlplayground.c)
   re-verifies the staging area, copies the image back to `0x0` (the
   active config sector is not touched, so the configuration survives
   the upgrade), erases the staging area and resets.
3. **Do not power off during the update (LED blinks fast)**: a power
   loss during the in-place copy leaves a half-old half-new image that
   can only be recovered through the SOIC-8 fixture (flashrom) or the
   serial installer.
4. Web upgrading requires a 2 MB flash part; a 1 MB chip holds the
   image itself but not the staging area, so such boards cannot be
   Web-upgraded (fixture/serial only).

### Bridge firmware (one-time hop from the legacy layout)

Old firmware (512KB layout) has only a 512KB staging area and cannot
accept the 1MB image directly.  `make BRIDGE=1` builds a bridge variant
running in the legacy layout (`*-bridge.bin`): flash the bridge first
(the old firmware accepts it), then upload the 1MB image while the
bridge is running - the bridge injects the active configuration sector
into the staged image at its new location (`0x1FF000`) and installs
everything in one pass, preserving the configuration.  While bridged it
also accepts legacy 512KB images (rolling back; a truncated 1MB upload
is rejected by the erased-upper-half check).

## Guards

- `make`: the imagebuilder output must be exactly `(banks+1)*64KB`
  (currently 0xB0000); a bank-count drift fails the build, as does a
  final `.bin` size different from `IMAGESIZE`.
- `tools/check_banking.py` (CI): cross-bank plain calls,
  codeseg/constseg mismatches, `__code` literal landing spots, ISR
  placement and the 16KB HOME budget.
- CI `firmware.yml`: reports the free bytes of all ten banks and the
  stack headroom (minimum 150 bytes) per machine.
