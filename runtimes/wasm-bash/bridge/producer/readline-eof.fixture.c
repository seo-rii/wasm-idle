/* Compile the exact patched Readline gather function against real pipes.
   Only its input queue and the WASIX select exception-set restriction are
   modeled here; the readiness, ioctl, nonblocking read and EOF are real. */
#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <time.h>
#include <unistd.h>

#define __wasi__ 1
#define HAVE_SELECT 1
#define USEC_TO_TIMEVAL(usecs, value) do { (value).tv_sec = 0; (value).tv_usec = (usecs); } while (0)
#define RL_CHECK_SIGNALS() ((void)0)
#define NEWLINE '\n'
#define RETURN '\r'
static const int _keyboard_input_timeout = 20000, ibuffer_len = 32;
static FILE *rl_instream;
static int queued[32], count, force_readiness, hook_calls;
static int rl_pending_input, rl_done;
#define RL_STATE_READCMD 0x8
#define RL_ISSTATE(state) ((state) == RL_STATE_READCMD)
#define READERR (-2)
static int (*rl_getc_function)(FILE *) = getc;
static int ibuffer_space(void) { return ibuffer_len - count; }
static int rl_stuff_char(int value) {
  /* Upstream rl_stuff_char(EOF) injects a newline before EOF. A real stream
     close must not take that path and accept a pending editor buffer. */
  assert(value >= 0 && value <= 255);
  assert(count < ibuffer_len);
  queued[count++] = value;
  return 1;
}
static int rl_get_char(int *value) {
  if (!count) return 0;
  *value = queued[0];
  for (int i = 1; i < count; i++) queued[i - 1] = queued[i];
  count--;
  return 1;
}
static int rl_clear_pending_input(void) { rl_pending_input = 0; return 0; }
static int _rl_next_macro_key(void) { return 0; }
static int event_hook(void) { hook_calls++; return 0; }
static int (*rl_event_hook)(void) = event_hook;
static int wasi_select(int nfds, fd_set *reads, fd_set *writes,
                       fd_set *exceptions, struct timeval *timeout) {
  if (exceptions) { errno = ENOSYS; return -1; }
  if (force_readiness) return 1; /* Another reader may consume ready data. */
  return select(nfds, reads, writes, exceptions, timeout);
}
#define select wasi_select

/* GATHER_SOURCE */
/* KEY_SOURCE */

int main(void) {
  int descriptors[2], flags;
  struct timespec before, after;
  assert(pipe(descriptors) == 0);
  rl_instream = fdopen(descriptors[0], "r");
  assert(rl_instream != NULL);
  assert(setvbuf(rl_instream, NULL, _IONBF, 0) == 0);
  flags = fcntl(descriptors[0], F_GETFL);
  assert(flags >= 0);

  assert(write(descriptors[1], "x", 1) == 1);
  assert(rl_gather_tyi() == 1 && count == 1 && queued[0] == 'x');
  count = 0;
  assert(clock_gettime(CLOCK_MONOTONIC, &before) == 0);
  assert(rl_gather_tyi() == 0 && count == 0);
  assert(clock_gettime(CLOCK_MONOTONIC, &after) == 0);
  assert((after.tv_sec - before.tv_sec) * 1000000000L +
         after.tv_nsec - before.tv_nsec >= 10000000L);

  force_readiness = 1;
  assert(rl_gather_tyi() == 0 && count == 0); /* EAGAIN is not EOF. */
  assert(fcntl(descriptors[0], F_GETFL) == flags);
  force_readiness = 0;

  assert(write(descriptors[1], "y", 1) == 1);
  assert(close(descriptors[1]) == 0);
  assert(rl_read_key() == 'y' && count == 0);
  /* A closed pipe is readable with FIONREAD == 0. Return EOF to Readline
     without queueing a newline, which would accept an unfinished edit. */
  assert(rl_read_key() == EOF && count == 0 && hook_calls == 1);
  assert(fcntl(descriptors[0], F_GETFL) == flags);
  assert(rl_read_key() == EOF && count == 0 && hook_calls == 2);
  assert(rl_pending_input == 0 && rl_done == 0);
  assert(fclose(rl_instream) == 0);
  puts("input; idle timeout; EAGAIN; buffered input before EOF; repeated EOF: passed");
  return 0;
}
