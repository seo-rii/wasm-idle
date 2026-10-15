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
| HOST-PIPE-REDIRECT | Two host commands joined by a Bash pipe, then `> binary` and `< binary` | Exact binary bytes through WASIX pipes and a shell-opened file; last status 0 in Bash; all three Supervisor records exit 0 |
| HOST-EXACT-CONSUMPTION | `printf xyz \| { tool one; tool; }` | The first guest consumes one byte; the second receives the rest |
| HOST-STATUS | Guest `proc_exit(23)` and a trapping guest | Statuses 23 and 134 |
| HOST-EPIPE | `tool yes \| tool one` | The reader exits 0 in Bash; the Supervisor record shows the writer received `EPIPE` and exited 64 |
| HOST-PATH-LOOKUP | Bare `tool` through `PATH` | Bash's own lookup reaches the registered path with argv0 `tool` |
| HOST-FAILURE | Throwing handler, then the unregistered placeholder | Status 126 without running a guest; no dispatch or native execution for the unregistered path; the shell continues |
| HOST-TAIL-EXEC | `exec /opt/host/bin/probe exit` | Bash itself completes with the host command's status 23 |
| BASH-PIPESTATUS | `true \| false`, then print `PIPESTATUS` | Recorded only; not part of acceptance |
| BASH-SUBSHELL-DUP | `>&2` and `> file` at top level and inside pipeline brace groups | Recorded only; not part of acceptance |

Every case also requires one handler call per external command on the SDK scheduler
thread with a frozen invocation, an empty container process list after Bash completes,
the SDK and container Workers retired before and after context close, no unexpected
console errors and the public `registerHostCommand`/`HostCommandDescriptor` API.

## Attempt history

Every attempt's original browser and process receipts are archived unchanged under
[`evidence/`](evidence/); `scripts/probe-container-shell-host-command.test.mjs` checks their
recorded results.

1. [`module-import`](evidence/module-import.json): all eight cases failed before any
   guest started. The package root re-exports the verified asset loader, whose bare
   `@wasm-idle/core` import does not resolve in the owner Worker. The owner now imports
   the Supervisor and host-command modules directly.
2. [`first-dispatch`](evidence/first-dispatch.json), application `ad239941`: real Bash
   dispatch reached the Supervisor in every case and 31 of 35 checks passed. Bash printed an
   empty `PIPESTATUS`, and host-command statuses 126 and 134 arrived as 79, as did Bash's own
   native exec failure 126. The Supervisor records held the correct statuses.
3. [`pipeline-status`](evidence/pipeline-status.json), `22b03116`: printing member statuses
   with `>&2` inside a pipeline brace group failed with `Invalid argument`; a builtin-only
   pipeline also shows an empty `PIPESTATUS`.
4. [`subshell-redirect`](evidence/subshell-redirect.json), `9b091e5a`: a file redirection in
   the same position fails the same way, while redirections on simple pipeline commands
   (`tool > binary`) work. Member statuses are now checked against Supervisor records.
5. [`before-exit-status-fix`](evidence/before-exit-status-fix.json), `26981d03`: 39 of 41
   checks pass with the eight-patch SDK; only the two statuses above 78 fail.

6. [`exit-status-worker-retirement`](evidence/exit-status-worker-retirement.json) and
   [`exit-status-lost-zero`](evidence/exit-status-lost-zero.json), nine-patch SDK
   (`24803a51`): statuses 126 and 134 now arrive intact, but each run passed 40 of 41
   checks with a different intermittent failure: one Worker outlived the five-second
   retirement window, and once the first command of a shell reported 0 while its
   Supervisor record held 23.
7. [`ten-patch-run-1` … `ten-patch-run-7`](evidence/), ten-patch SDK (`164aa02f`), with a
   twenty-dispatch repeat case added: **runs 1, 3, 4 and 5 pass all 45 checks.** Run 2
   timed out in HOST-PIPE-REDIRECT before any dispatch; run 6 timed out in HOST-TAIL-EXEC
   the same way; runs 2, 6 and 7 each show the first-command 0 in HOST-STATUS; run 7 also
   had one Worker outlive the retirement window. All twenty repeated statuses and statuses
   126/134 were correct in every run.

The status loss is in the pinned WASIX `proc_join`, which writes the exit code through the
`Errno` type and maps every non-errno value to 79. Bridge patch 0009 writes the raw status
that wasix-libc `waitpid` reads. The empty `PIPESTATUS` and the failing redirections inside
forked subshells are Bash/WASIX behaviors independent of host commands; they remain open
shell gaps, recorded by the two diagnostic cases.

## Result

Real Bash dispatch into the container Supervisor works end to end:
- prepared argv, raw environment and actual cwd;
- binary bytes through WASIX pipes and shell-opened files;
- exact stdin consumption by successive commands;
- `EPIPE`, PATH lookup, tail exec, start failure without native fallback;
- Worker and process cleanup.

It is **not** yet qualified as reliable. Three of seven final runs showed two intermittent
defects that also appear without any host-command error:
- **A lost first-command status.** Bash's `nojobs.c` `wait_for` maps an `ECHILD` from
  `waitpid(-1)` to status 0. A slow first command outlasts the WASIX 50 ms deep-sleep
  threshold of `proc_join`, which makes the deep-sleep resume path a candidate.
- **An occasional hang before dispatch.**

Both remain open together with Worker retirement timing. `hostCommandDispatchPassed` is
true only for a complete run with no failed check. The archived receipts keep every
outcome.

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
