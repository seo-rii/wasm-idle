# @wasm-idle/container

Experimental command-container foundation, version `0.1.0-alpha.0`. This package is opt-in;
existing playground and compiler APIs are unchanged. Only host JavaScript, types and documents
belong in the npm tarball. Runtime assets are separate verified distributions.

The API uses argv arrays and raw byte streams. A normal nonzero guest exit is a process result;
validation/startup failures are typed host errors. `exited` marks cleanup, not consumption of
remaining output. Callers of `spawn` must drain both output streams to release backpressure.
`run` will drain both and deliver stdin EOF. Cancellation and disposal do not delete workspace
data. Persistent storage, actual shell, Clang CLI and BusyBox require separate qualification.

```ts
import { createContainer } from '@wasm-idle/container';
import { createWasiAdapter } from '@wasm-idle/container/adapters/wasi';

// `bytes` is a trusted, previously verified core Wasm command, not a URL.
const container = createContainer({
  adapters: [createWasiAdapter()],
  commands: { tool: { adapter: 'wasi-preview1', bytes } }
});
container.fs.writeFile('/workspace/input', new TextEncoder().encode('hello'));
const result = await container.run('tool', ['input']);
await container.dispose();
```

The current **batch** adapter runs in a dedicated Worker with a private leased filesystem
snapshot. `spawn()` waits for Worker/profile readiness; guest execution starts after stdin is
closed. `run()` closes stdin automatically. Output is collected under a hard combined bound,
then exposed as byte streams after guest exit. This profile does not support live output,
interactive stdin or process pipelines. The standalone bounded-pipe primitives are tested but
are not a claim of live guest I/O. A future isolated adapter has its own qualification gate.

Defaults: 64 MiB workspace, 16,384 inodes, 64 MiB native Wasm memory maximum, 8 MiB input and
combined output, 8 MiB `run()` capture. Memory limits require one defined, unshared wasm32 memory
with an explicit maximum; modules with imported/shared/unbounded memories or a start section
are rejected before execution. Only enumerated Preview1 function imports and the
`wasm_idle_process_v1.initial_cwd` initialization import are accepted. A command with
non-root cwd must implement that initialization profile; a libc-linked producer must
call real `chdir`, because preopens and PWD alone do not initialize its cwd. Legacy
Preview1 modules can run with explicit `cwd: '/'`. Polling,
metadata mutation and durability syscalls return explicit unsupported errors. Network imports
are rejected. One snapshot command owns the workspace writer lease; conflicting startup or
editor writes fail rather than silently overwrite files. Open host fds must be closed first.

The current cwd fixture exercises raw WASI dirfd/preopen operations. Initialization of cwd
inside a guest's libc, and general-purpose CLI compatibility, require separate qualification.

Ordinary exit, including a nonzero code, commits a validated filesystem snapshot. Runtime trap,
output-limit failure and termination discard it. `terminate()` reclaims the dedicated Worker,
wakes pending batch input/output, and releases the lease. `dispose()` stops all commands and
retains the filesystem for inspection/export; `flush()` explicitly rejects memory-only mode.
Worker factory injection is trusted local application code and remains responsible for matching
the native Worker termination contract. No arbitrary JavaScript adapter isolation is claimed.

See [filesystem contract](./FS.md), [development plan](../../docs/container-development-plan.md)
and [compatibility ledger](../../docs/container-compatibility.md).

A host may supply `packages: createContainerPackageManager(...)` using a validated pinned index.
`container.packages.listCommands()` reads only metadata. `run(name, argv)` verifies the complete
package closure before atomically mounting it readonly and acquiring a workspace lease. A
successful mount is immutable and reused by identity; a failed closure publishes nothing. Later
runs of a command whose closure this container already mounted read the executable from that
readonly mount instead of preparing the closure again, so they need no network or asset cache.
The injecting host owns the package manager and may share it; container disposal cancels only
its own consumers. Dispose the manager separately when all users have finished.

`wasm-run <path> [args...]` executes a workspace artifact through the explicitly registered WASI
adapter after profile validation. It does not require executable mode metadata. Direct
`./artifact.wasm`, shell PATH/stat/exec nodes and shebang interpretation are not yet supported;
no placeholder `/usr/bin` executables are created. Local host command registrations cannot
replace pinned package commands or the reserved `wasm-run` name.

The separate [Clang adapter](./CLANG.md) uses the optional LLVM tool-host entrypoint.
Root imports do not load it or compiler bytes.
