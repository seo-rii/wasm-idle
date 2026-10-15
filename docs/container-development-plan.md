# Container development plan

Status: implementation ledger for the 2026-10-13 design proposal. Version numbers below are
qualification targets, not release promises. Unpassed gates remain unsupported.

## Baseline and ownership

The proposal inspected wasm-idle `75b1c358a5d3a97f7ee14a47ed582fab4dd64d28` and wasm-llvm
`25ef7345eba86fce0352e7eb0a881e23ed0e684f`. Implementation starts from wasm-idle
`814830465` (main, 2026-10-13): PR #124 subsequently restored the complete C/C++ headers and
self-contained MemFS delivery receipt. wasm-llvm main still matches the proposal baseline.
The active Kotlin checkouts are independent of this stack.

wasm-llvm owns pinned sources, patches, compiler builds, archives and receipts. wasm-idle owns
browser execution, workers, VFS, process supervision and the new `@wasm-idle/container` host
package. Existing `createClangCompiler` and artifact APIs remain available. Core must never
import container; LLVM uses structural tool-host types, not a reverse dependency.

## Product contract

The first deliverable is a command container: memory workspace, byte streams, direct argv,
WASI execution and command-lazy verified assets. A real shell is a separate gate. Neither a
JavaScript command parser nor a high-level compile wrapper qualifies as Bash or the Clang CLI.
Linux, ELF, Docker, arbitrary native npm addons, full fork/job control and unrestricted network
are outside this project. WASI components and additional languages are future adapters.

The shell acceptance script must run in `/bin/bash --noprofile --norc`:

```sh
set -eu
mkdir -p /workspace/demo
cd /workspace/demo
printf '#include <stdio.h>\nint main(void){puts("hello");return 0;}\n' > main.c
clang main.c -o hello.wasm
./hello.wasm | grep hello > result.txt
cat result.txt
```

Pass requires all three files in the same workspace, real Bash/Clang/BusyBox, shared fd/FS
semantics, no Clang body request before its command, and no repeated body request when the
verified cache survives. Printing `hello` alone is insufficient evidence.

## Qualification gates

| Stage | Required evidence | Not yet promised |
| --- | --- | --- |
| G0 | Real Bash external exec, fd/FS/cancel; Clang imports/driver; BusyBox port probe | A shell backend merely because WASIX has proc_spawn |
| P1 / 0.1 foundation | PROC-01–05, FD-01–03, FS-01–04 with actual Wasm and Worker cancellation | Interactive stdin without isolation |
| P2 / command alpha | PKG-01–08, CLI-01–03, FS-05–06; real compile/link/run | Live snapshot files or shell MVP |
| P3 / userland | BB-01, selected B0/B1 native/browser applet fixtures | All BusyBox applets |
| P4 / 0.2 shell | FD-04–06, FS-07, SH-01–04, DEPLOY-01 and the script above | Full job control or POSIX certification |
| P5 / 0.3 persistence | PERSIST-01–04, single writer recovery and lifecycle UI | Browser storage permanence or full offline boot |
| P6 / qualified SDK | Fixed profiles, receipts, source/notice packs and reproducible browser benchmarks | Unmeasured performance or file/chunk lazy loading |

G0 may conclude with a reproducible blocked backend. In that case independent P1/P2 work
continues, but P4 cannot be declared complete. See the backend ADR and compatibility ledger.

### Fixture IDs

A gate passes only when every listed ID has evidence for the requirement below at the stage's
level (real guest, Worker or browser where the stage says so). Host-only primitive tests may
cite an ID as partial evidence but do not pass it. New IDs are added here before use.

| ID | Requirement |
| --- | --- |
| PROC-01 | argv/env reach a real guest byte-exactly (empty, spaces, UTF-8, backslash); spawn snapshots them |
| PROC-02 | Real cwd, binary stdin with EOF; nonzero exit is a result and keeps files written before exit |
| PROC-03 | Cancel/timeout stops a CPU-bound Worker guest and aborted startup reclaims it; the next run works |
| PROC-04 | Exactly one terminal result per process; late completion or cancellation cannot replace it |
| PROC-05 | Containers do not share files or processes; disposal is idempotent and keeps workspace data |
| FD-01 | Zero-length I/O consumes nothing; short reads and partial writes report exact counts |
| FD-02 | Raw bytes (NUL, invalid UTF-8) pass unchanged; no text decoding |
| FD-03 | stdout/stderr drain concurrently with bounded buffers; capture over budget fails explicitly |
| FD-04 | EOF follows buffered data and the last writer, including duplicated descriptors |
| FD-05 | Closing the last reader wakes blocked writers with EPIPE |
| FD-06 | Pipeline admission reserves every stage first; a limit failure starts none |
| FS-01 | Relative paths use the real cwd; UTF-8 and backslash names work; NUL/ill-formed paths fail |
| FS-02 | Symlinks resolve before `..`; capability escape is EACCES; link loops are ELOOP |
| FS-03 | Inode/dentry separation: shared dup offsets, offset-free pread/pwrite, rename keeps the inode, unlinked open files stay usable |
| FS-04 | Readonly mounts and package trees reject writes; cross-mount rename is EXDEV |
| FS-05 | Crash, cancel and timeout discard private changes; a rejected commit leaves the namespace intact |
| FS-06 | The writer lease blocks competing edits; normal and nonzero exits commit the complete diff |
| FS-07 | Live visibility: running guests and the editor observe each other's writes |
| PKG-01 | Digest-pinned metadata validates and freezes without downloading bodies |
| PKG-02 | Command lookup reads metadata only; the first command prepares its dependency closure |
| PKG-03 | Verified bytes are reused across runs and reloads without another body request |
| PKG-04 | One consumer's cancellation keeps other consumers and the single shared fetch |
| PKG-05 | Hash/size/MIME/exact-URL/redirect/partial-response failures never populate the cache |
| PKG-06 | Unavailable persistent storage still permits verified in-memory execution |
| PKG-07 | An offline cache miss fails explicitly and names the pinned asset |
| PKG-08 | Invalid archives, mount conflicts or corrupt closures publish nothing; retry succeeds |
| CLI-01 | The real Clang driver compiles C/C++ through the container VFS with ordinary argv |
| CLI-02 | Real linking produces a WASI executable that runs in the container |
| CLI-03 | The complete selected-target header corpus compiles without sysroot pruning |
| BB-01 | The pinned BusyBox source/config/receipt artifact runs selected applets in native and browser checks |
| SH-01 | Real Bash runs external container commands with exact argv and exit status |
| SH-02 | Shell redirections and pipelines use the common descriptors and bounded pipes |
| SH-03 | The shell and its children share cwd and live filesystem state |
| SH-04 | Cancelling the shell stops its descendants and reclaims nested Workers |
| DEPLOY-01 | A clean origin passes COOP/COEP, CSP, exact asset bytes, lazy/nested workers and license packs |
| PERSIST-01 | Reload restores bytes, symlinks and metadata; edits during flush stay dirty |
| PERSIST-02 | Interrupted, corrupt or over-budget publication keeps the last-good root and reports failure |
| PERSIST-03 | Asset-cache deletion and disposal never delete or silently save the workspace |
| PERSIST-04 | A second owner cannot acquire the writer lock |

## Resource and trust invariants

- Supervisor owns the process namespace, mount namespace and policy. Each guest owns its mutable
  runtime state. No common WebAssembly.Memory is required. CPU-bound guests run in workers;
  no guest may synchronously block the event loop that services its I/O.
- `spawn` snapshots argv/env/cwd/options, validates policy and prepares assets before returning.
  Startup failures reclaim allocations. After return, one `exited` result represents completion
  and cleanup; unread buffered output can remain. Nonzero exit is not a host exception.
- `run` drains stdout and stderr concurrently and sends input EOF. Default capture budget is
  8 MiB total. Raw bytes never pass through a text decoder except in a terminal UI.
- Queues are bounded (initial pipe budget 64 KiB). Zero-length I/O consumes nothing, partial
  writes report exact bytes, duplicated descriptors share open-description offsets, EOF follows
  the last writer and buffered data, and closed readers wake writers with EPIPE.
- Cancellation/disposal are idempotent. Channel bindings include protocol version, process
  generation, request id, opcode and length. Both sides validate bounds; stale responses cannot
  mutate a later process. Track nested workers and wake blocked operations on shutdown.
- Workspace and cache are separate. `/workspace`, `/tmp`, `/home/user` are writable; package
  namespaces are readonly. Longest-prefix mounts, inode/dentry separation, symlink limits,
  UTF-8 paths, post-resolution capability checks and EXDEV define the first filesystem profile.
  Backslash remains a filename character. NUL is rejected. Unsupported operations fail explicitly.
- Snapshot adapters hold a writer lease and commit validated diffs after normal/nonzero exit;
  crash/cancel discard private changes. Generation conflict never overwrites editor changes.
  Live syscall visibility is a distinct capability and is required for the shell MVP.
- Manifest bytes are pinned by a host-provided digest. Resolve dependencies before execution;
  adapter ids are an explicit local allowlist, never remote JavaScript URLs. Assets preserve the
  existing exact-URL, no redirect, full-response, MIME/size/hash policies and credential omission.
- Share an asset request only under identical integrity/policy identity. Cancellation belongs to
  each consumer; abort the underlying fetch only after every consumer leaves. Cache write failure
  may fall back to verified memory, but integrity failure cannot. Publish package mounts atomically.
- Archives reject traversal, absolute paths, symlink escape, duplicate/prefix collisions and
  entry/size/depth excess. Delivery and logical hashes are separate. Range is a future profile.
- Command lookup uses metadata without loading bodies. Executables require checked magic/import
  profile and consistent executable metadata. Script execution requires a real interpreter;
  no shell-string interception. Unsupported direct execution must be documented as such.
- Compiler header closures remain complete. Do not reduce sysroots using one program's observed
  dependencies. Reuse verified modules before considering mutable-instance pooling.
- Guest network is denied by import capability; trusted asset networking is separate. Workers
  alone do not isolate arbitrary JavaScript. Source, stdin, environment and file content are not
  telemetry. Hard memory limits must be enforced by module/host configuration or rejected.

## Persistence and deployment (later gates)

The persistence owner writes new OPFS blobs, flushes/validates them, then publishes a root
reference in one IndexedDB transaction. There is no OPFS+IDB cross-store transaction. Retain a
last-good root, recover or report corruption, and GC orphan blobs later. Require one writer
owner; lack of an owner lock disables persistent editing. `dispose()` does not delete data;
`flush()` means publication within browser API guarantees, not permanent storage.

Batch supports prebuffered single-command execution. Isolated interactive requires secure
context, cross-origin isolation, SharedArrayBuffer and a validated synchronous I/O bridge.
Persistent adds OPFS/IDB/owner locks. Start qualification with an exactly recorded Chromium/Linux
version; other engines remain probes. Production acceptance checks COOP/COEP, CSP, exact CDN
response bytes, lazy/nested workers, immutable locks, licenses and corresponding source packs.
No infrastructure deployment is implied by this implementation stack.

Terminal/editor bindings consume the SDK and expose dirty generation, save state and export.
They must not own a competing filesystem or resolver. PTY, static preview origin isolation,
development-server networking, LSP and debugging are separately qualified capabilities.

## Review stack

Each PR contains one reviewable unit and its tests. Stack bases encode ordering; the table gives
logical prerequisites even when linear review ordering adds an earlier base.

| ID | Work unit | Logical prerequisites |
| --- | --- | --- |
| C-01 | Scope, boundaries, compatibility ledger | none |
| C-02 | Real Bash external-command probe and backend ADR | C-01 |
| C-03 | Package/API, errors and lifecycle contracts | C-01 |
| C-04 | Inode memory VFS, mounts and path capabilities | C-03 |
| C-05 | Descriptors and bounded byte streams | C-03 |
| C-06 | WASI Worker Supervisor and cancellation | C-04, C-05 |
| C-07 | Pinned distribution schema, graph and command index | C-03 |
| C-08 | Existing verified cache, dedup and cancellation | C-07 |
| C-09 | Atomic readonly package mounts and lazy resolver | C-04, C-08 |
| C-10 | LLVM structural tool host and snapshot lease | C-06 |
| C-11 | Real Clang compile/link CLI qualification | C-09, C-10 |
| C-12 | BusyBox source/config/patch/receipt producer | C-01 |
| C-13 | BusyBox aliases and selected applet qualification | C-06, C-09, C-12 |
| C-14 | Live bounded SAB/RPC bridge | C-06, C-02 |
| C-15 | Real shell exec/fd/wait/cancel integration | C-11, C-13, C-14 |
| C-16 | Terminal/editor bindings | C-15 |
| C-17 | Workspace persistence generations and recovery | C-04 |
| C-18 | Save/export/cache lifecycle UI | C-16, C-17 |
| C-19 | Clean-origin production qualification | C-15, C-18 |
| C-20 | Measured loading optimization | C-19 |

Do not create nominally complete PRs for unimplemented gates. Record blockers, next experiment
and evidence instead. Existing playground/API regression checks are required for every shared
boundary change. Browser evidence records application/producer revisions, asset hashes, OS,
browser, isolation, cache state, byte outputs, exits and download/timing measurements.

## Evidence sources

Repository anchors: `docs/runtime-asset-cache.md`, `runtimes/wasm-bash/README.md`,
`packages/llvm-core/runtime/clang/src/{index,app,browser-execution}.ts`,
`packages/llvm-core/runtime/core/src/memfs.ts`, and wasm-llvm
`producer/clang-browser/README.md`. Online API descriptions must be checked against pinned
`@wasmer/sdk@0.10.0`, not treated as proof of this SDK's extension points.
