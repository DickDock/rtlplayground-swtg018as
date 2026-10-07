#ifndef BRIDGE_LAYOUT
// Sentinel for reserved code bank 7.  imagebuilder derives the bank
// count from the highest written byte, so an empty bank would silently
// drop out of the packed image and shift everything after it.  The
// string doubles as the runtime PSBANK probe marker.
#pragma codeseg BANK7
#pragma constseg BANK7
__code const char bank7_mark[] = "RTLPLAYGROUND-BANK7-SENTINEL";
#endif
