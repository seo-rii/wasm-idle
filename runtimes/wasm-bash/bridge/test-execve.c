/* Encoder protocol test, not shell/runtime qualification. */
#include <assert.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int wasm_idle_test_execve(const char *, char *const [], char *const []);
static const char *destination;
static unsigned calls;
int wasm_idle_shell_exec_v1(const char *path, uint32_t path_len,
        const void *argv, uint32_t argv_len, const void *env, uint32_t env_len,
        uint32_t flags) {
    assert(path_len == 14 && memcmp(path, "/usr/bin/probe", 14) == 0);
    assert(flags == 0);
    char file[4096];
    snprintf(file, sizeof(file), "%s/argv-%u.bin", destination, calls);
    FILE *f = fopen(file, "wb"); assert(f);
    assert(fwrite(argv, 1, argv_len, f) == argv_len); assert(fclose(f) == 0);
    snprintf(file, sizeof(file), "%s/env-%u.bin", destination, calls);
    f = fopen(file, "wb"); assert(f);
    assert(fwrite(env, 1, env_len, f) == env_len); assert(fclose(f) == 0);
    ++calls;
    return ENOENT;
}
int main(int argc, char **argv) {
    assert(argc == 2); destination = argv[1];
    char *args[] = {"probe", "", "한글", "line\nbreak", "cr\rx", "", NULL};
    char *env[] = {"EMPTY=", "G0=space 한글\n\ry", NULL};
    assert(wasm_idle_test_execve("/usr/bin/probe", args, env) == -1);
    assert(errno == ENOENT && calls == 1);
    assert(wasm_idle_test_execve("/usr/bin/probe", NULL, NULL) == -1);
    assert(errno == ENOENT && calls == 2);
    char **too_many = calloc(4098, sizeof(char *)); assert(too_many);
    for (unsigned i = 0; i < 4097; ++i) too_many[i] = "";
    assert(wasm_idle_test_execve("/usr/bin/probe", too_many, env) == -1);
    assert(errno == E2BIG && calls == 2); free(too_many);
    char *large = malloc(1024 * 1024 + 1); assert(large);
    memset(large, 'x', 1024 * 1024); large[1024 * 1024] = 0;
    char *large_args[] = {large, NULL};
    assert(wasm_idle_test_execve("/usr/bin/probe", large_args, env) == -1);
    assert(errno == E2BIG && calls == 2); free(large);
    assert(wasm_idle_test_execve("", args, env) == -1);
    assert(errno == EINVAL && calls == 2);
    return 0;
}
