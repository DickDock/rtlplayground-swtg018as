#ifndef BRIDGE_LAYOUT
// Sentinel for reserved code bank 8.  imagebuilder derives the bank
// count from the highest written byte, so an empty bank would silently
// drop out of the packed image and shift everything after it.  The
// string doubles as the runtime PSBANK probe marker.
#pragma codeseg BANK8
#pragma constseg BANK8
__code const char bank8_mark[] = "RTLPLAYGROUND-BANK8-SENTINEL";
#endif
