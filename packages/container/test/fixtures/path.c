/* Real no-libc WASI path guest for deterministic live dirfd interleavings. */
typedef unsigned int u32;
typedef unsigned long long u64;
typedef struct { void *data; u32 length; } iovec;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(fd_write) int fd_write(int, const iovec *, int, u32 *);
WASI(fd_read) int fd_read(int, const iovec *, int, u32 *);
WASI(fd_readdir) int fd_readdir(int, void *, u32, u64, u32 *);
WASI(args_sizes_get) int args_sizes_get(u32 *, u32 *);
WASI(args_get) int args_get(char **, char *);
WASI(path_open) int path_open(int, u32, const char *, u32, u32, u64, u64, u32, u32 *);
WASI(path_filestat_get) int path_filestat_get(int, u32, const char *, u32, void *);
WASI(path_create_directory) int path_create_directory(int, const char *, u32);
WASI(path_remove_directory) int path_remove_directory(int, const char *, u32);
WASI(path_unlink_file) int path_unlink_file(int, const char *, u32);
WASI(path_readlink) int path_readlink(int, const char *, u32, void *, u32, u32 *);
WASI(path_symlink) int path_symlink(const char *, u32, int, const char *, u32);
WASI(path_rename) int path_rename(int, const char *, u32, int, const char *, u32);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);
__attribute__((import_module("wasm_idle_process_v1"), import_name("initial_cwd"))) int initial_cwd(char *, u32);
static char buffer[4096], argbytes[4096];
static char *argv[16];
static u32 length(const char *text) { u32 n = 0; while (text[n]) n++; return n; }
static int equal(const char *a, const char *b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }
static void check(int error) { if (error) proc_exit(error); }
static void output(const void *data, u32 size) {
  u32 offset = 0;
  while (offset < size) {
    iovec v = {(char *)data + offset, size - offset}; u32 count = 0;
    check(fd_write(1, &v, 1, &count)); if (!count || count > size - offset) proc_exit(90);
    offset += count;
  }
}
static u32 directory(const char *name) {
  u32 fd = 0; check(path_open(3, 1, name, length(name), 2, ((u64)1 << 16) | ((u64)1 << 17), 0, 0, &fd)); return fd;
}
__attribute__((export_name("_start"))) void _start(void) {
  if (initial_cwd(buffer, sizeof(buffer)) < 2) proc_exit(91);
  u32 argc, bytes, count = 0, fd = 0;
  check(args_sizes_get(&argc, &bytes)); if (argc != 2 || bytes > sizeof(argbytes)) proc_exit(92);
  check(args_get(argv, argbytes)); const char *mode = argv[1];
  if (equal(mode, "read") || equal(mode, "nofollow") || equal(mode, "write")) {
    int write = equal(mode, "write");
    check(path_open(3, !equal(mode, "nofollow"), "file", 4, write ? 9 : 0, write ? 66 : 2, 0, 0, &fd));
    if (write) { iovec v = {"written", 7}; check(fd_write(fd, &v, 1, &count)); if (count != 7) proc_exit(93); }
    else { iovec v = {buffer, sizeof(buffer)}; check(fd_read(fd, &v, 1, &count)); output(buffer, count); }
  } else if (equal(mode, "stat")) {
    check(path_filestat_get(3, 1, "file", 4, buffer)); output(buffer, 64);
  } else if (equal(mode, "mkdir")) check(path_create_directory(3, "created", 7));
  else if (equal(mode, "rmdir")) check(path_remove_directory(3, "empty", 5));
  else if (equal(mode, "unlink")) check(path_unlink_file(3, "file", 4));
  else if (equal(mode, "readlink")) { check(path_readlink(3, "link", 4, buffer, sizeof(buffer), &count)); output(buffer, count); }
  else if (equal(mode, "symlink")) check(path_symlink("target", 6, 3, "created", 7));
  else if (equal(mode, "readdir")) { check(fd_readdir(3, buffer, sizeof(buffer), 0, &count)); output(buffer, count); }
  else if (equal(mode, "rename")) {
    u32 from = directory("from"), to = directory("to");
    check(path_rename(from, "file", 4, to, "moved", 5));
  } else proc_exit(94);
}
