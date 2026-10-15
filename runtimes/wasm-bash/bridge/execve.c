/* Optional real-Bash link-time execve override; upstream parsing is unchanged.
 * ABI prototype only: do not distribute until the patched SDK/browser gate passes. */
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define LIMIT (1024U * 1024U)
#define MAX_STRINGS 4096U
#ifdef __wasm__
__attribute__((import_module("wasm_idle_shell_v1"), import_name("exec_v1")))
#endif
extern int wasm_idle_shell_exec_v1(const char *, uint32_t, const void *, uint32_t,
                                 const void *, uint32_t, uint32_t);

static void put32(unsigned char *out, uint32_t value) {
    for (unsigned i = 0; i < 4; ++i) out[i] = (unsigned char)(value >> (i * 8));
}

static unsigned char *frame(char *const values[], uint32_t *size) {
    uint32_t count = 0, total = 4;
    if (values) {
        while (values[count]) {
            if (count == MAX_STRINGS) { errno = E2BIG; return NULL; }
            size_t len = strlen(values[count]);
            if (len > LIMIT - total || len + 4 > LIMIT - total) {
                errno = E2BIG; return NULL;
            }
            total += 4 + (uint32_t)len;
            ++count;
        }
    }
    unsigned char *out = malloc(total);
    if (!out) { errno = ENOMEM; return NULL; }
    put32(out, count);
    uint32_t offset = 4;
    for (uint32_t i = 0; i < count; ++i) {
        uint32_t len = (uint32_t)strlen(values[i]);
        put32(out + offset, len);
        memcpy(out + offset + 4, values[i], len);
        offset += 4 + len;
    }
    *size = total;
    return out;
}

#ifdef WASM_IDLE_SHELL_EXEC_TEST
#define execve wasm_idle_test_execve
#endif
int execve(const char *path, char *const argv[], char *const envp[]) {
    size_t path_len = strlen(path);
    if (!path_len || path_len > 4096) { errno = EINVAL; return -1; }
    uint32_t argv_len, env_len;
    unsigned char *argv_frame = frame(argv, &argv_len);
    if (!argv_frame) return -1;
    unsigned char *env_frame = frame(envp, &env_len);
    if (!env_frame) { free(argv_frame); return -1; }
    if (path_len + argv_len + env_len > LIMIT) {
        free(argv_frame); free(env_frame); errno = E2BIG; return -1;
    }
    /* flags=0 means the provided environment completely replaces the parent. */
    int error = wasm_idle_shell_exec_v1(path, (uint32_t)path_len,
        argv_frame, argv_len, env_frame, env_len, 0);
    free(argv_frame);
    free(env_frame);
    /* A successful exec transfers control; an ordinary zero return is invalid. */
    errno = error ? error : EIO;
    return -1;
}
