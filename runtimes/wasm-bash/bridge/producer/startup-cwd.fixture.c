/* Native constructor/cleanup unit fixture. Not a Bash or WASIX guest. */
#include <assert.h>
#include <errno.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

static const char requested_cwd[] = "/workspace/space 한글";
static const char diagnostic[] = "wasm-idle bash: unable to initialize cwd\n";
static const char *scenario;
static unsigned stage, frees;
static size_t diagnostic_offset;

/* Use the first unreserved native priority to model initialization that must
 * precede the producer's final-priority constructor. */
__attribute__((constructor(101)))
static void fixture_initialize(void) {
    scenario = getenv("STARTUP_CWD_FIXTURE_CASE");
    assert(scenario);
    stage = 1;
}

char *__wrap_getcwd(char *buffer, size_t size) {
    assert(stage == 1 && buffer == NULL && size == 0);
    stage = 2;
    if (strcmp(scenario, "getcwd-error") == 0) {
        errno = ENOENT;
        return NULL;
    }
    return (char *)requested_cwd;
}

int __wrap_chdir(const char *path) {
    assert(stage == 2 && strcmp(path, requested_cwd) == 0);
    stage = 3;
    if (strcmp(scenario, "success") == 0) return 0;
    errno = EACCES;
    return -1;
}

void __wrap_free(void *value) {
    assert(stage == 3 && value == requested_cwd && frees == 0);
    ++frees;
    stage = 4;
}

ssize_t __real_write(int, const void *, size_t);
ssize_t __wrap_write(int fd, const void *bytes, size_t length) {
    assert(fd == STDERR_FILENO && stage != 1);
    assert(length == sizeof(diagnostic) - 1 - diagnostic_offset);
    assert(memcmp(bytes, diagnostic + diagnostic_offset, length) == 0);
    if (strcmp(scenario, "zero-diagnostic") == 0) return 0;
    if (strcmp(scenario, "closed-diagnostic") == 0) {
        errno = EPIPE;
        return -1;
    }
    if (strcmp(scenario, "partial-diagnostic") == 0 && length > 3) length = 3;
    ssize_t written = __real_write(fd, bytes, length);
    assert(written == (ssize_t)length);
    diagnostic_offset += length;
    return written;
}

_Noreturn void __wrap__Exit(int code) {
    assert(code == 125);
    if (strcmp(scenario, "getcwd-error") == 0) assert(stage == 2 && frees == 0);
    else assert(stage == 4 && frees == 1);
    _exit(code);
}

int main(int argc, char **argv) {
    assert(strcmp(scenario, "success") == 0 && stage == 4 && frees == 1);
    assert(argc == 4 && strcmp(argv[1], "space arg") == 0);
    assert(strcmp(argv[2], "한글") == 0 && strcmp(argv[3], "") == 0);
    puts("main-after-cwd");
    return 0;
}
