/* Preview1 vectored writes under a real filesystem quota, in snapshot/live Workers.
 * Build command and byte identities are recorded in writev-progress.json.
 * A nonzero exit identifies the source line of the failed assertion.
 */
typedef unsigned int u32;
typedef unsigned long long u64;
typedef struct { const void *ptr; u32 len; } iovec;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(args_sizes_get) u32 args_sizes_get(u32 *, u32 *);
WASI(args_get) u32 args_get(char **, char *);
WASI(path_open) u32 path_open(u32, u32, const char *, u32, u32, u64, u64, u32, u32 *);
WASI(fd_write) u32 fd_write(u32, const iovec *, u32, u32 *);
WASI(fd_pwrite) u32 fd_pwrite(u32, const iovec *, u32, u64, u32 *);
WASI(fd_pread) u32 fd_pread(u32, const iovec *, u32, u64, u32 *);
WASI(fd_seek) u32 fd_seek(u32, long long, u32, u64 *);
WASI(fd_tell) u32 fd_tell(u32, u64 *);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);
__attribute__((import_module("wasm_idle_process_v1"), import_name("initial_cwd"))) int initial_cwd(char *, u32);
#define CHECK(condition) do { if (!(condition)) proc_exit(__LINE__); } while (0)
#define SENTINEL 0xdeadbeefu

static u32 writev(u32 mode, u32 fd, const iovec *parts, u32 length, u64 offset, u32 *written) {
  return mode ? fd_pwrite(fd, parts, length, offset, written) : fd_write(fd, parts, length, written);
}

__attribute__((export_name("_start"))) void _start(void) {
  u32 argc, length, fd, written;
  char *argv[3], args[128], cwd[128], data[8];
  u64 position;
  CHECK(initial_cwd(cwd, sizeof(cwd)) > 0);
  CHECK(!args_sizes_get(&argc, &length) && argc == 2 && length <= sizeof(args));
  CHECK(!args_get(argv, args) && argv[1][1] == 0);
  u32 mode = argv[1][0] - '0';
  CHECK(mode <= 1);
  CHECK(!path_open(3, 1, "file", 4, 0, 2ull | 4ull | 64ull, 0, 0, &fd));
  CHECK(!fd_seek(fd, 1, 0, &position) && position == 1);

  /* A bad later iovec must fail before the first valid one mutates the file. */
  iovec invalid[] = {{"AB", 2}, {(void *)0xfffffff0u, 32}};
  written = SENTINEL;
  CHECK(writev(mode, fd, invalid, 2, 1, &written) == 21 && written == SENTINEL);
  CHECK(!fd_tell(fd, &position) && position == 1);

  /* The first nonempty vector fits, the next exceeds the 4-byte quota. */
  iovec parts[] = {{"", 0}, {"AB", 2}, {"", 0}, {"CD", 2}, {"EF", 2}};
  written = SENTINEL;
  CHECK(!writev(mode, fd, parts, 5, 1, &written) && written == 2);
  CHECK(!fd_tell(fd, &position) && position == (mode ? 1 : 3));
  iovec read = {data, sizeof(data)};
  CHECK(!fd_pread(fd, &read, 1, 0, &length) && length == 3);
  CHECK(data[0] == '_' && data[1] == 'A' && data[2] == 'B');

  /* Retry only the remaining byte that fits, at the reported position. */
  iovec retry = {"C", 1};
  CHECK(!writev(mode, fd, &retry, 1, 1 + written, &length) && length == 1);
  CHECK(!fd_tell(fd, &position) && position == (mode ? 1 : 4));
  CHECK(!fd_pread(fd, &read, 1, 0, &length) && length == 4);
  CHECK(data[0] == '_' && data[1] == 'A' && data[2] == 'B' && data[3] == 'C');

  /* Empty vectors do not turn a zero-progress quota failure into success. */
  iovec full[] = {{"", 0}, {"D", 1}};
  written = SENTINEL;
  CHECK(writev(mode, fd, full, 2, 4, &written) == 51 && written == SENTINEL);
  CHECK(!fd_tell(fd, &position) && position == (mode ? 1 : 4));
  CHECK(!writev(mode, fd, full, 1, 4, &written) && written == 0);
}
