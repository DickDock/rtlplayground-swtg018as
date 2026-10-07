#ifndef BRIDGE_LAYOUT
// Sentinel for code bank 4.  The modules for this bank live here after
// the banking migration; the sentinel stays as a runtime PSBANK probe
// marker.  It also guarantees aslink/imagebuilder always see the bank.
#pragma codeseg BANK4
#pragma constseg BANK4
__code const char bank4_mark[] = "RTLPLAYGROUND-BANK4-SENTINEL";
#endif
