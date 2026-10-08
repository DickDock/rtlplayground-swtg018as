# SNMP

[English](snmp.en.md) | 简体中文

The firmware ships a read-only SNMPv2c agent for integration with monitoring platforms such as Zabbix, PRTG and LibreNMS. It is disabled by default and enabled from the CLI or the startup config. It exposes the MIB-II system and interfaces groups (including the IF-MIB 64-bit octet counters and ifHighSpeed) plus the chip temperature scalars under an enterprises subtree, and listens on UDP port 161 and authenticates with a community string.

## Commands
```
snmp
snmp on|off
snmp community <word>
snmp contact <text>
snmp location <text>
```
- Bare `snmp` prints the current state (enabled, community, contact, location).
- `snmp on` / `snmp off` start and stop the agent. `on` starts listening on UDP 161.
- `snmp community` sets the community string: one word, 1-16 printable characters, default `public`. Changes apply immediately, no restart needed.
- `snmp contact` / `snmp location` fill `sysContact.0` and `sysLocation.0`. Multiple words are joined with single spaces, up to 23 characters.

Startup config example (via the web config editor or serial; replays automatically after save):
```
snmp community zbx#read
snmp on
```

## Exposed OIDs

Common prefix `1.3.6.1.2.1` (MIB-II); the ifXTable columns live under `1.3.6.1.2.1.31` (ifMIBObjects), shown below with the prefix trimmed to `1.`. `ifIndex` is the 1-based physical port number, matching the web UI; the CPU port is not in the table.

| OID | Name | Notes |
|---|---|---|
| 1.1.0 | sysDescr | `RTLPlayground <version> <machine>` |
| 1.2.0 | sysObjectID | `1.3.6.1.4.1.32473` (placeholder, see below) |
| 1.3.0 | sysUpTime | Centiseconds since boot (no RTC; derived from the 200 Hz tick, wraps after ~497 days like any TimeTicks) |
| 1.4.0 | sysContact | from `snmp contact` |
| 1.5.0 | sysName | the hostname (`hostname` command) |
| 1.6.0 | sysLocation | from `snmp location` |
| 1.7.0 | sysServices | 2 (L2) |
| 2.1.0 | ifNumber | number of physical ports (CPU port excluded) |
| 2.2.1.1.N | ifIndex | = N |
| 2.2.1.2.N | ifDescr | port name (`port <n> name`), `Port N` when unset |
| 2.2.1.3.N | ifType | 6 (ethernetCsmacd) |
| 2.2.1.4.N | ifMtu | live read of the port max-frame register |
| 2.2.1.5.N | ifSpeed | bps; 0 when down; rates ≥4.29 Gbps saturate at 4294967295 (RFC 3635) |
| 2.2.1.6.N | ifPhysAddress | the management MAC (same on all ports) |
| 2.2.1.7.N | ifAdminStatus | always up(1); admin state is not modelled |
| 2.2.1.8.N | ifOperStatus | up(1)/down(2), live link state |
| 2.2.1.9.N | ifLastChange | always 0 (not tracked) |
| 2.2.1.10.N | ifInOctets | Counter32, low 32 bits of the 64-bit hardware counter |
| 2.2.1.11.N | ifInUcastPkts | Counter32 |
| 2.2.1.13.N | ifInDiscards | Counter32 |
| 2.2.1.14.N | ifInErrors | Counter32 |
| 2.2.1.16.N | ifOutOctets | Counter32 |
| 2.2.1.17.N | ifOutUcastPkts | Counter32 |
| 2.2.1.19.N | ifOutDiscards | Counter32 |
| 2.2.1.20.N | ifOutErrors | Counter32 |
| 1.31.1.1.1.6.N | ifHCInOctets | Counter64, full 64-bit value — prefer this for graphs |
| 1.31.1.1.1.10.N | ifHCOutOctets | Counter64 |
| 1.31.1.1.1.15.N | ifHighSpeed | port speed in Mbps (the true value for 2.5G/5G/10G) |

The chip temperature lives under the enterprises subtree `1.3.6.1.4.1.32473.1` (the same enterprise number sysObjectID names); in one walk the subtree follows MIB-II in natural OID order:

| OID | Name | Notes |
|---|---|---|
| 1.3.6.1.4.1.32473.1.1.0 | chipTemp | chip temperature, Integer32 in tenths of a degree C (737 = 73.7 °C), live sensor read |
| 1.3.6.1.4.1.32473.1.2.0 | chipTempPowerOn | chip temperature at power-on, same unit; compare against chipTemp to separate ambient drift from self-heating |

## Behaviour and limits

- **Read-only.** GetRequest, GetNextRequest and GetBulk are supported; SetRequest is silently dropped (no response).
- Wrong community, malformed packets and unknown versions are likewise silently dropped — the manager sees a timeout.
- v1 works out of the box: a miss answers noSuchName (error 2, request varbind list echoed); v2c answers with per-varbind noSuchInstance / endOfMibView exceptions.
- No IP reassembly: a response is capped at ~1500 bytes. GetBulk repetitions are trimmed to the remaining space (RFC-legal); a GET with more than 16 varbinds is answered with tooBig.
- Counters are read live — a few dozen register accesses per request, same order as the web status page, no impact on the forwarding plane.
- `ifInDiscards`/`ifOutDiscards` map to the two halves of chip counter 8; the direction mapping has not been verified on hardware yet — report back if it turns out reversed.
- The sysObjectID enterprise number `32473` is an **unregistered placeholder**; register a PEN and change `SNMP_SYSOBJID_PEN` in `snmp.c` (`oid_prefix_ent` alongside) for proper device identification; the temperature scalars sit under the same enterprise number (`.1.1.0`/`.1.2.0`).

## Implementation notes

The code lives in `snmp.c` (bank7 in the 1MB layout; the transitional bridge image does not include SNMP). The request is parsed in place inside the uIP buffer and the response is built above the header reserve, then shifted into place. Internal RAM's overlay segment is exhausted, so the module works entirely from static XDATA state with global argument passing and no function parameters. Host-side unit tests: `test/test_snmp.c` (67 assertions: BER byte encodings, negative request validation, v1/v2c error semantics, full-tree GETNEXT order, non-monotonic port maps, GetBulk capping, community handling, temperature conversion and the MIB-II→enterprises walk handoff).

## Verification

```
snmpwalk     -v2c -c public <ip> 1.3.6.1.2.1          # full tree
snmpbulkwalk -v2c -c public <ip> 1.3.6.1.2.1.2.2      # ifTable
snmpget      -v1  -c public <ip> sysUpTime.0          # v1 compat
snmpget      -v2c -c public <ip> 1.3.6.1.4.1.32473.1.1.0   # chip temperature (0.1 °C)
snmpwalk     -v2c -c wrong  <ip> 1.3.6.1              # should time out
```
