# Isolated live WASI commands

`@wasm-idle/container/adapters/wasi-live` is an optional core Wasm/Preview1 adapter.
It uses one dedicated Worker per command. Browser execution requires a secure
context, cross-origin isolation, and SharedArrayBuffer; missing capabilities fail
before a Worker is allocated. The existing snapshot adapter remains available for
batch execution without isolation. Neither adapter implements a shell or PTY.

```ts
import { createContainer } from '@wasm-idle/container';
import { createLiveWasiAdapter } from '@wasm-idle/container/adapters/wasi-live';

const container = createContainer({
  adapters: [createLiveWasiAdapter()],
  artifactAdapter: 'wasi-preview1-live',
  commands: { tool: { adapter: 'wasi-preview1-live', bytes: verifiedWasmBytes } }
});
const process = await container.spawn('tool', ['argument']);
// Consume stdout and stderr concurrently, write stdin, then close stdin for EOF.
// run() performs those operations for bounded batch capture with live execution.
```

`spawn` returns after module/profile preparation. Execution begins immediately;
input EOF is not a prerequisite. Output is available while the process is alive.
Each endpoint has a bounded ring, default 64 KiB (`pipeBytes`: 1..65536). Writes
can be partial; zero-byte reads/writes do not wait. Every writer must close before
the reader observes EOF after draining buffered bytes. Cancelling the output
reader wakes guest writes with Preview1 `EPIPE` (64). It does not deliver SIGPIPE.
A vectored read performs one bounded read and scatters its partial result. It does
not wait on a later iovec after consuming available input. Standard byte streams
report unknown file type, not a terminal character device.

The existing input/output admission limits still apply cumulatively (default
8 MiB input and combined stdout/stderr). `run` has its separate capture bound.
Output exceeding its process bound causes `runtime-error`; capture overflow
rejects with `CAPTURE_LIMIT` and terminates the process. If a command finishes
before consuming all supplied stdin, `run` tolerates that input broken pipe and
continues collecting its result. Clients must honor WritableStream backpressure
and consume both outputs; `exited` does not imply the caller has drained them.

The Supervisor owns the common filesystem and per-process descriptor mappings.
Guest Workers issue synchronous RPC to that owner; only the guest Worker calls
`Atomics.wait`. Control headers, metadata and byte payloads have fixed bounds.
Version, process generation, monotonically increasing request ID, operation and
lengths are checked on both sides. Large I/O repeats partial operations through a
64 KiB data area. Directory-list metadata currently must fit 64 KiB; larger
listings return `ENOSPC` explicitly. No network or arbitrary host function RPC
exists. Each channel can access only its own descriptor map in its container.

The default per-call wait deadline is 120,000 ms, including idle stdin. Set
`maxBlockedIoMs` explicitly (1..3,600,000) when a workflow needs a different bound.
Deadline expiry is a runtime failure. `SpawnOptions.timeoutMs` remains the separate
overall startup/execution deadline. Termination marks the control channel stopped,
notifies blocked waits, closes pending pipe operations and owned descriptors,
then terminates the Worker. Late responses cannot publish after this transition.
Control cancellation never waits for output capacity.

Live operations are visible at each completed VFS operation. Editors may write
during execution; reproducible builds must pin their input revision separately.
An already completed live write stays after crash/cancel. Snapshot adapters require
an exclusive writer lease and cannot run against this filesystem while a live
process is present. Atomic readonly package mounts can publish during live
execution while preserving existing open descriptors and unlinked open files.

`spawnPipeline([{ command, args }, ...], options)` connects explicit command arrays.
All adapters must be live. Admission reserves capacity for every process before
starting any Worker; oversized pipelines fail immediately. Consumers start first.
Preparation failure terminates all started consumers and releases reservations.
The returned handle exposes first stdin, last stdout, an array of separate stderr
streams, per-process exit results, and idempotent whole-pipeline termination.
Intermediate stdout streams are owned by the pipeline. It does not parse shell
strings, choose POSIX pipeline exit status, redirect files, provide job control,
or qualify WASIX/Bash/BusyBox compatibility.

Validation uses a real no-libc Wasm fixture (source `test/fixtures/live.c`), including
two live guests sharing files, byte counts beyond the ring/RPC bounds, early reader
exit, cancellation during read/write/CPU execution, crash visibility, and restart.
These ABI tests do not replace the real BusyBox `yes | head` or shell acceptance
fixtures. Rebuild with `node scripts/build-fixtures.mjs`; run Node contracts and
`node scripts/test-live-browser.mjs` for the isolated/nonisolated Chromium gate.
