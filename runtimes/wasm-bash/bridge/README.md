# Source-pinned shell bridge candidate

This directory is an unbuilt porting prototype for the real Bash/WASIX backend. It does
not produce a supported SDK, replace the existing Bash distribution, or expose a public
container adapter. The existing upstream Bash parser and evaluator remain the shell.
See [ADR-002](../../../docs/adr/ADR-002-shell-backend.md) and the
[real pre-patch probe](../../../docs/container-shell-probe.md).

Candidate B is the next implementation path: connect the WASIX child-execution boundary
to the container Supervisor. Candidate A has reproduced argv, environment, exit, path,
visibility and lifetime failures. Candidate C cannot add missing imports by itself. The
patches here address narrowly identified prerequisites and expose a Rust runtime hook;
they do not yet implement the JavaScript Supervisor or common fd/filesystem binding.

## Source identities

| Input                           | Identity                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| npm runtime under investigation | `@wasmer/sdk@0.10.0`                                                                        |
| SDK npm-recorded git revision   | `93b8b738ebd3ee57e118da0f0eb795b97d5b999e`                                                  |
| SDK source archive              | 2,888,858 bytes; SHA-256 `ca5df306ffcb260fb3086e89d450aafac106e200ccf7b49bb03c348bc2208712` |
| Locked Rust runtime             | `wasmer-wasix@0.601.0`                                                                      |
| Rust crate archive              | 2,831,166 bytes; SHA-256 `a9a804fcfbdbbfe5b2d6fb30e741e22a21e88e964dedfea9e609f13a52823bfe` |
| Existing Bash source            | `fc8096485478055f4fcf31402004fdd8ff6b72b7` / `wasmer/bash@1.0.25`                           |
| Examined WASIX libc             | `v2024-07-08.1`, `libc-top-half/musl/src/process/execve.c`                                  |

Obtain the archives from the pinned [SDK source](https://codeload.github.com/wasmerio/wasmer-sdk/tar.gz/93b8b738ebd3ee57e118da0f0eb795b97d5b999e)
and [published Rust crate](https://static.crates.io/crates/wasmer-wasix/wasmer-wasix-0.601.0.crate).
The SDK source manifest says 0.8.0; the npm artifact's recorded git revision, rather than
a similarly named Git tag or the current documentation, identifies the investigated source.
The preparation helper verifies both complete archive sizes and hashes before extraction.
It preserves the existing Cargo lock except for changing this one crate to a local path.

## Patch boundaries

1. `0001-preserve-exec-unwind.patch`: `proc_exec2` currently turns every successful Rust
   return from `proc_exec3`, including normal Asyncify unwind, into `WasiError::Exit(0)`.
   Preserve `Ok(Errno::Success)` as `Ok(())`; retain errors. The real pre-patch trace observes
   a child `proc_exit(23)` followed by a parent join reporting zero; the later five-case trace reports 23 correctly. The source branch is a
   concrete explanation to test; a passing patched browser run is still required.
2. `0002-replace-explicit-environment.patch`: `_prepare_wasi` currently merges a supplied
   environment into the prior one. An explicit environment must replace it, including an
   empty vector. `None` continues to mean inheritance. This preserves a shell `unset`.
3. `0003-add-lossless-exec-frame.patch` plus `exec_frame.rs`, `proc_exec_v1.rs` and `execve.c`:
   the pinned libc and runtime use newline-delimited strings and remove empty elements.
   A private versioned import accepts bounded length-prefixed UTF-8, preserving empty,
   LF and CR arguments. Legacy WASIX imports keep their existing ABI. The guest shim is
   intended to be linked into a rebuilt real Bash; it is not linked into the current WEBc.
4. `0004-expose-host-command-hook.patch`: add a default metadata-only `Runtime::host_command`
   hook and forward it through `OverriddenRuntime`. `BinFactory::try_built_in` invokes it
   with the resolved path before ordinary builtins. Existing runtimes return `None`.
   The selected `VirtualCommand::exec` receives the existing parent context and child
   `WasiEnv` builder, and returns the existing `TaskJoinHandle`. A trusted SDK integration
   must still implement the hook and its lifetime contract.

No speculative change to signal ordering is included. No libc API returns fake success,
no stdout marker is interpreted as an exec request, and no shell string is parsed by host code.
The current runtime branches are reused after ABI decoding; startup failure, state rollback,
foreground cancellation and exact process completion remain unqualified.

## Private exec ABI

The optional wasm32 import is `wasm_idle_shell_v1.exec_v1`:

```text
(path_ptr, path_len, argv_ptr, argv_bytes, env_ptr, env_bytes, flags) -> errno
```

All parameters and the result are i32. Each vector consists of a little-endian u32 count,
then repeated little-endian u32 byte lengths followed immediately by UTF-8 bytes. There
are no pointers inside a vector. A four-byte zero count is an explicit empty vector.
Arguments may be empty; NUL, malformed UTF-8, truncated or trailing bytes are rejected.
The receiver accepts at most 4,096 entries per vector, a 1–4,096 byte non-NUL path and
1 MiB total path/vector bytes. Environment entries use `name=value`, with nonempty,
unique names. Values may be empty or contain LF/CR. Flags 0 means replace environment;
flags 1 means inherit and requires a null environment pointer and zero environment bytes.
All other flags are rejected. Guest memory ranges are checked before reading. The decoder
owns the strings before starting a child and uses a fresh memory view for each invocation.

Successful `exec` transfers control using the existing Asyncify path. An ordinary syscall
return is an errno; the libc shim does not report success if execution unexpectedly returns.
The normal nonzero child exit belongs to wait/join and is distinct from exec startup failure.

This is a prototype private ABI, not an assertion that WASIX standardizes these semantics.
The C encoder and pure Rust decoder tests verify only the protocol and local bounds. They
do not instantiate Wasmer, validate its Rust types, or prove the Asyncify integration.

## Supervisor, filesystem and fd ownership

The planned owner remains the container Supervisor. Each dedicated guest Worker uses its
own bounded control channel and 64 KiB data SAB to synchronously request operations; the
Supervisor stays asynchronous and must never execute a synchronous guest on its event loop.
Every request needs version, process generation, request id, opcode and payload length;
responses must validate generation and size, and cancellation must wake blocked waits.

`VirtualCommand::exec` is the candidate exec/wait boundary. Command lookup must use a fixed
host allowlist with no download. Starting the child may asynchronously prepare verified
assets, then transfer snapshots of argv/env/cwd and capabilities for inherited fd endpoints.
Only the exact registered executable entries are dispatched. The host maps cwd capability,
file descriptors and exit/abnormal termination; neither mutable guest memory nor raw JS
callbacks are accepted from remote package metadata. A child-start failure must leave the
caller alive and return an error; a successful image replacement needs exactly one terminal
result and cleanup owner for the old and new resource groups.

The SDK `Directory` currently owns an `Arc<dyn virtual_fs::FileSystem>`. A remote filesystem
implementation is a possible routing point, but it alone is insufficient: WASIX caches inode
and descriptor state, and `fd_pipe` creates internal `virtual_fs::Pipe` endpoints. Live writes,
rename/unlink/open descriptions, fd duplication, EOF and broken pipe must all route to the
same Supervisor resources. Snapshot diff or copying redirected files at process exit cannot
qualify this path. The hook patch intentionally does not pretend to solve these operations.

SDK thread Worker creation must also register every descendant with the resource group,
including workers created during cancellation. A returned JavaScript Worker list and a
single `terminate()` are insufficient. Download, blocked-read, CPU-loop, exit/cancel races
and foreground interruption require actual browser fixtures before exposing this adapter.

## Reproduce the bounded checks

From the repository root, with a C compiler and Rust installed:

```sh
node --test scripts/probe-container-shell.test.mjs
node scripts/test-container-shell-bridge.mjs
node scripts/prepare-container-shell-bridge.mjs --verify-only \
  --sdk-archive /path/to/wasmer-sdk.tgz \
  --wasix-archive /path/to/wasmer-wasix.tgz \
  --wasix-source /path/to/pristine/wasmer-wasix-0.601.0
```

The protocol test creates small native fixture binaries in a private temporary directory
and removes that directory after completion. The verification command compares every
modified source file with its verified archive, runs each independent patch with
`patch --dry-run --fuzz=0`, and checks source identity again. It creates no source copy and
makes no changes to the supplied checkout. The [checked-in receipt](evidence.source-checks.json) says `patches-apply-cleanly-not-built`.
The report classifier passed 6 Node tests; the native C/Rust protocol passed 5 Rust tests
(including frames emitted by the actual C encoder). These are bounded local checks only.

To prepare a fresh private source tree later, omit `--verify-only`/`--wasix-source` and use
`--output /new/private/path`. The helper refuses an existing output directory, verifies the
archives, extracts them, applies the patches, installs the new runtime sources and records
the patch hashes. It does not build, download dependencies or modify an active checkout.
This full preparation path has not been used for the checked-in evidence.

## Remaining runtime gate

The SDK requires `nightly-2025-07-05`, `rust-src`, shared wasm32 memory and build-std; its
Cargo lock contains 457 packages. The required nightly was not installed in the inspected
build environment. Existing Bash source/sysroot artifacts were not found in the producer's
configured cache roots. Full SDK/Bash rebuild and Wasmer typechecking were deferred because
of shared-host memory/IO load and limited private output space. No memory or disk estimate
is a measured producer requirement, and no previous or unrelated cache was deleted.

Next, reserve a sequential build slot and private output budget, build the pinned SDK and
real Bash with this shim, and verify actual imports and new artifact receipts. Then qualify
argv/env/cwd/exit, FD/FS visibility and Worker cleanup using the same real browser fixtures.
Implement the trusted SDK command registry and Supervisor FS/fd bindings only behind that
experimental profile. The first Clang-to-BusyBox pipeline, command-lazy verified loading,
foreground cancellation and common live workspace remain required shell MVP gates.
