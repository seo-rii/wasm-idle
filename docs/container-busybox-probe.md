# G0-BUSYBOX: bounded B0 and B1 ports

This probe keeps BusyBox's six selected applet implementations and its multicall
dispatcher. It is a producer experiment for `cat`, `echo`, `false`, `printf`,
`pwd` and `true`. The later B1 producer extends this baseline as described below. Neither
producer qualification establishes a shell, process spawning, terminal control,
or live container filesystem sharing.

Source and build inputs are pinned in
[`runtimes/wasm-busybox/manifest.json`](../runtimes/wasm-busybox/manifest.json).
BusyBox 1.37.0's official 2,565,764-byte archive has SHA-256
`3311dff32e746499f4df0d5df04d7eb396382d7e108bb9250e7b519b837043a4`.
The existing WASI SDK 33.0+m uses LLVM
`4434dabb69916856b824f68a64b029c67175e532` and wasi-libc `161b3195fc25`;
the manifest also pins actual compiler/linker/archive tools, the shared
`libclang-cpp`/`libLLVM` libraries those launchers load, the automatically loaded
`bin/clang.cfg` sysroot selection, and sysroot/resource tree hashes. Merely
installing another SDK named `33` does not satisfy that pin. Clang can also run an
unpinned host `wasm-opt` after an optimized link; the receipt records that tool's
path, hash and version rather than pinning it.

The producer's current gate and measured bytes are recorded in
[`evidence/g0-busybox.json`](../runtimes/wasm-busybox/evidence/g0-busybox.json).
Native byte fixtures are a reference baseline. Node WASI evidence and actual
browser/container evidence are separate fields, so a native-only success cannot
promote an applet to browser support.

The bounded port resolved these concrete build boundaries:

| Boundary | Evidence and decision |
| --- | --- |
| Effective configuration | Upstream `allnoconfig` resets requested boolean options even with `KCONFIG_ALLCONFIG`. Apply a fragment after that baseline, run `oldconfig`, and assert selected applets plus no shell/SUID flags. |
| Common includes | The first unmodified WASI compile stops at `libbb.h:20`, missing `netdb.h`. Further targeted compilation exposes setjmp/EH, process-clock, mount, terminal and account declarations. Exclude unused declarations for B0. |
| Unconditional library objects | Minimal applet configuration still builds archive and account libraries; `data_extract_all.c` requires unavailable `mknod`/`chown`. Restrict the build to coreutils and the actual B0 helper closure. |
| Shared helper source files | Needed allocation and numeric helpers share files with terminal, process, identity, mmap and temporary-file APIs. Guard unused definitions instead of returning fabricated success. |
| Linker dialect | wasm-ld rejects GNU `-nostdlib`, `--start-group` and `--end-group`. Use its real partial/archive link behavior and supported map output. |
| BusyBox help/list output | Upstream redirects fd 2 using `dup2`. The WASI batch path writes help/list directly to stdout and uses a declared 80-column layout. Applet diagnostics still use stderr. |
| Entry retention | WASI libc has a weak `__main_argc_argv` reference. Without explicit archive extraction, a link can succeed with a trapping weak entry and no applet code. Root the real compiler-generated entry with `--undefined=__main_argc_argv`; byte smoke must pass before accepting an artifact. |
| Memory and file offsets | Declare a 64 MiB Wasm memory maximum. `CONFIG_LFS=y` matches WASI libc's 64-bit `off_t`; a 4 KiB copy buffer avoids the optional mmap/sendfile branch. |
| Initial cwd | A versioned `wasm_idle_process_v1.initial_cwd` import copies the trusted cwd into a bounded 4096-byte buffer. A constructor calls actual libc `chdir` before the upstream entry; invalid or inaccessible cwd exits 125. An environment variable is not used to imitate cwd. |

The [patch ledger](../runtimes/wasm-busybox/patches/README.md) records one patch per
cause. No applet, shell parser, filesystem, process API or network API is
replaced with a mock. Adding more applets requires expanding this proven closure
and rerunning their own runtime fixtures.

The smoke matrix checks both `busybox <applet>` and argv0 alias dispatch. It
includes NUL/0xff printf output, numeric formatting and UTF-8 arguments, all 256
byte values through stdin, relative and absolute filenames containing spaces,
separate stderr from a missing file, and ordinary nonzero exit from `false`.
With an empty environment, `pwd` must print `/workspace/a b` and relative `cat`
must read the file in that actual cwd. Four additional fixtures reject invalid
startup cwd responses or a nonexistent directory with exit 125. Produced Wasm
must export `_start` and memory, have one unshared wasm32 memory with an explicit
maximum, and import only Preview 1 functions plus the declared process cwd ABI.

Browser qualification must additionally run these bytes through the container's
actual adapter, record its application/browser identity, and verify workspace,
fd, cancellation and mount behavior. The producer does not implement those host
responsibilities. Node's WASI runner is used only for trusted local fixtures.

Source distribution uses the selected archive's GPL version 2 only notice. The
producer creates a source pack with that archive, `LICENSE`, requested and generated configurations,
patches, manifest and build/verification instructions. No binary is committed or
published by this probe.

Primary references: [official source archives](https://busybox.net/downloads/),
[BusyBox build/multicall/porting FAQ](https://busybox.net/FAQ.html),
[BusyBox license notice](https://busybox.net/license.html), and
[Node WASI API and security boundary](https://nodejs.org/api/wasi.html).

## B1 subset

The next producer uses the same pinned source/toolchain and process cwd ABI for
real `grep`, `mkdir`, `cp`, `mv` and `rm`. Its four classified patches expand the
build closure and reject unavailable metadata/copy semantics before file changes.
They do not add successful libc stubs. The new import closure is still WASI
Preview 1 plus `wasm_idle_process_v1.initial_cwd`; it adds directory traversal,
create/remove/rename, symlink/readlink and fd flag operations.

`grep` uses the upstream algorithm with the selected WASI libc regex engine.
A native/WASI differential exposed the small upstream profile silently ignoring
`-a/-I` and truncating NUL-containing input. This port rejects those options and
NUL text input with exit 2. The full EXTRA_COMPAT path requires GNU regex APIs
absent from the pinned WASI libc; no replacement regex engine is introduced.
`mkdir -m` fails explicitly; creation modes belong to the host. `cp` qualifies
regular files and symlinks, while `-p/-a/-r/-R/-l/-s` and special files are rejected.
`mv` qualifies actual same-mount rename; EXDEV is reported without deleting an
existing destination or source. Recursive `rm` retains real upstream directory
iteration and unlink/rmdir calls.

The B1 matrix compares bytes, exit status and final file/directory/symlink trees
against the native build for each selected operation and both invocation forms.
It checks nonzero exits with partial successful writes, unsupported options with
an unchanged destination, paths with spaces and literal backslashes, 8 KiB read
boundaries, NUL/0xff data, and removal of a 200-entry directory. Regex parse errors
must report nonzero/stderr, but libc-specific wording is not required to match.
File mode, uid/gid and timestamps are not part of this profile's tree comparison.
The B0 byte/cwd/startup failure regressions remain mandatory. Downstream browser
qualification consumes the exact artifact, receipt and hash-pinned data matrix;
it must separately prove the container VFS and cache behavior.

The [B1 receipt](../runtimes/wasm-busybox/evidence/b1-busybox.json) records 20 native
B0 cases, 24 Node WASI B0/startup cases, and 108 B1 executions: 88 native
differential cases and 20 explicit profile rejections. Six rejection cases also
record the upstream native behavior. The resulting 447,557-byte artifact has
SHA-256 `547827daf25957a4e2f77ba9ba76b4734f363f867a8a5cb39302dce1b1c36ade`.
Its 2,580,335-byte source pack has SHA-256
`ca68639e0a6a159e55000594011e6b60f4850248e8edd5918d10b225e0afe818`.
[Verification evidence](../runtimes/wasm-busybox/evidence/b1-verification.json)
records successful producer/source-pack verification and rejection of modified
artifact bytes. A native build timeout remains in the receipt; the documented
continuation verified the complete prepared source tree before finishing the
same single-worker build and rerunning its tests.
