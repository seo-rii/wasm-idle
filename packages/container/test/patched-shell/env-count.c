/* Real freestanding WASI guest for Bash's explicit empty exec environment. */
typedef unsigned int u32;
typedef struct { const void *base; u32 len; } iovec;
#define WASI(name) __attribute__((import_module("wasi_snapshot_preview1"), import_name(#name)))
WASI(environ_sizes_get) int environ_sizes_get(u32 *, u32 *);
WASI(fd_write) int fd_write(u32, const iovec *, u32, u32 *);
WASI(proc_exit) __attribute__((noreturn)) void proc_exit(u32);

static void write_bytes(const char *bytes, u32 size) {
    while (size) {
        iovec io = { bytes, size };
        u32 wrote = 0;
        if (fd_write(1, &io, 1, &wrote) || !wrote || wrote > size) proc_exit(91);
        bytes += wrote;
        size -= wrote;
    }
}

void _start(void) {
    u32 count = 0, size = 0;
    if (environ_sizes_get(&count, &size)) proc_exit(92);
    char number[10];
    u32 offset = sizeof(number);
    do {
        number[--offset] = '0' + count % 10;
        count /= 10;
    } while (count);
    write_bytes("env-count=", 10);
    write_bytes(number + offset, sizeof(number) - offset);
    write_bytes("\n", 1);
}
