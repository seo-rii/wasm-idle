#include <stdio.h>
#include "record.h"
static __attribute__((noinline)) int same_name(int value) { register int local = value + 1; return local; }
int main(void) {
  int value = 0, trigger = 0;
  if (scanf("%d %d", &value, &trigger) != 2) return 2;
  printf("layout %zu %zu %zu %zu\n", sizeof(FrameRecord), offsetof(FrameRecord, tag), offsetof(FrameRecord, wide), offsetof(FrameRecord, ratio));
  fflush(stdout);
  int result = debug_middle(same_name(value), trigger);
  printf("result %d\n", result);
  return 0;
}
