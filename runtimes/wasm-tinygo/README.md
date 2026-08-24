# wasm-tinygo

`wasm-tinygo` contains two separate browser paths:

- `runtime.js` is the legacy porting harness. Its bridge-less fallback is a wasm-idle-authored Go
  AST-to-C subset and is not TinyGo language support.
- `upstream.js` is an independent consumer for the source-pinned upstream TinyGo compiler produced
  by `wasm-llvm/producer/tinygo-browser`. It verifies the producer receipt and every asset before
  running a source-pinned Go 1.24.6 `cmd/go` WASI package provider, the real TinyGo
  builder/compiler pipeline, raw WASI LLD, and Binaryen 129.

The upstream path derives its own graph from workspace files and exercises a multi-package module
with real CGo, C, hosted C++17, uppercase preprocessed `.S`, `go:embed`, generics, package
initializers, goroutines, channels, build-tag selection, stdin, and exact stdout. Compile protocol
v6 binds hosted libc++/libc++abi without exceptions, RTTI, or global constructors/destructors;
ordered C/C++/Clang-assembly and embed objects; exact receipt-allowed `CXXFLAGS`; restricted
`#cgo LDFLAGS`; and offline `vendor/modules.txt` resolution. Each compile runs in a one-shot Worker
with phase deadlines and a capped WebAssembly memory declaration. `TINYGO` is registered publicly
for `wasip1`, and the published static bundle contains only `upstream.js` plus its receipt-verified
toolchain—not the legacy subset. Go/Plan 9 assembly remains an upstream TinyGo loader limitation,
network module downloads remain disabled, and the path is not a general browser replacement for
the TinyGo CLI.

The repository also retains a repo-local host probe that downloads the official TinyGo release,
runs `tinygo build -target wasip1`, executes the resulting wasm artifact under a WASI shim, and
records a normalized driver/host bridge manifest.

Detailed compatibility and verification notes live in [COMPATIBILITY.md](./COMPATIBILITY.md).

## Documentation

- [Architecture](./docs/architecture.md)
- [Browser runtime](./docs/browser-runtime.md)
- [Manifest chain](./docs/manifests.md)
- [Development guide](./docs/development.md)
- [Roadmap](./docs/roadmap.md)
- [Compatibility matrix](./COMPATIBILITY.md)

## Status

- The legacy Emception execution path remains an explicitly labeled porting harness.
- The app boots emception in the browser and executes generated `clang` and `wasm-ld` plans.
- emception LLVM `16.0.0` download, patching, and checksum validation use the consumer-owned profile in `scripts/llvm-contracts/tinygo.mjs`; no producer npm package or wasm-rust assets are loaded.
- The Go/WASI probe binary handles driver, front-end, and backend modes.
- The planner-owned front-end handoff now carries explicit `compileUnits`, `packageGraph`, and `buildContext` sections.
- The front-end and backend exchange normalized manifests and verify them on the host/browser side.
- The repository produces and validates both a bootstrap wasm artifact and a lowered wasm artifact.
- The pure-browser static execution path now covers the starter compatibility subset used by the smoke tests: `fmt.Print`/`fmt.Println`, multi-placeholder `fmt.Printf` for `%s`/`%d`, integer/string/boolean constants, scalar package variables, local scalar `var`/`const` declarations, integer expressions and compound integer assignments, string `len(...)`, string equality/inequality, logical conditions, main-package integer or string helper functions, simple loops with `break`/`continue`, conditionals with simple init statements, simple integer/string/expressionless `switch` statements with optional simple init statements, and local imported packages that expose integer or string helper functions plus package-level scalar state.
- A repo-local TinyGo release can be fetched and used to compile and run a real `wasip1` sample on the host.
- A normalized `tinygo-driver-bridge.json` manifest can now verify that native `go-probe` driver metadata matches the real host-side TinyGo probe for the same request, and it also records how the synthetic frontend compile-unit handoff lines up with the real entry package facts, package graph, package files, direct imports, and promoted bridge coverage summary fields such as `compileUnitCount`, `compileUnitFileCount`, `graphPackageCount`, `bridgePackageCount`, `bridgeFileCount`, `coveredPackageCount`, `coveredFileCount`, `depOnlyPackageCount`, `standardPackageCount`, `localPackageCount`, and `programImportAlias`.
- The browser smoke path can now consume the same bridge vocabulary, verify a synthetic frontend compile-unit manifest against normalized TinyGo host facts, and check the emitted `frontend bridge coverage ...` log line.
- The independent upstream path verifies the source-pinned compiler and protocol-v6 producer
  receipt, package provider, reduced TinyGo/Go root, both producer receipts, and raw WASI LLD before
  making any compiler call.
- The package provider's local-module/build-tag/`go:embed` graph exactly matches the same pinned
  native `cmd/go` graph.
- The upstream provider, compiler, LLD, and Binaryen finalizer cover separate producer and consumer
  fixtures with CGo/C/hosted-C++/assembly plus ordinary TinyGo language semantics and exact stdout.
- Compile protocol v6 verifies the compiler-bound ordered object set, including CGo/native source
  and dependency hashes, target-C and hosted-C++17 ThinLTO bitcode, Clang assembler-with-cpp
  objects, TinyGo-generated `go:embed` objects, exact C++ flags, and restricted linker flags before
  exposing fresh copies to raw LLD.
- Compile and package-graph phases execute in disposable Workers with fail-closed deadlines. The
  public adapter uses the acceptance-verified 2 GiB wasm32 memory ceiling; direct callers may
  provide an explicit lower ceiling when their workload permits it.
- Offline external modules are accepted only through a complete, internally consistent
  `vendor/modules.txt` tree. Network proxy fallback is intentionally unavailable.

## What this repository demonstrates

1. Download and patch the published emception worker and vendor its runtime assets for local browser use.
2. Build `cmd/go-probe` into a WASI module that runs in the browser.
3. Accept a TinyGo-style build request and lower it into normalized planning artifacts.
4. Regenerate bootstrap and lowered C sources from front-end and backend handoff manifests.
5. Compile those sources with browser-hosted LLVM tools.
6. Verify the resulting wasm artifacts against the manifests and exported probe surface.

## Repository layout

- `cmd/go-probe`
  Single WASI entrypoint. It switches between driver, front-end, and backend modes through `WASM_TINYGO_MODE`.
- `internal/driver`
  Request parsing, package loading, import/module analysis, and planner invocation.
- `internal/tinygoplanner`
  TinyGo-style target resolution and bootstrap/front-end handoff manifest generation, including planner-owned `packageGraph` and `buildContext`.
- `internal/tinygofrontend`
  Front-end handoff consumer, handoff validation, compile-unit generation, and lowering-plan emission.
- `internal/tinygobackend`
  Lowered source generation, lowered IR emission, command batch generation, and final artifact contracts.
- `src/main.ts`
  Browser app shell that wires the reusable runtime into the demo UI.
- `src/runtime.ts`
  Reusable browser runtime that boots emception, plans builds, executes plans, and exposes the browser/test-hook API.
- `src/runtime-entry.ts`
  Library entry that binds `assetBaseUrl` relative to the published bundle and exports `createBundledTinyGoRuntime()`.
- `src/upstream-entry.ts`
  Independent library entry for the receipt-verified upstream compiler consumer.
- `src/upstream-assets.ts`, `src/upstream-contract.ts`, `src/upstream-vfs.ts`
  Hash-bound asset loading, compiler/package/link-plan contracts, and bounded binary VFS extraction.
- `src/upstream-runtime.ts`
  Upstream compiler, raw LLD, Binaryen 129, and separate WASI execution orchestration.
- `src/bootstrap-exports.ts`
  Bootstrap wasm manifest reader and expectation verifier.
- `src/compile-unit.ts`
  Host/browser verifiers for compile-unit, intermediate, lowering, and backend manifests.
- `src/lowered-exports.ts`
  Lowered artifact export and object/bitcode/final wasm verifiers.
- `tests/`
  Host-side Node tests, WASI integration tests, and a browser smoke test.

## Getting started

### Prerequisites

- Node.js and npm
- Go

### Local development

```sh
npm install
npm run dev
```

`npm run dev` prepares the browser assets automatically before starting Vite.

### Production build

```sh
npm run build:upstream
```

The public build uses a relative Vite base so the resulting `dist/` bundle can be embedded under
nested paths such as `wasm-idle/static/wasm-tinygo/` without rewriting asset URLs. It emits the
stable `dist/upstream.js` entry and its one-shot Worker chunks. The legacy `npm run build` still
emits both `runtime.js` and `upstream.js` for local port development, while the root
`sync:wasm-tinygo` command publishes only the independent upstream compiler consumer and its
receipt-bound assets.

## Commands

- `npm run prepare:assets`
  Fetches the emception worker, vendors its runtime assets locally, and rebuilds the Go/WASI probe.
- `npm run prepare:tinygo`
  Downloads and extracts the pinned TinyGo release into `.cache/tinygo-toolchain/`.
- `npm run dev`
  Prepares assets and starts the Vite dev server.
- `npm run build`
  Prepares the legacy porting assets and builds the local development bundle.
- `npm run build:upstream`
  Builds only the public `upstream.js` entry and disposable Worker chunks, then copies the already
  verified `public/tools/upstream/` tree into `dist/`. It never prepares or copies legacy assets.
- `npm run check`
  Runs TypeScript checking.
- `npm run probe:tinygo-host`
  Downloads the repo-local TinyGo toolchain, builds a real `wasip1` sample, runs the resulting wasm artifact, and writes `tinygo-host-probe.json`.
- `npm run probe:tinygo-driver-bridge`
  Downloads the repo-local TinyGo toolchain, runs the native `go-probe` driver and the real TinyGo host probe against the same request, reruns the package-graph-only `frontendAnalysisInput` seam, the synthetic `frontend-analysis` seam, the package-focused `frontend-real-adapter` seam, and the real-adapter-owned frontend build seam, and writes a normalized `tinygo-driver-bridge.json` manifest with verified target facts, package graph facts, canonical `frontendAnalysisInput`, `frontendAnalysis`, canonical `frontendRealAdapter`, compatibility alias `realFrontendAnalysis`, frontend handoff summary, direct import coverage, and the promoted bridge coverage summary fields.
- `npm run prepare:wasm-llvm-upstream -- --compiler ... --root-archive ... --producer-receipt ... --package-graph ... --package-graph-receipt ... --lld ... --output-dir ...`
  Verifies the passed wasm-llvm compiler and package-provider receipts and atomically prepares the
  declared upstream assets without replacing an existing output directory.
- `npm run probe:wasm-llvm-upstream -- ...`
  Runs the upstream consumer through the Node browser-WASI shim, raw LLD, Binaryen 129, and exact
  stdin/stdout acceptance.
- `npm run probe:wasm-llvm-upstream-browser -- ...`
  Serves the built `upstream.js` entry and runs the same acceptance in Chromium.
- `go test ./...`
  Runs the Go package tests.
- `npm run test:host`
  Runs Node-based host/verifier tests.
- `npm run test:tinygo-host`
  Downloads the repo-local TinyGo toolchain, runs the normalized driver/host bridge probe, and then reruns the real TinyGo bridge integration test.
- `npm run test:wasi`
  Runs the WASI integration tests against the built probe module, including the path where `frontend` prefers an existing `tinygo-frontend-real-adapter.json`, otherwise reuses `tinygo-frontend-analysis.json`, and only reruns analysis from `tinygo-frontend-input.json` when no verified handoff is present.
- `npm run test:browser`
  Runs the headless browser smoke test, including browser-side verification against an injected normalized TinyGo driver bridge manifest, the `frontend analysis input source=bridge` log, the canonical versus `compat-alias` `frontend real adapter bridge verified ... source=...` path, the `frontend bridge coverage ...` summary line, and the `frontend build source=real-adapter` activity log.

## Generated assets

These files are generated locally and intentionally ignored by git:

- `public/vendor/emception/emception.worker.js`
- `public/vendor/emception/`
- `public/tools/go-probe.wasm`
- `public/tools/upstream/upstream-toolchain.v2.json`
- `public/tools/upstream/tinygo-compiler.wasm`
- `public/tools/upstream/tinygo-package-graph.wasm`
- `public/tools/upstream/tinygoroot.tar.gz`
- `public/tools/upstream/producer-receipt.json`
- `public/tools/upstream/package-graph-provider-receipt.json`
- `public/tools/upstream/lld.wasm`
- `.cache/`

Clone the repository, run the normal npm scripts, and let those assets be regenerated on demand.

The real TinyGo host bridge also writes temporary `tinygo-host-probe.json` and `tinygo-driver-bridge.json` files inside its working directory under `/tmp/`.

## Scope

This repository ships the independent upstream compiler consumer used by wasm-idle's public
`TINYGO` language integration. It is not a drop-in browser replacement for the TinyGo CLI.

Today it focuses on:

- browser execution constraints
- manifest and handoff contracts
- lowering and artifact verification
- repeatable host/WASI/browser tests

It intentionally does not ship:

- exceptions, RTTI, global C++ constructors/destructors, or Go/Plan 9 assembly
- network module downloads or a prepopulated external module cache (offline vendoring is supported)
- targets other than `wasip1`, or a general-purpose browser TinyGo CLI
