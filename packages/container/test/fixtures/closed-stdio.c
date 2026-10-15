/* Real Preview1 fixture: argv[1] is a bitmask of initially open fd 0/1/2.
 * Build: clang --target=wasm32-unknown-unknown -Oz -nostdlib closed-stdio.c
 *   -Wl,--no-entry -Wl,--export-memory -Wl,--max-memory=16777216 -o closed-stdio.wasm
 */
typedef unsigned int u32;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(args_sizes_get) int args_sizes_get(u32 *, u32 *);
WASI(args_get) int args_get(char **, char *);
WASI(fd_fdstat_get) int fd_fdstat_get(int, void *);
WASI(fd_filestat_get) int fd_filestat_get(int, void *);
WASI(fd_read) int fd_read(int, void *, u32, u32 *);
WASI(fd_write) int fd_write(int, void *, u32, u32 *);
WASI(fd_close) int fd_close(int);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);
__attribute__((import_module("wasm_idle_process_v1"), import_name("initial_cwd"))) int initial_cwd(char *, u32);
__attribute__((export_name("_start"))) void _start(void) {
  u32 argc, length, count = 99;
  char *argv[4], text[128], cwd[4096];
  unsigned char stat[64];
  if (initial_cwd(cwd, sizeof(cwd)) < 2 || args_sizes_get(&argc, &length) || argc != 2 || length > sizeof(text) || args_get(argv, text)) proc_exit(90);
  int mask = argv[1][0] - '0';
  if (mask < 0 || mask > 7 || argv[1][1]) proc_exit(91);
  for (int fd = 0; fd < 3; fd++) {
    int expected = (mask & (1 << fd)) ? 0 : 8;
    if (fd_fdstat_get(fd, stat) != expected) proc_exit(10 + fd);
    if (fd_filestat_get(fd, stat) != expected) proc_exit(20 + fd);
    if ((fd ? fd_write(fd, 0, 0, &count) : fd_read(fd, 0, 0, &count)) != expected) proc_exit(30 + fd);
    if (!expected && count) proc_exit(40 + fd);
    if (fd_close(fd) != expected || fd_close(fd) != 8) proc_exit(50 + fd);
    if (fd_fdstat_get(fd, stat) != 8 || fd_filestat_get(fd, stat) != 8) proc_exit(60 + fd);
  }
}
