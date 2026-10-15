# Actual Bash host-command dispatch probe

This opt-in Chromium probe runs the real startup-cwd GNU Bash on the rebuilt SDK with the
trusted host-command registry from bridge patches 0007/0008. When Bash execs a registered
path, the SDK moves the prepared child to its scheduler thread, where this owner Worker's
handler calls `createHostCommandHandler`. That runs a real no-libc WASI guest
(`test/fixtures/live.wasm` or `command.wasm`) in a container live Worker whose standard
descriptors are the Bash child's own delegated descriptors. There is no JavaScript shell
parser, no stdout protocol and no command string interception.

The trusted owner Worker initializes the SDK with a verified Module and shared Memory,
creates the container with only the live adapter, registers `/opt/host/bin/tool`,
`/opt/host/bin/probe` and a deliberately throwing `/opt/host/bin/broken`, and leaves
`/opt/host/bin/unregistered` unregistered. Each of those paths holds the same native
placeholder file, which starts with NUL so neither WASIX nor Bash can execute it as
Wasm or as a script. The file only satisfies Bash's own command search.

| Case | Script behavior | Required observation |
| --- | --- | --- |
| HOST-METADATA | `cd sub`, then argv with spaces, Korean and an empty argument | Prepared argv, raw environment and actual cwd `/workspace/sub`; guest argv/env bytes; descriptors 0–2 |
| HOST-PIPE-REDIRECT | Two host commands joined by a Bash pipe, then `> binary` and `< binary` | Exact binary bytes through WASIX pipes and a shell-opened file; `PIPESTATUS` 0 0 |
| HOST-EXACT-CONSUMPTION | `printf xyz \| { tool one; tool; }` | The first guest consumes one byte; the second receives the rest |
| HOST-STATUS | Guest `proc_exit(23)` and a trapping guest | Statuses 23 and 134 |
| HOST-EPIPE | `tool yes \| tool one` | The writer receives `EPIPE` and exits 64 after the reader exits |
| HOST-PATH-LOOKUP | Bare `tool` through `PATH` | Bash's own lookup reaches the registered path with argv0 `tool` |
| HOST-FAILURE | Throwing handler, then the unregistered placeholder | Status 126 without running a guest; no dispatch or native execution for the unregistered path; the shell continues |
| HOST-TAIL-EXEC | `exec /opt/host/bin/probe exit` | Bash itself completes with the host command's status 23 |

Every case also requires one handler call per external command on the SDK scheduler
thread with a frozen invocation, an empty container process list after Bash completes,
the SDK and container Workers retired before and after context close, no unexpected
console errors and the public `registerHostCommand`/`HostCommandDescriptor` API.

## Scope

The guest's stdio is delegated, but files are not shared: the guest writes its own
`out.bin` into the container VFS while Bash's redirections use the native WASIX
`Directory`. `HOST-METADATA` records both sides to keep that boundary visible.
`commonContainerFdVfsQualified` and `shellBackendReady` remain false. Cancellation of a
running host command, guest signals, PTY semantics, BusyBox and Clang shell commands and
command-lazy assets are later gates.

## Running

Build `packages/core`, `packages/llvm-core` and `packages/container` first; the probe
serves the built container modules and records both their bytes and the TypeScript
source identities. The configuration names the pinned SDK package receipt and Bash
WEBc, plus an optional Chromium path and a fresh absolute output directory:

```json
{
	"packageReceipt": "/private/sdk-host-command-package/receipt.json",
	"packageReceiptSha256": "<pinned in probe-container-shell-host-command-lib.mjs>",
	"bashWebc": "/private/bash-build/candidate/bash-exec-shim.webc",
	"output": "/private/new-host-command-probe"
}
```

```sh
node --test scripts/probe-container-shell-host-command.test.mjs
node scripts/probe-container-shell-host-command.mjs --check /private/request.json
node --disable-wasm-trap-handler --wasm-num-compilation-tasks=1 \
  scripts/probe-container-shell-host-command.mjs --run /private/request.json
```

Each case has a 30-second deadline, a two-second owner cleanup acknowledgement and a
five-second Worker retirement window, in a fresh browser context using the existing
cookie helper. Run long attempts under the private background supervisor and keep the
original receipt; a failed attempt is never replaced by a later one.
