/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Browser WASI has no resolver. gethostbyname always reports unavailable. */
#ifndef WASM_IDLE_APL_NETDB_H
#define WASM_IDLE_APL_NETDB_H
struct hostent {
    char *h_name;
    char **h_aliases;
    int h_addrtype;
    int h_length;
    char **h_addr_list;
};
#ifdef __cplusplus
extern "C" {
#endif
struct hostent *gethostbyname(const char *name);
#ifdef __cplusplus
}
#endif
#endif
