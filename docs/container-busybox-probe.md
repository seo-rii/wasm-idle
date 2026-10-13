# G0-BUSYBOX: a bounded B0 port

This probe keeps BusyBox's six selected applet implementations and its multicall
dispatcher. It is a producer experiment for `cat`, `echo`, `false`, `printf`,
`pwd` and `true`. It does not qualify B1 utilities, a shell, process spawning,
terminal control, or live container filesystem sharing.

Source and build inputs are pinned in
[`runtimes/wasm-busybox/manifest.json`](../runtimes/wasm-busybox/manifest.json).
BusyBox 1.37.0's official 2,565,764-byte archive has SHA-256
`3311dff32e746499f4df0d5df04d7eb396382d7e108bb9250e7b519b837043a4`.
The existing WASI SDK 33.0+m uses LLVM
`4434dabb69916856b824f68a64b029c67175e532` and wasi-libc `161b3195fc25`;
the manifest also pins actual compiler/linker/archive tools and sysroot/resource
tree hashes. Merely installing another SDK named `33` does not satisfy that pin.

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
cause. No applet body, shell parser, filesystem, process API or network API is
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
