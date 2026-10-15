# BusyBox WASI producer probe

Status: **G0 producer probe; browser/container qualification is separate**. This
directory pins an upstream BusyBox source and a minimal six-applet configuration.
The committed receipt records the actual native and Node WASI results. Registration
as a supported container package additionally requires browser byte tests.

The source is BusyBox 1.37.0, pinned to the checksum published next to its official
archive. `config/b0.config` requests `cat`, `echo`, `false`, `printf`, `pwd`, `true`,
and the real upstream multicall entry. The script overlays that fragment onto
`allnoconfig`, resolves `oldconfig`, and checks the effective B0/no-shell flags.
BusyBox 1.37.0's `allnoconfig` resets boolean values even when `KCONFIG_ALLCONFIG`
names a fragment; that mechanism alone is insufficient. No shell interpreter,
fake libc successes, or host command interception is introduced. The
[classified patch set](patches/README.md) limits headers and linked helpers to B0;
it does not replace the upstream applet bodies.

`manifest.json` records exact source/config hashes and fingerprints the existing
local WASI SDK 33 toolchain, its selected WASI Preview 1 sysroot and Clang resource
directory. `bin/clang`, `wasm-ld` and the LLVM archive tools are small launchers
over the SDK's shared `libclang-cpp` and `libLLVM` libraries, so those libraries and
the automatically loaded `bin/clang.cfg`, which selects the sysroot, are pinned as
well. `evidence/g0-busybox.json` predates these three pins; they were computed from
the same local SDK installation, which still matches every earlier pin.
When a link passes an optimization flag, clang's WebAssembly driver also runs a
`wasm-opt` found in the SDK `bin` directory or `PATH`; BusyBox's `trylink` passes
its compiler flags to the final link. That host tool is outside the SDK pin, so the
receipt records its path, hash and `--version` output as `toolchain.implicitWasmOpt`
(`null` when none is found). Matching artifact bytes also require the same
`wasm-opt`. The G0 receipt predates this record.
The SDK fingerprint is a local build pin, not a claim that every
installation with the label `33` has identical bytes. The script refuses different
bytes. To move to another toolchain, review and update its pin and rerun the probe.

```sh
python3 runtimes/wasm-busybox/scripts/probe.py \
  --sdk /path/to/the/pinned/wasi-sdk \
  --work-dir /path/to/a/new/probe-directory \
  --source-archive /path/to/busybox-1.37.0.tar.bz2

python3 runtimes/wasm-busybox/scripts/verify.py /path/to/the/completed/probe-directory
```

Omit `--source-archive` to fetch the pinned official archive. The script verifies
size/hash before extraction, limits entry count/bytes, and rejects unexpected
archive members. Supply a new work directory on each run. Patch, configure, build
and Node smoke commands receive only the caller's `PATH`, `HOME` and `TMPDIR` plus fixed
locale/timestamp variables; caller `CFLAGS`, `LDFLAGS`, `MAKEFLAGS` and similar
settings do not reach the build. It writes separate WASI
and native configure/build logs with mode 0600, a generated configuration copy,
and `receipt.json`. Long invocations should run in a persistent background process
with a private outer log and exit-status file.

The producer probe returns nonzero until both native and Node WASI byte smoke
pass. Browser/container qualification remains a separate gate. Native execution
is a differential baseline, not evidence of WASI support. Both multicall
`busybox <applet>` and alias `argv[0]` invocation are tested using actual upstream
code. Binary stdout/stderr are compared directly, including NUL and non-UTF-8
bytes, missing-file diagnostics, and `false` must retain its exit code. `pwd` and
relative `cat` use a real libc cwd containing a space, with an empty environment.
On success, the probe writes
`busybox.wasm`, an import/export and memory inventory, a Node WASI smoke receipt,
and a source pack containing the upstream archive, license and port inputs. Node
WASI runs trusted local fixtures only; it is not the container's browser sandbox.

The B0 artifact requires the trusted host import
`wasm_idle_process_v1.initial_cwd(ptr: i32, capacity: i32) -> i32` in addition to
WASI Preview 1. The host writes UTF-8 cwd plus NUL and returns the byte count
including NUL, or returns -1 for insufficient capacity/invalid memory range.
A priority-101 constructor uses a 4096-byte buffer and performs actual libc
`chdir()` before the upstream entry. Invalid output or an inaccessible directory
exits 125. This is an explicit producer ABI, not an injected `PWD` environment
entry. Native builds retain normal OS cwd behavior. The smoke includes four
startup failure cases and bounds-checks the host's normal import implementation.

`evidence/g0-busybox.json` and [the probe ledger](../../docs/container-busybox-probe.md)
record the observed gate. No generated binary or source archive is committed.
The native artifact is a local test artifact only. A future distributable port
must provide its import/export inventory, native and browser smoke, complete
corresponding source/patch/config/build materials and notices before qualification.

The source archive's `LICENSE` identifies GPL version 2 only. Keep corresponding
source materials with any binary distribution. The [official license page](https://busybox.net/license.html)
and [upstream build/porting FAQ](https://busybox.net/FAQ.html) are the primary
references; `CONFIG_NOMMU` alone does not create a browser process backend.
