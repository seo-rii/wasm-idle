/* Actual no-libc WASI guest for partial I/O, visibility and cancellation gates. */
typedef unsigned int u32;
typedef unsigned long long u64;
typedef struct { void *data; u32 length; } iovec;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(fd_write) int fd_write(int, const iovec *, int, u32 *);
WASI(fd_read) int fd_read(int, const iovec *, int, u32 *);
WASI(fd_close) int fd_close(int);
WASI(fd_fdstat_get) int fd_fdstat_get(int, void *);
WASI(args_sizes_get) int args_sizes_get(u32 *, u32 *);
WASI(args_get) int args_get(char **, char *);
WASI(path_open) int path_open(int, u32, const char *, u32, u32, u64, u64, u32, u32 *);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);
__attribute__((import_module("wasm_idle_process_v1"), import_name("initial_cwd"))) int initial_cwd(char *, u32);
static char buffer[131073], argbytes[4096];
static char *argv[128];
static u32 length(const char *s) { u32 n = 0; while (s[n]) n++; return n; }
static int equal(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }
static void write_all(int fd, void *data, u32 length) {
  u32 offset = 0;
  while (offset < length) {
    iovec v = {(char *)data + offset, length - offset}; u32 n = 0;
    int error = fd_write(fd, &v, 1, &n);
    if (error) proc_exit(error); if (!n || n > length - offset) proc_exit(90);
    offset += n;
  }
}
static u32 read_some(int fd, void *data, u32 length) {
  iovec v = {data, length}; u32 n = 0;
  int error = fd_read(fd, &v, 1, &n); if (error) proc_exit(error); return n;
}
static u32 open_file(const char *name, int write) {
  u32 fd = 0;
  int error = path_open(3, 1, name, length(name), write ? 9 : 0, write ? 66 : 2, 0, 0, &fd);
  if (error) proc_exit(error); return fd;
}
static void read_file(const char *name) {
  u32 fd = open_file(name, 0), n;
  while ((n = read_some(fd, buffer, sizeof(buffer)))) write_all(1, buffer, n);
  if (fd_close(fd)) proc_exit(91);
}
__attribute__((export_name("_start"))) void _start(void) {
  char cwd[4096]; if (initial_cwd(cwd, sizeof(cwd)) < 2) proc_exit(125);
  u32 argc, bytes; if (args_sizes_get(&argc, &bytes) || argc > 128 || bytes > sizeof(argbytes)) proc_exit(92);
  if (args_get(argv, argbytes)) proc_exit(93);
  const char *mode = argc > 1 ? argv[1] : "copy";
  if (equal(mode, "yes")) { for (;;) write_all(1, "y\n", 2); }
  if (equal(mode, "one")) { u32 n = read_some(0, buffer, 1); write_all(1, buffer, n); return; }
  if (equal(mode, "read")) { read_file(argc > 2 ? argv[2] : "visible"); return; }
  if (equal(mode, "visible") || equal(mode, "crash")) {
    u32 fd = open_file("visible", 1); write_all(fd, "before", 6); fd_close(fd);
    if (equal(mode, "crash")) __builtin_trap();
    write_all(1, "ready", 5); read_some(0, buffer, 1); read_file("visible"); return;
  }
  if (equal(mode, "close-output")) {
    write_all(1, "eof", 3); if (fd_close(1)) proc_exit(94);
    read_some(0, buffer, 1); return;
  }
  if (equal(mode, "flood")) {
    for (u32 i = 0; i < sizeof(buffer); i++) buffer[i] = (char)i;
    write_all(1, buffer, sizeof(buffer)); write_all(2, buffer, sizeof(buffer)); return;
  }
  if (equal(mode, "non-tty")) {
    unsigned char stat[24];
    for (int fd = 0; fd < 3; fd++) if (fd_fdstat_get(fd, stat) || stat[0] != 0) proc_exit(95);
    return;
  }
  if (equal(mode, "loop")) { volatile u32 n = 1; while (n) n = n + 1 ? n + 1 : 1; }
  u32 n;
  while ((n = read_some(0, buffer, sizeof(buffer)))) write_all(1, buffer, n);
}
