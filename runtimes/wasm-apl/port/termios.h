/* SPDX-License-Identifier: GPL-3.0-or-later */
/* WASI has no terminal attributes. These declarations let GNU APL retain its
 * original terminal code; the accompanying host functions return ENOTTY.
 * This is not a native termios ABI and must never be used on a native target. */
#ifndef WASM_IDLE_APL_TERMIOS_H
#define WASM_IDLE_APL_TERMIOS_H

typedef unsigned int tcflag_t;
struct termios {
    tcflag_t c_iflag;
    tcflag_t c_lflag;
};

enum {
    IGNBRK = 1 << 0, IGNPAR = 1 << 1, ISTRIP = 1 << 2,
    INLCR = 1 << 3, IGNCR = 1 << 4, ICRNL = 1 << 5,
    ISIG = 1 << 6, ICANON = 1 << 7, ECHO = 1 << 8,
    ECHONL = 1 << 9, IEXTEN = 1 << 10, TCSANOW = 0
};

#ifdef __cplusplus
extern "C" {
#endif
int tcgetattr(int fd, struct termios *attributes);
int tcsetattr(int fd, int action, const struct termios *attributes);
#ifdef __cplusplus
}
#endif
#endif
