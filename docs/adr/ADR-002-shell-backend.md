# ADR-002: keep the shell backend behind the G0 gate

Status: accepted for staged development; candidate B selected for a source-pinned porting prototype; production shell backend deferred.

Decision date: 2026-10-14. Scope: C-02 and the pinned runtime below.

## Decision

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

## Observed boundary

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
common live filesystem/fd capabilities; actual Rust compilation is a distinct gate.

Only protocol tests and source-patch application checks are included at this stage. SDK Rust
typechecking and actual SDK/Bash rebuild remain pending under the current resource budget.
No producer lock or npm runtime dependency changes; no shell support promotion follows from
patches applying cleanly. Repeat the original real Bash gates with rebuilt, pinned artifacts
before accepting candidate B as a production backend.
