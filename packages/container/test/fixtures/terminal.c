/* Actual Wasm output/input/cancellation fixture for the optional UI binding. */
typedef unsigned int u32;
typedef unsigned long long u64;
typedef struct { void *data; u32 length; } iovec;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(fd_write) int fd_write(int, const iovec *, int, u32 *);
WASI(fd_read) int fd_read(int, const iovec *, int, u32 *);
WASI(fd_close) int fd_close(int);
WASI(args_sizes_get) int args_sizes_get(u32 *, u32 *);
WASI(args_get) int args_get(char **, char *);
WASI(path_open) int path_open(int, u32, const char *, u32, u32, u64, u64, u32, u32 *);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);
__attribute__((import_module("wasm_idle_process_v1"), import_name("initial_cwd"))) int initial_cwd(char *, u32);
static unsigned char buffer[1024];
static char args[256], *argv[4];
static int equal(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }
static void check(int error) { if (error) proc_exit(error); }
static void write_all(int fd, void *data, u32 length) {
  for (u32 offset = 0; offset < length;) {
    iovec v = {(char *)data + offset, length - offset}; u32 count;
    check(fd_write(fd, &v, 1, &count)); if (!count || count > length - offset) proc_exit(90); offset += count;
  }
}
__attribute__((export_name("_start"))) void _start(void) {
  char cwd[4096]; if (initial_cwd(cwd, sizeof(cwd)) < 2) proc_exit(91);
  u32 argc, size, count; check(args_sizes_get(&argc, &size));
  if (argc != 2 || size > sizeof(args)) proc_exit(92); check(args_get(argv, args));
  const char *mode = argv[1];
  if (equal(mode, "utf8")) {
    unsigned char out[] = {0xef, 0xbb, 0xbf, 0xed, 0x95, 0x9c, 0, 0xff, 0xc3};
    unsigned char err[] = {0xea, 0xb8, 0x80, 0xe2, 0x82};
    for (u32 i = 0; i < sizeof(out); i++) {
      write_all(1, out + i, 1); if (i < sizeof(err)) write_all(2, err + i, 1);
    }
    return;
  }
  if (equal(mode, "echo")) {
    u32 fd; check(path_open(3, 1, "input.bin", 9, 9, 66, 0, 0, &fd));
    for (;;) {
      iovec v = {buffer, sizeof(buffer)}; check(fd_read(0, &v, 1, &count)); if (!count) break;
      write_all(fd, buffer, count); write_all(1, buffer, count);
    }
    check(fd_close(fd)); return;
  }
  if (equal(mode, "flood")) {
    for (u32 i = 0; i < sizeof(buffer); i++) buffer[i] = 'x';
    for (;;) { write_all(1, buffer, sizeof(buffer)); write_all(2, buffer, sizeof(buffer)); }
  }
  write_all(1, "ready", 5);
  if (equal(mode, "input")) { iovec v = {buffer, sizeof(buffer)}; check(fd_read(0, &v, 1, &count)); return; }
  if (equal(mode, "loop")) { volatile u32 n = 1; while (n) n = n + 1 ? n + 1 : 1; }
  if (equal(mode, "exit")) proc_exit(23);
  if (equal(mode, "trap")) __builtin_trap();
  proc_exit(93);
}
