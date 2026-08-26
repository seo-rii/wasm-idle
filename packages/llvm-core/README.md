# @wasm-idle/llvm-core

Browser-side LLVM runtime hosts used by wasm-idle. This package contains JavaScript and TypeScript
code only. Compiler modules, sysroots, archives, and other runtime assets must be deployed
separately and supplied through explicit HTTP(S) URLs.

```ts
import { createClangCompiler } from '@wasm-idle/llvm-core/clang';

const compiler = await createClangCompiler({
	runtimeBaseUrl: new URL('https://cdn.example.com/llvm/clang/')
});
```

The corresponding compiler patches, source pins, and reproducible asset producers are maintained
in the `wasm-llvm` repository. This package does not read files from that repository or its npm
package.

The wasm-idle sync step deterministically repackages the producer's single-entry archives as native
gzip delivery assets. Clang uses `memfs.wasm.gz`, `clang.wasm.gz`, `lld.wasm.gz`, and
`sysroot.tar.gz`; COBOL uses `cobc.wasm.gz`, `rootfs.tar.gz`, and `c-sysroot.tar.gz`. The browser
loader pipes gzip response bodies through `DecompressionStream('gzip')`. Runtime manifests from
older external deployments may still reference ZIP files; those load `fflate` only on the legacy
compatibility path.

The bundled Clang `runtime-manifest.v1.json` is routed through the same worker asset bridge as its
four delivery assets. The compressed files remain pinned against their producer receipts in CI,
while the browser bridge normalizes transparent HTTP gzip decoding and pins the exact decoded
runtime bytes that it transfers to the compiler worker. When HTTP `Content-Encoding: gzip` hides
the original delivery bytes, the bridge verifies the decoded size and digest; loaders that return
raw gzip bytes continue to verify both the compressed delivery and decoded runtime identities. The
manifest is pinned directly, so the compiler cannot consume unverified metadata before loading an
otherwise verified binary.

## LLDB debug sessions

`@wasm-idle/llvm-core/debug` provides the low-level browser session that connects a dedicated LLDB
worker to a dedicated WAMR target worker. DAP and GDB RSP are carried on separate
`SharedArrayBuffer` byte queues, and stdin, stdout, and stderr use independent queues. Zero-length
asynchronous and blocking reads complete immediately, so an empty consumer buffer cannot wait
indefinitely for a queue signal. Blocking operations accept a non-negative finite timeout or
`Infinity`; invalid values are rejected before bytes move or a wait begins. Queue generations are
integers from 1 through 2147483647 because the transport stores them in signed `Int32Array`
metadata. Each descriptor must provide distinct control and data buffers so payload writes cannot
overwrite queue metadata. Worker transport bindings additionally require DAP input/output as a
complete pair and reject every control or data buffer reused across RSP and DAP directions, so one
logical stream cannot consume or corrupt another. Direct `DapClient` construction applies the same
buffer-isolation rule to its input/output pair. The target Worker extends that validation across
both RSP directions and every configured WASI stdin/stdout/stderr queue before claiming the session
generation or loading WAMR. Attaching a descriptor also validates its
closed-state flag and cursor distance before runtime code can consume it. Every queue state accessor, including
the closed-state check used during cleanup, rejects stale-generation metadata. Session and worker
disposal isolate each queue close, so one corrupt transport cannot prevent the remaining queues from
closing, worker-global transport state from being released, or either Worker from terminating. The
final target-output drain applies the same isolation so a stale channel cannot suppress the target
exit or worker-error lifecycle event. The session verifies the module, source, loader, Wasm, and
pthread-sidecar hashes before creating either worker.
Module inputs must be `Uint8Array` or `ArrayBuffer` bytes, source contents must be strings, and any
provided module or source SHA-256 must contain exactly 64 lowercase hexadecimal characters. Invalid
artifact inputs fail before runtime asset preflight or Worker creation.
Debug manifest assets must use canonical relative URL paths; percent-encoded dot segments and path
separators are rejected before they can escape or change the configured runtime root.
When `initialize()` starts, it snapshots the module and its expected hash, source files, configured
breakpoints, and launch arguments used by the workers and DAP. Mutating the caller-owned option
objects while integrity and asset verification are in flight therefore cannot change the already
validated debug target. The runtime manifest is parsed into an independent snapshot and the asset
base URL is captured at the same boundary, so later mutations cannot redirect LLDB or WAMR asset
loading. Transport queue capacity, the asset fetch implementation, and the worker factory are also
captured before verification starts, preventing in-flight option changes from resizing queues or
replacing the code that loads assets and creates workers.

```ts
import { createBrowserLldbSession } from '@wasm-idle/llvm-core/debug';

const session = await createBrowserLldbSession({
	manifest,
	runtimeBaseUrl: new URL('https://cdn.example.com/llvm/clang/'),
	module: artifact.bytes,
	moduleSha256: artifact.debug?.moduleSha256,
	sources,
	launch: {
		program: '/workspace/program.wasm',
		stopOnEntry: true,
		args: ['demo'],
		env: { MODE: 'debug' },
		cwd: '/workspace'
	},
	onMemory: (worker, bytes) => {
		console.info(`${worker} linear memory: ${bytes} bytes`);
	}
});
await session.initialize();
await session.setBreakpoints({ path: '/workspace/main.cpp' }, [12, 18]);
```

Configured and dynamic breakpoint lines must be positive safe integers. The product session
validates and snapshots them before changing its per-source state; invalid lines are rejected before
debug workers or a DAP request are created and do not supersede an in-flight valid update. Values
above `Number.MAX_SAFE_INTEGER` are rejected instead of being rounded in a DAP message.

`setBreakpoints()` updates the session's resolved-breakpoint cache as well as sending DAP. Later
`breakpoint` events therefore retain the IDs and source mapping from dynamic editor changes;
only `new`, `changed`, and `removed` reasons can mutate the cache, while malformed reasons remain
available to raw event listeners without changing state.
Out-of-order responses cannot replace the newest cached set. A superseded call resolves to that
current snapshot even when its obsolete DAP response fails; only the current request propagates its
failure. Use `getResolvedBreakpoints(path)` to read the current normalized snapshot. Returned
breakpoint and source objects are isolated copies, and the request source is captured before awaiting
DAP. Callers and DAP event listeners therefore cannot mutate the cache through a retained reference
or an in-flight request argument. If the response omitted an ID, a later event can promote the
matching source line to its assigned ID. Once an ID is known, later events match it before comparing
the resolved source path; the cache remains keyed by the source whose breakpoints were requested
even when LLDB reports the executable location in another file. IDs retired by a subsequent source
replacement remain ignored, so delayed events cannot attach themselves to a new ID-less breakpoint
on the same line.

Compile C/C++ LLDB artifacts with `compileArtifact(..., { debugMode: 'lldb' })`. They contain
untouched source, embedded DWARF, stable `/workspace/...` paths, and exact Clang provenance.
`compileLinkRun()` rejects `lldb` because an LLDB artifact must not be instantiated through the
normal browser execution path. Launch arguments, WASI environment variables, and the `/workspace`
working directory are forwarded to WAMR rather than being applied only to LLDB's attach request.
Launch configuration is validated before runtime assets are fetched or workers are created: the
program and working directory stay at their reserved `/workspace` paths, entry pause is boolean,
arguments are strings without NUL bytes, and environment keys/values follow WAMR's `--env` format.
The target Worker repeats the working-directory, collection-shape, value-type, and byte-level
argument/environment checks as a defense-in-depth boundary for direct worker messages. It performs
that validation before claiming the session generation, creating transports, loading WAMR, or
mounting files, so a rejected message neither executes runtime code nor leaves the Worker occupied.
Once a target generation is active, initialization for a competing generation is rejected before
starting another lifecycle; its failure cannot close the live target's stdout or stderr queues.
Both Workers treat an initialization replay carrying their already-active generation as idempotent:
they neither start the runtime twice nor emit a fatal current-generation error. A competing
generation is still rejected explicitly.
At the direct Worker boundary, both runtimes require a non-empty generation string without NUL
bytes before claiming any state. This preserves the generation guard's truthiness and prevents an
LLDB argv identifier from being truncated.
If WAMR loading or target setup fails after claiming a generation, the target Worker closes every
active RSP and WASI stream, clears its worker-global transport, and releases that generation before
reporting the error. A later valid initialization can therefore recover without reusing stale
queues.
If target disposal wins while the Emscripten loader or factory is pending, initialization stops at
that async boundary; it does not mount files, report readiness, or enter WAMR with already-closed
streams.
The LLDB Worker applies the same recovery contract to all DAP and RSP streams and clears its shared
ring registry when its loader, module setup, or adapter lifecycle fails. It releases the failed
generation before emitting the worker error, so a replacement adapter cannot observe stale
connections.
LLDB disposal also wins at both pending Emscripten loader boundaries, preventing a late module from
mounting the program, reporting readiness, or entering the adapter main loop after its DAP/RSP
queues have closed.
The same preflight-validated `/workspace/...` files provided to LLDB are mounted into WAMR's
MEMFS before launch, so guest WASI file access observes the workspace used to compile the DWARF
artifact. File paths must remain canonical beneath `/workspace`, and `/workspace/program.wasm` is
reserved for the debug target. The shared LLDB/WAMR mount boundary revalidates the program byte
view plus every source entry, content value, canonical path, and duplicate path before making any
MEMFS call. A malformed direct Worker artifact therefore cannot leave a partially mounted target.
The target launch also reserves a 1 MiB WAMR app heap for the debugger's scratch region, matching
the verified native source-debug baseline, and runs WAMR at verbosity zero so runtime diagnostics
do not contaminate the guest's stdout/stderr streams.
The LLDB producer runs its blocking DAP main loop on an Emscripten pthread. Its JavaScript
proxy-main stub returns as soon as that pthread starts, so the LLDB worker remains alive until the
runtime reports a real exit, abort, or session disposal.
LLDB may defer `continue`, `next`, `stepIn`, and `stepOut` responses until the target stops again.
Those execution requests therefore opt out of the DAP response timeout while retaining the
transport-write timeout; ordinary DAP requests still use the configured response deadline.
A deferred execution failure is fatal only while that request still owns the current run state. If
a valid `continued` or newer `stopped` event has already advanced the session, the obsolete failure
is ignored and cannot tear down the running target or its newer pause.
Pause requests are ordered separately. Once a `stopped` event has consumed a pending interrupt (or
a newer pause or execution request supersedes it), a late pause failure is ignored instead of being
reported after the target is already paused; a failure from the current request still propagates.
Configured DAP response, transport-write, and worker-ready timeouts must be positive finite
millisecond values. The session validates and snapshots them before loading assets or creating
workers, so invalid or concurrently changed timer settings cannot produce immediate or overflowing
browser timers. Per-request DAP response timeout overrides follow the same numeric rule and are
rejected before the request is sent; `null` is the explicit opt-out for execution requests whose
response arrives only after the target stops.
Product `scopes`, `variables`, `readMemory`, and `writeMemory` calls validate frame IDs, variable references,
pagination offsets/counts, and memory offsets/counts as safe integers before sending DAP. Invalid
caller input rejects with `RangeError` without changing the selected frame, stopping the session,
or creating a Worker request.
DAP requests are fully encoded before pending transport state or send timers are registered.
Circular, `BigInt`, or otherwise non-JSON arguments reject the returned Promise with the original
encoding failure as its cause, while the client remains available for later valid requests.
Request commands are likewise checked for a non-empty string before encoding or touching the
transport, so invalid low-level client calls cannot become opaque response timeouts.
DAP responses are correlated by both request sequence and command. A mismatched command is treated
as a transport protocol failure: every pending request is rejected and both byte queues are closed
instead of resolving a request with another command's body. Each queue close is best-effort and
isolated, so stale or corrupt metadata in one queue cannot block closing the other queue or
rejecting every pending request with the original failure. Response envelopes are also validated at
runtime: `request_seq` must be a positive safe integer, `command` a non-empty string, and `success`
a boolean; an optional failure `message` must be a string. Malformed values fail the stream instead
of timing out, stringifying an arbitrary object as an adapter error, or treating a string such as
`"false"` as success.
The session also validates the initial DAP capability body before finishing startup. It must be an
object, and every capability consumed by the browser integration must be boolean when present.
Malformed capability data raises `DapProtocolError` and disposes both workers instead of publishing
an initialized session with corrupt feature detection.
Every incoming DAP message must also carry a positive safe-integer `seq` and a recognized
`request`, `response`, or `event` type. Event names must be non-empty strings. Invalid common or
event envelopes fail the stream before listener dispatch or request timeout can hide the protocol
error.
The browser client does not implement adapter-to-client reverse requests such as `runInTerminal`.
Receiving one fails and closes the DAP stream explicitly, instead of silently leaving LLDB waiting
for a response that the browser host cannot provide. Reverse-request commands are validated before
the unsupported-operation error is reported.
The live playground session also validates the command-specific bodies it consumes after envelope
parsing. Malformed `scopes`, `variables`, `readMemory`, `writeMemory`, or `evaluate` data raises a `ProtocolError`,
stops the debug view, and disposes both workers. In particular, memory data must be valid Base64 and
the readable-plus-unreadable total cannot exceed the requested byte count; expression fallback to
`?` applies only to ordinary LLDB evaluation failures, not to a malformed successful response.
Optional `namedVariables` and `indexedVariables` counts are also validated and retained on scopes
and variables, along with a variable's `evaluateName`, so lazy paging and later evaluation do not
lose metadata at the product adapter boundary.
Stopped-state publication has the same boundary: `stopped`, `continued`, and `exited` event fields
plus the follow-up `threads` and `stackTrace` responses are checked before they can change the
selected thread, frame, source location, call stack, stopped-snapshot generation, or process exit
code. A malformed value fails and disposes the live session instead of publishing a corrupt pause,
resume, or exit snapshot.
A valid `continued` event invalidates every in-flight stopped-state lookup. Late `stackTrace` or
`scopes` success and failure therefore remain ignored and cannot stop a target that has already
resumed.
Explicit frame selections are ordered independently as well. Only the newest successful `scopes`
request can change the frame used by watch evaluation, while a protocol error from a superseded
selection rejects only its original caller and does not dispose the live session.
Lazy `variables`, watch `evaluate`, and `readMemory` calls also capture their stopped-state
generation before sending DAP. Once the target resumes or the selected frame changes, late valid
or malformed replies resolve to `[]`, `?`, or `null` respectively and cannot terminate the current
session. A malformed reply for the current stopped state remains fatal.
`BrowserLldbSession` also normalizes every resolved breakpoint before updating its cache. A
malformed current `setBreakpoints` response rejects with the exported `DapProtocolError`; a stale
response remains ignored, while an omitted per-line result stays unverified at its requested
location. A malformed asynchronous `breakpoint` event is delivered to raw listeners but cannot
mutate the cache used by the playground.
For the live playground, a current `DapProtocolError` during initial configuration or a later
breakpoint update is converted to the shared Core `ProtocolError`. The session publishes one stop,
disposes both debug workers, and rejects its completion with the low-level error retained as the
cause. Other active initialization failures preserve their original `Error` while following the
same single-stop and Worker-disposal lifecycle, including failures while flushing startup input.
Direct `DapClient` consumers can set `onEventError(error, event)` to observe an event-listener
exception. Throwing listeners and a throwing error hook are isolated from one another, and the
client continues parsing later events and responses on the same byte stream.
`DapClient` and `BrowserLldbSession` snapshot listener registrations when each event dispatch
starts. A listener registered by another callback begins with the next event, while a listener
removed before its turn is skipped. Dispatch therefore cannot grow without bound during one event.
The streaming DAP parser rejects malformed UTF-8, malformed JSON, and duplicate `Content-Length`
fields, caps an unterminated header at 8 KiB, and caps a declared JSON body at 16 MiB. Outbound
encoding applies the same body limit before pending request or shared-ring write state is created.
Invalid bytes therefore cannot be replacement-decoded into silently changed source paths,
expressions, or variable names. JSON syntax failures use a stable protocol error while retaining the
engine's `SyntaxError` as their cause. Oversized declarations fail before the body is buffered,
preventing a corrupt worker frame from growing browser memory without bound. Once a valid length is
known, the parser allocates that body buffer once and copies later transport fragments into place;
large variables and memory replies therefore use linear allocation instead of repeatedly copying
every previously received byte.

Current producer modules expose Emscripten's canonical `HEAPU8` view. Each worker samples only its
backing buffer length, emits an initial `onMemory(worker, bytes)` value, and emits again only when
the linear memory grows. A final sample is taken during worker shutdown. These messages carry the
session generation and stale-session samples are ignored by the same boundary as output, error,
and exit events. Callers can retain the maximum value per worker as the session's peak linear
memory; the callback does not expose memory contents and does not include the browser engine's
separate JavaScript heap. Older compatible producer assets without `HEAPU8` continue to run but do
not emit memory samples.
Every current-generation Worker message is runtime-validated before it can report readiness,
output, memory, exit, or failure. Worker identity, channel, data, byte count, exit code, and error
text must match the protocol; an invalid message becomes a `worker-error` and disposes the session
instead of changing lifecycle state. A message carrying another well-formed generation remains
ignored before its type-specific fields are inspected, preserving stale-session isolation.
Consumer `onOutput`, `onMemory`, `onLifecycle`, and DAP event-listener exceptions are isolated from
the byte transports and required session cleanup. Set `onCallbackError(error, callbackKind)` to
observe the original exception. Exceptions thrown by that error hook are also contained so
reporting code cannot terminate the debugger.
The required product Chromium gate retains the peak reported by each worker during its basic C
fixture and requires at least one sample from both workers. Its default linear-memory ceilings are
320 MiB for LLDB and 80 MiB for WAMR, leaving 25% headroom above their pinned 256 MiB and 64 MiB
initial memories. Override them with `WASM_IDLE_DEBUG_LLDB_LINEAR_MEMORY_LIMIT_BYTES` and
`WASM_IDLE_DEBUG_TARGET_LINEAR_MEMORY_LIMIT_BYTES` only when validating an intentional producer
memory change. The current basic fixture reports one sample at exactly 256 MiB and 64 MiB,
respectively. These values are the Emscripten linear-memory backing-buffer sizes, not total browser
RSS; both workers retain bounded memory growth for workloads that exceed the initial allocation.

The debug runtime requires a cross-origin-isolated page with `SharedArrayBuffer`. LLDB and WAMR
assets are lazy-loaded from the versioned producer manifest and are not included in this npm
package.
Before compiling an LLDB run, the application resolves all six LLDB/WAMR assets from that manifest,
downloads them one at a time, and verifies their pinned SHA-256 values. A missing or corrupt asset
therefore selects trace debugging for that run before DWARF compilation begins. The session repeats
the same preflight before creating workers so direct package consumers retain the integrity
boundary.

Repository CI runs `test:browser:debug:lldb` for every pull request and `main` push in a dedicated
Chromium job. The gate installs Chromium, downloads the four external Clang delivery assets,
verifies every pinned SHA-256 receipt, and requires the product LLDB/WAMR binaries published by
`wasm-llvm` commit `682ab86a070ae57b628f89043eb50ce936e2a98e` for C, C++, and Rust. The V2
manifest and all six debug assets are downloaded from that immutable revision and verified before
the browser starts; the test cannot silently fall back to trace debugging. At each C, C++, and Rust
source pause, the gate also verifies that LLDB scopes remain lazy until their
`variablesReference` is requested and then contain the expected local value.
The C++ fixture additionally follows the structure's and a pointer's own `variablesReference`
values and verifies their `first` and `second` fields without eagerly flattening either variable
tree.
Rust coverage includes a basic argument/output fixture, a structure and field tree plus an enum
value, three selectable recursive frames with distinct arguments, and a panic that must preserve
stderr before WAMR reports its `abort` as an LLDB exception stop. The panic fixture verifies its
local at the source breakpoint; after Rust has aborted, WAMR has no inspectable scope for that
terminal stop, so the gate explicitly expects an empty scope list and no source line there. These
fixtures continue to use the pinned generic DWARF path: the runtime does not advertise arbitrary
Rust expression evaluation.
A WASI file fixture mounts `/workspace/data/input.txt` into both debugger workers, pauses before
the guest opens it, and requires WAMR to print the file's value after continuing. Set
`WASM_IDLE_DEBUG_BROWSER_CASES=c-wasi-file` to run only this fixture locally.
A dedicated C fixture executes `__builtin_trap()`, verifies that LLDB reports an `exception` stop
on the trap source line with scopes still available, and then exercises a clean Stop Debug
disconnect. Set `WASM_IDLE_DEBUG_BROWSER_CASES=c-trap` to run only this fixture locally.
A second C fixture continues into an infinite loop, requires the UI to enter its running state
without waiting for LLDB's deferred `continue` response, sends Pause through the live WAMR RSP
transport, and verifies that the resulting LLDB interrupt is normalized to a `pause` stop with
source frames and scopes still available. Set `WASM_IDLE_DEBUG_BROWSER_CASES=c-interrupt` to run
only this fixture locally.
A third C fixture enters the same running loop and invokes Stop Debug before another stop event.
The session gives DAP `disconnect` a short best-effort grace period, then closes its queues and
terminates both workers without waiting for LLDB's deferred response. The fixture requires the UI
to return to Ready within five seconds. Set `WASM_IDLE_DEBUG_BROWSER_CASES=c-disconnect` to run only
this fixture locally.
Two transport-adversary fixtures exercise the same cleanup boundary under blocked WASI I/O. The
output fixture stalls the browser's queue consumers for three seconds while an infinite C target
alternates 16 KiB writes to stdout and stderr. It requires both independent rings to reach within
16 KiB of capacity, requests Pause in the same browser turn, and verifies a source stop before
disconnecting and launching a clean recovery program. Set
`WASM_IDLE_DEBUG_BROWSER_CASES=c-transport-saturation` to select it. The stdin fixture continues
past a source breakpoint, observes a flushed prompt, deliberately supplies no input, and requests
Pause while WAMR is blocked in `scanf`. A synchronous WAMR stdin read may not service that
interrupt, so the gate records either a pause or an explicit five-second timeout, then requires
disconnect and Worker cleanup within twice that interval and an immediate successful relaunch.
Set `WASM_IDLE_DEBUG_BROWSER_CASES=c-blocked-stdin` to select it. Override the bounded pause interval
with `WASM_IDLE_DEBUG_TRANSPORT_PAUSE_TIMEOUT_MS`; the existing disconnect timeout override remains
available for slower CI hosts.
A fourth C fixture repeats that running-target launch and disconnect sequence three times in one
page. It instruments page-created workers, requires every extra LLDB/WAMR worker pair to terminate,
and verifies that the active worker count returns to the first-run baseline after each disconnect.
It also requests garbage collection and limits renderer JS heap growth to 64 MiB by default; set
`WASM_IDLE_DEBUG_HEAP_GROWTH_LIMIT_BYTES` to tune that budget for constrained CI environments. Set
`WASM_IDLE_DEBUG_BROWSER_CASES=c-relaunch` to run only this fixture locally.
A companion fixture force-terminates the real target Worker and LLDB Worker after separate source
pauses. It dispatches the browser worker-error boundary, requires both workers from each failed
session to terminate within five seconds, and launches a final clean session that must print
`lldb-worker-recovery=73`. Set `WASM_IDLE_DEBUG_BROWSER_CASES=c-worker-crash` to run only this
fixture locally.
A fifth C fixture intercepts the LLDB WebAssembly asset with a synthetic 404 after a valid manifest
load. It requires the application preflight to report that exact asset status, select trace
debugging, and still produce `trace-asset-fallback=73`. Set
`WASM_IDLE_DEBUG_BROWSER_CASES=c-asset-fallback` to run only this fixture locally.
A sixth C fixture stops after stepping inside a three-level recursive call, selects every `recurse`
frame through the product UI adapter, and requires distinct frame IDs with `n=1`, `n=2`, and `n=3`
scope values. This guards the pinned synthetic-CFA fix against reusing the top frame's Wasm locals
for callers. Set `WASM_IDLE_DEBUG_BROWSER_CASES=c-recursive-frames` to run only this fixture locally.
It then sends a DAP `readMemory` request from the LLDB hexadecimal memory reference `0x0` for four
bytes of Wasm linear memory through the complete Sandbox and Terminal control path and verifies
that the response is readable before resuming. The hexadecimal form matters because LLDB-DAP
treats memory references as opaque strings and accepts addresses emitted by its own
`memoryReference` encoder.
A dedicated C memory-write fixture stops before an addition, resolves the local `value` variable's
LLDB `memoryReference`, writes the little-endian bytes for `100`, reads the same four bytes back,
and resumes to require `lldb-memory-write=103`. Set
`WASM_IDLE_DEBUG_BROWSER_CASES=c-memory-write` to run only this fixture locally. The capability is
fail-closed across the producer manifest and DAP initialize response, and does not imply variable
assignment or expression evaluation support.
This pinned LLDB build registers the inert no-script interpreter required by native formatter
matching, so the first lazy `variables` request cannot fall through a missing plugin callback. Its
call-depth frame identities also keep caller frames stable while a callee is pushed, allowing the
C++ gate to verify that `next` steps over a function call instead of stopping inside it.
