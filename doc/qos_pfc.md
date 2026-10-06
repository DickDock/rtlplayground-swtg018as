# QoS, Flow Control and Priority Flow Control

English | [简体中文](qos_pfc.zh-CN.md)

The RTL8372/3 decides an internal priority 0-7 for every packet, maps it to one of
8 egress queues per port and schedules the queues strictly or by weight. Pause
frames (IEEE 802.3x) can be sent and honoured on every port. The two 10G MACs
(chip ports 3 and 8, the SFP+ cages on most devices) additionally support
Priority Flow Control (IEEE 802.1Qbb), which pauses single priorities and is what
lossless RoCEv2 traffic needs. The switch cannot mark ECN.

Register addresses and field layouts are taken from `rtl8373_reg_definition.h` of
https://github.com/airjinkela/rtl837x-dsa-driver (GPL-2.0). The register values
behind the commands are covered by `test/test_qos.c`; the behaviour of the switch
still needs confirming on hardware, see [Verification](#verification).

All commands below except `show` and `pfc <port> force` are configuration and are
saved with the configuration. Ports are physical port numbers as everywhere else.

## QoS
```
qos show
qos trust dscp|1p|port
qos dscp <0-63> <prio 0-7>
qos 1p <pcp 0-7> <prio 0-7>
qos port <port> <prio 0-7>
qos queue <prio 0-7> <queue 0-7>
qos sched <port> <queue 0-7> strict|<weight 1-127>
```
The internal priority is chosen from several sources (802.1p PCP, DSCP, the port
default, ACL, SVLAN) by one-hot weights, the highest weight wins. `qos trust`
puts the given source on top in both weight tables. `qos dscp` and `qos 1p` map a
DSCP or PCP value to an internal priority, `qos port` sets the priority a port
assigns when no other source applies. `qos queue` maps an internal priority to a
queue on all ports, `qos sched` makes a queue of a port strict or sets its weight.

## 802.3x flow control
```
fc show
fc <port> auto|on|off
fc <port> set <0-3>
fc thr glb|<0-3> <on> <off>
fc guar <0-3> <pages>
```
`fc <port> on|off` forces sending and honouring pause frames on or off in the
MAC, `auto` returns to the result of auto-negotiation. Thresholds are in buffer
pages: pause is sent when the used pages exceed `<on>` and released below `<off>`.
There is one global threshold and 4 threshold sets with a guaranteed number of
pages, and each port selects one set. `fc show` also prints the pages in use and
their peak, per port and in total.

## Priority flow control
```
pfc show
pfc <port> map
pfc <port> on <prio>[,<prio>..]
pfc <port> off
pfc <port> force <prio>[,<prio>..]|off
```
Only the two 10G ports are accepted. `pfc <port> map` maps internal priority
and PCP n to priority group (PG) n, which `pfc <port> on` relies on: it enables
PFC for the listed priorities in both directions and for the PGs of the same
numbers. `pfc <port> force` marks PGs congested, so that the switch sends PFC
frames for them without any load; it is meant for testing and is not saved.

`pfc show` prints the raw control words, the priority to PG maps, the PG to
priority-enable-vector table and the pages used per PG.

## Verification
The following has not been confirmed on hardware yet:
1. Which of the two copies of the PFC registers belongs to which MAC. The code
   assumes the first is MAC 3 and the second MAC 8 (`PFC_IDX()` in
   `rtl837x_qos.c`). Run `pfc <port> force 3` and capture on the link partner
   (`tcpdump -i <if> ether proto 0x8808`, or `ethtool -S <if> | grep -i pfc`):
   the frames must appear on the port given.
2. The PG to priority-enable-vector table (`RTL837X_PG_2_PEV_TABLE`) is 64 bits
   wide and it is not known which of the two words holds PG 0-3. `pfc show`
   prints both words; the PFC frames sent by `pfc <port> force` show which
   priority a PG pauses.
3. The meaning of the 802.3x HI/LO threshold pairs. Only the HI registers are
   exposed.
4. Whether `fc <port> off`, which clears the MAC pause bits, leaves PFC working.
   If it does not, use `fc <port> auto` and disable pause on the link partner.

A lossless setup for RoCEv2 traffic marked with DSCP 26 on the 10G port 9:
```
qos trust dscp
qos dscp 26 3
qos queue 3 3
pfc 9 map
pfc 9 on 3
```
802.3x pause should be off on this port so that it does not pause all
priorities. Until point 4 above is confirmed, disable it on the link partner
(`ethtool -A <if> rx off tx off`) and leave the switch at `fc 9 auto` rather
than using `fc 9 off`.
