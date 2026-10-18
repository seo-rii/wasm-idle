/* Real Preview1 guest: NONBLOCK is immediate for regular files/directories. */
typedef unsigned int u32;
typedef unsigned long long u64;
typedef struct { const void *data; u32 length; } iovec;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(path_open) int path_open(int, u32, const char *, u32, u32, u64, u64, u32, u32 *);
WASI(fd_fdstat_get) int fd_fdstat_get(int, void *);
WASI(fd_fdstat_set_flags) int fd_fdstat_set_flags(int, u32);
WASI(fd_write) int fd_write(int, const iovec *, int, u32 *);
WASI(fd_close) int fd_close(int);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);
__attribute__((import_module("wasm_idle_process_v1"), import_name("initial_cwd"))) int initial_cwd(char *, u32);
static void check(int error) { if (error) proc_exit(error); }
static void flags(int fd, u32 expected) {
  unsigned char stat[24]; check(fd_fdstat_get(fd, stat));
  if (stat[2] != expected || stat[3]) proc_exit(90);
}
__attribute__((export_name("_start"))) void _start(void) {
  char cwd[4096]; if (initial_cwd(cwd, sizeof(cwd)) < 2) proc_exit(96);
  u32 fd, count;
  check(path_open(3, 1, ".", 1, 2, 8 | ((u64)1 << 14), 0, 4, &fd));
  flags(fd, 4); check(fd_fdstat_set_flags(fd, 0)); flags(fd, 0);
  check(fd_fdstat_set_flags(fd, 4)); flags(fd, 4);
  if (fd_fdstat_set_flags(fd, 2) != 58 || fd_fdstat_set_flags(fd, 1) != 58) proc_exit(91);
  flags(fd, 4); check(fd_close(fd));
  check(path_open(3, 1, "flags-file", 10, 9, 2 | 8 | 64, 0, 5, &fd));
  flags(fd, 5); check(fd_fdstat_set_flags(fd, 1)); flags(fd, 1);
  check(fd_fdstat_set_flags(fd, 5)); flags(fd, 5);
  if (fd_fdstat_set_flags(fd, 0) != 58) proc_exit(92);
  iovec v = {"ok", 2}; check(fd_write(fd, &v, 1, &count));
  if (count != 2) proc_exit(93); check(fd_close(fd));
  check(path_open(3, 1, "flags-file", 10, 0, 2, 0, 4, &fd));
  if (fd_fdstat_set_flags(fd, 0) != 76) proc_exit(94);
  flags(fd, 4); check(fd_close(fd));
  if (fd_fdstat_set_flags(0, 4) != 58 || fd_fdstat_set_flags(1, 4) != 58 || fd_fdstat_set_flags(2, 4) != 58) proc_exit(95);
}
