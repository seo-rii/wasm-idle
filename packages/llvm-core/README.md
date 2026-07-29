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
	}
});
await session.initialize();
```

Compile C/C++ LLDB artifacts with `compileArtifact(..., { debugMode: 'lldb' })`. They contain
untouched source, embedded DWARF, stable `/workspace/...` paths, and exact Clang provenance.
`compileLinkRun()` rejects `lldb` because an LLDB artifact must not be instantiated through the
normal browser execution path. Launch arguments, WASI environment variables, and the `/workspace`
working directory are forwarded to WAMR rather than being applied only to LLDB's attach request.
The target launch also reserves a 1 MiB WAMR app heap for the debugger's scratch region, matching
the verified native source-debug baseline, and runs WAMR at verbosity zero so runtime diagnostics
do not contaminate the guest's stdout/stderr streams.
The LLDB producer runs its blocking DAP main loop on an Emscripten pthread. Its JavaScript
proxy-main stub returns as soon as that pthread starts, so the LLDB worker remains alive until the
runtime reports a real exit, abort, or session disposal.
LLDB may defer `continue`, `next`, `stepIn`, and `stepOut` responses until the target stops again.
Those execution requests therefore opt out of the DAP response timeout while retaining the
transport-write timeout; ordinary DAP requests still use the configured response deadline.

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
`wasm-llvm` commit `9f61a243b00d056fdffe8266092ddfa4824e6f51` for C, C++, and Rust. The V2
manifest and all six debug assets are downloaded from that immutable revision and verified before
the browser starts; the test cannot silently fall back to trace debugging. At each C, C++, and Rust
source pause, the gate also verifies that LLDB scopes remain lazy until their
`variablesReference` is requested and then contain the expected local value.
The C++ fixture additionally follows the structure's and a pointer's own `variablesReference`
values and verifies their `first` and `second` fields without eagerly flattening either variable
tree.
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
