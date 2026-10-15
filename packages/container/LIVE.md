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
64 KiB data area. Directory-list metadata (names and inode statistics) must fit 64 KiB; larger
listings return `ENOSPC` explicitly. No network or arbitrary host function RPC
exists. Each channel can access only its own descriptor map in its container.

Each path syscall carries the process-owned directory descriptor to the Supervisor.
Resolution and the complete operation run synchronously there, including final
symlink checks for no-follow open, both directory descriptors for rename, and
directory entry names with their inode metadata. A host rename followed by a new
directory at the old path cannot redirect a pending operation to that replacement.
Directory cookies identify entries in one listing held by the open directory
descriptor, so removing entries between reads does not skip later names. Passing
cookie zero explicitly refreshes the listing; additions or renames during an
iteration appear after that rewind. Closing the descriptor releases the listing.
Batch filesystem bindings use the same structural contract with local synchronous
operations; they do not issue RPC or change snapshot visibility.

Regular files and directories accept Preview1 `NONBLOCK` because their memory
filesystem operations complete immediately. The flag is reported by
`fd_fdstat_get` and can be changed with `fd_fdstat_set_flags` when the descriptor
has that right. Changing `APPEND` after open, sync flags, and nonblocking standard
streams remain unsupported and return `ENOTSUP`.

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

## Delegated stdio and shell host commands

`spawn(command, args, { stdio })` lets a trusted caller hand a live guest its own
descriptors instead of container streams. Each of `stdin`, `stdout` and `stderr` may be
omitted (container stream), `null` (closed from the start, so guest use is `EBADF`) or a
caller-owned endpoint: `{ read(maxBytes), close() }` for stdin and
`{ write(bytes), close() }` for outputs. The guest's `fd_read`, `fd_write` and
`fd_close` on that descriptor call the endpoint directly through the same Supervisor
RPC: a read never asks for more than the guest requested, a write may be partial and
reports the endpoint's exact count, and a zero-length request does not call it. Endpoint
failures reach the guest as their `code` when it is one of `EINVAL`, `EBADF`, `EACCES`,
`EISDIR`, `ENOTSUP`, `EPIPE` or `EIO`; anything else becomes `EIO`. The container never
closes a delegated endpoint when the process exits; the guest's own `fd_close` closes it
once. The returned stream for a delegated channel is already closed. Delegated output is
not captured, so the combined output budget does not apply to it. Only live adapters
accept `stdio`; `run` and `spawnPipeline` reject it.

`createHostCommandHandler(container, { routes })` turns this into a trusted shell
host-command handler. It accepts the structural invocation of the patched WASIX SDK's
`Runtime.registerHostCommand` (path, argv, raw environment bytes, actual cwd and
descriptors 0–2) without importing that SDK. Each exact registered path maps to one
container command; the shell's `argv[1..]` follow the route's `args`, and the container
supplies argv0. Environment entries must be unique UTF-8 `name=value` pairs. The guest
runs with the shell child's descriptors delegated as above and the shell's cwd, which
must also exist in this container's VFS: the shell's WASIX filesystem is not the
container filesystem yet. Results map to shell statuses: an exit code keeps its low
eight bits, a timeout is 124, a filesystem conflict 125, a runtime failure 134 and a
termination 143. A missing route or command is 127 and any other start failure is 126,
each with a one-line diagnostic on the delegated stderr. `onRecord` observes outcomes
without argv, environment or byte contents. This is not a shell, PTY or signal mapping.

Two route kinds reach commands that delegated live stdio cannot:

- **Forwarded routes** (`stdio: 'forwarded'`) run a snapshot adapter such as Clang on
  container streams. The command's stdin is empty; the shell's stdin is never read.
  stdout and stderr are copied to the shell child's descriptors as chunks arrive,
  following partial writes. Ordering between the two channels is only arrival order. If a
  descriptor fails (for example `EPIPE`), its remaining output is drained and dropped, and
  the command's own status is still returned. The adapter's writer lease applies while
  it runs: shell mutations of the workspace fail with `EBUSY` until it commits or discards.
  Existing shell file handles survive that boundary, so stdout/stderr redirection and
  append to the common workspace work with snapshot commands. A snapshot that removes
  an inode still open in the shell fails with filesystem-conflict status 125; its entire
  private change set is discarded.
- **Module directories** (`moduleDirectories`) take normalized absolute directories that
  the shell runtime also registered with `registerHostCommandDirectory`. A normalized path
  strictly below one runs as `wasm-run <path> argv[1..]` with delegated stdio, so the
  container's `artifactAdapter` must be a live adapter. argv0 is therefore the absolute
  path, not the shell's spelling. The module is read from the container VFS and passes the
  adapter's import-profile checks. An exact route takes precedence.

The returned handler's `interrupt()` aborts every command it is running or
starting, as a terminal's interrupt key stops the foreground job. Each completes with
status 130 (`128 + SIGINT`) and no diagnostic, and the shell continues with that status:
Bash sees an ordinary exit, not a signal death, so a non-interactive script is not
stopped by it unless `set -e` applies. A live guest's Worker is terminated; a snapshot
adapter discards its private changes. This is owner-initiated cancellation, not a guest
`kill` or signal delivery.

Forwarded output remains part of the handler invocation after the snapshot guest
has exited. Interrupt also cancels pending forwarding and returns 130 at that stage;
already committed filesystem changes remain. Cancellation closes the forwarded
child's stdout/stderr endpoints once, leaves the shell's stdin untouched, and observes
late write failures without waiting for them. Normal completion leaves those endpoints
owned by the shell. `container.disposalSignal` aborts when `dispose()` starts; handlers
use it to stop forwarding with status 143 even when no guest process remains.

`createShellFilesystem(fs, { root })` exposes part of the container VFS to a trusted
shell runtime as a synchronous delegate, such as the patched SDK's
`Directory.fromHostFileSystem`. Paths are absolute inside the mount, and the root
capability confines `..` and symlinks to it. Handles are delegate-owned container
descriptors with explicit-offset reads/writes, append-mode writes at the live end,
`fstat`, `truncate` and `close`. Operations run directly on the VFS, like editor writes:
other live guests and editors see each one immediately. A snapshot adapter's writer lease
makes mutations fail with `EBUSY`. Single I/O is bounded (default 1 MiB), and so is the
number of open handles (default 1,024).
Shell handles opt in to the VFS's snapshot-preservation policy: commit preserves their
inode identity, offsets and flags while retaining the restrictions described in `FS.md`.

Validation uses real no-libc Wasm fixtures (`test/fixtures/live.c` and `path.c`), including
two live guests sharing files, byte counts beyond the ring/RPC bounds, early reader
exit, cancellation during read/write/CPU execution, crash visibility, and restart.
Deterministic host interleavings exercise every supported path operation and
directory listing, plus both rename descriptors and a final symlink replacement.
These ABI tests do not replace the real BusyBox `yes | head` or shell acceptance
fixtures. Rebuild with `node scripts/build-fixtures.mjs`; run Node contracts and
`node scripts/test-live-browser.mjs` for the isolated/nonisolated Chromium gate.
