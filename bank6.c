#ifndef BRIDGE_LAYOUT
// Sentinel for code bank 6.  The modules for this bank live here after
// the banking migration; the sentinel stays as a runtime PSBANK probe
// marker.  It also guarantees aslink/imagebuilder always see the bank.
#pragma codeseg BANK6
#pragma constseg BANK6
__code const char bank6_mark[] = "RTLPLAYGROUND-BANK6-SENTINEL";
#endif
