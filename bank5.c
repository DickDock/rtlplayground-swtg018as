#ifndef BRIDGE_LAYOUT
// Sentinel for code bank 5.  The modules for this bank live here after
// the banking migration; the sentinel stays as a runtime PSBANK probe
// marker.  It also guarantees aslink/imagebuilder always see the bank.
#pragma codeseg BANK5
#pragma constseg BANK5
__code const char bank5_mark[] = "RTLPLAYGROUND-BANK5-SENTINEL";
#endif
