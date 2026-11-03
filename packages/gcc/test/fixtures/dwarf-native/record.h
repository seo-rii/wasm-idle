#ifndef FRAME_RECORD_H
#define FRAME_RECORD_H
#include <stddef.h>
typedef struct FrameRecord { int tag; long long wide; double ratio; } FrameRecord;
_Static_assert(sizeof(FrameRecord) == 24 && offsetof(FrameRecord, wide) == 8 && offsetof(FrameRecord, ratio) == 16, "frame layout");
int debug_middle(int input, int trigger);
#endif
