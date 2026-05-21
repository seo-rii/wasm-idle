# wasm-tinygo

`wasm-tinygo` is a browser bootstrap for a future TinyGo-in-WASM toolchain.

The repository does not run the upstream TinyGo CLI in the browser yet. Instead, it proves the execution model around it: a browser-hosted LLVM toolchain, a Go/WASI planning stage, a browser-side front-end handoff, and a backend lowering/verification pipeline that produces real wasm artifacts.

The repository now also includes a repo-local host probe that downloads the official TinyGo release, runs `tinygo build -target wasip1`, executes the resulting wasm artifact under a WASI shim, and records a normalized driver/host bridge manifest. That is the first real upstream TinyGo execution path in this project, but it still runs on the host side rather than inside the browser pipeline.

Detailed compatibility and verification notes live in [COMPATIBILITY.md](./COMPATIBILITY.md).

## Documentation

- [Architecture](./docs/architecture.md)
- [Browser runtime](./docs/browser-runtime.md)
- [Manifest chain](./docs/manifests.md)
- [Development guide](./docs/development.md)
- [Roadmap](./docs/roadmap.md)
- [Compatibility matrix](./COMPATIBILITY.md)

## Status

- Browser execution path is working end to end.
- The app boots emception in the browser and executes generated `clang` and `wasm-ld` plans.
- The Go/WASI probe binary handles driver, front-end, and backend modes.
- The planner-owned front-end handoff now carries explicit `compileUnits`, `packageGraph`, and `buildContext` sections.
- The front-end and backend exchange normalized manifests and verify them on the host/browser side.
- The repository produces and validates both a bootstrap wasm artifact and a lowered wasm artifact.
- The pure-browser static execution path now covers the starter compatibility subset used by the smoke tests: `fmt.Print`/`fmt.Println`, multi-placeholder `fmt.Printf` for `%s`/`%d`, integer/string/boolean constants, scalar package variables, local scalar `var`/`const` declarations, integer expressions and compound integer assignments, string `len(...)`, string equality/inequality, logical conditions, main-package integer or string helper functions, simple loops with `break`/`continue`, conditionals with simple init statements, simple integer/string/expressionless `switch` statements with optional simple init statements, and local imported packages that expose integer or string helper functions plus package-level scalar state.
- A repo-local TinyGo release can be fetched and used to compile and run a real `wasip1` sample on the host.
- A normalized `tinygo-driver-bridge.json` manifest can now verify that native `go-probe` driver metadata matches the real host-side TinyGo probe for the same request, and it also records how the synthetic frontend compile-unit handoff lines up with the real entry package facts, package graph, package files, direct imports, and promoted bridge coverage summary fields such as `compileUnitCount`, `compileUnitFileCount`, `graphPackageCount`, `bridgePackageCount`, `bridgeFileCount`, `coveredPackageCount`, `coveredFileCount`, `depOnlyPackageCount`, `standardPackageCount`, `localPackageCount`, and `programImportAlias`.
- The browser smoke path can now consume the same bridge vocabulary, verify a synthetic frontend compile-unit manifest against normalized TinyGo host facts, and check the emitted `frontend bridge coverage ...` log line.
- The real upstream TinyGo compiler pipeline is not embedded yet.

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
npm run build
```

The production build now uses a relative Vite base so the resulting `dist/` bundle can be embedded
under nested paths such as `wasm-idle/static/wasm-tinygo/` without rewriting asset URLs. It also
emits a stable `dist/runtime.js` entry so host apps can import the TinyGo browser runtime as a
library instead of embedding the demo page in an iframe.

## Commands

- `npm run prepare:assets`
  Fetches the emception worker, vendors its runtime assets locally, and rebuilds the Go/WASI probe.
- `npm run prepare:tinygo`
  Downloads and extracts the pinned TinyGo release into `.cache/tinygo-toolchain/`.
- `npm run dev`
  Prepares assets and starts the Vite dev server.
- `npm run build`
  Prepares assets and builds the production bundle.
- `npm run check`
  Runs TypeScript checking.
- `npm run probe:tinygo-host`
  Downloads the repo-local TinyGo toolchain, builds a real `wasip1` sample, runs the resulting wasm artifact, and writes `tinygo-host-probe.json`.
- `npm run probe:tinygo-driver-bridge`
  Downloads the repo-local TinyGo toolchain, runs the native `go-probe` driver and the real TinyGo host probe against the same request, reruns the package-graph-only `frontendAnalysisInput` seam, the synthetic `frontend-analysis` seam, the package-focused `frontend-real-adapter` seam, and the real-adapter-owned frontend build seam, and writes a normalized `tinygo-driver-bridge.json` manifest with verified target facts, package graph facts, canonical `frontendAnalysisInput`, `frontendAnalysis`, canonical `frontendRealAdapter`, compatibility alias `realFrontendAnalysis`, frontend handoff summary, direct import coverage, and the promoted bridge coverage summary fields.
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
- `.cache/`

Clone the repository, run the normal npm scripts, and let those assets be regenerated on demand.

The real TinyGo host bridge also writes temporary `tinygo-host-probe.json` and `tinygo-driver-bridge.json` files inside its working directory under `/tmp/`.

## Scope

This repository is a bootstrap environment, not a drop-in replacement for the TinyGo CLI.

Today it focuses on:

- browser execution constraints
- manifest and handoff contracts
- lowering and artifact verification
- repeatable host/WASI/browser tests

It does not yet ship:

- the real upstream TinyGo compiler pipeline
- full TinyGo target compatibility
- a general-purpose browser TinyGo CLI
