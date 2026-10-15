# Optional WASIX shell owner

`@wasm-idle/container/adapters/wasix` provides `createWasixShellSession`,
`installWasixWorkerGroup`, and the `serveContainerOwner` /
`createContainerOwnerClient` MessagePort pair. Importing these modules starts no
runtime and downloads no assets. The application supplies a statically imported,
qualified SDK, a validated asset loader, immutable SDK/Bash identities, and
explicit container command routes. Package metadata cannot select JavaScript.

This entry point targets the repository's patched WASIX SDK and real GNU Bash
profile. An upstream SDK without `Directory.fromHostFileSystem`, host-command
registration, `rawStdin: true`, bounded pipes, and `Instance.waitForExit()` does
not satisfy the contract. Qualification belongs to the exact SDK/Bash receipt
and browser run; the injected-SDK unit tests only test the host protocol.

## Owner and session lifetime

Install a worker group before SDK initialization in a fresh Dedicated Worker.
The pinned SDK forwards guest thread creation to its owner scheduler, so the
group tracks those Workers, as well as container Workers created in that realm.
It enforces an allocation budget and aborts the session on worker errors. This
ownership profile does not cover arbitrary JavaScript that creates independent
descendants in other realms.

Each group and owner realm supports one SDK session. `dispose()` terminates its
tracked Workers, interrupts routed commands, frees SDK resources, and closes
owned filesystem handles. It permanently retains a closed Worker constructor
to reject late scheduler allocations after cancellation. Start a new owner
Worker for another session. After acknowledged owner disposal, the application
should terminate that owner Worker to release SDK globals and linear memory.
No disposal operation deletes workspace files or implicitly saves them.

`createWasixShellSession` loads the SDK Wasm and Bash WEBc through the supplied
verified loader, compiles those verified SDK bytes, and separately checks the
actual Bash executable digest before running it. The loader and container stay
owned by the injecting application. Initialization receives only static
application SDK/worker URLs and a bounded shared memory. Registry resolution is
disabled. Isolation, SharedArrayBuffer, and this pinned SDK profile are required.

The session exposes stdin/stdout/stderr and `exited`, plus `interrupt()`,
`terminate()` and `dispose()`. Its `pid` is the sentinel `0`: this backend resource
group is outside the Supervisor PID namespace; routed commands have normal
container PIDs. `interrupt()` cancels pending preparation and routed external
commands while allowing Bash to continue. It does not implement POSIX process
groups or signals. Builtin loops and blocked shell input require `terminate()`.
The `timeoutMs` option limits routed commands, not the lifetime of Bash.

The exit observer retains SDK streams before consuming `Instance.waitForExit()`.
It never captures output or closes stdin to force a batch result. Consumers must
drain stdout and stderr concurrently. Each output stream is pulled on demand;
chunks and input writes are limited to 64 KiB. The qualified SDK also bounds its
native pipes. A consumer that stops draining may block the guest. Normal exit
preserves buffered output for later reads; termination cancels pending I/O.
Startup cancellation retires the group and discards late SDK handles without
waiting indefinitely for an uncancellable SDK promise.

The pinned `waitForExit()` rejects SDK environment setup, traps, and lost exit
channels. The session turns those failures into `code: null` with
`reason: 'runtime-error'` and completes cleanup. Ordinary guest exits retain
their numeric code, including nonzero codes. An SDK that converts a host failure
into guest exit 1 does not satisfy this profile.

This is raw byte I/O, not a PTY. It provides no termios, resize, `isatty`, automatic
echo, Ctrl-C byte interpretation, `fg`/`bg`, or job control. The terminal binding
must explicitly call `interrupt()` or `terminate()`. UTF-8/ANSI rendering belongs
to the UI, never a pipe or filesystem operation.

## Files and commands

Shell mounts delegate to the same container VFS. Defaults are `/workspace`,
`/tmp`, and `/home/user`; additional mounts must be explicit, canonical and
non-overlapping. Each mount retains its own path capability. A path or symlink
cannot escape that capability. `createShellFilesystem` returns a binding with
an idempotent `dispose()` for closing all descriptors it owns after the backend
has stopped; unrelated descriptors are preserved.

Registered command directories are published atomically as readonly virtual
entries, with executable metadata and no executable file body. `readFile`/`open`
on those entries return `ENOTSUP`; execution belongs to the trusted SDK registry.
Common VFS metadata and directory listings expose the same entries to utilities.
The SDK filesystem ABI currently omits mode bits, so host dispatch enforces the
executable policy. Exact Bash PATH/access/exec behavior must be checked against
the real SDK/browser fixture; this is not general POSIX permission emulation.

Direct workspace execution checks executable metadata before routing to
`wasm-run`, which validates the Wasm ABI. An extension alone never grants execute
permission. The qualified Clang adapter can mark validated process artifacts
executable; data files, objects, and unsupported modules remain data. An explicit
registered `wasm-run` route can support non-executable input without claiming
direct execution support.

The default Clang profile uses its snapshot adapter. Shell redirection descriptors opt into retaining
their inode/offset across that snapshot. Writes and new opens are blocked while
the writer lease is held; a commit removing a linked open inode reports a
filesystem conflict. See [FS.md](FS.md). This does not make snapshot compilation
concurrently writable or a live filesystem adapter.

The optional `adapters/clang-live` entrypoint provides a separate compiler profile
with live filesystem calls and delegated byte endpoints. Completed writes remain
visible after cancellation. See [CLANG.md](CLANG.md) for its contract and actual
command receipts; qualification of a shell using it is a separate integration gate.

## MessagePort owner API

`serveContainerOwner(port, {container, startShell, ...})` binds a private port to
one container and generation. The host supplies `startShell`; messages cannot
select an adapter or a code URL. Version, generation, increasing request IDs,
operation shapes and byte budgets are checked. Output uses one outstanding read
per stream with no unsolicited byte queue. Control requests reserve capacity
even while stdout, stderr and exit are pending.

The client offers `startShell`, `inspect`, `flush`, `backup`, explicit
`restore(bytes, {replace: true})`, and workspace-only filesystem methods.
`fs.writeFile(path, bytes, {inode, bytes: baseline})` reuses the editor publication
contract and rejects conflicts. Both ordinary and conditional writes enforce
the `/workspace` capability after symlink resolution.

Optional hooks compose existing owners: `save` exposes save/autosave status and
routes `flush()` through the save controller; `clearAssetCache` invokes only an
explicit application cache action; garbage collection uses the persistence
owner; `dispose` releases host-owned asset/persistence services. The protocol
does not delete browser stores or silently flush dirty workspace data.

Control requests have a configurable deadline. Streaming reads, writes, exit
and startup can remain pending until input, output consumption or cancellation.
Pass an application-owned `signal` to the client and abort it on owner Worker
`error`/`messageerror` or lifetime end. This rejects pending operations. Transport
failure sends a best-effort disposal request and calls `onFailure`; remote
cleanup is **unconfirmed** without acknowledgment. Do not display a failed
connection as a successful save or teardown. Retain/export staged editor buffers
and create a fresh owner before restarting.

## Validation

- `test/unit/wasix-session.test.mjs`: injected-SDK protocol checks for lazy
  startup, raw streams, cleanup, late initialization, integrity and bounds.
- `test/contract/wasix-owner.test.mjs`: actual WASI Worker and MessageChannel byte
  streaming, interrupts, filesystem/editor boundaries and lifecycle faults.
- `test/shell-acceptance`: real Bash, BusyBox, Clang and generated artifacts in
  Chromium. Its receipt must identify the current SDK and sources to qualify
  this optional backend; protocol tests alone do not establish shell support.
