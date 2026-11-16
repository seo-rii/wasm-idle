// Host for the unmodified upstream Squirrel VM and standard libraries.
#include <stdio.h>
#include <stdarg.h>
#include <errno.h>
#include <squirrel.h>
#include <sqstdblob.h>
#include <sqstdio.h>
#include <sqstdsystem.h>
#include <sqstdmath.h>
#include <sqstdstring.h>
#include <sqstdaux.h>

// WASI has no child processes. Preserve libc's unavailable-command result.
extern "C" int system(const char *command) {
    if (!command) return 0;
    errno = ENOSYS;
    return -1;
}

static void output(HSQUIRRELVM, const SQChar *format, ...) {
    va_list args;
    va_start(args, format);
    vfprintf(stdout, format, args);
    va_end(args);
}

static void error(HSQUIRRELVM, const SQChar *format, ...) {
    va_list args;
    va_start(args, format);
    vfprintf(stderr, format, args);
    va_end(args);
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fputs("usage: squirrel <script.nut>\n", stderr);
        return 2;
    }
    setvbuf(stdin, nullptr, _IONBF, 0);
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    HSQUIRRELVM vm = sq_open(1024);
    sq_setprintfunc(vm, output, error);
    sq_pushroottable(vm);
    sqstd_register_bloblib(vm);
    sqstd_register_iolib(vm);
    sqstd_register_systemlib(vm);
    sqstd_register_mathlib(vm);
    sqstd_register_stringlib(vm);
    sqstd_seterrorhandlers(vm);
    SQRESULT result = sqstd_loadfile(vm, argv[1], SQTrue);
    if (SQ_SUCCEEDED(result)) {
        sq_pushroottable(vm);
        result = sq_call(vm, 1, SQFalse, SQTrue);
    }
    sq_close(vm);
    return SQ_SUCCEEDED(result) ? 0 : 1;
}
