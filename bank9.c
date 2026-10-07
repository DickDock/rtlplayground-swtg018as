#ifndef BRIDGE_LAYOUT
// Sentinel for reserved code bank 9.  imagebuilder derives the bank
// count from the highest written byte, so an empty bank would silently
// drop out of the packed image and shift everything after it.  The
// string doubles as the runtime PSBANK probe marker.
#pragma codeseg BANK9
#pragma constseg BANK9
__code const char bank9_mark[] = "RTLPLAYGROUND-BANK9-SENTINEL";
#endif
