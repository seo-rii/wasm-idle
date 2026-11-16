/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Host portability for the original GNU APL engine. Native process, resolver
 * and terminal facilities are unavailable in the browser and fail explicitly.
 * Language parsing, evaluation and file I/O remain in GNU APL/WASI libc. */
#include "wasi-host.h"
#include "termios.h"
#include "netdb.h"
#include <errno.h>
#include <semaphore.h>

extern "C" {
FILE *popen(const char *, const char *) { errno = ENOSYS; return nullptr; }
int pclose(FILE *) { errno = ENOSYS; return -1; }
pid_t fork(void) { errno = ENOSYS; return -1; }
pid_t getpid(void) { errno = ENOSYS; return -1; }
int pipe(int[2]) { errno = ENOSYS; return -1; }
int dup2(int, int) { errno = ENOSYS; return -1; }
int execve(const char *, char *const[], char *const[]) { errno = ENOSYS; return -1; }
int chroot(const char *) { errno = ENOSYS; return -1; }
int setuid(uid_t) { errno = ENOSYS; return -1; }
int pthread_cancel(pthread_t) { return ENOSYS; }
int pthread_setname_np(pthread_t, const char *) { return ENOSYS; }
int sem_init(sem_t *, int, unsigned int) { errno = ENOSYS; return -1; }
int sem_destroy(sem_t *) { errno = ENOSYS; return -1; }
int sem_wait(sem_t *) { errno = ENOSYS; return -1; }
int sem_post(sem_t *) { errno = ENOSYS; return -1; }
sem_t *sem_open(const char *, int, ...) { errno = ENOSYS; return SEM_FAILED; }
int sem_close(sem_t *) { errno = ENOSYS; return -1; }
int tcgetattr(int, struct termios *) { errno = ENOTTY; return -1; }
int tcsetattr(int, int, const struct termios *) { errno = ENOTTY; return -1; }
struct hostent *gethostbyname(const char *) { errno = ENOSYS; return nullptr; }
int getrlimit(int, struct rlimit *limit) {
    if (limit) { limit->rlim_cur = 0; limit->rlim_max = 0; }
    errno = ENOSYS;
    return -1;
}
int setrlimit(int, const struct rlimit *) { errno = ENOSYS; return -1; }
int socket(int, int, int) { errno = ENOSYS; return -1; }
int socketpair(int, int, int, int[2]) { errno = ENOSYS; return -1; }
int connect(int, const struct sockaddr *, socklen_t) { errno = ENOSYS; return -1; }
int bind(int, const struct sockaddr *, socklen_t) { errno = ENOSYS; return -1; }
int listen(int, int) { errno = ENOSYS; return -1; }
int getsockname(int, struct sockaddr *, socklen_t *) { errno = ENOSYS; return -1; }
int getpeername(int, struct sockaddr *, socklen_t *) { errno = ENOSYS; return -1; }
ssize_t sendto(int, const void *, size_t, int, const struct sockaddr *, socklen_t) {
    errno = ENOSYS; return -1;
}
ssize_t recvfrom(int, void *, size_t, int, struct sockaddr *, socklen_t *) {
    errno = ENOSYS; return -1;
}
int setsockopt(int, int, int, const void *, socklen_t) { errno = ENOSYS; return -1; }
int sigaction(int number, const struct sigaction *action, struct sigaction *previous) {
    if (!action) { errno = ENOSYS; return -1; }
    void (*old_handler)(int) = signal(number, action->sa_handler);
    if (old_handler == SIG_ERR) return -1;
    if (previous) previous->sa_handler = old_handler;
    return 0;
}
}
