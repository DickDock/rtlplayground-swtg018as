#ifndef BRIDGE_LAYOUT
// Sentinel for reserved code bank 10.  imagebuilder derives the bank
// count from the highest written byte, so an empty bank would silently
// drop out of the packed image and shift everything after it.  The
// string doubles as the runtime PSBANK probe marker.
#pragma codeseg BANK10
#pragma constseg BANK10
__code const char bank10_mark[] = "RTLPLAYGROUND-BANK10-SENTINEL";
#endif
