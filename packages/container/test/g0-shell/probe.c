/* Freestanding ABI probe; this is a real Wasm guest, not a compiler substitute. */
typedef unsigned int u32;
typedef unsigned long long u64;
typedef struct { void *base; u32 len; } iovec;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(args_sizes_get) int args_sizes_get(u32 *, u32 *);
WASI(args_get) int args_get(char **, char *);
WASI(environ_sizes_get) int environ_sizes_get(u32 *, u32 *);
WASI(environ_get) int environ_get(char **, char *);
WASI(fd_read) int fd_read(u32, iovec *, u32, u32 *);
WASI(fd_write) int fd_write(u32, iovec *, u32, u32 *);
WASI(fd_close) int fd_close(u32);
WASI(fd_prestat_get) int fd_prestat_get(u32, void *);
WASI(fd_prestat_dir_name) int fd_prestat_dir_name(u32, char *, u32);
WASI(path_open) int path_open(u32, u32, const char *, u32, u32, u64, u64, u32, u32 *);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);
#ifdef G0_WASIX_CWD
__attribute__((import_module("wasix_32v1"), import_name("getcwd"))) int getcwd(char *, u32 *);
#endif

static u32 len(const char *s) { u32 n = 0; while (s[n]) ++n; return n; }
static int same(const char *a, const char *b) { while (*a && *a == *b) { ++a; ++b; } return *a == *b; }
static void output(u32 fd, const void *bytes, u32 size) {
  const char *p = bytes;
  while (size) { iovec io = {(void *)p, size}; u32 wrote = 0;
    if (fd_write(fd, &io, 1, &wrote) || !wrote) proc_exit(91);
    p += wrote; size -= wrote;
  }
}
static void text(u32 fd, const char *s) { output(fd, s, len(s)); }
static void number(u32 n) { char b[12]; u32 i = sizeof(b); do { b[--i] = '0' + n % 10; n /= 10; } while(n); output(2, b+i, sizeof(b)-i); text(2, "\n"); }
static void copy(u32 from, u32 to) {
  char bytes[17]; u32 got;
  for (;;) { iovec io = {bytes, sizeof(bytes)};
    if (fd_read(from, &io, 1, &got)) proc_exit(92);
    if (!got) return;
    output(to, bytes, got);
  }
}
static u32 rootfd(void) {
  char name[256]; u32 pre[2];
  for (u32 fd = 3; fd < 32; ++fd) {
    if (fd_prestat_get(fd, pre) || pre[1] >= sizeof(name)) continue;
    if (fd_prestat_dir_name(fd, name, pre[1])) continue;
    name[pre[1]] = 0;
    if (same(name, "/")) return fd;
  }
  proc_exit(93);
}
void _start(void) {
  u32 argc = 0, size = 0; char *argv[32]; char args[4096];
  if (args_sizes_get(&argc, &size) || argc > 32 || size > sizeof(args) || args_get(argv, args)) proc_exit(94);
  const char *mode = argc > 1 ? argv[1] : "report";
#ifdef G0_WASIX_CWD
  if (same(mode, "cwd")) { char cwd[256]; u32 size = sizeof(cwd); if (getcwd(cwd, &size)) proc_exit(99); output(1, cwd, size); return; }
#endif
  if (same(mode, "loop")) { text(1, "ready\n"); for (;;) __asm__ volatile(""); }
  if (same(mode, "copy")) { copy(0, 1); return; }
  if (same(mode, "blocked")) { text(1, "ready\n"); copy(0, 1); return; }
  if (same(mode, "exit")) proc_exit(23);
  if (same(mode, "file")) {
    if (argc < 4) proc_exit(95);
    u32 input, out, root = rootfd();
    int error = path_open(root, 0, argv[2], len(argv[2]), 0, 2, 0, 0, &input);
    if (error) { text(2, "path_open input errno="); number(error); proc_exit(96); }
    error = path_open(root, 0, argv[3], len(argv[3]), 9, 64, 0, 0, &out);
    if (error) { text(2, "path_open output errno="); number(error); proc_exit(97); }
    copy(input, out); fd_close(input); fd_close(out); return;
  }
  for (u32 i = 0; i < argc; ++i) { text(1, "arg="); output(1, argv[i], len(argv[i])); output(1, "\0", 1); }
  char *env[64]; char envbytes[8192]; u32 count;
  if (environ_sizes_get(&count, &size) || count > 64 || size > sizeof(envbytes) || environ_get(env, envbytes)) proc_exit(98);
  for (u32 i = 0; i < count; ++i) { if (env[i][0]=='G' && env[i][1]=='0' && env[i][2]=='=') { text(1, env[i]); output(1, "\0", 1); } }
  text(2, "stderr\0"); output(2, "\0\xff\xe2\x82\xac", 5);
}
