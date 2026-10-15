# Source-pinned shell bridge candidate

This directory contains a source-pinned experimental port for the real Bash/WASIX backend.
The six-patch SDK passes real typechecking and release/bindgen generation. Patches 0007
and 0008 add a trusted JavaScript host-command registry; their separate gates are recorded
under [trusted host-command dispatch](#trusted-host-command-dispatch). None of this produces
a supported SDK, replaces the existing Bash distribution, or exposes a public container
adapter. The existing upstream Bash parser and evaluator remain the shell.
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

7. `0007-delegate-host-command-descriptors.patch` plus `host_command_io.rs`: an external
   `VirtualCommand` may take ownership of its prepared child as `HostCommandProcess`.
   The owner reads the existing metadata snapshot, obtains byte endpoints only for
   descriptors it names, and completes the child exactly once. See below.
8. `0008-dispatch-trusted-host-commands.patch` plus `sdk_host_command.rs`: the SDK
   `Runtime` implements `Runtime::host_command` from an exact-path registry and moves the
   owned child to the scheduler thread, where the JavaScript handler registered on that
   thread runs. This is the only SDK-side patch; `src-js` is unchanged.
9. `0009-preserve-join-exit-status.patch`: `proc_join` stored a child's exit code through
   `Errno`, whose conversion maps every value outside the errno range to `Unknown` (79).
   The ABI field is a u16 that wasix-libc's `waitpid` reads as the raw status, so the
   runtime now writes the raw exit status there. Statuses 0–78 are unchanged; 79–255
   (for example 126, 127 and 128+n) are no longer reported to Bash as 79. It applies to
   native children and host commands alike.
10. `0010-keep-running-child-on-wnohang.patch`: a nonblocking `proc_join` for a specific
    child that is still running removed that child from the parent and reported its pid
    with no status, which wasix-libc `waitpid(pid, WNOHANG)` returns as an exit with
    status 0. The child now stays joinable and the call reports pid 0, so `waitpid`
    returns 0 as POSIX requires. Blocking joins and finished children are unchanged. The
    pinned Bash does not use this call; see below.
11. `0011-mount-host-filesystems.patch` plus `sdk_host_filesystem.rs`: the SDK can mount a
    trusted synchronous JavaScript filesystem owned by one thread
    (`Directory.fromHostFileSystem(delegate)`), and registers that mount as live with WASIX.
12. `0012-revalidate-live-mounts.patch`: WASIX revalidates cached inodes below live mounts
    and reads a live file's size from its handle where the cached stat would be stale.

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
  --wasix-source /path/to/pristine/wasmer-wasix-0.601.0 \
  --sdk-source /path/to/pristine/wasmer-sdk-93b8b738ebd3ee57e118da0f0eb795b97d5b999e
```

The protocol test creates small native fixture binaries in a private temporary directory
and removes that directory after completion. The verification command compares every
modified source file with its verified archive, runs each independent patch with
`patch --dry-run --fuzz=0` against its own crate (0001–0007 WASIX, 0008 SDK), and checks
source identity again. `--sdk-source` is required since the SDK gained its own patch. It creates no source copy and
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

## Six-patch SDK check and binary gate

The fresh six-patch candidate at source commit
`7ceef67180e047d4703936482006a69b814662d2` now passes the real pinned SDK
library and external `container_command_snapshot_compile` check. The
[original typecheck process receipt](evidence.worker-imports-typecheck-process.json)
records exit 0 in 373.991 seconds. The same physical source and its own checked
target then produce the release SDK in 586.098 seconds, web glue with matching
`wasm-bindgen 0.2.101` in 1.762 seconds and static inspection in 0.255 seconds.
All four process receipts report normal exit 0, all owned processes reaped,
and no cleanup signals, remaining descendants or cleanup errors.

The [original binary receipt](evidence.worker-imports-sdk-binary.json) preserves
its bytes and full import/export inventory once. The bound SDK is 9,071,791
bytes with SHA-256
`326b58090df4dbe3f0f3e4105b56b9cdbd0ebf40a5cecd437f503dac19ac7551`.
The separate [archival verification](evidence.worker-imports-sdk-binary-metadata.json)
rechecks all 581 source/toolchain pins, the complete 198-file SDK and 376-file
WASIX inventories, six additional tool/compiler-library pins and all six outputs.
The source/lockfiles, atomics/build-std configuration and original release profile
remain unchanged. These sources and target were not copied from another build;
release reuses this physical source's preceding check target, so its timing is
not an independent clean-build benchmark.

This establishes Rust typing, release Wasm generation and static validity of
the corrected resolver. The actual guest still requires a separately packaged
SDK/Worker graph and Chromium run. It does not prove Bash execution, the private
import's runtime behavior, a trusted JS command registry, common live fd/VFS or
shell cleanup. The earlier [failed Chromium evidence](https://github.com/seo-rii/wasm-idle/pull/195)
and source-only preparation receipts retain their original results. No binary
or source archive is checked into Git.

## Remaining runtime gate

The SDK requires `nightly-2025-07-05`, `rust-src`, shared wasm32 memory and build-std; its
Cargo lock contains 457 packages. The earlier source inspection lacked the required
nightly; the recorded preparation attempt used an isolated installation of the exact
pinned nightly and `rust-src`, without changing the default toolchain. Complete locked
prefetch, offline validation, corrected Wasmer/SDK/example Rust typing and the six-patch
SDK release/bindgen gate now pass. The separate real Bash producer and local host-module
packaging have their own receipts. No memory or disk estimate is a measured producer
requirement, and no previous or unrelated cache was deleted.

Actual guest qualification uses a separately pinned package and the same real Chromium
fixtures; preserve the previous failure and each subsequent observation separately.
Implement the trusted SDK command registry and Supervisor FS/fd bindings only behind that
experimental profile. The first Clang-to-BusyBox pipeline, command-lazy verified loading,
foreground cancellation and common live workspace remain required shell MVP gates.

## Trusted host-command dispatch

Patches 0007 and 0008 connect the existing `Runtime::host_command` seam to JavaScript.
They are the SDK half of candidate B; they do not make Bash use the common Container
filesystem or descriptors, and both `shellBackendReady` and
`commonContainerFdVfsQualified` remain false.

```js
const runtime = new Runtime({ registry: null });
runtime.registerHostCommand('/opt/host/bin/tool', async (invocation) => {
	// invocation.argv, invocation.env (raw bytes), invocation.cwd,
	// invocation.stdin / stdout / stderr: HostCommandDescriptor | null
	return 0; // integer exit status 0..255
});
```

Registration is trusted host code. A path must be normalized and absolute, at most
4,096 bytes; at most 1,024 paths may be registered per runtime. Lookup is an exact string
match on the path WASIX passes to `try_built_in` after Bash's own command search, so the
guest must still find the file in its filesystem. Registered paths take precedence over
the file's bytes, which are never executed for that path. Nothing is fetched during lookup.

Lookup and `VirtualCommand::exec` run on the guest's Worker. `exec` takes the prepared
child out of the WASIX builder as `HostCommandProcess`, returns the child's join handle,
and posts the owned child to the SDK scheduler thread in a new `SchedulerMessage` variant.
JavaScript functions stay in a thread-local table on the registering thread; no
JavaScript value crosses threads and no `Send`/`Sync` implementation was added. The
handler runs only when that thread is also the command's scheduler thread, which is the
thread that called `Command.run`.

The handler receives a frozen object: the matched path, the prepared argv, raw
`name=value` environment bytes and the child's actual WASIX cwd from
`HostCommandSnapshot`, plus descriptors 0, 1 and 2 as `HostCommandDescriptor` objects
(`null` when closed in the child). No filesystem capability is delegated. A descriptor
offers:

- `read(maxBytes)`: at most 65,536 bytes, never consuming more than requested; an empty
  array is end of file and `maxBytes` 0 is `EINVAL`.
- `write(bytes)`: copies at most 65,536 leading bytes and resolves with the accepted
  count, which can be partial. A closed WASIX pipe reader yields `EPIPE`; no signal is
  raised in the child.
- `close()`: closes the descriptor in the child, as its own `fd_close` would.

Operations look up the child's descriptor table on every call and follow its rights,
shared offset and append flag like `fd_read`/`fd_write`, including files opened by shell
redirections and WASIX pipes created by Bash. They fail with a JavaScript `Error` whose
`code` is the WASI errno name (for example `EPIPE`) and whose `errno` is its number. The
descriptor's nonblocking flag is not emulated, and WASIX pipes remain unbounded as before.

The handler's promise resolves with an integer status from 0 to 255. Throwing, returning a
non-promise, rejecting or resolving with anything else completes the child with status 126.
Completion revokes every endpoint and cancels pending operations, closes the child's
descriptors as process exit does, then publishes the status to the exec/spawn caller. If
the owned child is dropped before completion, including when the scheduler has closed, it
completes synchronously with status 126 instead of falling back to native execution.

Out of scope: guest signals to a running host command, foreground interruption with a
surviving shell, PTY semantics, descriptors other than 0–2, and any filesystem sharing
with the Container VFS. A host command keeps running if its parent shell exits; it is
cancelled only by the trusted owner or forced owner cleanup.

### Actual SDK gate

Source commit `b2c6c07f37a7d22e97f0e19addc349dc020cfb53` was prepared into a fresh physical
copy and pinned with all 583 source, toolchain and preparation identities (SDK 199 and
WASIX 377 files). The unchanged pinned nightly, locks, atomics/build-std configuration and
release profile were used, with a unique target and intermediate directory:

| Stage             | Command                                                                                                                  | Wall seconds |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Typecheck         | `cargo check --locked --offline --target wasm32-unknown-unknown --lib --example container_command_snapshot_compile -j 1` | 845.135      |
| Release           | unchanged release profile, reusing this copy's checked target                                                            | 889.651      |
| Bindgen           | `wasm-bindgen 0.2.101 --target web --weak-refs --no-demangle`                                                            | 2.013        |
| Static inspection | one shared bounded memory, import/export inventory                                                                       | 0.255        |

Every stage exited 0 with all owned processes reaped and no cleanup signal or error. The
host was heavily shared during the run, so these times are not a benchmark. The bound
Wasm is 9,139,276 bytes, SHA-256
`57d07dc2378e211e4c02667dab927a06e58426c3706f1efaccefe1f6cdeb4367`; its shared memory
grows from 34 to 35 initial pages (maximum 16,384). The generated declarations export
`Runtime.registerHostCommand`, `Runtime.unregisterHostCommand`, `HostCommandDescriptor`,
`HostCommandInvocation` and `HostCommandHandler`. The original binary receipt (SHA-256
`1e85d0d18925ab2817cb2acfa77f394ecbb2be3fa78d84f1d576ea2ca45696ac`), the preparation
receipt and the four stage receipts are archived unchanged as `evidence.host-command-*.json`.
[Metadata](evidence.host-command-sdk-binary-metadata.json) records the post-run recheck of
every pin and output. Unchanged local packaging with the corrected all-thread guard then
produced package receipt
`83d26e215890f98470a837e34d40a42b25b20b511d5c00f2f7694c8a1ea2ec55` (1.51 seconds).

This is a build and static gate. Actual Bash dispatch is qualified separately in Chromium.

### Exit statuses above the errno range

The first actual Chromium dispatch run showed host-command statuses 126 and 134 arriving
in Bash as 79. Bash's own native `cannot execute binary file` status 126 did too, so the
loss is not specific to host commands. `JoinStatusUnion.exit_normal` is typed `Errno` in
the pinned types crate; `From<ExitCode> for Errno` turns values that are not errno
variants into `Errno::Unknown` (79). Patch 0009 writes the raw `u16` status into that
union field after the normal `JoinStatus` write, which is exactly what libc's
`W_EXITCODE(code.u.exit_normal, 0)` consumes. It applies independently with zero fuzz.

The nine-patch SDK at source `4a9e7a9b77dac2551a31d74a8ee3b618af4d1816` passed the same
fresh-source gate with 583 pins: typecheck 291.062 s, release 622.133 s, bindgen 2.019 s
and static inspection 0.255 s, each exiting 0 with all owned processes reaped. The bound
Wasm is 9,140,285 bytes, SHA-256
`b4a6675fa70a7e7e5a0dbb858d2c8b23678e893a2d41163620140e6f1929bb08`; binary receipt
`50a2f1c18574ea655543c7808b40541736083226b5d8abf40477a1bc5e7da720` and the stage receipts
are archived unchanged as `evidence.exit-status-*.json` with a
[post-run recheck](evidence.exit-status-sdk-binary-metadata.json). The unchanged local
packaging step produced package receipt
`21c82836f8cbce9a2d07133c35dca7c177944ebb9abf3ef2b25b74374803fbae` in 1.511 seconds.

### Nonblocking join of a running child

With patch 0009, two further actual runs each passed every status check except one
intermittent loss: Bash once observed 0 for the first host command of a shell while the
Supervisor completed it with 23, and twenty consecutive dispatches reproduced it on the
first command only. Patch 0010 was written for one candidate path: in `proc_join`, the
nonblocking path for a specific pid removes the child and writes its pid before checking
completion, so `waitpid(pid, WNOHANG)` on a running child reports an exit with status 0.
That is a real POSIX violation and the fix stands on its own, but it is **not** the cause
of the observed loss: the pinned Bash is built with `nojobs.c`, whose `wait_for` and
`reap_zombie_children` only call `waitpid(-1, ...)`. The 0010 commit message states the
opposite; this section supersedes it. `nojobs.c` turns an `ECHILD` from `waitpid(-1, ...)`
into status 0, so a join that briefly finds no children is the next candidate to trace.

The ten-patch SDK at source `959ea103b2535aacb04c6c69b2441e65a0203a47` (after disabling
patch backup files) passed the same fresh-source gate with 583 pins: typecheck 441.463 s,
release 1,016.289 s, bindgen 3.28 s and static inspection 0.508 s on a loaded host, each
exiting 0 with complete cleanup. The bound Wasm is 9,128,654 bytes, SHA-256
`bc203bae677f9f658a2893d6bcc4336ff75a29cd1c82cef1ce54c28dd7e02dc1`; binary receipt
`2b4d95ca3294dd059548b3c351adbe09444d79eada3125505f7981ada828d8c3` and stage receipts are
archived as `evidence.wnohang-*.json` with a [recheck](evidence.wnohang-sdk-binary-metadata.json).
Local packaging produced receipt
`4b4de3258029c40f7c6db2feb1e342009ce647d683f4ecff87daf509d3b094bb`. An earlier attempt of
this gate was stopped one minute into typechecking, before any output, because the
prepared source contained `proc_join.rs.orig`; it is not counted as a build result.

In seven actual Chromium runs of the dispatch probe with this package, all twenty
consecutive host-command statuses arrived intact every time, and statuses 126 and 134
remained correct. The first-command loss was not removed: in three of the seven runs the
first command of one shell still reported 0 while its Supervisor record held 23, and two of
those runs also hung once before any dispatch. A slow first command outlasts the WASIX
50 ms deep-sleep threshold of Bash's `proc_join`, which makes the deep-sleep resume path a
candidate; the cause is not yet traced and nothing here claims to fix it.

### First-command status loss: SIGQUIT before the status

A local diagnostic build traced the remaining loss. It applies the ten patches plus
[`diagnostics/9999-host-status-diagnostics.patch`](diagnostics/9999-host-status-diagnostics.patch),
which only adds `host_diag` debug records; it is not part of the patch set. The SDK logger
forwards every thread's records to the owner, which captured them in Chromium. With that
timing, 12 of 12 repeated `HOST-STATUS` scripts reported `exit=0`
([receipt](diagnostics/status-trace-browser.json)). The records show:

- **Bash uses a real fork.** It runs external commands with `proc_fork` and
  `copy_memory = true`, not vfork. The forked child's guest thread therefore stays alive,
  waiting in the non-vfork exec branch for the host command.
- **The status is already 0 before the host command finishes.**
  `HostCommandProcess::finish` copied `WasiEnv::on_exit` and called
  `signal_process(SIGQUIT)` before `terminate(code)`. When the forked child's waiting
  thread handled SIGQUIT first, its default disposition published status 0. The status is
  set only once, so the trace records `process terminate code=23 already=Some(Some(0))`,
  and Bash's `waitpid(-1)` then reports 0.

`finish` now publishes the status first and signals afterwards. A native guest's
`on_exit` runs on its only thread after `_start` returns, so it does not have this race.
The earlier hypotheses (0010, deep sleep) did not explain the loss; deep sleep is not
enabled for these runtimes.

## Trusted host filesystem mounts

Patches 0011 and 0012 let Bash use the common container filesystem instead of a private
WASIX `Directory`. `Directory.fromHostFileSystem(delegate)` takes a synchronous delegate
owned by the calling thread. In the container this is `createShellFilesystem(container.fs)`
on the Supervisor's thread. The delegate's operations are `stat`, `lstat`, `readdir`,
`mkdir`, `rmdir`, `unlink`, `rename`, `readlink`, `open`, `read`, `write`, `append`, `fstat`,
`truncate` and `close`, on paths absolute inside the mount and on delegate-owned handles.

How calls reach the delegate:

- Guest threads never call JavaScript. Each filesystem operation is posted as a new
  `SchedulerMessage` variant to the SDK scheduler thread, which owns the delegate.
- The guest thread then blocks on an owned reply channel.
- Operations on the owning thread itself run directly.
- Delegates live in a thread-local table, and nothing is implemented as `Send`/`Sync` by
  hand.
- Every read, write, size and listing reaches the delegate; nothing is cached in the SDK.
- Writes use explicit offsets. A file opened in append mode lets the delegate place each
  write at the current end.

Mounting such a directory registers its path with WASIX as a live mount, and patch 0012
covers the state WASIX caches itself:

- A cached child below a live mount is checked with `symlink_metadata` on every lookup:
    - a missing entry is evicted, and the lookup then fails with `ENOENT`;
    - an entry whose type changed is evicted and rediscovered;
    - otherwise its stat is refreshed.
- `fd_filestat_get` and `path_open` refresh a live file's size and times from its handle.
- An `O_APPEND` write seeks to the handle's actual end, not WASIX's cached size.
- `O_CREAT` without `O_EXCL` opens a file that another process created after the lookup,
  instead of failing with `EPERM`.
- Host-command descriptors use the same live end-of-file rule.

Registering a mount that is not live only costs extra metadata calls. Path symlinks,
hard links, directory listing cookies across concurrent changes, and rename/rmdir races
against other processes keep their existing WASIX behavior. These remain gaps.

## Workspace WebAssembly executables

A shell runs programs it just built, such as `./hello.wasm`, from the workspace. With only
exact registrations, WASIX would execute such a file natively inside the Bash runtime,
outside the Supervisor's process table and import-profile checks.
`Runtime.registerHostCommandDirectory(directory, handler)` routes those modules to a trusted
handler instead. It takes the same handler and thread rule as `registerHostCommand`, and
needs no patch: it is part of the SDK's `host_command.rs`.

```js
runtime.registerHostCommandDirectory('/workspace', (invocation) => runModule(invocation));
```

Lookup on the guest's thread:

1. An exact registration wins.
2. Otherwise the longest registered directory strictly containing the path is selected.
   Only a normalized absolute path can match. WASIX turns `./name` into one by prefixing
   the cwd; relative names with `..` keep the ordinary resolver.
3. Before the child is taken, the first four bytes are read through the guest's own
   filesystem. Only the Wasm magic `\0asm` is routed. Any other file (a script, text,
   a missing or unreadable file) returns "not found" to WASIX, which then uses its ordinary
   resolver, so Bash keeps its usual `ENOEXEC`/script or `ENOENT` behavior.

`invocation.path` is the matched absolute path and `invocation.argv` the guest's argv
unchanged. The handler, not WASIX, decides how to run the module; in the container it is
`wasm-run` on the live artifact adapter, whose import-profile check applies. Reading the
magic is a four-byte read, not an execution. The file can change between that read and the
handler's own read; the handler validates what it reads.

### Actual SDK gate

Commit `414a524f41306b5153597a950237b8f2c59beda7` (patches 0001–0012 plus directory
routing) was prepared into a fresh physical copy with 584 pins and a unique target:
typecheck 298.595 s, release 557.648 s, bindgen 1.763 s and static inspection 0.254 s.
Each stage exited 0 with every process reaped. The bound Wasm is 9,191,476 bytes, SHA-256
`647f97d834037cf66f1bd4e2ca02d43b4aeed75b05ba1f87b4a78b5e541d02ff`; binary receipt
`8d8bad7cf82dcb629d5c0061f0ed5f92a51e5a55f0162a2572c86b88e47801a7`. Stage receipts are
archived as `evidence.host-executables-*.json` with a
[recheck](evidence.host-executables-sdk-binary-metadata.json). Local packaging produced
receipt `c26676d7b65a5c42534324cf26f2e14ad49c49e3537b01155f1568c595f1fc44`. The shell
acceptance script runs with this package on the wasm-idle shell branch.
