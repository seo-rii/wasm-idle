# ADR-002: keep the shell backend behind the G0 gate

Status: candidate B implemented behind the optional WASIX adapter; public combined-artifact/browser and production qualification are recorded separately.

Decision date: 2026-10-14. Scope: C-02 and the pinned runtime below.

## Current implementation (2026-10-16)

Candidate B is implemented by the maintained SDK/WASIX bridge and the optional
`@wasm-idle/container/adapters/wasix` entrypoint. Root container imports do not
load WASIX. The original GNU Bash parser/evaluator determines command, redirect
and pipeline behavior. Its prepared child argv/env/cwd and inherited stdio reach
trusted registered Supervisor commands. `Directory.fromHostFileSystem` delegates
the shell's live filesystem calls to the common VFS. The default Clang route uses
the explicit snapshot writer-lease profile. Open shell output files survive a normal snapshot
commit with their inode, offset and append contract, including nonzero guest exit.
Crashes/cancellation discard unpublished compiler changes.

The optional `llvm-clang-tool-host-live-v1` command adapter delegates compiler file
operations and byte descriptors to the same owner transport. It preserves completed
writes on cancellation and supports concurrent file visibility. Its separate actual
Node/Chromium command receipts pass 14 checks each, including the real compiler's
closed-stdin repair through the null device. Actual Bash composition passes 50 checks,
and the rendered live workbench passes six. A trusted local application setting selects
the fixed adapter, Worker and stdio route; its manifest identity changes with the profile.
The default snapshot distribution separately passes all 83 checks across eight scenarios.
Neither profile changes the other's visibility/cancellation contract. These are local
Chromium qualifications; production deployment and source/notice review remain separate.

The JavaScript owner never performs WASIX work that can wait for one of its own
filesystem callbacks. Command preparation stays on the guest side, and a service
thread owns child descriptor I/O/completion. Bounded per-descriptor queues preserve
write ordering while control and other descriptors continue. The raw stream profile
uses bounded native pipes and `Instance.waitForExit()`; it does not invoke the legacy
SDK capture API. An isolated owner realm tracks and retires its SDK Worker group,
including late startup. Public owner transport reports unconfirmed cleanup if that
realm is lost. Routed foreground cancellation can leave Bash alive; a builtin loop
requires ending the session and opening a fresh owner.

The original observations below are historical experiment results, not descriptions
of the current implementation. The [qualification ledger](../container-qualification.md)
records exact artifact and browser gates. Descriptors beyond inherited stdio, arbitrary
signals, PTY/termios and job control remain unsupported. There is no Linux, WASIX-wide,
or general POSIX compatibility promise.

## Original staged decision

Continue the independent command-container API and common resource contracts. Do not make
`@wasm-idle/container` depend on WASIX, and do not call the command API a shell MVP.
Candidate A, executing prepared WASI modules inside the existing Bash/WASIX runtime, is a useful
real experiment. It does not yet satisfy the shell backend gate. Select B for the next source-pinned porting prototype. The pinned Rust runtime has a concrete
`VirtualCommand::exec` boundary that can receive a trusted host command with the existing child
context and join handle. The public JavaScript SDK does not expose it. C remains insufficient
without the same host and resource changes; no candidate is a qualified production adapter.

The experiment runs the existing GNU Bash parser/evaluator, real compiled ABI guests, and the
existing real Clang binary in Chromium. There is no JavaScript command parser, mock compiler,
or UI interception of shell strings. The runnable harness, exact identities, raw byte output,
exit codes and individual gate results are documented in
[container-shell-probe.md](../container-shell-probe.md).

## Version boundary

The package is `wasmer/bash@1.0.25`, source
`fc8096485478055f4fcf31402004fdd8ff6b72b7`, with `@wasmer/sdk@0.10.0`. Its JavaScript API uses
`Wasmer.fromFile`, `Command.run`, `Directory`, and `Runtime({ registry: null })`.

Review the SDK source at the npm package's recorded git revision
[`93b8b738ebd3ee57e118da0f0eb795b97d5b999e`](https://github.com/wasmerio/wasmer-sdk/tree/93b8b738ebd3ee57e118da0f0eb795b97d5b999e).
The current [JavaScript documentation](https://docs.wasmer.io/runtime/js/) describes a different
`sandboxes.create` API. Its examples do not establish that the pinned SDK exposes the same hooks.
The similarly named old `v0.10.0` Git tag is not the npm package's git revision either.

## Original unmodified runtime observations

| Contract                | Observation with the pinned runtime                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real external execution | Mounted Preview 1 Wasm executes from real Bash. Spaces, Korean arguments and exported environment bytes survive. An empty argument disappears.                                                                                                                 |
| cwd                     | A separate guest calls `wasix_32v1.getcwd` and observes `/workspace/sub` after Bash `cd sub`. This does not imply that Preview 1 libc resolves relative paths the same way.                                                                                    |
| Exit and streams        | An early run observes child exit 23 through `$?`; the complete rerun observes 0 instead. Exit preservation is not qualified. Binary stdin, two external pipeline stages and stdout retain NUL, `0xff`, CR and UTF-8. stderr remains separate.                  |
| File sharing            | With an absolute executable path, a child reads a shell-created file and writes a new file visible to the parent and host `Directory`.                                                                                                                         |
| Pipeline redirect       | A new redirect file can be read inside the shell but is absent from the host `Directory` after completion. The common-mount gate fails.                                                                                                                        |
| Final external command  | A script ending in an external invocation can leave SDK `wait()` pending. The harness records a timeout separately from a guest exit.                                                                                                                          |
| Clang                   | The actual binary runs `--version`. An absolute source path produces a real object with `-c` in the selective run, but the complete rerun times out. A relative source path is not found in this profile.                                                      |
| Clang driver/linker     | A freestanding link, with no sysroot libraries required, reports `WASI does not support spawning subprocesses`. The observed exit changes from 1 to 0 between runs, while the output artifact remains missing. Both outcomes fail qualification.               |
| Cancellation            | The harness observes a running loop/blocked read, or pending asset response, cancels the owned group, then starts a new Bash group in the same page. This is whole-backend recovery, not foreground interrupt with a surviving shell.                          |
| Worker lifetime         | Explicitly terminating tracked direct Workers is insufficient for every normal completion. Browser-observed descendants can survive the five-second retirement window. Closing the isolated test context is the final test cleanup, not an SDK implementation. |

These results describe the tested paths, not a POSIX compatibility claim. In particular, the
filesystem experiment is not proof of concurrent live access across arbitrary adapters.

## Backend comparison

| Candidate                            | Decision and required work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: native WASI children inside WASIX | Keep as a candidate. The existing Clang module has Preview 1 imports and has produced a real object in one run. Fix or replace the demonstrated argv, exit, path, pipeline visibility, wait and Worker ownership boundaries; connect the real linker; demonstrate repeatability, memory policy and command-lazy verified bytes.                                                                                                                                                                                                                                                               |
| B: Supervisor exec bridge            | Not exposed by the pinned public SDK. [`RuntimeOptions`](https://github.com/wasmerio/wasmer-sdk/blob/93b8b738ebd3ee57e118da0f0eb795b97d5b999e/src/js_runtime.rs) accepts registry/API-key/network-gateway configuration, and [`SpawnOptions`](https://github.com/wasmerio/wasmer-sdk/blob/93b8b738ebd3ee57e118da0f0eb795b97d5b999e/src/options.rs) accepts arguments, environment, streams, mounts and package names. Neither supplies an arbitrary JavaScript exec resolver or fd/VFS callback. A maintained SDK/runtime patch needs its own ABI, resource ownership and cancellation tests. |
| C: bridge executable                 | A real Wasm importing `container.dispatch` fails to initialize under the unmodified runtime; the guest status observed by Bash is 45. A bridge executable alone cannot add the missing host import, dedicated control fd, wait/cancel or shared-filesystem contract. No stdout marker protocol is exposed as a production API.                                                                                                                                                                                                                                                                |
| D: upstream shell host port          | Remains a separate fallback epic. Preserve the actual upstream parser/evaluator if pursued. No decision to undertake or qualify this port is made here.                                                                                                                                                                                                                                                                                                                                                                                                                                       |

The [WASIX `proc_spawn` ABI](https://www.wasix.org/docs/api-reference/wasix/proc_spawn/)
does not itself supply a JavaScript adapter extension. The SDK's
[`Instance`](https://github.com/wasmerio/wasmer-sdk/blob/93b8b738ebd3ee57e118da0f0eb795b97d5b999e/src/instance.rs)
also has no public process termination method. The probe's Worker-group owner is experimental
harness code and must not become the public lifecycle implementation by copying it unchanged.

## Asset, file and fd ownership

The Node harness verifies local SDK/Bash bytes against the repository lock before serving them
from a private loopback server. It verifies the extracted Bash executable identity too. The
browser starts from those bytes, imports the verified SDK through a Blob URL, and initializes
nested SDK Workers with the same module. Registry lookup is disabled, and the browser harness
rejects requests outside its own test origin.

Each case owns a `Directory` mounted at `/workspace`, a Bash runtime group and its stdio. The
WASIX runtime owns guest fd inheritance and pipeline construction. The host drains byte
streams and reads the mounted directory after completion. The probe does not replace the
SDK's internal filesystem with the container VFS. The Clang experiments mount prepared bytes
before starting Bash; they therefore do **not** prove command-lazy compiler loading.

No npm runtime dependency, producer pin, public API or deployment is changed by this ADR.
Promotion requires all G0 checks and the later real BusyBox/Clang/shared-VFS shell acceptance
fixture. Until then, unsupported shell features, full job control, arbitrary signals, durable
workspace and native fork semantics remain outside the supported container profile.

## Source-pinned B prototype

The [bridge candidate](../../runtimes/wasm-bash/bridge/README.md) records the exact SDK and
`wasmer-wasix@0.601.0` source pins, five separated patch boundaries and a bounded private exec
frame. The original runtime trace observes a real guest `proc_exit(23)` followed by a Bash
`proc_join` receiving zero. Its legacy newline/CR argument serialization also loses empty
arguments, and explicit environment handling merges instead of replacing state. These are
source-backed hypotheses with reproduction fixtures, not evidence that the proposed patches
already fix the browser runtime.

The next backend keeps the Supervisor as the sole live filesystem and pipe owner. WASIX
`VirtualCommand`, `virtual_fs::FileSystem`, descriptor/pipe creation and SDK thread ownership
all need explicit integration. The small hook patch does not yet implement the JavaScript
command registry, shared resources, cancellation or foreground shell recovery. The existing
container WASI live adapter therefore does not qualify this shell path automatically.

The fifth patch exposes owned immutable command metadata from the prepared child
builder. Both exec branches prepare argv/environment before dispatch; spawn also
applies child cwd and fd operations first. Its cwd comes from the child's WASIX
filesystem lookup, independently of parent state and `PWD`. The external SDK
compile probe checks public accessibility without returning an execution or
successful task handle. This does not export mutable runtime state or establish
common live filesystem/fd capabilities.

The initial prototype included only protocol tests and source-patch application checks.
That source-only status is superseded by the concrete rebuild observations below. Applying
patches alone still does not qualify candidate B as a production backend.

The genuine pinned SDK library and external command-snapshot example now pass
`cargo check --locked --offline --target wasm32-unknown-unknown --lib --example
container_command_snapshot_compile -j 1` at source
`de98d061435a308e8bbcd2ca195d29ac07401774`, with all owned processes reaped and
all 580 recorded source/toolchain/preparation pins unchanged. The
[immutable metadata receipt](../../runtimes/wasm-bash/bridge/evidence.sdk-typecheck.json)
and [original process receipt](../../runtimes/wasm-bash/bridge/evidence.sdk-typecheck-process.json)
preserve that evidence. Earlier genuine Rust API errors and dependency-cache
failures remain recorded separately.

## Rebuilt observations on 2026-10-15

The actual Worker uses a second WASI import resolver. The first five-patch SDK/Bash run on
[#195](https://github.com/seo-rii/wasm-idle/pull/195) therefore fails with Noexec(45) before
guest entry. The sixth patch on [#196](https://github.com/seo-rii/wasm-idle/pull/196) registers
the private exec import on that real path; fresh-source SDK typechecking, release generation,
matching bindgen and local module/Worker packaging pass. The generated SDK entrypoint and
Worker graph retain fixed trusted local URLs and caller-supplied verified Module/Memory.

The [#197](https://github.com/seo-rii/wasm-idle/pull/197) actual browser run then passes 17
of 18 selected native WASIX checks. The remaining relative redirect writes outside the host
workspace because the pinned libc's legacy relative-open cwd remains `/` while WASIX cwd is
`/workspace`. Actual absolute-path/explicit-chdir comparisons isolate this startup boundary.
The separately pinned constructor on [#198](https://github.com/seo-rii/wasm-idle/pull/198)
synchronizes those states before Bash main; its real offline producer build/import inspection
passes. It does not rewrite scripts, arguments or the Bash parser.

At application `7c7c32c3dc3c8f6842dd59bd677457e5e9613032`,
[#199](https://github.com/seo-rii/wasm-idle/pull/199) runs the same ten scripts and ABI
fixture sources with the same SDK package and new Bash bytes: all 18 checks pass in Chromium
153.0.8010.12/Linux. The host sees the exact nine redirected binary bytes; all 60 Workers
retire. Original Noexec and 17/18 receipts remain unchanged beside the successful receipt.
This improves candidate A's native-child observations; it does not exercise a JavaScript
Supervisor command resolver or replace native `Directory` with the common Container VFS.

The separate [#200 cancellation probe](https://github.com/seo-rii/wasm-idle/pull/200), at
application `266469ff21821f8e347fcc967bc32d3da8fb8437`, passes 19 selected checks for actual
CPU-loop, blocked-input and pending-download cancellation plus same-page Bash recovery.
The trusted owner explicitly terminates its SDK Worker group; the next command uses a fresh
owner and shared memory, reusing only verified immutable bytes and the compiled SDK module.
All 21 observed Workers retire before recovery and context closure. The partial pinned WEBc
request is aborted after 16,384 bytes; the server observes no active response. This is forced
host-group cleanup, not a new SDK termination method, guest signal, surviving-shell interrupt,
PTY or Container asset-service cancellation contract. The pending wait is observed before
cleanup, and a late worker failure cannot be treated as successful cancellation.

All current `shellBackendReady` and `commonContainerFdVfsQualified` fields remain false.
The production backend decision stays deferred. Candidate B's next required experiment is
actual Bash external dispatch through a trusted host-command registration into a small real
WASI command, with prepared-child argv/env/cwd, inherited fd endpoints and common live files.
The source-pinned Rust `Runtime::host_command`/`VirtualCommand::exec` seam supplies the
extension point; the current SDK JavaScript runtime still inherits no implementation.
`HostCommandSnapshot` grants metadata only. It cannot be treated as file/fd authority, and a
JavaScript callback must remain on its owning Worker rather than being marked `Send + Sync`.
Clang and BusyBox integration, verified command-lazy loading and public process cancellation
must pass their actual common-resource fixtures before candidate B or a shell MVP is promoted.

## Trusted host-command dispatch (candidate B, first layer)

Bridge patches 0007/0008 ([#205](https://github.com/seo-rii/wasm-idle/pull/205)) implement
the `Runtime::host_command` seam in the SDK:
- a registered exact path takes the prepared child out of the WASIX builder;
- the SDK moves that child to the scheduler thread;
- the JavaScript handler registered there receives the snapshot plus descriptors 0–2;
- JavaScript values never cross threads.

On the C-15 integration branch, `createHostCommandHandler` runs container live guests with
those descriptors delegated directly. The guest's own `fd_read`/`fd_write`/`fd_close` call
Bash's child descriptors through the Supervisor RPC, with no relay buffer.

Actual Chromium runs confirm:
- argv, environment and cwd fidelity;
- binary pipes and shell redirections;
- exact stdin consumption;
- `EPIPE`, PATH lookup, tail exec, start failure and cleanup.

[#208](https://github.com/seo-rii/wasm-idle/pull/208) fixes two WASIX `proc_join` status
defects. Statuses of 79 and above were reported as 79, and WNOHANG reported a running child as
exited 0. An intermittent first-command status loss and a rare hang before dispatch remain
open; see `packages/container/test/host-command-shell/README.md`.

This layer does not join the filesystems. The shell keeps its WASIX `Directory`, and the
guest uses the container VFS. `commonContainerFdVfsQualified` and `shellBackendReady`
remain false. The next layers are:
- a live shell filesystem backed by the container VFS, including WASIX cache revalidation;
- descriptors beyond stdio;
- public cancellation of a running host command;
- BusyBox/Clang dispatch.
