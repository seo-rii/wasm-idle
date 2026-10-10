/* WASI has no child processes. The browser selects bfi interpreter mode, so
 * upstream bfc's compiler-only system() call is never used by the runtime. */
#include <errno.h>
#include <stdlib.h>

int system(const char *command)
{
    if (command == NULL) {
        return 0;
    }
    errno = ENOSYS;
    return -1;
}
