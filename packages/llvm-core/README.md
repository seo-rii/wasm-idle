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
`SharedArrayBuffer` byte queues, and stdin, stdout, and stderr use independent queues. The session
verifies the module, source, loader, Wasm, and pthread-sidecar hashes before creating either worker.
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

Configured and dynamic breakpoint lines must be positive integers. Invalid lines are rejected before
debug workers or a DAP request are created, and do not supersede an in-flight valid update.

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
The same preflight-validated `/workspace/...` files provided to LLDB are mounted into WAMR's
MEMFS before launch, so guest WASI file access observes the workspace used to compile the DWARF
artifact. File paths must remain canonical beneath `/workspace`, and `/workspace/program.wasm` is
reserved for the debug target.
The target launch also reserves a 1 MiB WAMR app heap for the debugger's scratch region, matching
the verified native source-debug baseline, and runs WAMR at verbosity zero so runtime diagnostics
do not contaminate the guest's stdout/stderr streams.
The LLDB producer runs its blocking DAP main loop on an Emscripten pthread. Its JavaScript
proxy-main stub returns as soon as that pthread starts, so the LLDB worker remains alive until the
runtime reports a real exit, abort, or session disposal.
LLDB may defer `continue`, `next`, `stepIn`, and `stepOut` responses until the target stops again.
Those execution requests therefore opt out of the DAP response timeout while retaining the
transport-write timeout; ordinary DAP requests still use the configured response deadline.
Configured DAP response, transport-write, and worker-ready timeouts must be positive finite
millisecond values. The session validates and snapshots them before loading assets or creating
workers, so invalid or concurrently changed timer settings cannot produce immediate or overflowing
browser timers. Per-request DAP response timeout overrides follow the same numeric rule and are
rejected before the request is sent; `null` is the explicit opt-out for execution requests whose
response arrives only after the target stops.
DAP requests are fully encoded before pending transport state or send timers are registered.
Circular, `BigInt`, or otherwise non-JSON arguments reject the returned Promise with the original
encoding failure as its cause, while the client remains available for later valid requests.
DAP responses are correlated by both request sequence and command. A mismatched command is treated
as a transport protocol failure: every pending request is rejected and both byte queues are closed
instead of resolving a request with another command's body. Response envelopes are also validated
at runtime: `request_seq` must be a positive safe integer, `command` a non-empty string, and
`success` a boolean. Malformed values fail the stream instead of timing out or treating a string
such as `"false"` as success.
Every incoming DAP message must also carry a positive safe-integer `seq` and a recognized
`request`, `response`, or `event` type. Event names must be non-empty strings. Invalid common or
event envelopes fail the stream before listener dispatch or request timeout can hide the protocol
error.
Direct `DapClient` consumers can set `onEventError(error, event)` to observe an event-listener
exception. Throwing listeners and a throwing error hook are isolated from one another, and the
client continues parsing later events and responses on the same byte stream.
`DapClient` and `BrowserLldbSession` snapshot listener registrations when each event dispatch
starts. A listener registered by another callback begins with the next event, while a listener
removed before its turn is skipped. Dispatch therefore cannot grow without bound during one event.
The streaming DAP parser caps an unterminated header at 8 KiB and a declared JSON body at 16 MiB.
Oversized declarations fail before the body is buffered, preventing a corrupt worker frame from
growing browser memory without bound.

Current producer modules expose Emscripten's canonical `HEAPU8` view. Each worker samples only its
backing buffer length, emits an initial `onMemory(worker, bytes)` value, and emits again only when
the linear memory grows. A final sample is taken during worker shutdown. These messages carry the
session generation and stale-session samples are ignored by the same boundary as output, error,
and exit events. Callers can retain the maximum value per worker as the session's peak linear
memory; the callback does not expose memory contents and does not include the browser engine's
separate JavaScript heap. Older compatible producer assets without `HEAPU8` continue to run but do
not emit memory samples.
Consumer `onOutput`, `onMemory`, `onLifecycle`, and DAP event-listener exceptions are isolated from
the byte transports and required session cleanup. Set `onCallbackError(error, callbackKind)` to
observe the original exception. Exceptions thrown by that error hook are also contained so
reporting code cannot terminate the debugger.
The required product Chromium gate retains the peak reported by each worker during its basic C
fixture and requires at least one sample from both workers. Its default linear-memory ceilings are
640 MiB for LLDB and 320 MiB for WAMR, leaving 25% headroom above their pinned 512 MiB and 256 MiB
initial memories. Override them with `WASM_IDLE_DEBUG_LLDB_LINEAR_MEMORY_LIMIT_BYTES` and
`WASM_IDLE_DEBUG_TARGET_LINEAR_MEMORY_LIMIT_BYTES` only when validating an intentional producer
memory change. The current basic fixture reports one sample at exactly 512 MiB and 256 MiB,
respectively.

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
`wasm-llvm` commit `4e5a696be2b44aec3fe9f364956c19c6dda098db` for C, C++, and Rust. The V2
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
terminal stop, so the gate explicitly expects an empty scope list there. These fixtures continue to
use the pinned generic DWARF path: the runtime does not advertise arbitrary Rust expression
evaluation.
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
This pinned LLDB build registers the inert no-script interpreter required by native formatter
matching, so the first lazy `variables` request cannot fall through a missing plugin callback. Its
call-depth frame identities also keep caller frames stable while a callee is pushed, allowing the
C++ gate to verify that `next` steps over a function call instead of stopping inside it.
