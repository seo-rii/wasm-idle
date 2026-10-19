/* Run the actual WASI select call from the producer patch against a real pipe.
   Model only WASIX's documented rejection of a nonempty exception set. */
#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <errno.h>
#include <stdio.h>
#include <sys/select.h>
#include <time.h>
#include <unistd.h>

static int wasi_select(int count, fd_set *reads, fd_set *writes,
                       fd_set *exceptions, struct timeval *timeout) {
  if (exceptions) {
    errno = ENOSYS;
    return -1;
  }
  return select(count, reads, writes, exceptions, timeout);
}
#define select wasi_select

static int readable(int tty) {
  fd_set readfds;
  struct timeval timeout = { 0, 20000 };
  FD_ZERO(&readfds);
  FD_SET(tty, &readfds);
/* READINESS_SOURCE */
}

int main(void) {
  int descriptors[2];
  char value;
  struct timespec before, after;
  assert(pipe(descriptors) == 0);
  assert(write(descriptors[1], "x", 1) == 1);
  assert(readable(descriptors[0]) == 1);
  assert(read(descriptors[0], &value, 1) == 1 && value == 'x');
  assert(clock_gettime(CLOCK_MONOTONIC, &before) == 0);
  assert(readable(descriptors[0]) == 0);
  assert(clock_gettime(CLOCK_MONOTONIC, &after) == 0);
  long elapsed = (after.tv_sec - before.tv_sec) * 1000000000L +
                 after.tv_nsec - before.tv_nsec;
  assert(elapsed >= 10000000L); /* Preserve the idle polling boundary. */
  assert(write(descriptors[1], "y", 1) == 1);
  assert(readable(descriptors[0]) == 1);
  assert(read(descriptors[0], &value, 1) == 1 && value == 'y');
  assert(close(descriptors[0]) == 0);
  assert(close(descriptors[1]) == 0);
  puts("ready; idle timeout; subsequent input: passed");
  return 0;
}
