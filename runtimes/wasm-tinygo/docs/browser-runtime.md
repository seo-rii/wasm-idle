# Browser Runtime

This document describes how the reusable browser runtime in `src/runtime.ts`
drives the current `wasm-tinygo` pipeline, and how `src/main.ts` wraps that
runtime for the demo app. Most sections describe the legacy porting harness;
the independent upstream compiler path is called out separately below.

It is narrower than `docs/architecture.md` and `docs/manifests.md`. Those files
describe stage ownership and manifest contracts. This file explains the browser
runtime rules that matter when you change the UI flow, browser smoke tests, or
test hooks.

## Lifecycle

## Library entry

`wasm-tinygo` now ships three browser-facing entries:

- `index.html`
  standalone demo app
- `runtime.js`
  reusable library bundle that exports `createBundledTinyGoRuntime(...)`
- `upstream.js`
  independent receipt-verified upstream TinyGo compiler consumer

The demo page uses `createTinyGoBrowserRuntime(...)`, which is a UI-friendly
adapter around the same runtime core. Host apps such as `wasm-idle` import
`runtime.js` directly and call the runtime API without going through an iframe.

The browser runtime exposes four user-visible actions:

- `boot`
- `plan`
- `execute`
- `reset`

The phases shown in the UI map onto those actions:

- `toolchain`
  emception worker bootstrap state
- `probe`
  Go/WASI driver planning state
- `smoke`
  browser-side execution state
- `verify`
  browser-side artifact and handoff verification state

### Boot

`boot` is responsible only for emception setup.

It:

- fetches the vendored emception worker
- starts the worker
- wires stdout, stderr, and process-start logging into the terminal
- marks the `toolchain` phase as `booting`, then `ready`

If the runtime is already ready, `boot` is intentionally a no-op. Repeated
ready-state `boot()` calls should not consume the shared action slot or block a
later `plan()` / `execute()` call.

### Plan

`plan` runs the Go/WASI driver against `/workspace/tinygo-request.json`.

It:

- snapshots injected workspace files and build overrides
- writes a normalized TinyGo-style request
- runs `go-probe` in driver mode
- stores the resulting `TinyGoBuildResult` in `lastBuildResult`
- updates the `probe` phase

The plan cache is invalidated whenever the browser runtime input changes.

### Execute

`execute` is the longest path in the browser host.

It:

1. ensures the emception runtime exists
2. snapshots injected overrides, bridge fixtures, and workspace files
3. reuses `lastBuildResult` when it is still valid, otherwise replans
4. materializes planner output into the browser filesystem
5. runs `frontend-analysis`
6. runs `frontend-real-adapter-analysis`
7. runs the generic `frontend` build path
8. runs the backend path
9. verifies lowered and final wasm artifacts

The browser host clears the last materialized `frontendAnalysisInput` snapshot at
the start of each execute. A new snapshot is only published when the current
execution reaches the verified handoff path successfully.

### Reset

`reset` is stronger than "clear the terminal".

It:

- terminates the emception worker
- clears `bootPromise`
- clears cached plan state
- clears injected bridge and workspace overrides
- clears the last materialized `frontendAnalysisInput` snapshot
- resets all phase labels to `idle`

This keeps a later run from reusing stale runtime state or stale bridge inputs.

## Runtime asset loading

This section describes the legacy `runtime.js` porting harness, not the public
`wasm-idle` TinyGo product path. The harness can load its assets in three ways:

- direct fetch from `assetBaseUrl`
- a caller-provided `assetLoader`
- a compressed runtime pack index + binary

### Asset loader

`createTinyGoRuntime(...)` accepts:

- `assetLoader`
  A callback that can return a URL, bytes, or a Blob for a given runtime asset.
  The loader receives `{ assetPath, assetUrl, label }`.
- `assetPacks`
  A list of `{ index, asset, fileCount, totalBytes }` pack references.

The runtime applies the loader to:

- `tools/go-probe.wasm`
- any pack index fetches (so a loader can serve the pack index itself)

The emception worker must still be reachable as a URL. If the loader returns
raw bytes for the worker asset, the runtime rejects it, because the worker
bootstrap expects a stable URL for its nested assets.

### Runtime packs

Runtime packs are optional compressed bundles of the browser assets. A pack is
two files:

- `runtime-pack.index.json`
  JSON index with `format: "wasm-tinygo-runtime-pack-index-v1"` plus
  `fileCount`, `totalBytes`, and entry ranges.
- `runtime-pack.bin`
  Concatenated bytes for the listed assets.

The runtime uses `assetPacks` to resolve runtime assets before falling back to
direct fetch or loader URLs. This mirrors the wasm-rust runtime pack flow.
`wasm-idle` does not expose this receipt-free pack reference in its public
runtime configuration and publishes no legacy pack files.

### Upstream toolchain assets

`loadTinyGoUpstreamToolchainAssets(...)` requires a complete host-pinned runtime profile before it
loads `tools/upstream/upstream-toolchain.v2.json`. The profile binds the manifest plus the logical
and deterministic deployment-storage receipts for the compiler, package-graph provider, reduced
root archive, their producer receipts, and raw LLD. Custom bases and loaders are mirrors unless a
complete replacement profile is supplied. The loader verifies the manifest before JSON parsing,
cross-checks its exact asset graph against the profile, and verifies every logical asset before any
compiler Worker can consume it. `prepareTinyGoUpstreamToolchain(...)` then independently re-verifies
byte counts and SHA-256 digests, checks both producer identities, safely expands the bounded root
archive, validates its runtime closure, and accepts only WASI Preview 1 imports.

The provider and compiler receive only `/tinygo-root`, `/workspace`, and `/work` preopens. A compile
request supplies workspace files and a root package (`.` in protocols v1 through v4), not package JSON. The
provider runs the fixed offline `go list` request, and its graph is validated against the mounted
paths before compilation. The verified producer receipt selects the legacy single-object v1,
v2 embed-object, v3 CGo/C, or v4 bounded C++/assembly ordered object-set contract. In v3 and v4 every object path, kind, format,
byte count, SHA-256, source/dependency identity, linker argument, link order, and aggregate limit is
checked before raw LLD runs from a fresh link-only VFS. Binaryen 129 then performs the declared
asyncify/O1 finalization. Compilation and execution are separate calls, so a program is not run
once with empty stdin during the compile phase.

Protocol v4 also requires per-object semantic evidence from the pinned LLVM 20.1.1 producer.
LLVM bitcode evidence binds successful module verification, the exact WASI target triple/data
layout, and zero TLS, constructor, destructor, or forbidden C++ ABI findings. Assembly evidence
binds LLVM object validation, linking metadata version 2, and a symbol table. The browser does not
pretend to reimplement LLVM's readers: it independently checks the LLVM container envelope and
Wasm framing, rejects fake/duplicate linking metadata, TLS/init/dynamic-linking metadata, forbidden
ABI symbols and target features, and then uses raw LLD as the semantic consumer. Both raw LLD and
Binaryen outputs must compile as WebAssembly, expose `_start` and memory, import only WASI Preview 1
functions, and contain no relocatable, dynamic-linking, shared-memory, memory64, exception, or
out-of-profile feature metadata. Because `target_features` is advisory rather than semantic proof,
both final outputs must retain that producer metadata and the consumer separately decodes bounded
core type, import, table, global, element, function, export, and instruction streams to reject
actual SIMD, atomic, exception, GC/reference-type, tail-call, multivalue, multi-memory/table, custom
page-size, or extended-reference use.
The remaining LLVM IR/object semantic claims still come from the hash-bound pinned producer evidence;
raw LLD remains the independent semantic authority for the exact object bytes.

Protocol v2 introduced `go:embed` object publication. Protocol v3 preserves that handoff, accepts
real upstream `CgoFiles`, and verifies each target `CFile` as Clang ThinLTO bitcode with source and
header dependency hashes. Protocol v4 adds `CXXFiles` and uppercase `.S` as ordered Clang-produced
objects. Protocol v5 binds hosted libc++/libc++abi C++17 without exceptions, RTTI, or global
constructors/destructors. Protocol v6 additionally binds exact allowed `CXXFLAGS`, restricted
`#cgo LDFLAGS`, and a complete offline `vendor/modules.txt` tree. Go/Plan 9 assembly remains an
upstream TinyGo 0.40.1 loader limitation; the browser does not translate it through a custom
subset. GOROOT assembly stays on upstream TinyGo's standard-package intrinsic/replacement path for
the pinned root.

## Shared action model

UI buttons and `window.__wasmTinygoTestHooks` share the same action guard.

Only one of these actions may be active at a time:

- `booting`
- `planning`
- `executing`

The shared guard exists for two reasons:

- prevent concurrent filesystem mutation inside the browser runtime
- keep test-hook behavior aligned with real UI behavior

### UI behavior

UI handlers go through `runUiAction(...)`.

That wrapper:

- acquires the shared action slot
- lets the action update phase labels and activity logs
- swallows the final rejected promise after the action has already surfaced its
  failure in the UI

That last rule matters for browser reliability. A failed UI click should appear
as phase/log state, not as a stray `pageerror` or `unhandledrejection`.

Disabled buttons also return early inside the click handler. This prevents
scripted `dispatchEvent(...)` calls from bypassing the UI lock and creating
browser-visible promise noise.

### Test-hook behavior

Test hooks use the stricter `runWithTestHookAction(...)` path.

When hooks race, the caller gets a rejected promise such as:

- `wasm-tinygo test hook action already running: planning`
- `wasm-tinygo test hook action already running: executing`

This is deliberate. Tests need a hard failure they can assert on, while the UI
needs a quiet failure path that is already represented by phase/log output.

## Injected browser inputs

The browser runtime exposes these hooks for smoke tests:

- `boot()`
- `plan()`
- `execute()`
- `readFrontendAnalysisInputManifest()`
- `setBuildRequestOverrides(...)`
- `setDriverBridgeManifest(...)`
- `setWorkspaceFiles(...)`

The three setter APIs are not passive.

Each setter:

- requires the shared action slot to be idle
- invalidates the cached plan
- clears the last published `frontendAnalysisInput` snapshot
- returns the `probe`, `smoke`, and `verify` phases to `idle`

That keeps later `execute()` calls from silently reusing a plan or handoff that
belongs to an older workspace or older bridge fixture.

## Bridge-driven browser verification

The browser host can inject normalized host-side bridge facts into the runtime
through `setDriverBridgeManifest(...)`.

When a bridge fixture is present, the browser host does three extra things:

1. verifies the planner-owned `tinygo-frontend-input.json` against the bridge
2. prefers the canonical `frontendAnalysisInput` payload from the bridge when it
   exists
3. verifies the emitted analysis and real-adapter handoffs against the same
   bridge facts

The terminal logs reflect those boundaries explicitly:

- `frontend input bridge verified ...`
- `frontend analysis input bridge verified ...`
- `frontend analysis input source=bridge`
- `frontend analysis bridge verified ...`
- `frontend real adapter bridge verified ... source=canonical`
- `frontend real adapter bridge verified ... source=compat-alias`
- `frontend build source=real-adapter`

Those lines are part of the contract now. Browser smoke uses them to prove that
the browser path is consuming the same normalized bridge vocabulary as the
host-side TinyGo probe flow.

## Browser smoke expectations

`tests/browser-smoke.test.mjs` covers more than a single happy path.

It now checks:

- end-to-end boot, plan, execute, and artifact verification
- stable demo coverage for both the host-assisted bridge path and the bridge-less static starter-subset path
- canonical `frontendAnalysisInput` injection into the browser path
- canonical versus compatibility-alias `frontendRealAdapter` handling
- explicit failure surfacing for unsupported bridge-less language cases and invalid target overrides
- reset clearing runtime state and snapshots
- cache invalidation after workspace or override changes
- busy-action rejection for hooks
- quiet no-op behavior for scripted UI clicks on disabled controls
- ready-state `boot()` idempotence

If you change browser action sequencing in `src/runtime.ts` or its demo wiring
in `src/main.ts`, update the smoke test in the same patch. The browser runtime
has accumulated enough concurrency rules that code-only changes are easy to
regress.

## Upstream browser acceptance

`npm run probe:wasm-llvm-upstream-browser -- ...` serves `dist/upstream.js` and the exact
receipt-bound assets to Chromium. The acceptance compiles a multi-package workspace with generics,
package initialization, goroutines/channels, CGo, target C, hosted C++17, uppercase `.S`, exact
C++/linker flags, and stdin. It runs Binaryen 129 and compares exit status, stderr, stdout, and the
compiler/linker artifacts with the Node consumer. The route does not fall back to `runtime.js` or
the AST-to-C subset on any failure.
