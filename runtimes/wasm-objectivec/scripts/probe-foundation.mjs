#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	loadRuntimeManifest,
	resolveRuntimeAssetUrls,
	resolveRuntimeManifestUrl
} from 'wasm-clang';
import App from '../../wasm-clang/dist/app.js';
import { MemFS } from '../../wasm-clang/dist/memory/index.js';
import { compile } from '../../wasm-clang/dist/wasm.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(RUNTIME_ROOT, '..', '..');
const CACHE_ROOT =
	process.env.WASM_IDLE_OBJECTIVEC_CACHE_DIR ||
	path.join(os.tmpdir(), 'wasm-idle-objectivec-runtime');
const FOUNDATION_CACHE_ROOT =
	process.env.WASM_IDLE_OBJECTIVEC_FOUNDATION_CACHE_DIR ||
	path.join(os.tmpdir(), 'wasm-idle-objectivec-foundation');
const LIBOBJC2_DIR = path.join(CACHE_ROOT, 'libobjc2');
const LIBS_BASE_DIR = path.join(FOUNDATION_CACHE_ROOT, 'libs-base');
const LIBFFI_DIR = path.join(FOUNDATION_CACHE_ROOT, 'libffi');
const BUILD_DIR = path.join(FOUNDATION_CACHE_ROOT, 'build');
const OBJECT_DIR = path.join(BUILD_DIR, 'obj');
const STATIC_DIR = path.join(REPO_ROOT, 'static', 'wasm-objectivec');
const CLANG_BASE_URL = pathToFileURL(path.join(REPO_ROOT, 'static', 'clang') + path.sep);
const CLANG_MANIFEST_URL = resolveRuntimeManifestUrl(CLANG_BASE_URL);

const LIBOBJC2_URL = 'https://github.com/gnustep/libobjc2.git';
const LIBOBJC2_REF = 'v2.3';
const LIBS_BASE_URL = 'https://github.com/gnustep/libs-base.git';
const LIBS_BASE_REF = 'base-1_31_1';
const LIBFFI_URL = 'https://github.com/libffi/libffi.git';
const LIBFFI_REF = 'v3.6.0';
const installedMemfsDirectories = new Set();
const installedMemfsFiles = new Set();
const installedMemfsFileOrder = [];
const textEncoder = new TextEncoder();
const traceHeaders = process.env.WASM_IDLE_OBJECTIVEC_FOUNDATION_TRACE_HEADERS === '1';
const useLibffi = process.env.WASM_IDLE_OBJECTIVEC_FOUNDATION_USE_LIBFFI === '1';
const buildArchive = process.argv.includes('--build-archive');
const prelinkExisting = process.argv.includes('--prelink-existing');

const selectedSource = process.argv.find((arg) => arg.endsWith('.m')) || 'NSObjCRuntime.m';
const excludedArchiveSources = new Set([
	'callframe.m',
	'GSFFCallInvocation.m',
	'libgnustep-base-entry.m',
	'win32-entry.m',
	'NSKeyValueObserving.m',
	'GSAvahiClient.m',
	'GSAvahiNetService.m',
	'GSAvahiNetServiceBrowser.m',
	'GSAvahiRunLoopIntegration.m',
	'GSMDNSNetServices.m',
	'NSURLSession.m',
	'NSURLSessionTask.m',
	'NSURLSessionConfiguration.m'
]);
const extraArchiveSources = [
	'Source/Additions/GSObjCRuntime.m',
	'Source/Additions/Unicode.m',
	'Source/Additions/NSDebug+GNUstepBase.m',
	'Source/Additions/NSProcessInfo+GNUstepBase.m',
	'Source/Additions/GSMime.m',
	'Source/Additions/GSInsensitiveDictionary.m',
	'NSNotificationQueue.m',
	'Source/unix/GSRunLoopCtxt.m',
	'Source/unix/NSStream.m'
];
const foundationHeaderShimPaths = [
	'config.h',
	'GSConfig.h',
	'GNUstepBase/config.h',
	'GNUstepBase/GSConfig.h',
	'GNUstepBase/preface.h',
	'objc/blocks_runtime.h',
	'Block.h',
	'blocks_runtime.h',
	'dispatch/dispatch.h',
	'stdarg.h',
	'stddef.h',
	'stdbool.h',
	'stdint.h',
	'inttypes.h',
	'limits.h',
	'ctype.h',
	'errno.h',
	'math.h'
];
const libffiArchiveSources = ['src/prep_cif.c', 'src/types.c', 'src/wasm/ffi.c'];

const baseConfigHeader = `#pragma once
#define _POSIX_VERSION 200809L
#define GNUSTEP_TARGET_DIR "wasm32-wasi"
#define GNUSTEP_TARGET_CPU "wasm32"
#define GNUSTEP_TARGET_OS "wasi"
#define GNUSTEP_TARGET_CONFIG_FILE "/GNUstep.conf"
#define GNUSTEP_TARGET_USER_CONFIG_FILE ".GNUstep.conf"
#define GNUSTEP_TARGET_MAKEFILES "/System/Library/Makefiles"
#define GNUSTEP_TARGET_USER_DEFAULTS_DIR "Defaults"
#define GNUSTEP_TARGET_USER_DIR_APPS "Applications"
#define GNUSTEP_TARGET_USER_DIR_ADMIN_APPS "Applications/Admin"
#define GNUSTEP_TARGET_USER_DIR_WEB_APPS "Applications/Web"
#define GNUSTEP_TARGET_USER_DIR_TOOLS "Tools"
#define GNUSTEP_TARGET_USER_DIR_ADMIN_TOOLS "Tools/Admin"
#define GNUSTEP_TARGET_USER_DIR_LIBRARY "Library"
#define GNUSTEP_TARGET_USER_DIR_LIBRARIES "Library/Libraries"
#define GNUSTEP_TARGET_USER_DIR_HEADERS "Library/Headers"
#define GNUSTEP_TARGET_USER_DIR_DOC "Library/Documentation"
#define GNUSTEP_TARGET_USER_DIR_DOC_MAN "Library/Documentation/man"
#define GNUSTEP_TARGET_USER_DIR_DOC_INFO "Library/Documentation/info"
#define GNUSTEP_TARGET_SYSTEM_USERS_DIR "/System/Users"
#define GNUSTEP_TARGET_NETWORK_USERS_DIR "/Network/Users"
#define GNUSTEP_TARGET_LOCAL_USERS_DIR "/Local/Users"
#define GNUSTEP_TARGET_SYSTEM_APPS "/System/Applications"
#define GNUSTEP_TARGET_SYSTEM_ADMIN_APPS "/System/Applications/Admin"
#define GNUSTEP_TARGET_SYSTEM_WEB_APPS "/System/Applications/Web"
#define GNUSTEP_TARGET_SYSTEM_TOOLS "/System/Tools"
#define GNUSTEP_TARGET_SYSTEM_ADMIN_TOOLS "/System/Tools/Admin"
#define GNUSTEP_TARGET_SYSTEM_LIBRARY "/System/Library"
#define GNUSTEP_TARGET_SYSTEM_LIBRARIES "/System/Library/Libraries"
#define GNUSTEP_TARGET_SYSTEM_HEADERS "/System/Library/Headers"
#define GNUSTEP_TARGET_SYSTEM_DOC "/System/Library/Documentation"
#define GNUSTEP_TARGET_SYSTEM_DOC_MAN "/System/Library/Documentation/man"
#define GNUSTEP_TARGET_SYSTEM_DOC_INFO "/System/Library/Documentation/info"
#define GNUSTEP_TARGET_NETWORK_APPS "/Network/Applications"
#define GNUSTEP_TARGET_NETWORK_ADMIN_APPS "/Network/Applications/Admin"
#define GNUSTEP_TARGET_NETWORK_WEB_APPS "/Network/Applications/Web"
#define GNUSTEP_TARGET_NETWORK_TOOLS "/Network/Tools"
#define GNUSTEP_TARGET_NETWORK_ADMIN_TOOLS "/Network/Tools/Admin"
#define GNUSTEP_TARGET_NETWORK_LIBRARY "/Network/Library"
#define GNUSTEP_TARGET_NETWORK_LIBRARIES "/Network/Library/Libraries"
#define GNUSTEP_TARGET_NETWORK_HEADERS "/Network/Library/Headers"
#define GNUSTEP_TARGET_NETWORK_DOC "/Network/Library/Documentation"
#define GNUSTEP_TARGET_NETWORK_DOC_MAN "/Network/Library/Documentation/man"
#define GNUSTEP_TARGET_NETWORK_DOC_INFO "/Network/Library/Documentation/info"
#define GNUSTEP_TARGET_LOCAL_APPS "/Local/Applications"
#define GNUSTEP_TARGET_LOCAL_ADMIN_APPS "/Local/Applications/Admin"
#define GNUSTEP_TARGET_LOCAL_WEB_APPS "/Local/Applications/Web"
#define GNUSTEP_TARGET_LOCAL_TOOLS "/Local/Tools"
#define GNUSTEP_TARGET_LOCAL_ADMIN_TOOLS "/Local/Tools/Admin"
#define GNUSTEP_TARGET_LOCAL_LIBRARY "/Local/Library"
#define GNUSTEP_TARGET_LOCAL_LIBRARIES "/Local/Library/Libraries"
#define GNUSTEP_TARGET_LOCAL_HEADERS "/Local/Library/Headers"
#define GNUSTEP_TARGET_LOCAL_DOC "/Local/Library/Documentation"
#define GNUSTEP_TARGET_LOCAL_DOC_MAN "/Local/Library/Documentation/man"
#define GNUSTEP_TARGET_LOCAL_DOC_INFO "/Local/Library/Documentation/info"
#define HAVE_DIRENT_H 1
#define HAVE_DISPATCH_DISPATCH_H 1
#define HAVE_DISPATCH_CANCEL 1
#define HAVE_FCNTL_H 1
#define HAVE_FLOAT_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_LIMITS_H 1
#define HAVE_MALLOC_H 1
#define HAVE_MEMORY_H 1
#define HAVE_SIGNAL_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRING_H 1
#define HAVE_STRINGS_H 1
#define HAVE_SYS_PARAM_H 1
#define HAVE_SYS_SOCKET_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_SYS_TIME_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_SYS_WAIT_H 1
#define HAVE_TIME_H 1
#define HAVE_UNISTD_H 1
#define HAVE_UTIME_H 1
#define STDC_HEADERS 1
#define SIZEOF_SHORT 2
#define SIZEOF_INT 4
#define SIZEOF_LONG 4
#define SIZEOF_LONG_LONG 8
#define SIZEOF_FLOAT 4
#define SIZEOF_DOUBLE 8
#define SIZEOF_VOIDP 4
#define VASPRINTF_RETURNS_LENGTH 1
#define VSPRINTF_RETURNS_LENGTH 1
${useLibffi ? '#define USE_LIBFFI 1\n#define HAVE_FFI_PREP_CLOSURE_LOC 1\n' : ''}
`;

const gsConfigHeader = `#pragma once
#include <stdint.h>
#define GS_PASS_ARGUMENTS 0
#define GS_FAKE_MAIN 0
#define GS_WINAPI
#define GS_USE_WIN32_THREADS_AND_LOCKS 0
#define GS_USE_LIBDISPATCH 0
#define GS_USE_LIBDISPATCH_RUNLOOP 0
#define GS_HAVE_NSURLSESSION 1
#define GS_WORDS_BIGENDIAN 0
#define GS_SIZEOF_SHORT 2
#define GS_SIZEOF_INT 4
#define GS_SIZEOF_LONG 4
#define GS_SIZEOF_LONG_LONG 8
#define GS_SIZEOF_FLOAT 4
#define GS_SIZEOF_DOUBLE 8
#define GS_SIZEOF_VOIDP 4
#define _GSC_S_SHT 0
#define _GSC_S_INT 1
#define _GSC_S_LNG 2
#define _GSC_S_LNG_LNG 3
typedef int8_t gss8;
typedef uint8_t gsu8;
typedef int16_t gss16;
typedef uint16_t gsu16;
typedef int32_t gss32;
typedef uint32_t gsu32;
typedef int64_t gss64;
typedef uint64_t gsu64;
typedef __int128_t gss128;
typedef __uint128_t gsu128;
typedef float gsf32;
typedef double gsf64;
typedef uintptr_t gsaddr;
typedef struct { char storage[64]; } gs_cond_public_t;
typedef struct { char storage[64]; } gs_mutex_public_t;
#define GS_HAVE_I64 1
#define GS_HAVE_I128 1
#define GSNativeChar char
#define UTF32Char uint32_t
#define USE_ZLIB 0
#define USE_GMP 0
#define NXConstantString NSConstantString
#define GS_WITH_GC 0
`;

const shimFiles = {
	'config.h': baseConfigHeader,
	'GSConfig.h': gsConfigHeader,
	'GNUstepBase/config.h': baseConfigHeader,
	'GNUstepBase/GSConfig.h': gsConfigHeader,
	'GNUstepBase/preface.h': `#pragma once
#include <stdlib.h>
#include <stdarg.h>
#define GNUSTEP_BASE_VERSION 13101
#define GNUSTEP_BASE_MAJOR_VERSION 1
#define GNUSTEP_BASE_MINOR_VERSION 31
#define GNUSTEP_BASE_SUBMINOR_VERSION 1
#define GNUSTEP_BASE_GCC_VERSION 0
#include <objc/objc.h>
#include <objc/objc-class.h>
#include <objc/objc-runtime.h>
#define VSPRINTF_LENGTH(VSPF_CALL) (VSPF_CALL)
#define VASPRINTF_LENGTH(VASPF_CALL) (VASPF_CALL)
#ifndef MAX
#define MAX(a,b) ((a) > (b) ? (a) : (b))
#endif
#ifndef MIN
#define MIN(a,b) ((a) < (b) ? (a) : (b))
#endif
#ifndef ABS
#define ABS(a) ((a) < 0 ? -(a) : (a))
#endif
#ifndef STRINGIFY
#define STRINGIFY(s) XSTRINGIFY(s)
#define XSTRINGIFY(s) #s
#endif
#ifndef OBJC_STRINGIFY
#define OBJC_STRINGIFY(s) @STRINGIFY(s)
#endif
#define assert(expr) ((void)0)
#define GSNOSUPERDEALLOC return
#define GS_UNREACHABLE() __builtin_unreachable()
`,
	'dynamic-load.h': '#pragma once\n#include "null-load.h"\n',
	'objc/objc-config.h': '#pragma once\n',
	'objc/blocks_runtime.h': `#pragma once
void *_Block_copy(const void *);
void _Block_release(const void *);
#define Block_copy(block) _Block_copy(block)
#define Block_release(block) _Block_release(block)
`,
	'Block.h': `#pragma once
void *_Block_copy(const void *);
void _Block_release(const void *);
#define Block_copy(block) _Block_copy(block)
#define Block_release(block) _Block_release(block)
`,
	'blocks_runtime.h': `#pragma once
void *_Block_copy(const void *);
void _Block_release(const void *);
#define Block_copy(block) _Block_copy(block)
#define Block_release(block) _Block_release(block)
`,
	'pthread.h': `#pragma once
#include <time.h>
typedef int pthread_t;
typedef int pthread_key_t;
typedef int pthread_cond_t;
typedef int pthread_mutex_t;
typedef int pthread_mutexattr_t;
typedef int pthread_attr_t;
#define PTHREAD_MUTEX_NORMAL 0
#define PTHREAD_MUTEX_ERRORCHECK 1
#define PTHREAD_MUTEX_RECURSIVE 1
#define PTHREAD_MUTEX_INITIALIZER 0
#define PTHREAD_CREATE_DETACHED 1
static inline int pthread_mutex_init(pthread_mutex_t *m, const pthread_mutexattr_t *a) { (void)a; *m = 0; return 0; }
static inline int pthread_mutex_lock(pthread_mutex_t *m) { (void)m; return 0; }
static inline int pthread_mutex_trylock(pthread_mutex_t *m) { (void)m; return 0; }
static inline int pthread_mutex_unlock(pthread_mutex_t *m) { (void)m; return 0; }
static inline int pthread_mutex_destroy(pthread_mutex_t *m) { (void)m; return 0; }
static inline int pthread_mutexattr_init(pthread_mutexattr_t *a) { *a = 0; return 0; }
static inline int pthread_mutexattr_settype(pthread_mutexattr_t *a, int type) { (void)a; (void)type; return 0; }
static inline int pthread_mutexattr_destroy(pthread_mutexattr_t *a) { (void)a; return 0; }
static inline int pthread_cond_init(pthread_cond_t *c, const void *a) { (void)a; *c = 0; return 0; }
static inline int pthread_cond_wait(pthread_cond_t *c, pthread_mutex_t *m) { (void)c; (void)m; return 0; }
static inline int pthread_cond_timedwait(pthread_cond_t *c, pthread_mutex_t *m, const struct timespec *t) { (void)c; (void)m; (void)t; return 0; }
static inline int pthread_cond_signal(pthread_cond_t *c) { (void)c; return 0; }
static inline int pthread_cond_broadcast(pthread_cond_t *c) { (void)c; return 0; }
static inline int pthread_cond_destroy(pthread_cond_t *c) { (void)c; return 0; }
static inline int pthread_key_create(pthread_key_t *key, void (*destructor)(void *)) { static int next = 1; (void)destructor; *key = next++; return 0; }
static inline void *pthread_getspecific(pthread_key_t key) { (void)key; return 0; }
static inline int pthread_setspecific(pthread_key_t key, const void *value) { (void)key; (void)value; return 0; }
static inline pthread_t pthread_self(void) { return 1; }
static inline int pthread_equal(pthread_t left, pthread_t right) { return left == right; }
static inline int pthread_attr_init(pthread_attr_t *a) { *a = 0; return 0; }
static inline int pthread_attr_setdetachstate(pthread_attr_t *a, int state) { (void)a; (void)state; return 0; }
static inline int pthread_attr_setstacksize(pthread_attr_t *a, size_t size) { (void)a; (void)size; return 0; }
static inline int pthread_attr_destroy(pthread_attr_t *a) { (void)a; return 0; }
static inline int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start)(void *), void *arg) { (void)attr; (void)start; (void)arg; *thread = 1; return -1; }
static inline void pthread_exit(void *value) { (void)value; }
static inline int sched_yield(void) { return 0; }
`,
	'stdarg.h': `#pragma once
typedef __builtin_va_list va_list;
#define va_start(ap, param) __builtin_va_start(ap, param)
#define va_end(ap) __builtin_va_end(ap)
#define va_arg(ap, type) __builtin_va_arg(ap, type)
#define va_copy(dest, src) __builtin_va_copy(dest, src)
`,
	'stddef.h': `#pragma once
#define NULL ((void *)0)
typedef __SIZE_TYPE__ size_t;
typedef __PTRDIFF_TYPE__ ptrdiff_t;
typedef __WCHAR_TYPE__ wchar_t;
#define offsetof(type, member) __builtin_offsetof(type, member)
`,
	'stdbool.h': `#pragma once
#define bool _Bool
#define true 1
#define false 0
`,
	'stdatomic.h': `#pragma once
#define memory_order_relaxed __ATOMIC_RELAXED
#define memory_order_consume __ATOMIC_CONSUME
#define memory_order_acquire __ATOMIC_ACQUIRE
#define memory_order_release __ATOMIC_RELEASE
#define memory_order_acq_rel __ATOMIC_ACQ_REL
#define memory_order_seq_cst __ATOMIC_SEQ_CST
#define atomic_fetch_add(object, operand) __c11_atomic_fetch_add((object), (operand), __ATOMIC_SEQ_CST)
#define atomic_fetch_sub(object, operand) __c11_atomic_fetch_sub((object), (operand), __ATOMIC_SEQ_CST)
`,
	'stdint.h': `#pragma once
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef __INTPTR_TYPE__ intptr_t;
typedef __UINTPTR_TYPE__ uintptr_t;
typedef long long intmax_t;
typedef unsigned long long uintmax_t;
#define INT8_MAX 127
#define INT8_MIN (-128)
#define UINT8_MAX 255
#define INT16_MIN (-32768)
#define INT16_MAX 32767
#define UINT16_MAX 65535
#define INT32_MIN (-2147483647 - 1)
#define INT32_MAX 2147483647
#define UINT32_MAX 4294967295U
#define INT64_MIN (-9223372036854775807LL - 1LL)
#define INT64_MAX 9223372036854775807LL
#define UINT64_MAX 18446744073709551615ULL
#define INTPTR_MIN (-2147483647 - 1)
#define INTPTR_MAX 2147483647
#define UINTPTR_MAX 4294967295U
`,
	'inttypes.h': `#pragma once
#include <stdint.h>
#define PRIdPTR "ld"
#define PRIu64 "llu"
#define PRIuPTR "lu"
#define PRIxPTR "lx"
`,
	'limits.h': `#pragma once
#define CHAR_BIT 8
#define SCHAR_MIN (-128)
#define SCHAR_MAX 127
#define UCHAR_MAX 255
#define CHAR_MIN SCHAR_MIN
#define CHAR_MAX SCHAR_MAX
#define SHRT_MIN (-32768)
#define SHRT_MAX 32767
#define USHRT_MAX 65535
#define INT_MIN (-2147483647 - 1)
#define INT_MAX 2147483647
#define UINT_MAX 4294967295U
#define LONG_MIN (-2147483647L - 1L)
#define LONG_MAX 2147483647L
#define ULONG_MAX 4294967295UL
#define LLONG_MIN (-9223372036854775807LL - 1LL)
#define LLONG_MAX 9223372036854775807LL
#define ULLONG_MAX 18446744073709551615ULL
#define PATH_MAX 1024
#define MAXPATHLEN PATH_MAX
#define MAXSYMLINKS 8
`,
	'stdlib.h': `#pragma once
#include <stddef.h>
#define NULL ((void *)0)
void *malloc(size_t);
void *calloc(size_t, size_t);
void *realloc(void *, size_t);
void free(void *);
void abort(void);
void exit(int);
char *getenv(const char *);
int atoi(const char *);
long atol(const char *);
long strtol(const char *, char **, int);
unsigned long strtoul(const char *, char **, int);
long long atoll(const char *);
long long strtoll(const char *, char **, int);
unsigned long long strtoull(const char *, char **, int);
double strtod(const char *, char **);
char *mktemp(char *);
#define alloca(size) __builtin_alloca(size)
`,
	'malloc.h': `#pragma once
#include <stdlib.h>
`,
	'alloca.h': `#pragma once
#define alloca(size) __builtin_alloca(size)
`,
	'string.h': `#pragma once
#include <stddef.h>
void *memcpy(void *, const void *, size_t);
void *memmove(void *, const void *, size_t);
void *memset(void *, int, size_t);
int memcmp(const void *, const void *, size_t);
char *strcpy(char *, const char *);
char *strncpy(char *, const char *, size_t);
char *strcat(char *, const char *);
char *strncat(char *, const char *, size_t);
char *strchr(const char *, int);
char *strrchr(const char *, int);
int strcmp(const char *, const char *);
int strncmp(const char *, const char *, size_t);
size_t strlen(const char *);
`,
	'strings.h': `#pragma once
#include <string.h>
int strcasecmp(const char *, const char *);
int strncasecmp(const char *, const char *, size_t);
`,
	'errno.h': `#pragma once
extern int errno;
#define EPERM 1
#define ENOENT 2
#define ESRCH 3
#define EINTR 4
#define EIO 5
#define ENXIO 6
#define E2BIG 7
#define ENOEXEC 8
#define EBADF 9
#define ECHILD 10
#define EAGAIN 11
#define EALREADY 114
#define ENOMEM 12
#define EACCES 13
#define EFAULT 14
#define EBUSY 16
#define EEXIST 17
#define EXDEV 18
#define ENODEV 19
#define ENOTDIR 20
#define EISDIR 21
#define EINVAL 22
#define ENFILE 23
#define EMFILE 24
#define ENOTTY 25
#define EFBIG 27
#define ENOSPC 28
#define ESPIPE 29
#define EROFS 30
#define EMLINK 31
#define EPIPE 32
#define EDOM 33
#define EINPROGRESS 115
#define EDEADLK 45
#define ERANGE 34
#define ENAMETOOLONG 36
#define ENOSYS 38
#define ENOTEMPTY 39
#define ELOOP 40
#define ENOTSOCK 88
#define EDESTADDRREQ 89
#define EMSGSIZE 90
#define EPROTOTYPE 91
#define ENOPROTOOPT 92
#define EPROTONOSUPPORT 93
#define EOPNOTSUPP 95
#define EAFNOSUPPORT 97
#define EADDRINUSE 98
#define EADDRNOTAVAIL 99
#define ENETDOWN 100
#define ENETUNREACH 101
#define ECONNABORTED 103
#define ECONNRESET 104
#define ENOBUFS 105
#define EISCONN 106
#define ENOTCONN 107
#define ETIMEDOUT 110
#define ECONNREFUSED 111
`,
	'stdio.h': `#pragma once
#include <stdarg.h>
#include <stddef.h>
#include <sys/types.h>
typedef struct FILE FILE;
extern FILE *stdin;
extern FILE *stdout;
extern FILE *stderr;
#define BUFSIZ 1024
#define EOF (-1)
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2
int printf(const char *, ...);
int fprintf(FILE *, const char *, ...);
int fscanf(FILE *, const char *, ...);
int sprintf(char *, const char *, ...);
int sscanf(const char *, const char *, ...);
int vfprintf(FILE *, const char *, va_list);
int snprintf(char *, size_t, const char *, ...);
int vsnprintf(char *, size_t, const char *, va_list);
int fflush(FILE *);
FILE *fopen(const char *, const char *);
int fclose(FILE *);
int fileno(FILE *);
char *fgets(char *, int, FILE *);
void clearerr(FILE *);
int ferror(FILE *);
size_t fread(void *, size_t, size_t, FILE *);
size_t fwrite(const void *, size_t, size_t, FILE *);
int fseeko(FILE *, off_t, int);
off_t ftello(FILE *);
int rename(const char *, const char *);
`,
	'unistd.h': `#pragma once
#include <stddef.h>
#include <sys/types.h>
int close(int);
int dup(int);
int dup2(int, int);
int unlink(const char *);
int access(const char *, int);
int chdir(const char *);
int chown(const char *, uid_t, gid_t);
int rmdir(const char *);
uid_t geteuid(void);
uid_t getuid(void);
pid_t getpid(void);
char *getcwd(char *, size_t);
char *getwd(char *);
ssize_t readlink(const char *, char *, size_t);
ssize_t read(int, void *, size_t);
ssize_t write(int, const void *, size_t);
off_t lseek(int, off_t, int);
int ftruncate(int, off_t);
void sync(void);
unsigned int sleep(unsigned int);
int pipe(int[2]);
long sysconf(int);
pid_t fork(void);
int execve(const char *, char *const[], char *const[]);
void _exit(int);
#define F_OK 0
#define R_OK 4
#define W_OK 2
#define X_OK 1
#define _SC_SYMLOOP_MAX 1
`,
	'sys/param.h': `#pragma once
#include <limits.h>
`,
	'fcntl.h': `#pragma once
#include <sys/types.h>
#define O_RDONLY 0
#define O_WRONLY 1
#define O_RDWR 2
#define O_CREAT 0100
#define O_EXCL 0200
#define O_TRUNC 01000
#define O_APPEND 02000
#define O_NONBLOCK 04000
#define O_BINARY 0
#define FNDELAY O_NONBLOCK
#define F_GETFL 3
#define F_SETFL 4
int open(const char *, int, ...);
int fcntl(int, int, ...);
`,
	'sys/fcntl.h': `#pragma once
#include <fcntl.h>
`,
	'dirent.h': `#pragma once
#include <sys/types.h>
typedef struct DIR DIR;
struct dirent {
  ino_t d_ino;
  char d_name[1024];
};
DIR *opendir(const char *);
struct dirent *readdir(DIR *);
int closedir(DIR *);
`,
	'utime.h': `#pragma once
#include <sys/types.h>
struct utimbuf {
  time_t actime;
  time_t modtime;
};
int utime(const char *, const struct utimbuf *);
`,
	'sys/utime.h': `#pragma once
#include <utime.h>
`,
	'sys/time.h': `#pragma once
#include <time.h>
struct timeval {
  time_t tv_sec;
  long tv_usec;
};
typedef struct { unsigned long fds_bits[32]; } fd_set;
#define FD_ZERO(set) memset((set), 0, sizeof(fd_set))
#define FD_SET(fd, set) ((void)((set)->fds_bits[(fd) / (8 * sizeof(unsigned long))] |= (1UL << ((fd) % (8 * sizeof(unsigned long))))))
#define FD_CLR(fd, set) ((void)((set)->fds_bits[(fd) / (8 * sizeof(unsigned long))] &= ~(1UL << ((fd) % (8 * sizeof(unsigned long))))))
#define FD_ISSET(fd, set) (((set)->fds_bits[(fd) / (8 * sizeof(unsigned long))] & (1UL << ((fd) % (8 * sizeof(unsigned long))))) != 0)
int gettimeofday(struct timeval *, void *);
int select(int, fd_set *, fd_set *, fd_set *, struct timeval *);
`,
	'sys/socket.h': `#pragma once
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>
typedef unsigned short sa_family_t;
typedef uint32_t socklen_t;
struct sockaddr {
  sa_family_t sa_family;
  char sa_data[14];
};
struct sockaddr_storage {
  sa_family_t ss_family;
  char storage[126];
};
struct linger {
  int l_onoff;
  int l_linger;
};
#define AF_UNSPEC 0
#define AF_UNIX 1
#define AF_LOCAL AF_UNIX
#define AF_INET 2
#define AF_INET6 10
#define PF_UNSPEC AF_UNSPEC
#define PF_UNIX AF_UNIX
#define PF_LOCAL AF_LOCAL
#define PF_INET AF_INET
#define PF_INET6 AF_INET6
#define SOCK_STREAM 1
#define SOCK_DGRAM 2
#define SOL_SOCKET 1
#define SO_REUSEADDR 2
#define SO_ERROR 4
#define SO_KEEPALIVE 9
#define SO_LINGER 13
#define SO_RCVBUF 8
#define SO_SNDBUF 7
#define SHUT_RD 0
#define SHUT_WR 1
#define SHUT_RDWR 2
#define MSG_PEEK 0x02
#define MSG_DONTWAIT 0x40
int socket(int, int, int);
int bind(int, const struct sockaddr *, socklen_t);
int connect(int, const struct sockaddr *, socklen_t);
int listen(int, int);
int accept(int, struct sockaddr *, socklen_t *);
int shutdown(int, int);
ssize_t recv(int, void *, size_t, int);
ssize_t send(int, const void *, size_t, int);
int getsockname(int, struct sockaddr *, socklen_t *);
int getpeername(int, struct sockaddr *, socklen_t *);
int setsockopt(int, int, int, const void *, socklen_t);
int getsockopt(int, int, int, void *, socklen_t *);
`,
	'sys/un.h': `#pragma once
#include <string.h>
#include <sys/socket.h>
struct sockaddr_un {
  sa_family_t sun_family;
  char sun_path[108];
};
#define SUN_LEN(ptr) ((socklen_t)(sizeof(sa_family_t) + strlen((ptr)->sun_path)))
`,
	'netinet/in.h': `#pragma once
#include <stdint.h>
#include <sys/socket.h>
typedef uint16_t in_port_t;
typedef uint32_t in_addr_t;
struct in_addr { in_addr_t s_addr; };
struct in6_addr { unsigned char s6_addr[16]; };
struct sockaddr_in {
  sa_family_t sin_family;
  in_port_t sin_port;
  struct in_addr sin_addr;
  unsigned char sin_zero[8];
};
struct sockaddr_in6 {
  sa_family_t sin6_family;
  in_port_t sin6_port;
  uint32_t sin6_flowinfo;
  struct in6_addr sin6_addr;
  uint32_t sin6_scope_id;
};
#define IPPROTO_IP 0
#define IPPROTO_TCP 6
#define IPPROTO_UDP 17
#define INADDR_ANY 0U
#define INADDR_NONE 0xffffffffU
uint16_t htons(uint16_t);
uint16_t ntohs(uint16_t);
uint32_t htonl(uint32_t);
uint32_t ntohl(uint32_t);
`,
	'arpa/inet.h': `#pragma once
#include <netinet/in.h>
in_addr_t inet_addr(const char *);
char *inet_ntoa(struct in_addr);
const char *inet_ntop(int, const void *, char *, size_t);
int inet_pton(int, const char *, void *);
`,
	'netdb.h': `#pragma once
#include <stddef.h>
#include <sys/socket.h>
struct hostent {
  char *h_name;
  char **h_aliases;
  int h_addrtype;
  int h_length;
  char **h_addr_list;
};
struct addrinfo {
  int ai_flags;
  int ai_family;
  int ai_socktype;
  int ai_protocol;
  socklen_t ai_addrlen;
  struct sockaddr *ai_addr;
  char *ai_canonname;
  struct addrinfo *ai_next;
};
struct servent {
  char *s_name;
  char **s_aliases;
  int s_port;
  char *s_proto;
};
#define AI_PASSIVE 1
#define AI_CANONNAME 2
#define EAI_NONAME -2
struct hostent *gethostbyname(const char *);
struct servent *getservbyname(const char *, const char *);
int gethostname(char *, size_t);
int getaddrinfo(const char *, const char *, const struct addrinfo *, struct addrinfo **);
void freeaddrinfo(struct addrinfo *);
const char *gai_strerror(int);
`,
	'sys/ioctl.h': `#pragma once
#define FIONBIO 0x5421
#define SIOCGIFCONF 0x8912
int ioctl(int, unsigned long, ...);
`,
	'sys/sockio.h': `#pragma once
#define SIOCGIFCONF 0x8912
`,
	'net/if.h': `#pragma once
#include <sys/socket.h>
#define IFNAMSIZ 16
#define SIOCGIFCONF 0x8912
struct ifreq {
  char ifr_name[IFNAMSIZ];
  struct sockaddr ifr_addr;
};
struct ifconf {
  int ifc_len;
  union {
    char *ifcu_buf;
    struct ifreq *ifcu_req;
  } ifc_ifcu;
};
#define ifc_buf ifc_ifcu.ifcu_buf
#define ifc_req ifc_ifcu.ifcu_req
`,
	'curl/curl.h': `#pragma once
#include <stddef.h>
#include <stdint.h>
#include <sys/socket.h>
typedef void CURL;
typedef void CURLM;
typedef int CURLcode;
typedef int CURLMcode;
typedef int curl_socket_t;
typedef long long curl_off_t;
typedef enum { CURLMSG_NONE = 0, CURLMSG_DONE = 1 } CURLMSG;
typedef struct CURLMsg {
  CURLMSG msg;
  CURL *easy_handle;
  union {
    void *whatever;
    CURLcode result;
  } data;
} CURLMsg;
struct curl_slist {
  char *data;
  struct curl_slist *next;
};
struct curl_blob {
  void *data;
  size_t len;
  unsigned int flags;
};
#define LIBCURL_VERSION_NUM 0x080000
#define CURL_ERROR_SIZE 256
#define CURLE_OK 0
#define CURLE_UNSUPPORTED_PROTOCOL 1
#define CURLE_FAILED_INIT 2
#define CURLE_URL_MALFORMAT 3
#define CURLE_COULDNT_RESOLVE_PROXY 5
#define CURLE_COULDNT_RESOLVE_HOST 6
#define CURLE_COULDNT_CONNECT 7
#define CURLE_WEIRD_SERVER_REPLY 8
#define CURLE_REMOTE_ACCESS_DENIED 9
#define CURLE_OPERATION_TIMEDOUT 28
#define CURLE_SSL_CONNECT_ERROR 35
#define CURLE_GOT_NOTHING 52
#define CURLE_SEND_ERROR 55
#define CURLE_RECV_ERROR 56
#define CURLE_SSL_CERTPROBLEM 58
#define CURLE_SSL_CACERT_BADFILE 77
#define CURLE_REMOTE_FILE_NOT_FOUND 78
#define CURLE_ABORTED_BY_CALLBACK 42
#define CURLE_WRITE_ERROR 23
#define CURLE_FILESIZE_EXCEEDED 63
#define CURLE_LOGIN_DENIED 67
#define CURLE_SSL_ISSUER_ERROR 83
#define CURLE_QUIC_CONNECT_ERROR 96
#define CURLE_SSL_PINNEDPUBKEYNOTMATCH 90
#define CURLE_SSL_INVALIDCERTSTATUS 91
#define CURLM_OK 0
#define CURL_GLOBAL_SSL 1L
#define CURL_SOCKET_TIMEOUT -1
#define CURL_CSELECT_IN 0x01
#define CURL_CSELECT_OUT 0x02
#define CURL_CSELECT_ERR 0x04
#define CURL_POLL_NONE 0
#define CURL_POLL_IN 1
#define CURL_POLL_OUT 2
#define CURL_POLL_INOUT 3
#define CURL_POLL_REMOVE 4
#define CURLPAUSE_CONT 0
#define CURLPAUSE_ALL 5
#define CURL_READFUNC_ABORT 0x10000000
#define CURL_READFUNC_PAUSE 0x10000001
#define CURL_HTTP_VERSION_3 30
#define CURL_BLOB_NOCOPY 1
#define CURLOPT_URL 10002
#define CURLOPT_PORT 3
#define CURLOPT_CUSTOMREQUEST 10036
#define CURLOPT_HTTPHEADER 10023
#define CURLOPT_POSTFIELDS 10015
#define CURLOPT_POSTFIELDSIZE 60
#define CURLOPT_POSTFIELDSIZE_LARGE 30120
#define CURLOPT_UPLOAD 46
#define CURLOPT_NOBODY 44
#define CURLOPT_FOLLOWLOCATION 52
#define CURLOPT_CONNECTTIMEOUT 78
#define CURLOPT_TIMEOUT 13
#define CURLOPT_WRITEFUNCTION 20011
#define CURLOPT_WRITEDATA 10001
#define CURLOPT_READFUNCTION 20012
#define CURLOPT_READDATA 10009
#define CURLOPT_HEADERFUNCTION 20079
#define CURLOPT_HEADERDATA 10029
#define CURLOPT_XFERINFOFUNCTION 20219
#define CURLOPT_XFERINFODATA 10057
#define CURLOPT_PROGRESSFUNCTION 20056
#define CURLOPT_NOPROGRESS 43
#define CURLOPT_ERRORBUFFER 10010
#define CURLOPT_PRIVATE 10103
#define CURLOPT_VERBOSE 41
#define CURLOPT_HTTP_VERSION 84
#define CURLOPT_CAINFO 10065
#define CURLOPT_CAINFO_BLOB 40309
#define CURLINFO_RESPONSE_CODE 0x200002
#define CURLINFO_EFFECTIVE_URL 0x100001
#define CURLINFO_PRIVATE 0x100015
#define CURLINFO_OS_ERRNO 0x200019
#define CURLMOPT_SOCKETFUNCTION 20001
#define CURLMOPT_SOCKETDATA 10002
#define CURLMOPT_TIMERFUNCTION 20004
#define CURLMOPT_TIMERDATA 10005
#define CURLMOPT_MAX_HOST_CONNECTIONS 7
CURLcode curl_global_init(long);
CURL *curl_easy_init(void);
CURL *curl_easy_duphandle(CURL *);
CURLcode curl_easy_setopt(CURL *, int, ...);
CURLcode curl_easy_getinfo(CURL *, int, ...);
CURLcode curl_easy_pause(CURL *, int);
void curl_easy_cleanup(CURL *);
const char *curl_easy_strerror(CURLcode);
CURLM *curl_multi_init(void);
CURLMcode curl_multi_setopt(CURLM *, int, ...);
CURLMcode curl_multi_socket_action(CURLM *, curl_socket_t, int, int *);
CURLMcode curl_multi_add_handle(CURLM *, CURL *);
CURLMcode curl_multi_remove_handle(CURLM *, CURL *);
CURLMcode curl_multi_assign(CURLM *, curl_socket_t, void *);
CURLMsg *curl_multi_info_read(CURLM *, int *);
CURLMcode curl_multi_cleanup(CURLM *);
const char *curl_multi_strerror(CURLMcode);
struct curl_slist *curl_slist_append(struct curl_slist *, const char *);
void curl_slist_free_all(struct curl_slist *);
`,
	'dispatch/dispatch.h': `#pragma once
#include <stdint.h>
#include <sys/types.h>
typedef long dispatch_once_t;
typedef void *dispatch_queue_t;
typedef void *dispatch_queue_attr_t;
typedef void *dispatch_group_t;
typedef void *dispatch_source_t;
typedef void *dispatch_object_t;
typedef void *dispatch_source_type_t;
typedef uint64_t dispatch_time_t;
typedef void (^dispatch_block_t)(void);
typedef void (*sighandler_t)(int);
#define DISPATCH_QUEUE_SERIAL ((void *)0)
#define DISPATCH_QUEUE_CONCURRENT ((void *)0)
#define DISPATCH_QUEUE_PRIORITY_DEFAULT 0
#define DISPATCH_SOURCE_TYPE_TIMER ((dispatch_source_type_t)1)
#define DISPATCH_SOURCE_TYPE_READ ((dispatch_source_type_t)2)
#define DISPATCH_SOURCE_TYPE_WRITE ((dispatch_source_type_t)3)
#define DISPATCH_TIME_NOW 0
#define DISPATCH_TIME_FOREVER (~0ULL)
#define NSEC_PER_SEC 1000000000LL
#define NSEC_PER_MSEC 1000000LL
#define DISPATCH_CANCEL 0
void dispatch_once(dispatch_once_t *, dispatch_block_t);
dispatch_queue_t dispatch_queue_create(const char *, dispatch_queue_attr_t);
dispatch_queue_t dispatch_get_global_queue(long, unsigned long);
void dispatch_async(dispatch_queue_t, dispatch_block_t);
dispatch_group_t dispatch_group_create(void);
void dispatch_group_async(dispatch_group_t, dispatch_queue_t, dispatch_block_t);
long dispatch_group_wait(dispatch_group_t, dispatch_time_t);
void dispatch_release(void *);
void dispatch_retain(void *);
void dispatch_resume(void *);
void dispatch_suspend(void *);
void dispatch_cancel(void *);
dispatch_source_t dispatch_source_create(dispatch_source_type_t, uintptr_t, unsigned long, dispatch_queue_t);
void dispatch_source_set_event_handler(dispatch_source_t, dispatch_block_t);
void dispatch_source_set_cancel_handler(dispatch_source_t, dispatch_block_t);
void dispatch_source_set_timer(dispatch_source_t, dispatch_time_t, uint64_t, uint64_t);
void dispatch_source_cancel(dispatch_source_t);
dispatch_time_t dispatch_time(dispatch_time_t, int64_t);
`,
	'sys/resource.h': `#pragma once
typedef unsigned long rlim_t;
struct rlimit {
  rlim_t rlim_cur;
  rlim_t rlim_max;
};
#define RLIMIT_STACK 3
#define PRIO_PROCESS 0
int getrlimit(int, struct rlimit *);
int setrlimit(int, const struct rlimit *);
int getpriority(int, int);
int setpriority(int, int, int);
`,
	'sys/wait.h': `#pragma once
#include <sys/types.h>
#define WNOHANG 1
#define WIFEXITED(status) (1)
#define WEXITSTATUS(status) ((status) & 0xff)
#define WIFSIGNALED(status) (0)
#define WTERMSIG(status) (0)
pid_t waitpid(pid_t, int *, int);
`,
	'float.h': `#pragma once
#define FLT_MIN 1.17549435082228750797e-38F
#define FLT_MAX 3.40282346638528859812e+38F
#define FLT_EPSILON 1.19209289550781250000e-7F
#define DBL_MIN 2.22507385850720138309e-308
#define DBL_MAX 1.79769313486231570815e+308
#define DBL_EPSILON 2.22044604925031308085e-16
`,
	'math.h': `#pragma once
#define HUGE_VAL __builtin_huge_val()
#define HUGE_VALF __builtin_huge_valf()
#define INFINITY __builtin_inff()
#define NAN __builtin_nan("")
#define FP_NAN 0
#define FP_INFINITE 1
#define FP_ZERO 2
#define FP_SUBNORMAL 3
#define FP_NORMAL 4
#define isnan(x) __builtin_isnan(x)
#define isinf(x) __builtin_isinf_sign(x)
#define finite(x) __builtin_isfinite(x)
#define fpclassify(x) __builtin_fpclassify(0, 1, 4, 3, 2, x)
double fabs(double);
double floor(double);
double ceil(double);
double round(double);
double trunc(double);
double rint(double);
double sin(double);
double cos(double);
double sqrt(double);
double pow(double, double);
double fmod(double, double);
double modf(double, double *);
double log(double);
double exp(double);
double nan(const char *);
`,
	'sys/types.h': `#pragma once
#include <stddef.h>
#ifndef WASM_IDLE_MODE_T_DEFINED
#define WASM_IDLE_MODE_T_DEFINED 1
typedef unsigned int mode_t;
#endif
#ifndef WASM_IDLE_OFF_T_DEFINED
#define WASM_IDLE_OFF_T_DEFINED 1
typedef long long off_t;
#endif
#ifndef WASM_IDLE_SSIZE_T_DEFINED
#define WASM_IDLE_SSIZE_T_DEFINED 1
typedef long ssize_t;
#endif
#ifndef WASM_IDLE_TIME_T_DEFINED
#define WASM_IDLE_TIME_T_DEFINED 1
typedef long time_t;
#endif
typedef int pid_t;
typedef unsigned int dev_t;
typedef unsigned int gid_t;
typedef unsigned int ino_t;
typedef unsigned int nlink_t;
typedef unsigned int uid_t;
typedef unsigned char u_char;
typedef unsigned short u_short;
typedef unsigned int u_int;
typedef unsigned long u_long;
typedef long blksize_t;
typedef long blkcnt_t;
`,
	'sys/stat.h': `#pragma once
#include <sys/types.h>
#ifndef WASM_IDLE_TIMESPEC_DEFINED
#define WASM_IDLE_TIMESPEC_DEFINED 1
struct timespec { time_t tv_sec; long tv_nsec; };
#endif
struct stat {
  dev_t st_dev;
  ino_t st_ino;
  mode_t st_mode;
  nlink_t st_nlink;
  uid_t st_uid;
  gid_t st_gid;
  dev_t st_rdev;
  off_t st_size;
  blksize_t st_blksize;
  blkcnt_t st_blocks;
  time_t st_atime;
  time_t st_mtime;
  time_t st_ctime;
  struct timespec st_atim;
  struct timespec st_mtim;
  struct timespec st_ctim;
  struct timespec st_birthtim;
  struct timespec st_birthtimespec;
  time_t st_birthtime;
};
#define S_IFMT 0170000
#define S_IFIFO 0010000
#define S_IFCHR 0020000
#define S_IFDIR 0040000
#define S_IFBLK 0060000
#define S_IFREG 0100000
#define S_IFLNK 0120000
#define S_IFSOCK 0140000
#define S_IRUSR 0400
#define S_IWUSR 0200
#define S_IXUSR 0100
#define S_IRGRP 0040
#define S_IWGRP 0020
#define S_IXGRP 0010
#define S_IROTH 0004
#define S_IWOTH 0002
#define S_IXOTH 0001
#define S_ISDIR(m) (((m) & S_IFMT) == S_IFDIR)
#define S_ISREG(m) (((m) & S_IFMT) == S_IFREG)
#define S_ISLNK(m) (((m) & S_IFMT) == S_IFLNK)
int stat(const char *, struct stat *);
int lstat(const char *, struct stat *);
int fstat(int, struct stat *);
int mkdir(const char *, mode_t);
int chmod(const char *, mode_t);
int fchmod(int, mode_t);
`,
	'time.h': `#pragma once
#ifndef WASM_IDLE_TIME_T_DEFINED
#define WASM_IDLE_TIME_T_DEFINED 1
typedef long time_t;
#endif
#ifndef WASM_IDLE_TIMESPEC_DEFINED
#define WASM_IDLE_TIMESPEC_DEFINED 1
struct timespec { time_t tv_sec; long tv_nsec; };
#endif
typedef long clock_t;
time_t time(time_t *);
char *ctime(const time_t *);
`,
	'wchar.h': `#pragma once
#include <stddef.h>
typedef int wint_t;
typedef struct { unsigned long storage[4]; } mbstate_t;
size_t wcslen(const wchar_t *);
int wcscmp(const wchar_t *, const wchar_t *);
wchar_t *wcscpy(wchar_t *, const wchar_t *);
`,
	'dlfcn.h': `#pragma once
#define RTLD_LAZY 1
#define RTLD_NOW 2
#define RTLD_GLOBAL 0x100
#define RTLD_LOCAL 0
#define RTLD_DEFAULT ((void *)0)
typedef struct {
  const char *dli_fname;
  void *dli_fbase;
  const char *dli_sname;
  void *dli_saddr;
} Dl_info;
void *dlopen(const char *, int);
void *dlsym(void *, const char *);
int dlclose(void *);
char *dlerror(void);
int dladdr(const void *, Dl_info *);
`,
	'ctype.h': `#pragma once
int isalnum(int);
int isalpha(int);
int isdigit(int);
int islower(int);
int isspace(int);
int isupper(int);
int isxdigit(int);
int isprint(int);
int tolower(int);
int toupper(int);
`,
	'setjmp.h': `#pragma once
typedef int jmp_buf[32];
int setjmp(jmp_buf);
void longjmp(jmp_buf, int);
`,
	'signal.h': `#pragma once
typedef void (*sighandler_t)(int);
#define SIG_DFL ((sighandler_t)0)
#define SIG_IGN ((sighandler_t)1)
#define SIG_ERR ((sighandler_t)-1)
#define SIGHUP 1
#define SIGINT 2
#define SIGQUIT 3
#define SIGILL 4
#define SIGTRAP 5
#define SIGABRT 6
#define SIGBUS 7
#define SIGFPE 8
#define SIGKILL 9
#define SIGSEGV 11
#define SIGPIPE 13
#define SIGALRM 14
#define SIGTERM 15
#define SIGCHLD 17
#define SIGCONT 18
#define SIGSTOP 19
sighandler_t signal(int, sighandler_t);
int raise(int);
int kill(pid_t, int);
`,
	'sys/signal.h': `#pragma once
#include <signal.h>
`,
	'mframe.h': `#pragma once
typedef struct { unsigned size; unsigned align; } NSArgumentInfo;
static inline const char *mframe_next_arg(const char *type, NSArgumentInfo *info) {
  if (info) { info->size = sizeof(void *); info->align = sizeof(void *); }
  return type;
}
`
};

const includePattern = /^\s*#\s*(?:include|import)(?:_next)?\s+[<"]([^>"]+)[>"]/gm;
const foundationSupportSource = `
#include <stdint.h>
#include <stdlib.h>

typedef int jmp_buf[32];
typedef unsigned int uid_t;
typedef unsigned int gid_t;
typedef int pid_t;
typedef long dispatch_once_t;
typedef void *dispatch_queue_t;
typedef void *dispatch_queue_attr_t;
typedef void *dispatch_group_t;
typedef void *dispatch_source_t;
typedef void *dispatch_source_type_t;
typedef uint64_t dispatch_time_t;
typedef void (^dispatch_block_t)(void);
typedef void (*sighandler_t)(int);

int setjmp(jmp_buf env) {
  (void)env;
  return 0;
}

void longjmp(jmp_buf env, int value) {
  (void)env;
  (void)value;
  abort();
}

char *mktemp(char *template_name) {
  return template_name;
}

sighandler_t signal(int signum, sighandler_t handler) {
  (void)signum;
  return handler;
}

int raise(int signum) {
  (void)signum;
  return 0;
}

int kill(int pid, int signum) {
  (void)pid;
  (void)signum;
  return 0;
}

int chown(const char *path, uid_t owner, gid_t group) {
  (void)path;
  (void)owner;
  (void)group;
  return 0;
}

uid_t getuid(void) {
  return 0;
}

uid_t geteuid(void) {
  return 0;
}

gid_t getgid(void) {
  return 0;
}

gid_t getegid(void) {
  return 0;
}

pid_t getpid(void) {
  return 1;
}

char *getwd(char *buffer) {
  if (buffer != 0) {
    buffer[0] = '.';
    buffer[1] = '\\0';
  }
  return buffer;
}

int gethostname(char *name, unsigned long size) {
  if (name != 0 && size > 0) name[0] = '\\0';
  return 0;
}

struct hostent {
  char *h_name;
  char **h_aliases;
  int h_addrtype;
  int h_length;
  char **h_addr_list;
};

struct hostent *gethostbyname(const char *name) {
  static char *aliases[] = { 0 };
  static char address[4] = { 127, 0, 0, 1 };
  static char *addresses[] = { address, 0 };
  static struct hostent host = { 0, aliases, 2, 4, addresses };
  host.h_name = (char *)name;
  return &host;
}

struct servent {
  char *s_name;
  char **s_aliases;
  int s_port;
  char *s_proto;
};

struct sockaddr {
  unsigned short sa_family;
  char sa_data[14];
};
typedef unsigned int socklen_t;

struct servent *getservbyname(const char *name, const char *proto) {
  (void)name;
  (void)proto;
  return 0;
}

int setsockopt(int socket, int level, int option_name, const void *option_value, socklen_t option_len) {
  (void)socket;
  (void)level;
  (void)option_name;
  (void)option_value;
  (void)option_len;
  return -1;
}

int getsockname(int socket, struct sockaddr *address, socklen_t *address_len) {
  (void)socket;
  (void)address;
  (void)address_len;
  return -1;
}

int getpeername(int socket, struct sockaddr *address, socklen_t *address_len) {
  (void)socket;
  (void)address;
  (void)address_len;
  return -1;
}

int socket(int domain, int type, int protocol) {
  (void)domain;
  (void)type;
  (void)protocol;
  return -1;
}

int connect(int socket, const struct sockaddr *address, socklen_t address_len) {
  (void)socket;
  (void)address;
  (void)address_len;
  return -1;
}

int bind(int socket, const struct sockaddr *address, socklen_t address_len) {
  (void)socket;
  (void)address;
  (void)address_len;
  return -1;
}

int listen(int socket, int backlog) {
  (void)socket;
  (void)backlog;
  return -1;
}

int accept(int socket, struct sockaddr *address, socklen_t *address_len) {
  (void)socket;
  (void)address;
  (void)address_len;
  return -1;
}

int shutdown(int socket, int how) {
  (void)socket;
  (void)how;
  return -1;
}

void sync(void) {
}

struct timeval {
  long tv_sec;
  long tv_usec;
};
typedef struct { unsigned long fds_bits[32]; } fd_set;

int select(int nfds, fd_set *readfds, fd_set *writefds, fd_set *exceptfds, struct timeval *timeout) {
  (void)nfds;
  (void)readfds;
  (void)writefds;
  (void)exceptfds;
  (void)timeout;
  return 0;
}

void *valloc(unsigned long size) {
  return malloc(size);
}

int getpagesize(void) {
  return 65536;
}

int pipe(int fds[2]) {
  if (fds != 0) {
    fds[0] = -1;
    fds[1] = -1;
  }
  return -1;
}

pid_t fork(void) {
  return -1;
}

pid_t waitpid(pid_t pid, int *status, int options) {
  (void)pid;
  (void)options;
  if (status != 0) *status = 0;
  return -1;
}

int dup2(int oldfd, int newfd) {
  (void)oldfd;
  return newfd;
}

int dup(int oldfd) {
  return oldfd;
}

int execve(const char *path, char *const argv[], char *const envp[]) {
  (void)path;
  (void)argv;
  (void)envp;
  return -1;
}

void dispatch_once(dispatch_once_t *predicate, dispatch_block_t block) {
  if (predicate != 0 && *predicate != 0) return;
  if (block != 0) block();
  if (predicate != 0) *predicate = 1;
}

dispatch_queue_t dispatch_queue_create(const char *label, dispatch_queue_attr_t attr) {
  (void)label;
  (void)attr;
  return (dispatch_queue_t)1;
}

dispatch_queue_t dispatch_get_global_queue(long priority, unsigned long flags) {
  (void)priority;
  (void)flags;
  return (dispatch_queue_t)1;
}

void dispatch_async(dispatch_queue_t queue, dispatch_block_t block) {
  (void)queue;
  if (block != 0) block();
}

dispatch_group_t dispatch_group_create(void) {
  return (dispatch_group_t)1;
}

void dispatch_group_async(dispatch_group_t group, dispatch_queue_t queue, dispatch_block_t block) {
  (void)group;
  (void)queue;
  if (block != 0) block();
}

long dispatch_group_wait(dispatch_group_t group, dispatch_time_t timeout) {
  (void)group;
  (void)timeout;
  return 0;
}

void dispatch_release(void *object) {
  (void)object;
}

void dispatch_retain(void *object) {
  (void)object;
}

void dispatch_resume(void *object) {
  (void)object;
}

void dispatch_suspend(void *object) {
  (void)object;
}

void dispatch_cancel(void *object) {
  (void)object;
}

dispatch_source_t dispatch_source_create(dispatch_source_type_t type, uintptr_t handle, unsigned long mask, dispatch_queue_t queue) {
  (void)type;
  (void)handle;
  (void)mask;
  (void)queue;
  return (dispatch_source_t)1;
}

void dispatch_source_set_event_handler(dispatch_source_t source, dispatch_block_t block) {
  (void)source;
  (void)block;
}

void dispatch_source_set_cancel_handler(dispatch_source_t source, dispatch_block_t block) {
  (void)source;
  (void)block;
}

void dispatch_source_set_timer(dispatch_source_t source, dispatch_time_t start, uint64_t interval, uint64_t leeway) {
  (void)source;
  (void)start;
  (void)interval;
  (void)leeway;
}

void dispatch_source_cancel(dispatch_source_t source) {
  (void)source;
}

dispatch_time_t dispatch_time(dispatch_time_t when, int64_t delta) {
  return when + (dispatch_time_t)delta;
}
`;
const ignoredSystemHeaders = new Set([
	'arpa/inet.h',
	'ctype.h',
	'dirent.h',
	'dlfcn.h',
	'errno.h',
	'fcntl.h',
	'float.h',
	'grp.h',
	'iconv.h',
	'inttypes.h',
	'langinfo.h',
	'limits.h',
	'locale.h',
	'malloc.h',
	'math.h',
	'memory.h',
	'netdb.h',
	'netinet/in.h',
	'poll.h',
	'pwd.h',
	'setjmp.h',
	'signal.h',
	'stdarg.h',
	'stddef.h',
	'stdint.h',
	'stdio.h',
	'stdlib.h',
	'string.h',
	'strings.h',
	'sys/param.h',
	'sys/signal.h',
	'sys/socket.h',
	'sys/stat.h',
	'sys/time.h',
	'sys/types.h',
	'sys/un.h',
	'sys/wait.h',
	'time.h',
	'unistd.h',
	'utime.h',
	'wchar.h'
]);

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd || REPO_ROOT,
			stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
			env: process.env
		});
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr?.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`${command} ${args.join(' ')} failed\n${stderr}`));
		});
	});
}

async function exists(filePath) {
	return !!(await stat(filePath).catch(() => null));
}

async function ensureGitCheckout(directory, url, ref) {
	if (!(await exists(path.join(directory, '.git')))) {
		await mkdir(path.dirname(directory), { recursive: true });
		await rm(directory, { recursive: true, force: true });
		await run('git', ['clone', url, directory]);
	}
	await run('git', ['fetch', '--tags', '--quiet'], { cwd: directory });
	await run('git', ['checkout', '--quiet', ref], { cwd: directory });
}

function generateFfiHeader(source) {
	return source
		.replaceAll('@VERSION@', '3.6.0')
		.replaceAll('@TARGET@', 'WASM')
		.replaceAll('@HAVE_LONG_DOUBLE@', '0')
		.replaceAll('@FFI_VERSION_STRING@', '3.6.0')
		.replaceAll('@FFI_VERSION_NUMBER@', '30600')
		.replaceAll('@FFI_EXEC_TRAMPOLINE_TABLE@', '0');
}

async function readLibffiHeaders() {
	return {
		'ffi.h': generateFfiHeader(
			await readFile(path.join(LIBFFI_DIR, 'include', 'ffi.h.in'), 'utf8')
		),
		'ffitarget.h': await readFile(path.join(LIBFFI_DIR, 'src', 'wasm', 'ffitarget.h'), 'utf8'),
		'ffi_common.h': await readFile(path.join(LIBFFI_DIR, 'include', 'ffi_common.h'), 'utf8'),
		'fficonfig.h': `#pragma once
#define HAVE_ALLOCA_H 1
#define HAVE_MEMCPY 1
#define HAVE_LONG_DOUBLE_VARIANT 0
#define HAVE_INT128 1
#define STDC_HEADERS 1
#define FFI_HIDDEN __attribute__((visibility("hidden")))
`
	};
}

async function addFileWithDirs(clang, filePath, contents) {
	if (installedMemfsFiles.has(filePath)) return;
	const parts = filePath.split('/').slice(0, -1);
	let directory = '';
	for (const part of parts) {
		directory = directory ? `${directory}/${part}` : part;
		if (installedMemfsDirectories.has(directory)) continue;
		try {
			clang.memfs.addDirectory(directory);
			installedMemfsDirectories.add(directory);
		} catch {
			// Existing directories are fine.
			installedMemfsDirectories.add(directory);
		}
	}
	try {
		clang.memfs.addFile(
			filePath,
			typeof contents === 'string' ? textEncoder.encode(contents) : contents
		);
	} catch (error) {
		const recentFiles = installedMemfsFileOrder.slice(-8).join(', ');
		throw new Error(
			`Failed to add ${filePath} to wasm-clang memfs after ${installedMemfsFileOrder.length} files` +
				`${recentFiles ? `; recent files: ${recentFiles}` : ''}: ${error.message}`,
			{ cause: error }
		);
	}
	installedMemfsFiles.add(filePath);
	installedMemfsFileOrder.push(filePath);
	if (traceHeaders) console.log(`[foundation-probe] installed ${filePath}`);
}

async function resolveProbeHeaderPath(currentPath, includeName) {
	if (includeName.startsWith('ObjectiveC2/')) {
		const aliasedHeader = includeName.slice('ObjectiveC2/'.length);
		if (aliasedHeader.startsWith('objc/')) return { path: aliasedHeader, source: '' };
		return resolveProbeHeaderPath(currentPath, aliasedHeader);
	}
	if (shimFiles[includeName] != null)
		return { path: includeName, source: shimFiles[includeName] };
	if (ignoredSystemHeaders.has(includeName)) return null;
	if (includeName.startsWith('objc/')) return null;
	const candidates = [];
	const currentDirectory = currentPath.includes('/') ? path.posix.dirname(currentPath) : '';
	if (
		currentDirectory &&
		!includeName.startsWith('Foundation/') &&
		!includeName.startsWith('CoreFoundation/') &&
		!includeName.startsWith('GNUstepBase/')
	) {
		candidates.push(path.posix.join(currentDirectory, includeName));
	}
	candidates.push(includeName);
	for (const candidate of candidates) {
		if (shimFiles[candidate] != null) return { path: candidate, source: shimFiles[candidate] };
		if (candidate.startsWith('Foundation/')) {
			const sourcePath = path.join(LIBS_BASE_DIR, 'Headers', candidate);
			if (await exists(sourcePath)) return { path: candidate, sourcePath };
		}
		if (candidate.startsWith('CoreFoundation/')) {
			const sourcePath = path.join(LIBS_BASE_DIR, 'Headers', candidate);
			if (await exists(sourcePath)) return { path: candidate, sourcePath };
		}
		if (candidate.startsWith('GNUstepBase/')) {
			for (const sourcePath of [
				path.join(LIBS_BASE_DIR, 'Headers', candidate),
				path.join(LIBS_BASE_DIR, 'Headers', 'Additions', candidate)
			]) {
				if (await exists(sourcePath)) return { path: candidate, sourcePath };
			}
		}
		if (candidate.startsWith('Source/')) {
			const sourcePath = path.join(LIBS_BASE_DIR, candidate);
			if (await exists(sourcePath)) return { path: candidate, sourcePath };
		}
		const sourceHeader = path.join(LIBS_BASE_DIR, 'Source', candidate);
		if (await exists(sourceHeader)) return { path: candidate, sourcePath: sourceHeader };
	}
	return null;
}

async function readResolvedHeader(resolved) {
	if (resolved.source != null) return resolved.source;
	return readFile(resolved.sourcePath, 'utf8');
}

function memfsPathFor(sourcePath) {
	for (const prefix of ['CoreFoundation', 'Foundation', 'GNUstepBase']) {
		if (sourcePath.startsWith(`${prefix}/`)) {
			let hash = 0;
			for (const character of sourcePath) {
				hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
			}
			return `${prefix[0]}/${(hash % 16).toString(16)}/${sourcePath.replaceAll('/', '_')}`;
		}
	}
	return sourcePath;
}

async function rewriteProbeIncludes(currentPath, source) {
	let rewritten = '';
	let lastIndex = 0;
	includePattern.lastIndex = 0;
	for (const match of source.matchAll(includePattern)) {
		const resolved = await resolveProbeHeaderPath(currentPath, match[1]);
		const replacementPath = resolved ? memfsPathFor(resolved.path) : null;
		rewritten += source.slice(lastIndex, match.index);
		if (replacementPath && replacementPath !== match[1]) {
			rewritten += match[0].replace(match[1], replacementPath);
		} else {
			rewritten += match[0];
		}
		lastIndex = match.index + match[0].length;
	}
	return rewritten + source.slice(lastIndex);
}

function patchFoundationSource(sourcePath, source) {
	if (sourcePath === 'NSObject.m') {
		return source
			.replace(
				'  (*autorelease_imp)(autorelease_class, autorelease_sel, self);\n  return self;',
				`  if (autorelease_imp != 0)
    {
      (*autorelease_imp)(autorelease_class, autorelease_sel, self);
    }
  return self;`
			)
			.replace(
				`      /* Call the default finalizer to handle C++ destructors.
       */
      (*finalize_imp)(anObject, finalize_sel);`,
				`      /* Call the default finalizer to handle C++ destructors.
       */
      if (finalize_imp != 0)
        {
          (*finalize_imp)(anObject, finalize_sel);
        }`
			);
	}
	if (sourcePath === 'NSString.m') {
		return source
			.replace(
				'if (self == [NSString class] && beenHere == NO)',
				'if (NO && self == [NSString class] && beenHere == NO)'
			)
			.replace(
				/\n\+ \(id\) allocWithZone: \(NSZone\*\)z\n/,
				`
static void
GSWasmIdleInitializeNSStringCluster(Class self)
{
  static BOOL	beenHere = NO;

  if (beenHere == NO)
    {
      beenHere = YES;
      cMemberSel = @selector(characterIsMember:);
      caiSel = @selector(characterAtIndex:);
      gcrSel = @selector(getCharacters:range:);
      ranSel = @selector(rangeOfComposedCharacterSequenceAtIndex:);

      _DefaultStringEncoding = GSPrivateDefaultCStringEncoding();
      _ByteEncodingOk = GSPrivateIsByteEncoding(_DefaultStringEncoding);

      NSStringClass = (Class)objc_getClass("NSString");
      class_setVersion(self, 1);
      NSMutableStringClass = (Class)objc_getClass("NSMutableString");
      NSDataClass = (Class)objc_getClass("NSData");
      GSPlaceholderStringClass = (Class)objc_getClass("GSPlaceholderString");
      GSStringClass = (Class)objc_getClass("GSString");
      GSMutableStringClass = (Class)objc_getClass("GSMutableString");

      /*
       * The normal GNUstep bootstrap creates shared placeholder strings here.
       * In the wasm package this can re-enter +allocWithZone: before the class
       * cluster is stable, so placeholders are allocated directly on demand.
       */
      register_printf_atsign();
    }
}

+ (id) allocWithZone: (NSZone*)z
`
			)
			.replace(
				`+ (void) initialize
{
  /*
   * Flag required as we call this method explicitly from GSBuildStrings()
   * to ensure that NSString is initialised properly.
   */
  static BOOL	beenHere = NO;

  if (self == [NSString class] && beenHere == NO)
    {
      beenHere = YES;
      cMemberSel = @selector(characterIsMember:);
      caiSel = @selector(characterAtIndex:);
      gcrSel = @selector(getCharacters:range:);
      ranSel = @selector(rangeOfComposedCharacterSequenceAtIndex:);

      _DefaultStringEncoding = GSPrivateDefaultCStringEncoding();
      _ByteEncodingOk = GSPrivateIsByteEncoding(_DefaultStringEncoding);

      NSStringClass = self;
      class_setVersion(self, 1);
      NSMutableStringClass = (Class)objc_getClass("NSMutableString");
      NSDataClass = (Class)objc_getClass("NSData");
      GSPlaceholderStringClass = (Class)objc_getClass("GSPlaceholderString");
      GSStringClass = (Class)objc_getClass("GSString");
      GSMutableStringClass = (Class)objc_getClass("GSMutableString");

      /*
       * Set up infrastructure for placeholder strings.
       */
      defaultPlaceholderString = (GSPlaceholderString*)
	[GSPlaceholderStringClass allocWithZone: NSDefaultMallocZone()];
      placeholderMap = NSCreateMapTable(NSNonOwnedPointerMapKeyCallBacks,
	NSNonRetainedObjectMapValueCallBacks, 0);
      register_printf_atsign();
      [self registerAtExit];
    }
}`,
				`static void
GSWasmIdleInitializeNSStringCluster(Class self)
{
  static BOOL	beenHere = NO;

  if (beenHere == NO)
    {
      beenHere = YES;
      cMemberSel = @selector(characterIsMember:);
      caiSel = @selector(characterAtIndex:);
      gcrSel = @selector(getCharacters:range:);
      ranSel = @selector(rangeOfComposedCharacterSequenceAtIndex:);

      _DefaultStringEncoding = GSPrivateDefaultCStringEncoding();
      _ByteEncodingOk = GSPrivateIsByteEncoding(_DefaultStringEncoding);

      NSStringClass = (Class)objc_getClass("NSString");
      NSMutableStringClass = (Class)objc_getClass("NSMutableString");
      NSDataClass = (Class)objc_getClass("NSData");
      GSPlaceholderStringClass = (Class)objc_getClass("GSPlaceholderString");
      GSStringClass = (Class)objc_getClass("GSString");
      GSMutableStringClass = (Class)objc_getClass("GSMutableString");

      /*
       * Set up infrastructure for placeholder strings.
       */
      defaultPlaceholderString = (GSPlaceholderString*)
	NSAllocateObject(GSPlaceholderStringClass, 0, NSDefaultMallocZone());
      placeholderMap = 0;
    }
}

+ (void) initialize
{
  if (NSStringClass == 0)
    {
      GSWasmIdleInitializeNSStringCluster(self);
    }
}`
			)
			.replace(
				`+ (id) allocWithZone: (NSZone*)z
{
  if (self == NSStringClass)`,
				`+ (id) alloc
{
  if (self == (Class)objc_getClass("NSString"))
    {
      return NSAllocateObject((Class)objc_getClass("GSPlaceholderString"), 0, NSDefaultMallocZone());
    }
  if (NSStringClass == 0)
    {
      GSWasmIdleInitializeNSStringCluster(self);
    }
  return [self allocWithZone: NSDefaultMallocZone()];
}

+ (id) allocWithZone: (NSZone*)z
{
  if (self == (Class)objc_getClass("NSString"))
    {
      return NSAllocateObject((Class)objc_getClass("GSPlaceholderString"), 0, z);
    }
  if (NSStringClass == 0)
    {
      GSWasmIdleInitializeNSStringCluster(self);
    }
  if (self == NSStringClass)`
			)
			.replace(
				`      if (z == NSDefaultMallocZone() || z == 0)
\t{
\t  /*
\t   * As a special case, we can return a placeholder for a string
\t   * in the default zone extremely efficiently.
\t   */
\t  return defaultPlaceholderString;
\t}`,
				`      if (z == NSDefaultMallocZone() || z == 0)
\t{
\t  /*
\t   * The shared default placeholder relies on GNUstep's normal runtime
\t   * initialization ordering.  Allocate a fresh placeholder in the wasm
\t   * package to avoid re-entering that initialization path.
\t   */
\t  return NSAllocateObject(GSPlaceholderStringClass, 0, z);
\t}`
			);
	}
	if (sourcePath === 'GSString.m') {
		const rewritten = source
			.replace(
				/static void\nsetup\(BOOL rerun\)\n\{[\s\S]*?\n\}\n\nstatic GSCInlineString\*/m,
				`static void
setup(BOOL rerun)
{
  static BOOL	beenHere = NO;

  if (!beenHere || rerun)
    {
      beenHere = YES;

      caiSel = @selector(characterAtIndex:);
      gcrSel = @selector(getCharacters:range:);
      ranSel = @selector(rangeOfComposedCharacterSequenceAtIndex:);

      externalEncoding = GSPrivateDefaultCStringEncoding();
      if (isByteEncoding(externalEncoding) == YES)
	{
	  internalEncoding = externalEncoding;
	}

      NSDataClass = (Class)objc_getClass("NSData");
      NSStringClass = (Class)objc_getClass("NSString");
      GSStringClass = (Class)objc_getClass("GSString");
      GSCStringClass = (Class)objc_getClass("GSCString");
      GSUnicodeStringClass = (Class)objc_getClass("GSUnicodeString");
      GSCBufferStringClass = (Class)objc_getClass("GSCBufferString");
      GSUnicodeBufferStringClass = (Class)objc_getClass("GSUnicodeBufferString");
      GSCInlineStringClass = (Class)objc_getClass("GSCInlineString");
      GSUInlineStringClass = (Class)objc_getClass("GSUInlineString");
      GSCSubStringClass = (Class)objc_getClass("GSCSubString");
      GSUnicodeSubStringClass = (Class)objc_getClass("GSUnicodeSubString");
      GSMutableStringClass = (Class)objc_getClass("GSMutableString");
      NSConstantStringClass = (Class)objc_getClass("NXConstantString");

      GSImmutableStringClass = (Class)objc_getClass("GSImmutableString");
      immutableIvar = GSImmutableStringClass == 0 ? 0
	: class_getInstanceVariable(GSImmutableStringClass, "_parent");

      cMemberSel = @selector(characterIsMember:);
      convertSel = @selector(canBeConvertedToEncoding:);
      convertImp = 0;
      equalSel = @selector(isEqualToString:);
      equalImp = 0;
      hashSel = @selector(hash);
      hashImp = 0;
    }
}

static GSCInlineString*`
			)
			.replace(
				`+ (id) allocWithZone: (NSZone*)z
{
  GSPlaceholderString   *o = NSAllocateObject(self, 0, z);`,
				`+ (id) allocWithZone: (NSZone*)z
{
  if (z == 0)
    {
      z = NSDefaultMallocZone();
    }
  GSPlaceholderString   *o = NSAllocateObject(self, 0, z);`
			)
			.replaceAll(
				'newCInline(length, myZone)',
				'newCInline(length, myZone ? myZone : NSDefaultMallocZone())'
			)
			.replaceAll(
				'NSAllocateObject(GSUnicodeBufferStringClass, 0, myZone)',
				'NSAllocateObject(GSUnicodeBufferStringClass, 0, myZone ? myZone : NSDefaultMallocZone())'
			)
			.replace(
				/- \(id\) initWithUTF8String: \(const char\*\)bytes\n\{[\s\S]*?\n\}\n\n- \(NSUInteger\) length/m,
				`- (id) initWithUTF8String: (const char*)bytes
{
  const uint8_t *b = (const uint8_t*)bytes;
  BOOL		ascii = YES;
  NSUInteger    length;
  GSStr		me;
  uint8_t       c;
  NSZone       *zone = myZone ? myZone : NSDefaultMallocZone();

  if (GSCInlineStringClass == 0)
    {
      GSCInlineStringClass = (Class)objc_getClass("GSCInlineString");
    }
  if (GSUnicodeBufferStringClass == 0)
    {
      GSUnicodeBufferStringClass = (Class)objc_getClass("GSUnicodeBufferString");
    }
  if (NULL == bytes)
    [NSException raise: NSInvalidArgumentException
		format: @"[GSPlaceholderString-initWithUTF8String:]: NULL cString"];
  /* Skip leading BOM
   */
  if (b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF)
    {
      b = &b[3];
    }

  length = 0;
  while ((c = b[length]))
    {
      length++;
      if (c > 127)
        {
          ascii = NO;
          while (b[length])
            {
              length++;
            }
          break;
        }
    }

  if (YES == ascii)
    {
      me = (GSStr)newCInline(length, zone);
      memcpy(me->_contents.c, b, length);
    }
  else
    {
      unichar	                *u = 0;
      unsigned	                l = 0;

      if (GSToUnicode(&u, &l, b, length, NSUTF8StringEncoding, zone, 0) == NO)
	{
	  return nil;	// Invalid data
	}
      me = (GSStr)NSAllocateObject(GSUnicodeBufferStringClass, 0, zone);
      me->_contents.u = u;
      me->_count = l;
      me->_flags.wide = 1;
      me->_flags.owned = YES;
    }
  return (id)me;
}

- (NSUInteger) length`
			);
		if (!rewritten.includes('NSZone       *zone = myZone ? myZone : NSDefaultMallocZone();')) {
			throw new Error('failed to rewrite GSPlaceholderString initWithUTF8String');
		}
		const wasmUtf8String = `static inline const char*
UTF8String_c(GSStr self)
{
  unsigned char *r;

  if (self->_count == 0)
    {
      return "";
    }

  r = (unsigned char*)malloc(self->_count + 1);
  if (r == 0)
    {
      return 0;
    }
  memcpy(r, self->_contents.c, self->_count);
  r[self->_count] = '\\0';
  return (const char*)r;
}

static inline const char*
UTF8String_u(GSStr self)
{
  unsigned c = self->_count;
  unsigned char *r;
  unsigned out = 0;
  unsigned i;

  if (c == 0)
    {
      return "";
    }

  r = (unsigned char*)malloc((c * 3) + 1);
  if (r == 0)
    {
      return 0;
    }
  for (i = 0; i < c; i++)
    {
      unichar ch = self->_contents.u[i];

      if (ch < 0x80)
	{
	  r[out++] = (unsigned char)ch;
	}
      else if (ch < 0x800)
	{
	  r[out++] = (unsigned char)(0xc0 | (ch >> 6));
	  r[out++] = (unsigned char)(0x80 | (ch & 0x3f));
	}
      else
	{
	  r[out++] = (unsigned char)(0xe0 | (ch >> 12));
	  r[out++] = (unsigned char)(0x80 | ((ch >> 6) & 0x3f));
	  r[out++] = (unsigned char)(0x80 | (ch & 0x3f));
	}
    }
  r[out] = '\\0';
  return (const char*)r;
}`;
		const withUtf8String = rewritten.replace(
			/static inline const char\*\nUTF8String_c\(GSStr self\)\n\{[\s\S]*?\n\}\n\nstatic inline const char\*\nUTF8String_u\(GSStr self\)\n\{[\s\S]*?\n\}\n\nstatic inline BOOL/m,
			`${wasmUtf8String}\n\nstatic inline BOOL`
		);
		if (withUtf8String === rewritten) {
			throw new Error('failed to rewrite UTF8String_c and UTF8String_u');
		}
		return withUtf8String;
	}
	if (sourcePath === 'NSZone.m') {
		return source
			.replace(
				`GS_DECLARE void*
NSZoneMalloc (NSZone *zone, NSUInteger size)
{
  if (!zone)
    zone = NSDefaultMallocZone();
  return (zone->malloc)(zone, size);
}`,
				`GS_DECLARE void*
NSZoneMalloc (NSZone *zone, NSUInteger size)
{
  if (!zone || zone == NSDefaultMallocZone())
    {
      void *mem = malloc(size);
      if (mem != NULL)
        {
          return mem;
        }
      [NSException raise: NSMallocException
                  format: @"Default zone has run out of memory"];
      return 0;
    }
  return (zone->malloc)(zone, size);
}`
			)
			.replace(
				`GS_DECLARE void*
NSZoneRealloc (NSZone *zone, void *ptr, NSUInteger size)
{
  if (!zone)
    zone = NSDefaultMallocZone();
  return (zone->realloc)(zone, ptr, size);
}`,
				`GS_DECLARE void*
NSZoneRealloc (NSZone *zone, void *ptr, NSUInteger size)
{
  if (!zone || zone == NSDefaultMallocZone())
    {
      void *mem = realloc(ptr, size);
      if (mem != NULL)
        {
          return mem;
        }
      [NSException raise: NSMallocException
                  format: @"Default zone has run out of memory"];
      return 0;
    }
  return (zone->realloc)(zone, ptr, size);
}`
			)
			.replace(
				`GS_DECLARE void
NSZoneFree (NSZone *zone, void *ptr)
{
  if (!zone)
    zone = NSDefaultMallocZone();
  (zone->free)(zone, ptr);
}`,
				`GS_DECLARE void
NSZoneFree (NSZone *zone, void *ptr)
{
  if (!zone || zone == NSDefaultMallocZone())
    {
      free(ptr);
      return;
    }
  (zone->free)(zone, ptr);
}`
			);
	}
	if (sourcePath === 'cifframe.m') {
		return source.replace(
			'  result = [NSMutableData dataWithCapacity: size];\n  [result setLength: size];',
			'  (void)[NSData data];\n  result = [[[NSMutableData alloc] initWithCapacity: size] autorelease];\n  [result setLength: size];'
		);
	}
	if (sourcePath === 'GSFFIInvocation.m') {
		return source.replace(
			`\t  [NSException raise: NSInvalidArgumentException
\t    format: @"%c[%s %s]: unrecognized selector sent to instance %p",
\t    (class_isMetaClass(c) ? '+' : '-'),
\t    class_getName(c), sel_getName(sel), receiver];`,
			`\t  fprintf(stderr, "GNUstep forwarding missing selector: %c[%s %s] receiver=%p\\\\n",
\t    (class_isMetaClass(c) ? '+' : '-'),
\t    class_getName(c), sel_getName(sel), receiver);
\t  abort();`
		);
	}
	return source;
}

async function installTransitiveHeaders(clang, currentPath, source, seen = new Set()) {
	includePattern.lastIndex = 0;
	for (const match of source.matchAll(includePattern)) {
		const resolved = await resolveProbeHeaderPath(currentPath, match[1]);
		if (!resolved || seen.has(resolved.path)) continue;
		seen.add(resolved.path);
		const headerSource = await readResolvedHeader(resolved);
		await addFileWithDirs(
			clang,
			memfsPathFor(resolved.path),
			await rewriteProbeIncludes(resolved.path, headerSource)
		);
		await installTransitiveHeaders(clang, resolved.path, headerSource, seen);
	}
}

async function installShimHeaders(clang) {
	for (const [header, source] of Object.entries(shimFiles)) {
		await addFileWithDirs(
			clang,
			memfsPathFor(header),
			await rewriteProbeIncludes(header, source)
		);
	}
}

async function installProbeHeaders(clang, sourcePath, source) {
	await installShimHeaders(clang);
	const objcHeaders = JSON.parse(
		await readFile(path.join(REPO_ROOT, 'static', 'wasm-objectivec', 'headers.json'), 'utf8')
	);
	for (const [header, source] of Object.entries(objcHeaders)) {
		await addFileWithDirs(clang, header, source);
	}
	await installTransitiveHeaders(clang, sourcePath, source);
}

async function runWasmApp(module, memfs, out, ...args) {
	memfs.out = out;
	const app = new App(module, memfs, args[0], ...args.slice(1));
	await app.run();
}

function resetInstalledMemfsTracking() {
	installedMemfsDirectories.clear();
	installedMemfsFiles.clear();
	installedMemfsFileOrder.length = 0;
}

function parseMakeVariableValues(makefileSource, variableName) {
	const values = [];
	const assignmentPattern = new RegExp(`^\\s*${variableName}\\s*(?:\\+)?=\\s*(.*)$`);
	const lines = makefileSource.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(assignmentPattern);
		if (!match) continue;
		let value = match[1];
		while (value.trimEnd().endsWith('\\') && index + 1 < lines.length) {
			value = `${value.trimEnd().slice(0, -1)} ${lines[++index]}`;
		}
		values.push(
			...value
				.split(/\s+/)
				.map((item) => item.trim())
				.filter(Boolean)
		);
	}
	return values;
}

function parseSourceList(makefileSource) {
	const sources = [
		...parseMakeVariableValues(makefileSource, 'GNU_MFILES'),
		...parseMakeVariableValues(makefileSource, 'BASE_MFILES'),
		...extraArchiveSources
	];
	const seen = new Set();
	return sources
		.filter((source) => source.endsWith('.m') && !source.startsWith('$('))
		.filter((source) => !excludedArchiveSources.has(source))
		.filter((source) => {
			if (seen.has(source)) return false;
			seen.add(source);
			return true;
		});
}

function parseHeaderList(makefileSource) {
	const headers = [
		...parseMakeVariableValues(makefileSource, 'FOUNDATION_HEADERS').map(
			(header) => `Foundation/${header}`
		),
		...parseMakeVariableValues(makefileSource, 'COREFOUNDATION_HEADERS').map(
			(header) => `CoreFoundation/${header}`
		),
		...parseMakeVariableValues(makefileSource, 'GNUSTEPBASE_HEADERS').map(
			(header) => `GNUstepBase/${header}`
		)
	];
	return [...new Set(headers.filter((header) => header.endsWith('.h')))];
}

function foundationObjectNameFor(sourcePath) {
	return `${sourcePath.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}.o`;
}

function libffiObjectNameFor(sourcePath) {
	return `libffi_${sourcePath.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}.o`;
}

async function findArchiver() {
	const candidates = [
		process.env.LLVM_AR,
		path.join(
			REPO_ROOT,
			'runtimes/wasm-clang/artifacts/toolchain-build-yowasp/emsdk/upstream/bin/llvm-ar'
		),
		path.join(
			REPO_ROOT,
			'runtimes/wasm-clang/artifacts/toolchain-build/tools/wasi-sdk-33.0-x86_64-linux/bin/llvm-ar'
		),
		'llvm-ar',
		'ar'
	].filter(Boolean);
	for (const candidate of candidates) {
		if (candidate.includes(path.sep) && !(await exists(candidate))) continue;
		return candidate;
	}
	throw new Error('Unable to locate llvm-ar/ar');
}

async function createFoundationCompileRuntime() {
	await ensureGitCheckout(LIBOBJC2_DIR, LIBOBJC2_URL, LIBOBJC2_REF);
	await ensureGitCheckout(LIBS_BASE_DIR, LIBS_BASE_URL, LIBS_BASE_REF);
	if (useLibffi) {
		await ensureGitCheckout(LIBFFI_DIR, LIBFFI_URL, LIBFFI_REF);
		Object.assign(shimFiles, await readLibffiHeaders());
		console.log(`[foundation-probe] using libffi ${LIBFFI_REF} headers`);
	}
	const manifest = await loadRuntimeManifest(CLANG_MANIFEST_URL);
	const assetUrls = resolveRuntimeAssetUrls(CLANG_BASE_URL, manifest);
	return {
		assetUrls,
		clang: { memfs: await createFoundationMemfs(assetUrls) },
		clangModule: await compile(assetUrls.clang),
		manifest
	};
}

async function createFoundationMemfs(assetUrls) {
	resetInstalledMemfsTracking();
	const memfs = new MemFS({
		stdout: (output) => process.stdout.write(output),
		stdin: () => '',
		path: CLANG_BASE_URL.toString(),
		memfsModuleUrl: assetUrls.memfs
	});
	await memfs.ready;
	return memfs;
}

async function freshFoundationRuntime(runtime) {
	return {
		...runtime,
		clang: { memfs: await createFoundationMemfs(runtime.assetUrls) }
	};
}

function foundationCompileArgs(manifest, sourcePath, objectPath) {
	const resourceDir = manifest.compiler?.resourceDir || '/lib/clang/8.0.1';
	const resourceIncludeDir = `${resourceDir.replace(/\/+$/, '')}/include`;
	return [
		'clang',
		'-cc1',
		'-triple',
		'wasm32-wasi',
		'-emit-obj',
		'-disable-free',
		'-isysroot',
		'/',
		'-resource-dir',
		resourceDir,
		'-internal-isystem',
		resourceIncludeDir,
		'-internal-isystem',
		'/include/wasm32-wasi',
		'-internal-isystem',
		'/include',
		'-I.',
		'-include',
		'inttypes.h',
		'-include',
		'ctype.h',
		'-include',
		'errno.h',
		'-include',
		'math.h',
		'-include',
		'stdbool.h',
		'-include',
		memfsPathFor('GNUstepBase/preface.h'),
		'-IFoundation',
		'-IGNUstepBase',
		'-ferror-limit',
		'20',
		'-O0',
		'-ffunction-sections',
		'-fdata-sections',
		'-D__wasm__=1',
		'-D__wasm32__=1',
		'-D__GNUSTEP_RUNTIME__=1',
		'-D__OBJC_GNUSTEP_RUNTIME_ABI__=20',
		'-DGS_WITH_GC=0',
		'-DGS_USE_LIBDISPATCH=0',
		'-DGS_USE_LIBDISPATCH_RUNLOOP=0',
		'-DENOSPC=28',
		'-D__builtin_frame_address(x)=0',
		'-D__builtin_return_address(x)=0',
		'-Wno-error=implicit-function-declaration',
		'-Wno-error=incompatible-function-pointer-types',
		'-Wno-error=int-conversion',
		'-Wno-non-literal-null-conversion',
		'-o',
		objectPath,
		'-x',
		'objective-c',
		'-fobjc-runtime=gnustep-2.0',
		'-fblocks',
		sourcePath
	];
}

function libffiCompileArgs(manifest, sourcePath, objectPath) {
	const resourceDir = manifest.compiler?.resourceDir || '/lib/clang/8.0.1';
	const resourceIncludeDir = `${resourceDir.replace(/\/+$/, '')}/include`;
	return [
		'clang',
		'-cc1',
		'-triple',
		'wasm32-wasi',
		'-emit-obj',
		'-disable-free',
		'-isysroot',
		'/',
		'-resource-dir',
		resourceDir,
		'-internal-isystem',
		resourceIncludeDir,
		'-internal-isystem',
		'/include/wasm32-wasi',
		'-internal-isystem',
		'/include',
		'-I.',
		'-Iinclude',
		'-Isrc',
		'-Isrc/wasm',
		'-ferror-limit',
		'20',
		'-O2',
		'-ffunction-sections',
		'-fdata-sections',
		'-D__wasm__=1',
		'-D__wasm32__=1',
		'-D__EMSCRIPTEN__=1',
		'-DFFI_BUILDING=1',
		'-DFFI_STATIC_BUILD=1',
		'-o',
		objectPath,
		'-x',
		'c',
		sourcePath
	];
}

function foundationSupportCompileArgs(manifest, sourcePath, objectPath) {
	const resourceDir = manifest.compiler?.resourceDir || '/lib/clang/8.0.1';
	const resourceIncludeDir = `${resourceDir.replace(/\/+$/, '')}/include`;
	return [
		'clang',
		'-cc1',
		'-triple',
		'wasm32-wasi',
		'-emit-obj',
		'-disable-free',
		'-isysroot',
		'/',
		'-resource-dir',
		resourceDir,
		'-internal-isystem',
		resourceIncludeDir,
		'-internal-isystem',
		'/include/wasm32-wasi',
		'-internal-isystem',
		'/include',
		'-I.',
		'-ferror-limit',
		'20',
		'-O2',
		'-ffunction-sections',
		'-fdata-sections',
		'-D__wasm__=1',
		'-D__wasm32__=1',
		'-o',
		objectPath,
		'-x',
		'c',
		'-fblocks',
		sourcePath
	];
}

async function compileFoundationObject({ clang, clangModule, manifest }, sourceName) {
	const sourcePathOnDisk = sourceName.startsWith('Source/')
		? path.join(LIBS_BASE_DIR, sourceName)
		: path.join(LIBS_BASE_DIR, 'Source', sourceName);
	const source = patchFoundationSource(sourceName, await readFile(sourcePathOnDisk, 'utf8'));
	await installProbeHeaders(clang, sourceName, source);
	await addFileWithDirs(clang, sourceName, await rewriteProbeIncludes(sourceName, source));
	const objectName = foundationObjectNameFor(sourceName);
	const objectPath = `objects/${objectName}`;
	await addFileWithDirs(clang, objectPath, new Uint8Array(0));
	try {
		await runWasmApp(
			clangModule,
			clang.memfs,
			true,
			...foundationCompileArgs(manifest, sourceName, objectPath)
		);
	} catch (error) {
		const objectBytes = Uint8Array.from(clang.memfs.getFileContents(objectPath));
		if (objectBytes.length === 0) throw error;
		console.warn(`[foundation-probe] recovered ${sourceName} after clang output stream exit`);
	}
	const objectBytes = Uint8Array.from(clang.memfs.getFileContents(objectPath));
	if (!objectBytes.length) throw new Error(`${sourceName} did not produce an object file`);
	const diskObjectPath = path.join(OBJECT_DIR, objectName);
	await writeFile(diskObjectPath, objectBytes);
	return diskObjectPath;
}

async function compileFoundationSupportObject({ clang, clangModule, manifest }) {
	await installShimHeaders(clang);
	const sourcePath = 'wasm_idle_foundation_support.c';
	await addFileWithDirs(clang, sourcePath, foundationSupportSource);
	const objectName = 'wasm_idle_foundation_support.o';
	const objectPath = `objects/${objectName}`;
	await addFileWithDirs(clang, objectPath, new Uint8Array(0));
	try {
		await runWasmApp(
			clangModule,
			clang.memfs,
			true,
			...foundationSupportCompileArgs(manifest, sourcePath, objectPath)
		);
	} catch (error) {
		const objectBytes = Uint8Array.from(clang.memfs.getFileContents(objectPath));
		if (objectBytes.length === 0) throw error;
		console.warn('[foundation-build] recovered support object after clang output stream exit');
	}
	const objectBytes = Uint8Array.from(clang.memfs.getFileContents(objectPath));
	if (!objectBytes.length) throw new Error('foundation support did not produce an object file');
	const diskObjectPath = path.join(OBJECT_DIR, objectName);
	await writeFile(diskObjectPath, objectBytes);
	return diskObjectPath;
}

async function installLibffiCompileHeaders(clang) {
	await installShimHeaders(clang);
	for (const header of ['ffi.h', 'ffitarget.h', 'ffi_common.h', 'fficonfig.h']) {
		await addFileWithDirs(clang, header, shimFiles[header]);
		await addFileWithDirs(clang, `include/${header}`, shimFiles[header]);
	}
	await addFileWithDirs(
		clang,
		'emscripten/emscripten.h',
		`#pragma once
#define EM_JS(ret, name, args, ...) ret name args __attribute__((import_module("env"), import_name(#name)));
#define EM_JS_DEPS(tag, deps)
`
	);
}

async function compileLibffiObject({ clang, clangModule, manifest }, sourceName) {
	await installLibffiCompileHeaders(clang);
	await addFileWithDirs(
		clang,
		sourceName,
		await readFile(path.join(LIBFFI_DIR, sourceName), 'utf8')
	);
	const objectName = libffiObjectNameFor(sourceName);
	const objectPath = `objects/${objectName}`;
	await addFileWithDirs(clang, objectPath, new Uint8Array(0));
	try {
		await runWasmApp(
			clangModule,
			clang.memfs,
			true,
			...libffiCompileArgs(manifest, sourceName, objectPath)
		);
	} catch (error) {
		const objectBytes = Uint8Array.from(clang.memfs.getFileContents(objectPath));
		if (objectBytes.length === 0) throw error;
		console.warn(`[foundation-build] recovered ${sourceName} after clang output stream exit`);
	}
	const objectBytes = Uint8Array.from(clang.memfs.getFileContents(objectPath));
	if (!objectBytes.length) throw new Error(`${sourceName} did not produce an object file`);
	const diskObjectPath = path.join(OBJECT_DIR, objectName);
	await writeFile(diskObjectPath, objectBytes);
	return diskObjectPath;
}

async function compileSelectedProbeSource(runtime) {
	const { clang, clangModule, manifest } = runtime;
	const memfs = clang.memfs;
	const sourcePath = selectedSource.startsWith('Source/')
		? path.join(LIBS_BASE_DIR, selectedSource)
		: path.join(LIBS_BASE_DIR, 'Source', selectedSource);
	const source = patchFoundationSource(selectedSource, await readFile(sourcePath, 'utf8'));
	await installProbeHeaders(clang, selectedSource, source);
	await addFileWithDirs(
		clang,
		selectedSource,
		await rewriteProbeIncludes(selectedSource, source)
	);
	memfs.addFile('probe.o', new Uint8Array(0));
	try {
		await runWasmApp(
			clangModule,
			memfs,
			true,
			...foundationCompileArgs(manifest, selectedSource, 'probe.o')
		);
	} catch (error) {
		const objectBytes = Uint8Array.from(memfs.getFileContents('probe.o'));
		if (objectBytes.length === 0) throw error;
		console.warn(
			`[foundation-probe] recovered ${selectedSource} after clang output stream exit`
		);
	}
	const objectBytes = Uint8Array.from(clang.memfs.getFileContents('probe.o'));
	await mkdir(OBJECT_DIR, { recursive: true });
	await writeFile(path.join(OBJECT_DIR, foundationObjectNameFor(selectedSource)), objectBytes);
	console.log(`\n[foundation-probe] ${selectedSource} object bytes: ${objectBytes.length}`);
}

async function writeFoundationHeadersManifest(makefileSource) {
	const headers = {};
	for (const headerPath of new Set([...foundationHeaderShimPaths, ...Object.keys(shimFiles)])) {
		if (shimFiles[headerPath] != null) {
			headers[headerPath] = shimFiles[headerPath];
		}
	}
	for (const headerPath of parseHeaderList(makefileSource)) {
		const sourcePath = path.join(LIBS_BASE_DIR, 'Headers', headerPath);
		if (!(await exists(sourcePath))) continue;
		headers[headerPath] = await readFile(sourcePath, 'utf8');
	}
	await writeFile(
		path.join(STATIC_DIR, 'foundation-headers.json'),
		`${JSON.stringify(headers, null, '\t')}\n`
	);
}

async function buildFoundationArchive(runtime) {
	const makefileSource = await readFile(
		path.join(LIBS_BASE_DIR, 'Source', 'GNUmakefile'),
		'utf8'
	);
	const sourceLimit = Number(process.env.WASM_IDLE_OBJECTIVEC_FOUNDATION_SOURCE_LIMIT || '0');
	const sources = parseSourceList(makefileSource).slice(0, sourceLimit || undefined);
	await rm(BUILD_DIR, { recursive: true, force: true });
	await mkdir(OBJECT_DIR, { recursive: true });
	await mkdir(STATIC_DIR, { recursive: true });

	const objectPaths = [];
	for (const [index, sourceName] of sources.entries()) {
		console.log(`[foundation-build] compiling ${index + 1}/${sources.length} ${sourceName}`);
		objectPaths.push(
			await compileFoundationObject(await freshFoundationRuntime(runtime), sourceName)
		);
	}
	console.log('[foundation-build] compiling Foundation WASI support object');
	objectPaths.push(await compileFoundationSupportObject(await freshFoundationRuntime(runtime)));
	const libffiObjectPaths = [];
	if (useLibffi) {
		for (const [index, sourceName] of libffiArchiveSources.entries()) {
			console.log(
				`[foundation-build] compiling libffi ${index + 1}/${libffiArchiveSources.length} ${sourceName}`
			);
			libffiObjectPaths.push(
				await compileLibffiObject(await freshFoundationRuntime(runtime), sourceName)
			);
		}
	}

	const archivePath = path.join(STATIC_DIR, 'libgnustep-base.a');
	const prelinkedObjectPath = path.join(STATIC_DIR, 'libgnustep-base.o');
	await rm(archivePath, { force: true });
	await rm(prelinkedObjectPath, { force: true });
	const archiver = await findArchiver();
	await run(archiver, ['rcs', archivePath, ...objectPaths]);
	const prelinkRuntime = await freshFoundationRuntime(runtime);
	const lldModule = await compile(runtime.assetUrls.lld);
	await prelinkRuntime.clang.memfs.ready;
	for (const [index, objectPath] of objectPaths.entries()) {
		await addFileWithDirs(
			prelinkRuntime.clang,
			`objects/prelink-${index}.o`,
			new Uint8Array(await readFile(objectPath))
		);
	}
	prelinkRuntime.clang.memfs.addFile('libgnustep-base.o', new Uint8Array(0));
	await runWasmApp(
		lldModule,
		prelinkRuntime.clang.memfs,
		true,
		'wasm-ld',
		'-r',
		'-o',
		'libgnustep-base.o',
		...objectPaths.map((_, index) => `objects/prelink-${index}.o`)
	);
	await writeFile(
		prelinkedObjectPath,
		Uint8Array.from(prelinkRuntime.clang.memfs.getFileContents('libgnustep-base.o'))
	);
	if (libffiObjectPaths.length) {
		const libffiArchivePath = path.join(STATIC_DIR, 'libffi.a');
		await rm(libffiArchivePath, { force: true });
		await run(archiver, ['rcs', libffiArchivePath, ...libffiObjectPaths]);
		console.log(`[foundation-build] wrote ${libffiArchivePath}`);
	}
	await writeFoundationHeadersManifest(makefileSource);
	console.log(`[foundation-build] wrote ${archivePath}`);
	console.log(`[foundation-build] wrote ${prelinkedObjectPath}`);
	console.log(`[foundation-build] wrote ${path.join(STATIC_DIR, 'foundation-headers.json')}`);
}

async function prelinkExistingFoundationObjects(runtime) {
	const selectedSources = (process.env.WASM_IDLE_OBJECTIVEC_FOUNDATION_PRELINK_SOURCES || '')
		.split(',')
		.map((source) => source.trim())
		.filter(Boolean);
	if (!selectedSources.length) {
		throw new Error('WASM_IDLE_OBJECTIVEC_FOUNDATION_PRELINK_SOURCES is required');
	}
	const objectPaths = selectedSources.map((sourceName) =>
		path.join(
			OBJECT_DIR,
			sourceName === 'wasm_idle_foundation_support.c'
				? 'wasm_idle_foundation_support.o'
				: foundationObjectNameFor(sourceName)
		)
	);
	for (const objectPath of objectPaths) {
		if (!(await exists(objectPath))) {
			throw new Error(`missing cached Foundation object: ${objectPath}`);
		}
	}
	const prelinkedObjectPath = path.join(STATIC_DIR, 'libgnustep-base.o');
	const archivePath = path.join(STATIC_DIR, 'libgnustep-base.a');
	await mkdir(STATIC_DIR, { recursive: true });
	await rm(prelinkedObjectPath, { force: true });
	await rm(archivePath, { force: true });
	const archiver = await findArchiver();
	await run(archiver, ['rcs', archivePath, ...objectPaths]);
	const prelinkRuntime = await freshFoundationRuntime(runtime);
	const lldModule = await compile(runtime.assetUrls.lld);
	await prelinkRuntime.clang.memfs.ready;
	for (const [index, objectPath] of objectPaths.entries()) {
		await addFileWithDirs(
			prelinkRuntime.clang,
			`objects/prelink-${index}.o`,
			new Uint8Array(await readFile(objectPath))
		);
	}
	prelinkRuntime.clang.memfs.addFile('libgnustep-base.o', new Uint8Array(0));
	await runWasmApp(
		lldModule,
		prelinkRuntime.clang.memfs,
		true,
		'wasm-ld',
		'-r',
		'-o',
		'libgnustep-base.o',
		...objectPaths.map((_, index) => `objects/prelink-${index}.o`)
	);
	await writeFile(
		prelinkedObjectPath,
		Uint8Array.from(prelinkRuntime.clang.memfs.getFileContents('libgnustep-base.o'))
	);
	console.log(`[foundation-build] wrote ${prelinkedObjectPath}`);
	console.log(`[foundation-build] wrote ${archivePath}`);
	console.log(`[foundation-build] prelinked ${objectPaths.length} cached Foundation objects`);
}

async function main() {
	const runtime = await createFoundationCompileRuntime();
	if (prelinkExisting) {
		await prelinkExistingFoundationObjects(runtime);
		return;
	}
	if (buildArchive) {
		await buildFoundationArchive(runtime);
		return;
	}
	await compileSelectedProbeSource(runtime);
}

main().catch((error) => {
	console.error(`\n[foundation-probe] ${selectedSource} failed:`);
	console.error(error?.stack || error?.message || error);
	process.exitCode = 1;
});
