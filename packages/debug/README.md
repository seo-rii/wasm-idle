# @wasm-idle/debug

Optional debugger UI, session controller, expression helpers, language adapters, and Monaco editor
integration for wasm-idle. Install it separately in applications that provide debugging:

```bash
pnpm add @wasm-idle/debug
```

The Monaco integration is available from `@wasm-idle/debug/editor`; `monaco-editor` is an optional
peer dependency. This package contains code only and includes no runtime, compiler, WebAssembly, or
toolchain assets.

Debug execution is exposed through one adapter contract:

- `TraceDebugAdapter` preserves the existing source-instrumentation controls.
- `LldbDapAdapter` maps standard DAP threads, frames, scopes, lazy variables, breakpoints, stepping,
  memory reads, output, and process lifecycle events.

`LldbDapAdapter` does not infer conditional-breakpoint, logpoint, or data-breakpoint support from
LLDB's generic DAP advertisement. These capabilities remain false because the public adapter
contract cannot carry breakpoint conditions or log messages and does not expose data-breakpoint
operations. Add the adapter methods and their product-path tests before enabling them; the current
browser WAMR product also lacks the required target-side expression evaluation and watchpoints.

The playground controller still supports an exact local or argument name as a watch after its lazy
top-level scope has been loaded. When the runtime reports expression evaluation as unavailable, a
watch such as `answer` resolves from the matching variable entry, while `answer + 1`, field paths,
and other expressions remain `?`. This fallback does not advertise LLDB expression evaluation.
Adapter initialization snapshots its request arguments and explicit feature opt-ins before awaiting
the DAP response. Mutating a caller-owned options object in flight therefore cannot enable
WebAssembly expression evaluation after the conservative capability decision has begun.

Variable mutation, restart, and standalone terminate requests also remain false even when a generic
DAP server advertises them, because the `DebugAdapter` contract does not expose those operations.
Add the adapter method and its product-path tests before enabling the corresponding capability.

`createAdapterDebugSessionController()` provides the shared view model. Variable children remain
lazy through `variablesReference`; consumers should not serialize an entire LLDB variable tree.
Supply an LLDB DAP session from `@wasm-idle/llvm-core/debug`. Runtime assets remain owned by the
`wasm-llvm` producer and are deliberately excluded from this package.

LLDB response bodies are validated again at the adapter boundary even though the lower-level DAP
client already validates message envelopes. `threads`, `stackTrace`, `scopes`, `variables`,
`readMemory`, and `evaluate` must contain their required collections and fields plus well-formed
identifiers, source descriptors, counts, and presentation data. Memory data must decode as Base64
and cannot exceed the requested byte count. A malformed body rejects with
`DebugAdapterProtocolError`, whose `command` and `path` identify the failed field; hosts should treat
it as a session failure and dispose the LLDB/WAMR workers. Stack and scope line or column values may
be zero, matching DAP's representation for an unavailable source location.
For `readMemory`, both the decoded data and `unreadableBytes` share the requested byte budget. A
response cannot claim more readable-plus-unreadable bytes than the request count.
Recognized DAP events receive the same field validation. A malformed event is emitted only as a raw
`dap` event, so it cannot move the selected thread/frame, append non-string output, change process
state, or mutate the tracked breakpoint cache.

The playground-facing controller also exposes `readMemory(memoryReference, offset, count)` while
the target is paused. `DebugMemory` crosses the framework-neutral Sandbox and Terminal contracts
as a `Uint8Array`; browser automation and other serialization boundaries should explicitly convert
that array to plain byte values instead of relying on implicit typed-array serialization.

LLDB pause, frame, and breakpoint events carry the SHA-256 of the compiled source when the artifact
provides it. Hosts should call `markSourceRevisionStale(sourcePath)` when an editor model changes
during an active session. This includes non-selected workspace sources that are added, replaced, or
removed through a programmatic workspace update; compare the complete replacement against the
session workspace instead of tracking only the active editor model. The controller keeps execution
controls available but clears the paused line for that source and exposes `sourceRevisionStale`,
preventing a valid DWARF location from being drawn against newer text.

Command serialization also treats a runtime `pause` event as completion of the command that resumed
the target. Locks are versioned so a late `continue` promise cannot unlock a newer step request;
hosts may therefore issue the next step as soon as the stopped state is published.

The LLDB adapter and playground host version concurrent breakpoint updates per source path. A
delayed DAP response cannot replace the adapter's current breakpoint IDs or restore an older set in
the UI. DAP `new` events enter the same per-source replacement set as response IDs, while `changed`
and `removed` keep that set synchronized. A later source replacement therefore retires event-created
IDs, and late events for an untracked ID are discarded. Superseded controller calls resolve with the
current source snapshot instead of returning their stale result. Direct `LldbDapAdapter` calls use
the same rule for late successes, failures, and malformed response bodies, and returned
breakpoint/source objects are isolated from its event-correlation cache. The adapter controller and
playground host also ignore a superseded request's late failure instead of surfacing it after the
current update succeeds. Updates for different workspace files remain independent, while failures
from the latest request still propagate.

When a selected LLDB stack frame names another `/workspace/...` source, the host should await
`selectFrame()`, open the matching workspace file, and then update the controller source path. This
keeps the Monaco model, selected frame, paused line, and per-source revision state synchronized.

The strict Chromium LLDB suite also injects stale-generation control messages into the real LLDB
and WAMR workers and synthetic stale output, error, and exit events at the host boundary. The active
session must remain paused, step successfully, emit only current-generation output, and exit
normally.

The same product suite terminates the real WAMR target Worker and LLDB Worker in turn after a
source pause. Each browser `error` event must stop the active debug view, dispose both workers
within five seconds, and permit a fresh session to launch without stale events. A final third
session runs to normal output, proving that failure cleanup does not poison later DAP or RSP
generations.

The required browser gate runs three launch/disconnect cycles and checks worker cleanup plus
JavaScript heap growth. Run the opt-in long soak with 100 cycles using:

```bash
WASM_IDLE_DEBUG_BROWSER_CASES=c-relaunch \
WASM_IDLE_DEBUG_RELAUNCH_COUNT=100 \
WASM_IDLE_DEBUG_BROWSER_TEST_TIMEOUT_MS=7200000 \
pnpm run test:browser:debug:lldb
```

`WASM_IDLE_DEBUG_RELAUNCH_COUNT` must be an integer of at least three. The same worker-count and
heap-growth limits are enforced on every cycle. The example gives Vitest two hours for the
opt-in soak; adjust the existing
`WASM_IDLE_DEBUG_HEAP_GROWTH_LIMIT_BYTES` only when recording an intentional budget change.

Streaming input is verified on the same product path: a C target resumes from an LLDB source
breakpoint, flushes a prompt, blocks in WASI `stdin`, and receives input plus EOF only after the
browser observes that prompt. This keeps debugger control traffic independent from terminal I/O.
