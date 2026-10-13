# B0-only WASI patch boundary

Apply patches in filename order to the pinned BusyBox 1.37.0 source. They preserve
the upstream bodies of all six selected applets and its multicall dispatch.
`BB_WASI_B0` is set only for `ARCH=wasm32`. The native reference build compiles the
original helpers and paths.

| Patch | Cause and scope |
| --- | --- |
| `0001-wasi-b0-declarations.patch` | Exclude unused network, account, signal, process-clock, mmap, setjmp and terminal declarations from this restricted profile. No fabricated types or successful calls replace them. |
| `0002-wasi-b0-libbb-exclusions.patch` | Exclude unused mmap, identity-changing, pipe/dup, network, terminal and process helper definitions in the shared allocation/stdio file. Suppress glibc malloc tuning. Allocation, read/write, open and diagnostics used by B0 remain upstream code. |
| `0003-wasi-b0-build-closure.patch` | Build only `coreutils` and the explicit B0 `libbb` closure. Minimal Kconfig still compiles unrelated archive/account libraries. Declare a hard 64 MiB Wasm memory maximum and retain the real entry from the archive instead of libc's trapping weak entry. |
| `0004-wasm-partial-link.patch` | Omit the GNU linker compatibility flag `-nostdlib` from raw `wasm-ld -r` invocations. |
| `0005-wasi-b0-help-output.patch` | Write help/list bytes directly to stdout in WASI batch mode, instead of duplicating fd 1 onto fd 2. Use 80-column help layout because batch mode has no terminal. |
| `0006-wasm-final-link.patch` | Omit GNU archive group and informational options unsupported by wasm-ld. wasm-ld resolves archive dependencies without the GNU group flags. |
| `0007-process-initial-cwd.patch` | A priority-101 constructor obtains the initial cwd from the versioned host import, validates its NUL-terminated result, and calls libc `chdir` before the real multicall entry. Invalid or inaccessible cwd exits 125. Environment entries are unchanged. |

No shell parser, fake process success, network implementation or filesystem stub
is introduced. Unsupported applets remain disabled. Extending this closure needs
real syscall support or explicit feature exclusion, then native/WASI/browser tests.

`CONFIG_LFS=y` matches WASI libc's 64-bit `off_t`. A 4 KiB copy buffer selects
upstream `read`/`write` copying without optional mmap/sendfile. These configuration
choices do not change `cat` byte semantics.
