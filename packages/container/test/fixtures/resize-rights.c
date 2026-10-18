/* Preview1 size-only handles must resize without acquiring byte I/O rights. */
typedef unsigned int u32;
typedef unsigned long long u64;
typedef struct { void *data; u32 length; } iovec;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(path_open) u32 path_open(u32, u32, const char *, u32, u32, u64, u64, u32, u32 *);
WASI(fd_fdstat_get) u32 fd_fdstat_get(u32, void *);
WASI(fd_fdstat_set_rights) u32 fd_fdstat_set_rights(u32, u64, u64);
WASI(fd_filestat_set_size) u32 fd_filestat_set_size(u32, u64);
WASI(fd_read) u32 fd_read(u32, const iovec *, u32, u32 *);
WASI(fd_write) u32 fd_write(u32, const iovec *, u32, u32 *);
WASI(fd_readdir) u32 fd_readdir(u32, void *, u32, u64, u32 *);
WASI(fd_close) u32 fd_close(u32);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);
__attribute__((import_module("wasm_idle_process_v1"), import_name("initial_cwd"))) int initial_cwd(char *, u32);

static const u64 READ = 2, WRITE = 64, RESIZE = (u64)1 << 22;
static void check(u32 error) { if (error) proc_exit(error); }
static void rights(u32 fd, u64 expected) {
  u64 stat[3];
  check(fd_fdstat_get(fd, stat));
  if (stat[1] != expected || stat[2] != 0) proc_exit(100);
}

__attribute__((export_name("_start"))) void _start(void) {
  char cwd[4096];
  if (initial_cwd(cwd, sizeof(cwd)) < 2) proc_exit(101);
  u32 fd, count;
  char buffer[6] = {0};
  iovec io = {buffer, sizeof(buffer)};

  check(path_open(3, 1, "size-only", 9, 0, RESIZE, 0, 0, &fd));
  rights(fd, RESIZE);
  check(fd_filestat_set_size(fd, 2));
  if (fd_read(fd, &io, 1, &count) != 76) proc_exit(102);
  if (fd_write(fd, &io, 1, &count) != 76) proc_exit(103);
  check(fd_fdstat_set_rights(fd, 0, 0));
  if (fd_filestat_set_size(fd, 0) != 76) proc_exit(104);
  check(fd_close(fd));

  check(path_open(3, 1, "size-read", 9, 0, READ | RESIZE, 0, 0, &fd));
  rights(fd, READ | RESIZE);
  check(fd_filestat_set_size(fd, sizeof(buffer)));
  check(fd_read(fd, &io, 1, &count));
  if (count != sizeof(buffer) || buffer[0] != 'A' || buffer[1] != 'B' ||
      buffer[2] != 'C' || buffer[3] != 'D' || buffer[4] || buffer[5]) proc_exit(105);
  if (fd_write(fd, &io, 1, &count) != 76) proc_exit(106);
  check(fd_close(fd));

  check(path_open(3, 1, "size-only", 9, 0, WRITE, 0, 0, &fd));
  if (fd_filestat_set_size(fd, 0) != 76) proc_exit(107);
  check(fd_close(fd));
  /* The size-only right must also respect readonly mounts at open time. */
  if (path_open(4, 1, "usr/share/resize/file", 21, 0, RESIZE, 0, 0, &fd) != 69) proc_exit(108);
  /* Callers may request a broad mask containing rights inapplicable to directories. */
  for (u32 directory = 0; directory <= 2; directory += 2) {
    check(path_open(3, 1, ".", 1, directory, ((u64)1 << 14) | RESIZE, 0, 0, &fd));
    check(fd_readdir(fd, buffer, sizeof(buffer), 0, &count));
    if (!count) proc_exit(109);
    check(fd_close(fd));
    check(path_open(4, 1, "usr/share/resize", 16, directory, ((u64)1 << 14) | RESIZE, 0, 0, &fd));
    check(fd_readdir(fd, buffer, sizeof(buffer), 0, &count));
    if (!count) proc_exit(110);
    check(fd_close(fd));
  }
}
