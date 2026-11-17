/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Declarations for native process APIs absent from WASI. The implementation
 * reports ENOSYS; it does not create processes or access the host machine. */
#ifndef WASM_IDLE_APL_WASI_HOST_H
#define WASM_IDLE_APL_WASI_HOST_H
#include <stdio.h>
#include <unistd.h>
#include <sys/types.h>
#include <signal.h>
#include <sys/socket.h>
#include <pthread.h>

typedef unsigned long long rlim_t;
struct rlimit {
    rlim_t rlim_cur;
    rlim_t rlim_max;
};
enum { RLIMIT_CPU = 0, RLIMIT_DATA = 2, RLIMIT_AS = 9 };
#define RLIM_INFINITY (~0ULL)
#define SO_REUSEADDR 2

/* GNU APL uses only sa_handler. WASI's own signal() emulation supplies it. */
struct sigaction { void (*sa_handler)(int); };

#ifdef __cplusplus
extern "C" {
#endif
FILE *popen(const char *command, const char *mode);
int pclose(FILE *stream);
pid_t fork(void);
pid_t getpid(void);
int pipe(int descriptors[2]);
int dup2(int source, int destination);
int execve(const char *path, char *const argv[], char *const envp[]);
int chroot(const char *path);
int setuid(uid_t uid);
int pthread_cancel(pthread_t thread);
int getrlimit(int resource, struct rlimit *limit);
int setrlimit(int resource, const struct rlimit *limit);
int sigaction(int signal_number, const struct sigaction *action,
              struct sigaction *previous);
int socket(int domain, int type, int protocol);
int socketpair(int domain, int type, int protocol, int descriptors[2]);
int connect(int descriptor, const struct sockaddr *address, socklen_t length);
int bind(int descriptor, const struct sockaddr *address, socklen_t length);
int listen(int descriptor, int backlog);
int getsockname(int descriptor, struct sockaddr *address, socklen_t *length);
int getpeername(int descriptor, struct sockaddr *address, socklen_t *length);
ssize_t sendto(int descriptor, const void *buffer, size_t length, int flags,
               const struct sockaddr *address, socklen_t address_length);
ssize_t recvfrom(int descriptor, void *buffer, size_t length, int flags,
                 struct sockaddr *address, socklen_t *address_length);
int setsockopt(int descriptor, int level, int option, const void *value,
               socklen_t length);
#ifdef __cplusplus
}
#endif
#endif
