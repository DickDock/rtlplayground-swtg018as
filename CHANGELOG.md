# Change Log

## [0.x] - 2026-xx-XX

## Added

- Web UI
  - Compress the embedded assets (minify + gzip) and switch to a single-page layout. #315
  - Replace the multi-page UI with a themed single-page app: light, dark and Selenized themes following the browser by default,
    English, Japanese and Chinese, save to flash merges the command log into the startup config and verifies the write,
    firmware images are checked in the browser before upload. #429
- QoS, flow control and PFC
  - `qos` command: priority source trust, DSCP and 802.1p to priority maps, port priority,
    priority to queue map and strict or weighted queue scheduling.
  - `fc` command: forced 802.3x pause per port, pause thresholds and threshold sets, buffer page counters.
  - `pfc` command: Priority Flow Control (802.1Qbb) on the two 10G ports. See doc/qos_pfc.md.
- Syslog
  - Every datagram now carries an uptime stamp, `<14>[up 0d 00:00:00] host message`; the
    counters are bumped once a second by the tick handler, so the packet builder needs no
    32-bit divide.
  - Runtime events reach the feed, not just command output: per-port link up/down (read from
    the per-port carrier bits in REG_LINKS_STS), web logins (success and failure, with the
    peer address), session expiry, configuration saves from the web UI and the command text
    of every command run over HTTP.

## Changed

- Default address
  - The compiled-in fallback address (used when no valid configuration is stored) moves
    from 192.168.2.2 to 192.168.31.3, gateway 192.168.31.1.
- Version string
  - The firmware version shortens from `v0.1.0-7aebfef-dirty` to `v0.1.0+7aebfef`
    (semver build-metadata style); a dirty tree now appends a single `~`
    instead of the `-dirty` suffix.  Image filenames follow the same scheme.
- Flash layout
  - The firmware image grows from 512 KiB to 1 MiB: code banks 1-10 (480 KiB of code capacity,
    previously 3 banks / 144 KiB), the HTML slot moves to 0xB0000 and the two configuration
    sectors to 0xFE000/0xFF000.  Web upgrading now requires a 2 MB flash part (the staging
    area is the second half); boards with smaller flashes keep working but can only be
    reflashed through the SOIC-8 fixture or the serial installer.
- Web UI
  - Login page redesigned: a glassmorphism card over a glowing perspective grid ("network
    horizon"), password visibility toggle, spinner while submitting and a shake on a wrong
    password, in both light and dark themes.
  - Dashboard: the per-port throughput bar list is removed (the traffic table already carries
    the numbers).  The live chart gains an error-rate line, Y-axis tick labels, a 2m/5m/15m
    window selector and a crosshair tooltip; the SFP DDM cards keep their own fluid grid,
    which also fixes the collapsed gap above the traffic table.
  - The nav footer shows just the firmware version in the `v<ver>+<hash>` form the images
    are named with, instead of the prefixed "RTLPlayground <version>".
  - Bridge firmware (`make BRIDGE=1`, `-bridge` images): a 512 KiB build running in the
    legacy layout that installs the 1 MB image and migrates the configuration to its new
    location.  Upgrade path for devices still on the old firmware: flash the bridge, then
    flash the 1 MB image - the configuration is preserved.

## Fixed

- Code banks
  - dhcp.c declared its string literals in a different bank than its code, so DHCP log
    messages printed garbage; code and literals now share one bank and a CI check
    (`tools/check_banking.py`) rejects cross-bank plain calls and literal mismatches.
- Tools and CI
  - The bridge-era config "recovery" in the update installer checked 0x170000 — an address
    inside the upload staging area — so installing any 1 MB image found image bytes there
    and copied 4 KiB of code over the active configuration sector (observed as the board
    booting with factory defaults after an upgrade).  The recovery served a migration that
    is long complete and is now removed entirely.
  - fileadder compressed the web files with gzip in place but left the raw tail past the
    compressed stream in the image, shipping ~50 KiB of plaintext residue behind the HTML
    slot; the tail is now wiped after compression.
  - CI: the bridge image size check relied on the shell glob-expanding a redirection
    target, which the container's `sh` does not do; it now iterates the matches and
    redirects a plain variable.
  - CI: building with an explicit `MACHINE=` plus `machine.h` defining the same board
    tripped `-Werror` with "macro redefined"; the active board define now carries an
    explicit value.
  - Header `inline` functions (`tcp_tick_due`, `clock_time`, `itohex`) are now
    `static inline`: without `static` a C99 inline definition provides no external
    definition, so the host unit tests only linked on compilers that happened to inline
    every call.

## Breaking changes

- Config
  - A startup configuration line longer than the command buffer no longer stops the replay:
    the offending line is skipped and the following lines are still applied.
  - The web UI and the configuration upload now refuse a line the replay cannot take,
    instead of writing it to flash.

## Breaking changes

- Config
  - VLAN don't accept port `u`-suffix anymore.
    So `vlan 1 4u` is not valid anymore.
    Replace it with `vlan 1 4`.
- Commands
  - port zero/`0` is treated as the `CPU_PORT`. #326
  - Many commands don't accept the CPU_PORT anymore. See #334.
    When the CPU_PORT is needed, the command/service will add the CPU_PORT automaticly.
    Only `isolate` accept the CPU_PORT as destination port.

## [v0.1_aplha] - 2025-11-03

First release.