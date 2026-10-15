# BusyBox WASI producer probe

Status: **G0 producer probe; browser/container qualification is separate**. This
directory pins an upstream BusyBox source and a restricted eleven-applet configuration.
The committed receipt records the actual native and Node WASI results. Registration
as a supported container package additionally requires browser byte tests.

The source is BusyBox 1.37.0, pinned to the checksum published next to its official
archive. `config/b1.config` requests the B0 `cat`, `echo`, `false`, `printf`, `pwd`,
`true` applets plus B1 `grep`, `mkdir`, `cp`, `mv`, `rm`, and the real upstream
multicall entry. `config/b0.config` is retained as the historical baseline. The script overlays that fragment onto
`allnoconfig`, resolves `oldconfig`, and checks the effective selected-applet/no-shell flags.
BusyBox 1.37.0's `allnoconfig` resets boolean values even when `KCONFIG_ALLCONFIG`
names a fragment; that mechanism alone is insufficient. No shell interpreter,
fake libc successes, or host command interception is introduced. The
[classified patch set](patches/README.md) limits headers and linked helpers to the selected applets. B1 adds explicit
capability rejection to the real mkdir/copy/move paths; it does not replace their
file operations or grep regex engine.

`manifest.json` records exact source/config hashes and fingerprints the existing
local WASI SDK 33 toolchain, its selected WASI Preview 1 sysroot and Clang resource
directory. The SDK fingerprint is a local build pin, not a claim that every
installation with the label `33` has identical bytes. The script refuses different
bytes. To move to another toolchain, review and update its pin and rerun the probe.

```sh
python3 runtimes/wasm-busybox/scripts/probe.py \
  --sdk /path/to/the/pinned/wasi-sdk \
  --work-dir /path/to/a/new/probe-directory \
  --source-archive /path/to/busybox-1.37.0.tar.bz2 --jobs 1

python3 runtimes/wasm-busybox/scripts/verify.py /path/to/the/completed/probe-directory
```

Omit `--source-archive` to fetch the pinned official archive. The script verifies
size/hash before extraction, limits entry count/bytes, and rejects unexpected
archive members. Supply a new work directory on each run. It writes separate WASI
and native configure/build logs with mode 0600, a generated configuration copy,
and `receipt.json`. Long invocations should run in a persistent background process
with a private outer log and exit-status file.

A completed attempt whose WASI gate passed but native build timed out can be
continued once with `scripts/resume-native.py WORK --source-archive ARCHIVE
--timeout 900`. It reconstructs and hashes the entire pinned patched source,
checks configs/compiler/artifact/test-script identities, preserves the failed
receipt, and resumes only the native make with one job. The final receipt records
that continuation and includes its script in the source pack. A source mismatch
or an unrelated failure is not accepted as a resumable attempt.

The producer returns nonzero until the B0 regression and B1 native/Node WASI
differential fixtures pass. Builds allow only one or two compiler jobs. Browser/container qualification remains a separate gate. Native execution
is a differential baseline, not evidence of WASI support. Both multicall
`busybox <applet>` and alias `argv[0]` invocation are tested using actual upstream
code. Binary stdout/stderr are compared directly, including NUL and non-UTF-8
bytes, missing-file diagnostics, and `false` must retain its exit code. `pwd` and
relative `cat` use a real libc cwd containing a space, with an empty environment.
On success, the probe writes
`busybox.wasm`, an import/export and memory inventory, a Node WASI smoke receipt,
and a source pack containing the upstream archive, license and port inputs. Node
WASI runs trusted local fixtures only; it is not the container's browser sandbox.


The B1 profile qualifies operations individually:

| Applet | Selected behavior | Explicit limits |
| --- | --- | --- |
| `grep` | Basic/extended/fixed matching, UTF-8 literal bytes, non-UTF-8 bytes without NUL, file/stdin, line numbering, case folding, inversion and recursive file traversal | `-a`/`-I` and NUL input fail explicitly; libc regex diagnostic wording can differ |
| `mkdir` | Directory creation, `-p`, relative paths, symlink parents, partial changes on nonzero exit | `-m` fails before creation; the host owns creation modes and no umask is emulated |
| `cp` | Regular file bytes, overwrite/truncate, multiple sources, `-n`, symlink dereference and `-d` preservation | `-p`, `-a`, `-r`, `-R`, `-l`, `-s` fail before destination mutation; special files are rejected |
| `mv` | Same-mount file/directory/symlink rename, overwrite, `-n` | A failed cross-mount rename reports an error without copy/unlink fallback |
| `rm` | File/symlink removal, `-f`, recursive removal, errors after partial successful removal | No permission/ownership emulation; filesystem errors remain visible |

This is a batch byte-stream profile. It provides no PTY, shell, live pipeline,
job control, metadata preservation, hardlinks, ownership or permission mutation.
B1 native builds retain upstream behavior for rejected WASI-only operations;
their fixtures instead assert an explicit WASI failure with unchanged files.
The grep NUL/`-a`/`-I` cases additionally record native success/truncation as a
negative control, alongside the intentional WASI rejection. Both builds apply
the same source patches, but only `ARCH=wasm32` defines the port guards.
All other B1 fixtures compare native and WASI exit, bytes and resulting tree.
Both multicall and argv0 forms run in a real cwd with spaces. The matrix includes
200 entries to exercise directory iteration while recursive removal mutates it.
`test/b1-cases.mjs` emits a hash-pinned data matrix for downstream browser tests;
`b1-smoke.json` records per-invocation native/WASI evidence. Modes, ownership and
timestamps are deliberately outside the compared tree schema.

The artifact requires the trusted host import
`wasm_idle_process_v1.initial_cwd(ptr: i32, capacity: i32) -> i32` in addition to
WASI Preview 1. The host writes UTF-8 cwd plus NUL and returns the byte count
including NUL, or returns -1 for insufficient capacity/invalid memory range.
A priority-101 constructor uses a 4096-byte buffer and performs actual libc
`chdir()` before the upstream entry. Invalid output or an inaccessible directory
exits 125. This is an explicit producer ABI, not an injected `PWD` environment
entry. Native builds retain normal OS cwd behavior. The smoke includes four
startup failure cases and bounds-checks the host's normal import implementation.

`evidence/g0-busybox.json` preserves the earlier B0 evidence.
`evidence/b1-busybox.json`, `evidence/b1-verification.json`,
and [the probe ledger](../../docs/container-busybox-probe.md)
record the observed gate. No generated binary or source archive is committed.
The native artifact is a local test artifact only. A future distributable port
must provide its import/export inventory, native and browser smoke, complete
corresponding source/patch/config/build materials and notices before qualification.

The source archive's `LICENSE` identifies GPL version 2 only. Keep corresponding
source materials with any binary distribution. The [official license page](https://busybox.net/license.html)
and [upstream build/porting FAQ](https://busybox.net/FAQ.html) are the primary
references; `CONFIG_NOMMU` alone does not create a browser process backend.
