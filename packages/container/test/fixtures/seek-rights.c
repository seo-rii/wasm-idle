/* Preview1 descriptor rights, executed by both snapshot and live Workers.
 * Build command and byte identities are recorded in seek-rights.json.
 * A nonzero exit identifies the source line of the failed assertion.
 */
typedef unsigned int u32;
typedef unsigned long long u64;
typedef struct { void *ptr; u32 len; } iovec;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(args_sizes_get) u32 args_sizes_get(u32 *, u32 *);
WASI(args_get) u32 args_get(char **, char *);
WASI(path_open) u32 path_open(u32, u32, const char *, u32, u32, u64, u64, u32, u32 *);
WASI(fd_read) u32 fd_read(u32, const iovec *, u32, u32 *);
WASI(fd_write) u32 fd_write(u32, const iovec *, u32, u32 *);
WASI(fd_pread) u32 fd_pread(u32, const iovec *, u32, u64, u32 *);
WASI(fd_pwrite) u32 fd_pwrite(u32, const iovec *, u32, u64, u32 *);
WASI(fd_seek) u32 fd_seek(u32, long long, u32, u64 *);
WASI(fd_tell) u32 fd_tell(u32, u64 *);
WASI(fd_fdstat_get) u32 fd_fdstat_get(u32, void *);
WASI(fd_fdstat_set_rights) u32 fd_fdstat_set_rights(u32, u64, u64);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);
__attribute__((import_module("wasm_idle_process_v1"), import_name("initial_cwd"))) int initial_cwd(char *, u32);
#define CHECK(condition) do { if (!(condition)) proc_exit(__LINE__); } while (0)
#define READ 2ull
#define SEEK 4ull
#define TELL 32ull
#define WRITE 64ull
#define PATH_OPEN (1ull << 13)
#define NOTCAPABLE 76

__attribute__((export_name("_start"))) void _start(void) {
  u32 argc, length, fd, count;
  char *argv[3], args[128], cwd[128], byte;
  u64 position, stat[3];
  iovec io = { &byte, 1 };
  CHECK(initial_cwd(cwd, sizeof(cwd)) > 0);
  CHECK(!args_sizes_get(&argc, &length) && argc == 2 && length <= sizeof(args));
  CHECK(!args_get(argv, args) && argv[1][1] == 0);
  u32 mode = argv[1][0] - '0';
  CHECK(mode <= 8);
  u64 rights[] = { READ | TELL, WRITE | TELL, SEEK, TELL,
    READ | WRITE | SEEK, READ | WRITE | SEEK | TELL, READ | WRITE | SEEK | TELL, SEEK, TELL };
  CHECK(!path_open(3, 1, "file", 4, 0, rights[mode], 0, 0, &fd));

  if (mode == 0) {
    CHECK(fd_pread(fd, &io, 1, 2, &count) == NOTCAPABLE);
    CHECK(fd_pread(fd, 0, 0, 2, &count) == NOTCAPABLE);
    CHECK(!fd_read(fd, &io, 1, &count) && count == 1 && byte == 'A');
    CHECK(!fd_tell(fd, &position) && position == 1);
    CHECK(!fd_seek(fd, 0, 1, &position) && position == 1);
    CHECK(fd_seek(fd, 0, 0, &position) == NOTCAPABLE);
  } else if (mode == 1) {
    byte = 'Z';
    CHECK(fd_pwrite(fd, &io, 1, 2, &count) == NOTCAPABLE);
    CHECK(fd_pwrite(fd, 0, 0, 2, &count) == NOTCAPABLE);
    CHECK(!fd_write(fd, &io, 1, &count) && count == 1);
    CHECK(!fd_tell(fd, &position) && position == 1);
    CHECK(!fd_seek(fd, 0, 1, &position) && position == 1);
    CHECK(fd_seek(fd, 0, 0, &position) == NOTCAPABLE);
  } else if (mode == 2) {
    CHECK(!fd_seek(fd, 2, 0, &position) && position == 2);
    CHECK(!fd_tell(fd, &position) && position == 2);
    CHECK(!fd_seek(fd, 0, 1, &position) && position == 2);
    CHECK(fd_pread(fd, &io, 1, 0, &count) == NOTCAPABLE);
    CHECK(fd_pwrite(fd, &io, 1, 0, &count) == NOTCAPABLE);
    CHECK(!fd_fdstat_set_rights(fd, 0, 0));
    CHECK(fd_tell(fd, &position) == NOTCAPABLE);
    CHECK(fd_seek(fd, 0, 1, &position) == NOTCAPABLE);
  } else if (mode == 3) {
    CHECK(!fd_tell(fd, &position) && position == 0);
    CHECK(!fd_seek(fd, 0, 1, &position) && position == 0);
    CHECK(fd_seek(fd, 1, 1, &position) == NOTCAPABLE);
    CHECK(fd_seek(fd, 0, 0, &position) == NOTCAPABLE);
    CHECK(fd_seek(fd, 0, 2, &position) == NOTCAPABLE);
    CHECK(fd_pread(fd, &io, 1, 0, &count) == NOTCAPABLE);
    CHECK(fd_pwrite(fd, &io, 1, 0, &count) == NOTCAPABLE);
  } else if (mode == 4) {
    CHECK(!fd_seek(fd, 2, 0, &position) && position == 2);
    CHECK(!fd_pread(fd, &io, 1, 0, &count) && count == 1 && byte == 'A');
    CHECK(!fd_tell(fd, &position) && position == 2);
    byte = 'Z';
    CHECK(!fd_pwrite(fd, &io, 1, 3, &count) && count == 1);
    CHECK(!fd_tell(fd, &position) && position == 2);
    CHECK(!fd_pread(fd, 0, 0, 0, &count) && count == 0);
    CHECK(!fd_pwrite(fd, 0, 0, 0, &count) && count == 0);
    CHECK(!fd_read(fd, &io, 1, &count) && count == 1 && byte == 'C');
    byte = 'Y';
    CHECK(!fd_write(fd, &io, 1, &count) && count == 1);
    CHECK(!fd_tell(fd, &position) && position == 4);
  } else if (mode == 5) {
    CHECK(!fd_seek(fd, 2, 0, &position) && position == 2);
    CHECK(!fd_fdstat_set_rights(fd, READ | WRITE | SEEK, 0));
    CHECK(!fd_tell(fd, &position) && position == 2);
    CHECK(!fd_fdstat_set_rights(fd, READ, 0));
    CHECK(fd_tell(fd, &position) == NOTCAPABLE);
    CHECK(fd_seek(fd, 0, 1, &position) == NOTCAPABLE);
    CHECK(fd_pread(fd, &io, 1, 0, &count) == NOTCAPABLE);
    CHECK(fd_pwrite(fd, &io, 1, 0, &count) == NOTCAPABLE);
    CHECK(!fd_read(fd, &io, 1, &count) && count == 1 && byte == 'C');
  } else if (mode == 6) {
    CHECK(!fd_seek(fd, 2, 0, &position) && position == 2);
    CHECK(!fd_fdstat_set_rights(fd, READ | WRITE | TELL, 0));
    CHECK(!fd_tell(fd, &position) && position == 2);
    CHECK(!fd_seek(fd, 0, 1, &position) && position == 2);
    CHECK(fd_seek(fd, 1, 1, &position) == NOTCAPABLE);
    CHECK(fd_pread(fd, &io, 1, 0, &count) == NOTCAPABLE);
    CHECK(fd_pwrite(fd, &io, 1, 0, &count) == NOTCAPABLE);
    byte = 'Z';
    CHECK(!fd_write(fd, &io, 1, &count) && count == 1);
    CHECK(!fd_fdstat_set_rights(fd, READ | WRITE, 0));
    CHECK(fd_tell(fd, &position) == NOTCAPABLE);
    CHECK(fd_seek(fd, 0, 1, &position) == NOTCAPABLE);
    CHECK(fd_pread(fd, 0, 0, 0, &count) == NOTCAPABLE);
    CHECK(fd_pwrite(fd, 0, 0, 0, &count) == NOTCAPABLE);
    CHECK(!fd_read(fd, &io, 1, &count) && count == 1 && byte == 'D');
  } else if (mode == 7) {
    CHECK(!fd_fdstat_get(fd, stat) && stat[1] == SEEK);
    CHECK(!fd_fdstat_set_rights(fd, TELL, 0));
    CHECK(!fd_fdstat_get(fd, stat) && stat[1] == TELL);
    CHECK(!fd_tell(fd, &position) && position == 0);
    CHECK(!fd_seek(fd, 0, 1, &position) && position == 0);
    CHECK(fd_seek(fd, 0, 0, &position) == NOTCAPABLE);
    CHECK(fd_fdstat_set_rights(fd, SEEK, 0) == NOTCAPABLE);
    CHECK(!fd_fdstat_set_rights(fd, 0, 0));
    CHECK(!fd_fdstat_get(fd, stat) && stat[1] == 0);
    CHECK(fd_tell(fd, &position) == NOTCAPABLE);
    CHECK(fd_seek(fd, 0, 1, &position) == NOTCAPABLE);
  } else {
    CHECK(!fd_fdstat_set_rights(3, PATH_OPEN, SEEK));
    CHECK(!path_open(3, 1, "file", 4, 0, TELL, 0, 0, &fd));
    CHECK(!fd_tell(fd, &position) && position == 0);
    CHECK(!fd_seek(fd, 0, 1, &position) && position == 0);
    CHECK(fd_seek(fd, 0, 0, &position) == NOTCAPABLE);
    CHECK(path_open(3, 1, "file", 4, 0, READ, 0, 0, &fd) == NOTCAPABLE);
    CHECK(!fd_fdstat_set_rights(3, PATH_OPEN, TELL));
    CHECK(!path_open(3, 1, "file", 4, 0, TELL, 0, 0, &fd));
    CHECK(path_open(3, 1, "file", 4, 0, SEEK, 0, 0, &fd) == NOTCAPABLE);
  }
}
