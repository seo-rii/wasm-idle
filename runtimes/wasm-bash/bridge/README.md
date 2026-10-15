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
5. `0005-owned-command-snapshot.patch`: allow an external SDK `VirtualCommand` to
   call `host_command_snapshot()` on its prepared child `WasiEnv`. The returned
   `HostCommandSnapshot` owns argv, raw `name=value` environment bytes and the cwd
   from that child's WASIX filesystem directory lookup. Its fields are private;
   read-only accessors retain no guest pointers, locks, mutable state or fd/FS
   capabilities. Automatic Rust `Send + Sync` on owned values requires no unsafe
   implementation or JS callback assertion. This metadata accessor does not
   supply descriptor routing or the trusted JavaScript command registry.
6. `0006-register-worker-shell-import.patch`: register the existing private
   `wasm_idle_shell_v1.exec_v1` binding in the separate resolver actually used
   by SDK Worker instantiation. `WasiEnv::instantiate` calls the free
   `import_object_for_all_wasi_versions`; the binding added by `0003` to
   `generate_import_object_from_env` does not reach that call. The actual
   resolver now adds the same typed function only when the module imports a
   `wasix_32v1` function, matching the existing wasm32 profile. A pure WASI
   or WASIX64 module does not gain this private import. The original patch
   and its historical receipts remain unchanged.

The [first actual Chromium probe](https://github.com/seo-rii/wasm-idle/pull/195)
of the rebuilt five-patch SDK and shim-linked
Bash reached SDK initialization in all ten cases, then returned exit 45 with
empty stdout/stderr and `Unable to initialize the context and store`. The
missing namespace in the actual resolver makes `Instance::new` fail before
Bash executes even a builtin; that branch publishes `Errno::Noexec` (45).
The `0006` change addresses that source-level omission. Its source checks do
not establish a corrected SDK build, Bash execution or common Container
fd/filesystem support.

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

The snapshot is taken from the child in `VirtualCommand::exec`'s builder, after
the runtime prepares it. Both ordinary exec and vfork exec call `_prepare_wasi`
before `try_built_in`. `proc_spawn2` prepares argv/environment and applies fd
operations, including `chdir`/`fchdir`, before that call. `proc_spawn` sets child
cwd and stdio before dispatch. The parent context or a `PWD` environment entry
cannot stand in for the prepared child's actual cwd. Calling the accessor on a
concurrently running environment does not freeze its threads or establish an
atomic transaction across those state locks.

`host_command_compile_probe.rs` is an external SDK example for the public
snapshot boundary. It reads the prepared builder and verifies that the owned
value is automatically `Send + Sync + 'static`. Its `VirtualCommand::exec`
returns `Unsupported` after the metadata check; it never starts a guest,
registers a command, or returns a fabricated `TaskJoinHandle`. A successful
compile of this probe establishes Rust accessibility and types only.

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
node --test scripts/verify-container-shell-worker-imports.test.mjs
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
makes no changes to the supplied checkout. The original four-patch
[checked-in receipt](evidence.source-checks.json) remains historical and says
`patches-apply-cleanly-not-built`. The five-patch
[snapshot source receipt](evidence.snapshot-source-checks.json) separately records
the current actual dry run and the compile probe as `not-run`.
It predates the first genuine SDK Rust diagnostics. The distinct
[memory-API correction source receipt](evidence.sdk-typefix-source-checks.json)
records the later five-patch dry run after qualifying the Wasmer `Function`
reference and using pinned `WasmSlice::read_to_vec()` for owned argv/environment
bytes. The original frame ABI, limits and decoder remain unchanged. These local
source/protocol checks do not establish a passing SDK/example typecheck.
The report classifier passed 6 Node tests; the native C/Rust protocol passed 5 Rust tests
(including frames emitted by the actual C encoder). These are bounded local checks only.

To prepare a fresh private source tree later, omit `--verify-only`/`--wasix-source` and use
`--output /new/private/path`. The helper refuses an existing output directory, verifies the
archives, extracts them, applies the patches, installs the new runtime sources and records
the patch and compile-probe hashes. It installs the probe as the SDK example
`container_command_snapshot_compile`. It does not build, download dependencies
or modify an active checkout. The dry-run receipt is not full preparation or
SDK compile evidence.

Fresh preparation also checks the actual Worker resolver, its wasm32 gate,
the version-specific resolver and the existing seven-i32 syscall signature.
It records `workerImports.status: source-shape-checked-not-typechecked` and
the three inspected Rust source hashes in the preparation receipt. This is
an explicit guard against the missing-resolver regression, not a Rust parser,
typecheck or runtime test. To rerun it read-only on prepared sources:

```sh
node scripts/verify-container-shell-worker-imports.mjs /absolute/prepared/wasmer-wasix
```

The original five-patch source tree fails this guard. Keep that tree and its
failure evidence unchanged; prepare a new source directory for the six-patch
candidate and use distinct build directories before any later rebuild.
The [six-patch preparation receipt](evidence.worker-imports-source-preparation.json)
records successful fresh extraction, zero-fuzz sequential patch application and
the source guard. The prepared SDK tree is byte-identical to the preceding
five-patch SDK source; only WASIX `src/lib.rs` changes. Compiler and guest
qualification remain `not-run`/false in this receipt.

After provisioning the pinned nightly and `rust-src`, prefetch all locked
dependency targets for both the SDK and the pinned standard-library source
workspace. Run from the prepared SDK directory, using the private toolchain
home and distinct physical target/intermediate directories for this source
copy. Keep the SDK's atomics/build-std configuration intact:

```sh
export RUSTUP_HOME=/private/prerequisites/rustup
export CARGO_TARGET_DIR=/private/run/sdk-target
export CARGO_BUILD_BUILD_DIR=/private/run/sdk-intermediate
export CARGO_PROFILE_DEV_DEBUG=0

cargo +nightly-2025-07-05 fetch --locked
cargo +nightly-2025-07-05 fetch --locked \
  --manifest-path "$RUSTUP_HOME/toolchains/nightly-2025-07-05-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/Cargo.toml"

cargo +nightly-2025-07-05 check --locked --offline \
  --target wasm32-unknown-unknown --lib --example container_command_snapshot_compile -j 1
```

Omit `--target` in both prefetch steps; retain it for the offline check. The
exact pinned Cargo [fetch implementation](https://github.com/rust-lang/cargo/blob/930b4f62cfcd1f0eabdb30a56d91bf6844b739bf/src/cargo/ops/cargo_fetch.rs)
filters explicit fetch targets, while its [check download filtering](https://github.com/rust-lang/cargo/blob/930b4f62cfcd1f0eabdb30a56d91bf6844b739bf/src/cargo/core/package.rs)
also considers the host. The unfiltered fetch includes every platform in the
locked graph even when SDK `build.target` is set. Preserve both lockfile hashes;
do not update dependency versions or substitute a different nightly to fill a
cache miss.

The example is an external crate target, so crate-private runtime state would
cause a real Rust privacy failure. Missing dependencies or toolchain are not a
passing compile check. Use a sequential bounded background process with private
log/status files; full rebuild and real Bash/browser gates remain separate.

The separate [SDK preparation receipt](evidence.sdk-check-preparation.json)
records the first supervised check attempt. Both wasm-targeted fetches exited
zero, but the offline check exited 101 before Rust typing because locked
`corosensei@0.3.0` had not been downloaded. All three owned process groups were
reaped. This records incomplete dependency preparation, not a snapshot type
failure or a successful SDK compile. The original five-patch dry-run receipt
remains unchanged and does not cover this later attempt.

After complete locked prefetch, a subsequent supervised SDK check reached Rust
typing and exited 101 with three prototype errors: one unqualified `Function`
reference and two unsupported `WasmSliceAccess::to_vec()` calls. The source
correction uses `wasmer::Function` and the pinned memory slice's fallible owned
byte copy before dispatch. It adds no guest-memory view or lock to the command
snapshot. The old failed source tree, log and process receipt remain separate;
the corrected full SDK/example check has a separate receipt below. Absence of a snapshot
API diagnostic in the failed run does not establish that the example passes.
The separate [Rust typing failure receipt](evidence.sdk-typecheck-errors.json)
records the exact source/toolchain, all three diagnostics, the 342.205-second
execution and complete process cleanup. The corrected five-patch source checks
are recorded in [their own receipt](evidence.sdk-typefix-source-checks.json).

The genuine corrected [SDK typecheck receipt](evidence.sdk-typecheck.json) passes
the full patched runtime/SDK library and the external
`container_command_snapshot_compile` example at source commit
`de98d061435a308e8bbcd2ca195d29ac07401774`. The exact pinned nightly performs
`cargo check --locked --offline --target wasm32-unknown-unknown --lib
--example container_command_snapshot_compile -j 1` in fresh physical sources and
unique target/intermediate directories. All 580 source/toolchain/preparation
identities stay unchanged. The [original supervision record](evidence.sdk-typecheck-process.json)
reports exit 0 in 412.428 seconds and all owned processes reaped.

This proves Rust typing and external access to owned prepared-child metadata,
including the snapshot's automatic `Send + Sync` traits. `cargo check` produces
metadata, not a runnable SDK Wasm/JavaScript distribution. It does not execute
Bash or qualify an exec/wait path, a JS Supervisor registry, common live fd/FS,
or browser cleanup. Earlier failure and source-only receipts retain their
original results; no probe returns fabricated guest success.

## Remaining runtime gate

The SDK requires `nightly-2025-07-05`, `rust-src`, shared wasm32 memory and build-std; its
Cargo lock contains 457 packages. The earlier source inspection lacked the required
nightly; the recorded preparation attempt used an isolated installation of the exact
pinned nightly and `rust-src`, without changing the default toolchain. Complete locked
prefetch, offline validation and corrected Wasmer/SDK/example Rust typing now
pass. Existing Bash source/sysroot
artifacts were not found in the producer's configured cache roots. Full SDK/Bash rebuild
and actual browser qualification still require a sequential resource budget. No memory
or disk estimate is a measured producer requirement, and no previous or unrelated cache
was deleted.

Next, reserve a sequential build slot and private output budget, build the pinned SDK and
real Bash with this shim, and verify actual imports and new artifact receipts. Then qualify
argv/env/cwd/exit, FD/FS visibility and Worker cleanup using the same real browser fixtures.
Implement the trusted SDK command registry and Supervisor FS/fd bindings only behind that
experimental profile. The first Clang-to-BusyBox pipeline, command-lazy verified loading,
foreground cancellation and common live workspace remain required shell MVP gates.
