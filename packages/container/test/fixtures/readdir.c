/* Remove directory entries between bounded Preview1 readdir calls. */
typedef unsigned int u32;
typedef unsigned long long u64;
typedef struct { const void *data; u32 length; } iovec;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(fd_readdir) int fd_readdir(int, void *, u32, u64, u32 *);
WASI(path_unlink_file) int path_unlink_file(int, const char *, u32);
WASI(fd_write) int fd_write(int, const iovec *, int, u32 *);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);
__attribute__((import_module("wasm_idle_process_v1"), import_name("initial_cwd"))) int initial_cwd(char *, u32);
static void check(int error) { if (error) proc_exit(error); }
static u32 word(const unsigned char *p) { return p[0] | p[1] << 8 | p[2] << 16 | (u32)p[3] << 24; }
__attribute__((export_name("_start"))) void _start(void) {
  char cwd[4096]; if (initial_cwd(cwd, sizeof(cwd)) < 2) proc_exit(90);
  unsigned char entries[256]; u64 cookie = 0; u32 removed = 0, used;
  for (;;) {
    check(fd_readdir(3, entries, sizeof(entries), cookie, &used));
    if (!used) break;
    u32 offset = 0, count = 0;
    while (offset + 24 <= used) {
      unsigned char *entry = entries + offset; u32 length = word(entry + 16);
      if (length > used - offset - 24) break;
      check(path_unlink_file(3, (char *)entry + 24, length));
      cookie = word(entry) | (u64)word(entry + 4) << 32;
      offset += 24 + length; removed++; count++;
    }
    if (!count || removed > 1000) proc_exit(91);
  }
  /* Explicit rewind must refresh the listing after completed mutations. */
  check(fd_readdir(3, entries, sizeof(entries), 0, &used));
  if (used) proc_exit(92);
  iovec result = {&removed, sizeof(removed)}; check(fd_write(1, &result, 1, &used));
  if (used != sizeof(removed)) proc_exit(93);
}
