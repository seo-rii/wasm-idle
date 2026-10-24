# @wasm-idle/debug

Optional debugger UI, session controller, expression helpers, language adapters, and Monaco editor
integration for wasm-idle. Install it separately in applications that provide debugging:

```bash
pnpm add @wasm-idle/debug
```

The Monaco integration is available from `@wasm-idle/debug/editor`; `monaco-editor` is an optional
peer dependency. This package contains code only and includes no runtime, compiler, WebAssembly, or
toolchain assets.

`attachMonacoDebugHover(Monaco, editor, options)` adds an optional debugger content widget with
typed values, lazy child pages and an Add Watch action. Supply `resolve` from the controller's
`resolveHover`, and `loadChildren` from its raw child-loading API. It starts disabled: call
`setEnabled(paused)` on every stop and frame change, including a new stop on the same source line,
so old asynchronous values and child references are discarded. Call `dispose()` when the editor
binding is removed. Labels are configurable and target values are always inserted as text.
`attachMonacoDebugActions` also accepts `onAddWatch` and `onEditBreakpoint` callbacks for editor
context-menu actions. These helpers leave application panel layout and translations to the host.

Debug execution is exposed through one adapter contract:

- `TraceDebugAdapter` preserves the existing source-instrumentation controls.
- `LldbDapAdapter` maps standard DAP threads, frames, scopes, lazy variables, breakpoints, stepping,
  memory reads, output, and process lifecycle events.

`LldbDapAdapter` does not infer conditional-breakpoint or logpoint support from LLDB's generic DAP
advertisement. Structured specifications can carry conditions, hit counts and log messages, but
each operation requires the corresponding effective capability of the pinned runtime. Data breakpoints are enabled only when both the pinned runtime manifest
and LLDB's initialize response advertise them. The adapter exposes `dataBreakpointInfo()` and the
replace-all `setDataBreakpoints()` operation for read, write, and combined read/write access.

When the runtime reports expression evaluation as unavailable, the playground controller resolves a
bounded variable path from lazy DAP variables. Exact locals and arguments, nested fields such as
`pair.first`, and zero-based non-negative indexes such as `items[2]` are supported. Indexed access
requests only the selected child with DAP `start`/`count`; field traversal caches each fetched child
page for the current stop. Arithmetic, calls, dereferences, negative indexes, and other expressions
remain `?`. Resume, disconnect, or frame selection invalidates in-flight traversal so a stale result
cannot repopulate the UI. This fallback does not advertise LLDB expression evaluation.
The controller accepts at most 64 active watches. Each submitted expression is limited to 4,096
UTF-16 code units, and a fallback variable path is limited to 64 total segments including its root.
Expressions that exceed either bound and additions beyond the active-watch limit are rejected before
calling the runtime evaluator or requesting lazy DAP variables. The playground input applies the same
4,096-code-unit limit.

`createDebugSessionController()` is also the headless state owner for application-specific debugger
panels. `variableNodes` and `scopeNodes(scope)` expose lazy trees whose opaque `path` values survive
new stop-local DAP references. Use `expandVariable(path, expanded)`, `loadMoreVariablePath(path)`, and
`addWatchFromVariable(path)` instead of constructing paths in the UI. Expanded branches reload only
their first page after a stop; collapsed branches stay lazy. Expansion preferences survive fresh
sessions and retain the 512 most recently expanded paths,
and a rendered tree is limited to 5,000 loaded nodes and 64 levels. The legacy `locals`, `scopes`,
`variablesByReference` and raw child-loading APIs remain available.

LLDB startup messages and debugger console output travel through `ondebug` as
`{ type: 'output', category: 'console' | 'important', output, sourcePath?, line? }`.
They do not enter the program terminal or consume its output budget. Program stdout/stderr,
including DAP output explicitly marked `stdout` or `stderr`, still use the normal output callback.
Missing or unknown DAP categories mean `console`; telemetry is not displayed. Console logpoints
retain their text and available source location. Raw LLDB worker stderr is an `important` diagnostic;
worker failures and unsuccessful DAP requests retain their normal error handling.

The controller exposes `diagnostics` (up to 200 chunks and 65,536 text code units) and
`latestImportantDiagnostic`. The playground keeps ordinary messages in a collapsed **Debugger log**
and displays important messages immediately. Logs survive Stop and clear at `begin()`;
hosts can also call `clearDiagnostics()`. Custom panels should handle these events without changing
the debugger's paused/running state. Update `wasm-idle`, `@wasm-idle/core`, `@wasm-idle/debug`,
`@wasm-idle/llvm-core`, and other installed SDK packages together when integrating this event in
an existing application; older debug controllers do not recognize it.

For low-level `BrowserLldbSession` consumers, `onOutput(channel, data)` receives target runtime output;
use the optional `onDebuggerOutput(channel, data)` for raw LLDB worker stdout/stderr. DAP console
events remain available through `onEvent`.

The pinned WAMR producer routes its module-name announcement through the verbose logger, so the
normal `-v=0` debug session does not print it. Guest stdout/stderr pass through unchanged, including
output from Wasm start functions during attach. The consumer does not filter target text.

Each node supplies `changed` and an optional `previousValue`. Comparison covers only values actually
loaded in both stops. Frame keys use function/source and caller stack locations, never persistent
DAP frame IDs. A known step transition is required: Continue, an unknown activation, changed source,
or a different session discards the comparison baseline. Recursive activations have separate paths.
Frame selection alone does not compare the caller's variables against the callee's variables.

Watch results keep their existing `expression` and `value` fields and add `variable`/`node` when
expandable. `resolveHover(expression)` uses the same bounded variable-path resolver and returns
`null` when unavailable. A runtime with structured evaluation may additionally supply typed child
references; effective watch/hover capabilities gate calls to that evaluator. A safe path lookup does
not enable arbitrary C/C++ calls, operators or assignments. Resume, a different stopped frame, or a
superseding hover discards stale results.

`history` contains immutable rendered stop snapshots; `selectHistory(id)` and
`selectHistory(null)` select a snapshot and return to live inspection. `selectedHistory` is separate
from the live execution state, so historical selection does not move the target or change command
availability. Snapshots copy locals, loaded child pages, watches and stack locations and retain no
live variable, memory or frame handles. Historical trees cannot fetch more children. The default
limits are 20 stops, 500 variable nodes and 65,536 text characters per snapshot; `historyLimit`
(0–100) and `snapshotVariableLimit` (1–5,000) configure these bounds. `truncated` reports omitted or
shortened content. Starting a new session clears history; finishing a session preserves it.

`watchVariable(path, accessType, options?)` discovers a supported data breakpoint using the node's current
scope/parent reference and variable name, then updates the runtime's replace-all watchpoint set while
preserving previously verified entries. Pass `{ replaceExisting: true }` for a single-watchpoint UI.
The returned array contains only the result for the requested variable. A late discovery after resume/frame change or an explicit watchpoint replacement cannot install
a watchpoint. `setStructuredBreakpoints(specifications, sourcePath?)` stores source-specific enabled,
conditional, hit-count and logpoint settings. It returns `false` and supplies `breakpointError` when
the active session cannot apply them. Numeric `setBreakpoints(lines)` retains settings on surviving
lines; omitted specifications, including disabled entries, are removed. `structuredBreakpoints` and `sourceBreakpoints` supply launch/persistence state. Use
`steppingOptions` with execution's `debugSteppingOptions`; `setSteppingOptions(options)` applies an
available runtime policy directly. These controls must also check the current session capabilities.
Adapter initialization snapshots its request arguments and explicit feature opt-ins before awaiting
the DAP response. Mutating a caller-owned options object in flight therefore cannot enable
WebAssembly expression evaluation after the conservative capability decision has begun.

Variable mutation, DAP in-session restart, and standalone terminate requests also remain false even
when a generic DAP server advertises them, because the `DebugAdapter` contract does not expose those
operations. The playground's **Restart Debug** action is deliberately a higher-level operation: it
fully stops the current execution, awaits both debugger Workers' disposal, and launches a new
LLDB/WAMR session from the current workspace. It does not preserve target state or claim the DAP
`restart` capability.

The playground's C/C++ LLDB **Debug** action pauses at the first executable location in `main`.
The host keeps the low-level runtime's safe `_start` entry stop internal, installs a verified
temporary DAP function breakpoint, and continues after user source breakpoints are configured.
The temporary breakpoint is removed at the next stop, including an earlier constructor breakpoint,
trap, or user Pause. Stop and Pause during setup cannot cause a late automatic resume. Source
breakpoints remain intact. If `main` cannot be resolved, LLDB stays at runtime entry with an
explanation. Generic DAP clients and Rust retain their existing `stopOnEntry` behavior.
The `cpp-source-entry` Chromium fixture covers Debug without user breakpoints, Next within `main`,
and Step Into with the visible `calculate(int) → main → _start` call stack.

`createAdapterDebugSessionController()` provides the shared view model. Variable children remain
lazy through `variablesReference`; consumers should not serialize an entire LLDB variable tree.
Both controller surfaces bind each lazy-variable request to the current stopped frame. Resume,
disconnect, a newer stop, or another frame selection invalidates the request; a late success or
failure resolves as an empty child list and cannot restore cleared locals or report an obsolete UI
error.

The playground controller automatically loads the first 50 variables from at most two inexpensive
Locals/Arguments scopes after a stop or frame selection. The panel, inline values, and watches share
the same cache; nested arrays and objects remain lazy. Scope disclosure state persists across stops.
`debugScopes(frameId)` selects the evaluation frame; `debugFrameScopes(frameId)` only reads metadata.

An LLDB `pause` may initially contain only the top frame and empty scopes. Matching
`pauseDetails` events fill in the same stop's stack and scopes; `stopId` prevents a late
response from updating a newer stop. Pass both event types to the controller so detail
updates preserve frame selection and already loaded values.
When the adapter advertises `supportsValueFormattingOptions`, `debugFrameName(frameId)` requests a
single frame with the standard `stackTrace.format` parameter name/value options. The controller
preserves `functionName` for identity and puts the bounded adapter label in `displayName`, so the UI
never appends duplicate arguments. Otherwise, when the adapter supplies a distinct Arguments scope (`presentationHint: 'arguments'` or the standard
scope name), `loadFrameArguments(frameIds)` progressively fills `DebugFrame.argumentsSummary` without
changing selection. Initial loading covers eight frames; the playground also requests visible frames.
Each scope-based summary is limited to six arguments and 80 characters per value; a native formatted
frame name is limited to 512 characters. Adapters without formatting or a separate argument scope
keep their original frame names rather than mislabelling local variables as parameters.

Execution control follows the same event-authoritative ordering. Once a `continued` or `stopped`
event supersedes a pending continue, step, or pause request, a late transport failure resolves
without replacing the newer state or surfacing an obsolete command error; failures from the current
state still reject and remain visible.
Adapter event delivery snapshots its listeners. A listener added during dispatch starts with the
next event, one removed before its turn is skipped, and a throwing listener cannot prevent later UI
consumers from seeing the event. After delivery finishes, the first listener exception is rethrown
so the hosting transport can report or isolate it.
When callers provide a DAP `start` offset, the returned page is merged at that offset instead of
replacing children loaded by earlier pages; omitting `start` remains an explicit full refresh.
Supply an LLDB DAP session from `@wasm-idle/llvm-core/debug`. Runtime assets remain owned by the
`wasm-llvm` producer and are deliberately excluded from this package.

LLDB response bodies are validated again at the adapter boundary even though the lower-level DAP
client already validates message envelopes. `threads`, `stackTrace`, `scopes`, `variables`,
`readMemory`, `writeMemory`, `dataBreakpointInfo`, `setDataBreakpoints`, and `evaluate` must contain
their required collections and fields plus well-formed
identifiers, source descriptors, counts, and presentation data. Memory data must decode as Base64
and cannot exceed the requested byte count. A malformed body rejects with
`DebugAdapterProtocolError`, whose `command` and `path` identify the failed field; hosts should treat
it as a session failure and dispose the LLDB/WAMR workers. Stack and scope line or column values may
be zero, matching DAP's representation for an unavailable source location.
Numeric request identifiers, pagination bounds, memory offsets, and byte counts must be JavaScript
safe integers. Invalid values reject with `RangeError` before a DAP request is sent, avoiding JSON
number precision loss at the LLDB boundary.
Public memory reads, memory writes, and data-breakpoint ranges are limited to 256 bytes per request.
Memory references, data-breakpoint names, and data identifiers must be non-empty and no longer than
4,096 UTF-16 code units. A `setDataBreakpoints` replacement contains at most 256 entries; an empty
replacement remains valid and clears the watchpoint set. Runtime callers are also checked for array
shape and boolean `allowPartial`/`asAddress` values before the adapter allocates or sends DAP data.
For `readMemory`, both the decoded data and `unreadableBytes` share the requested byte budget. A
response cannot claim more readable-plus-unreadable bytes than the request count, including when
the adapter omits the optional `data` field because the entire range is unreadable.
The encoded Base64 length is checked against that byte budget before decoding. Data-breakpoint
responses may report a null or omitted identifier when a value is unavailable, but present
identifiers obey the same string bound and advertised access types must be unique valid values.
For `readMemory` and `writeMemory`, the product session requires both the LLDB runtime manifest and
the DAP initialize response to advertise the corresponding request before it sends one. Input
bytes cross DAP as Base64. A successful complete-write response may omit its optional DAP body or
`bytesWritten`; the adapter then reports the requested byte count. An explicit short count is
accepted only when the caller enabled `allowPartial`, and a response can never claim more bytes than
the caller supplied. This is raw target-memory mutation only; it does not advertise `setVariable`
or general C/C++/Rust expression assignment.
Each pause event carries these effective session capabilities to the controller. The controller
rejects unsupported memory and data-breakpoint operations locally, and the playground renders only
the controls supported by that specific LLDB/WAMR session.
Data-breakpoint discovery can address a stopped variable by `variablesReference` and `name`, or use
LLDB's `asAddress` plus `bytes` extension for a bounded raw memory range. Returned identifiers are
opaque and scoped to the current target session. `setDataBreakpoints()` always replaces the complete
watchpoint set; pass an empty array to clear it. A trace session rejects both operations explicitly.
The v2 playground exposes one active memory data breakpoint at a time. It snapshots the requested
access mode, serializes replace-all updates through one UI owner, disables resume, stepping, frame
selection, and access-mode changes until that update settles, and invalidates late display results
when the target resumes or the selected frame changes. The old displayed breakpoint is cleared
before a replace-all request, so a rejected or malformed response cannot restore stale UI state.
Recognized DAP events receive the same field validation. A malformed event is emitted only as a raw
`dap` event, so it cannot move the selected thread/frame, append non-string output, change process
state, or mutate the tracked breakpoint cache.

The playground-facing controller also exposes `readMemory(memoryReference, offset, count)` and
`writeMemory(memoryReference, offset, data, allowPartial)` while the target is paused. Memory bytes
cross the framework-neutral Sandbox and Terminal contracts as `Uint8Array`; browser automation and
other serialization boundaries should explicitly convert them to plain byte values instead of
relying on implicit typed-array serialization. The adapter controller binds each memory operation
to the current session and stopped-state generation. If the target continues, stops again, or starts
a new session before the operation settles, the controller rejects its obsolete successful result
with `DebugAdapterStateError` without recording it as an error in the newer state.
The playground memory inspector is visible only while an LLDB target is paused. It accepts decimal
or hexadecimal safe-integer offsets, limits each read to 256 bytes, pages by the chosen byte count,
and renders readable bytes in hexadecimal and ASCII while marking unreadable bytes as `??`. A
variable with a DAP `memoryReference` can populate the inspector directly. Its write field accepts
1–256 two-digit hexadecimal bytes separated by whitespace or commas, always requests a complete raw
memory write, reports the actual byte count, and rereads the written range. Pause/resume/stop and
frame-selection boundaries clear the current page and invalidate any in-flight read or write
response. Raw memory editing does not claim typed `setVariable` support.

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

The required browser gate uses **Restart Debug** for three fresh-session launches, verifies that no
more than one LLDB/target Worker pair is live, then performs a final disconnect and checks JavaScript
heap growth. Run the opt-in long soak with 100 sessions using:

```bash
WASM_IDLE_DEBUG_BROWSER_CASES=c-relaunch \
WASM_IDLE_DEBUG_RELAUNCH_COUNT=100 \
WASM_IDLE_DEBUG_BROWSER_TEST_TIMEOUT_MS=7200000 \
pnpm run test:browser:debug:lldb
```

`WASM_IDLE_DEBUG_RELAUNCH_COUNT` must be an integer of at least three. The same Worker disposal,
two-debug-Worker peak, and heap-growth limits are enforced across the sequence. The example gives Vitest two hours for the
opt-in soak; adjust the existing
`WASM_IDLE_DEBUG_HEAP_GROWTH_LIMIT_BYTES` only when recording an intentional budget change.

Streaming input is verified on the same product path: a C target resumes from an LLDB source
breakpoint, flushes a prompt, blocks in WASI `stdin`, and receives input plus EOF only after the
browser observes that prompt. This keeps debugger control traffic independent from terminal I/O.

Transport preemption is also tested with the real product adapter. One fixture stalls the browser
output readers until both dedicated stdout and stderr rings are within 16 KiB of capacity, then
requires Pause, Stop Debug, balanced Worker disposal, and a clean recovery launch. Another fixture
leaves WAMR blocked in `scanf` after its prompt. Because that synchronous read may defer the RSP
interrupt, the fixture bounds the pause attempt to five seconds, requires disconnect and cleanup
within twice that interval, and proves that a replacement LLDB/WAMR session can immediately run to
completion. The pause bound is configurable through
`WASM_IDLE_DEBUG_TRANSPORT_PAUSE_TIMEOUT_MS`; a timeout ends that pause attempt explicitly and never
silently switches the live session to trace debugging.
