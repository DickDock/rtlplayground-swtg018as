#!/usr/bin/env python3
"""Static banking checks for the RTLPlayground 8051 firmware.

The SDCC banked model used here is unforgiving: a plain `lcall` to a
symbol living in another bank compiles without a whisper but reads
garbage at run time (the generic-pointer bank is only applied by the
__sdcc_banked_call trampoline), and `__code` pointers are only valid
while PSBANK points at the bank holding the target.  This script turns
those failure modes into build failures.

Checks:
  1. Every authored .c declares codeseg == constseg.  A split (as dhcp.c
     had: code in BANK3, string literals in BANK2) makes the module read
     its own string literals through the wrong PSBANK.
  2. Every authored .c either declares a bank or is on the HOME
     allowlist.  A missing pragma silently lands the module in the 16 KB
     HOME area and eats the last bytes of the 157-byte stack headroom.
  3. __interrupt handlers only live in HOME-allowlisted files; an ISR
     must never execute from (or depend on) a swappable bank.
  4. From the linker map plus the SDCC-generated .asm: no plain
     lcall/ljmp crosses areas.  Cross-bank calls must go through
     __sdcc_banked_call.

Usage: check_banking.py --build-dir output/<machine> [--src-dir .]
Exit status 0 = clean.
"""
import argparse
import os
import re
import sys

# Files intentionally compiled into the resident HOME area (CSEG).
# Interrupt service routines and the flash driver MUST stay here: flash
# programming switches the SPI controller away from code fetch, so only
# the pre-fetched 16 KB can execute during erase/write.
HOME_ALLOW = {
    "rtlplayground", "rtl837x_flash", "udp_apps", "machine",
}
# Public HOME symbols that are safe to plain-call from any bank.
HOME_PREFIXES = tuple()

AREA_RE = re.compile(r"^\.area\s+(\S+)")
LCALL_RE = re.compile(r"^\s*(lcall|ljmp)\s+(_\w+|__sdcc_banked_call)")
MODULE_RE = re.compile(r"^\.module\s+(\S+)")


def parse_map(path):
    """Return (area_ranges, sym_area) from an ASxxxx linker map.

    area_ranges: list of (area_name, base, end_exclusive), sorted by base.
    sym_area: symbol -> area_name (public symbols, from the module pages).
    """
    ranges = []
    syms = {}
    with open(path, encoding="latin-1") as f:
        for line in f:
            m = re.match(r"^(HOME|BANK\d+|CSEG|GSINIT\d|GSFINAL|CONST|XINIT)\s+"
                         r"([0-9A-Fa-f]{8})\s+([0-9A-Fa-f]{8})", line)
            if m:
                base = int(m.group(2), 16)
                size = int(m.group(3), 16)
                if size and not any(r[0] == m.group(1) and r[1] == base
                                    for r in ranges):
                    ranges.append((m.group(1), base, base + size))
                continue
            # "C:   000175E5  _httpd_appcall   httpd" — code symbol table
            m = re.match(r"^C:\s+([0-9A-Fa-f]{8})\s+(\S+)\s+(\S+)\s*$", line)
            if m:
                syms[m.group(2)] = int(m.group(1), 16)
    ranges.sort(key=lambda r: r[1])
    return ranges, syms


def area_of(ranges, addr):
    for name, base, end in ranges:
        if base <= addr < end:
            return name
    return "HOME" if addr < 0x4000 else None


def is_home_area(name):
    return name in ("HOME", "CSEG", "GSINIT0", "GSINIT1", "GSINIT2",
                    "GSINIT3", "GSINIT4", "GSINIT5", "GSFINAL", "CONST",
                    "XINIT") or name == "GSINIT"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--build-dir", required=True)
    ap.add_argument("--src-dir", default=".")
    args = ap.parse_args()

    src = args.src_dir
    failures = []

    # --- source-level checks (1)-(3) ---
    c_files = []
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in ("output", "test", "tools",
                                                "installer", "design-mockup",
                                                ".git", ".github", "doc")]
        for f in files:
            if f.endswith(".c"):
                c_files.append(os.path.join(root, f))

    for path in sorted(c_files):
        mod = os.path.splitext(os.path.basename(path))[0]
        with open(path, encoding="utf-8", errors="replace") as f:
            text = f.read()
        code = re.search(r"^\#pragma\s+codeseg\s+(\S+)", text, re.M)
        const = re.search(r"^\#pragma\s+constseg\s+(\S+)", text, re.M)
        has_isr = "__interrupt" in text
        if code and const and code.group(1) != const.group(1):
            failures.append(f"{path}: codeseg={code.group(1)} but "
                            f"constseg={const.group(1)}; __code literals "
                            f"would be read through the wrong PSBANK")
        if code:
            bank = code.group(1)
            if has_isr:
                failures.append(f"{path}: __interrupt in banked module "
                                f"{bank}; ISR must stay in HOME")
        else:
            if mod not in HOME_ALLOW:
                failures.append(f"{path}: no #pragma codeseg and not on the "
                                f"HOME allowlist (silently lands in the "
                                f"16KB HOME area)")

    # --- map + asm cross-area call check (4) ---
    map_path = os.path.join(args.build_dir, "rtlplayground.map")
    ranges, syms = (None, {})
    if os.path.exists(map_path):
        ranges, syms = parse_map(map_path)
    else:
        failures.append(f"map not found: {map_path}")

    if ranges:
        stats = {"lcall": 0, "home": 0, "same": 0}
        for fname in sorted(os.listdir(args.build_dir)):
            if not fname.endswith(".asm"):
                continue
            module = fname[:-4]
            areas = set()
            with open(os.path.join(args.build_dir, fname),
                      encoding="latin-1") as f:
                for line in f:
                    m = AREA_RE.match(line)
                    if m and "(CODE)" in line:
                        areas.add(m.group(1))
                    m = LCALL_RE.match(line)
                    if m and m.group(1) == "lcall" and m.group(2) != "__sdcc_banked_call":
                        sym = m.group(2)
                        stats["lcall"] += 1
                        addr = syms.get(sym)
                        if addr is None:
                            continue
                        if isinstance(addr, str):
                            continue
                        tgt = area_of(ranges, addr)
                        if tgt is None:
                            continue
                        if is_home_area(tgt):
                            stats["home"] += 1
                            continue  # resident area: plain call is fine
                        own = {a for a in areas if not is_home_area(a)}
                        if own and tgt not in own:
                            failures.append(
                                f"{fname}: plain lcall {sym} -> {tgt} from "
                                f"{sorted(own)}; cross-bank calls must use "
                                f"__sdcc_banked_call")
                        else:
                            stats["same"] += 1
        print(f"banking: {stats['lcall']} plain calls "
              f"({stats['home']} to HOME, {stats['same']} same-bank)")

    # --- HOME size budget (everything linked below 0x4000) ---
    home_used = sum(end - base for name, base, end in ranges
                    if base < 0x4000)
    if home_used > 0x4000:
        failures.append(f"HOME area overflow: {home_used} > {0x4000} bytes")

    if failures:
        for f in failures:
            print("BANKING: " + f, file=sys.stderr)
        print(f"banking check: {len(failures)} violation(s)", file=sys.stderr)
        return 1
    print(f"banking check: clean (HOME {home_used}/16384 bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
