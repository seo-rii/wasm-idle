/* Bash/WASIX libc compatibility: initialize its legacy relative-path cwd.
 * The pinned libc's getcwd reads the host cwd, while open uses a separate
 * legacy cwd initialized to "/". Its chdir updates both states.
 * Keep this separate from the lossless execve ABI encoder. */
#include <stdlib.h>
#include <unistd.h>

static _Noreturn void startup_cwd_failed(void) {
    static const char message[] = "wasm-idle bash: unable to initialize cwd\n";
    size_t offset = 0;
    while (offset < sizeof(message) - 1) {
        size_t remaining = sizeof(message) - 1 - offset;
        ssize_t written = write(STDERR_FILENO, message + offset, remaining);
        if (written <= 0 || (size_t)written > remaining) break;
        offset += (size_t)written;
    }
    _Exit(125);
}

/* The pinned CRT initializes TLS, then runs constructors before main. Its
 * preopen constructor has priority 51; the ordinary final priority follows it.
 * Read the actual host cwd rather than PWD, argv or a hard-coded mount path. */
__attribute__((constructor(65535)))
static void wasm_idle_shell_initialize_cwd(void) {
    char *cwd = getcwd(NULL, 0);
    if (!cwd) startup_cwd_failed();
    int result = chdir(cwd);
    free(cwd);
    if (result != 0) startup_cwd_failed();
}
