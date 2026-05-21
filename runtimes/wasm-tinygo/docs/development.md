# Development

## Prerequisites

- Node.js and npm
- Go

## Common workflow

```sh
npm install
npm run dev
```

The dev and build flows prepare browser-side assets automatically before starting Vite or producing a production build.

## Useful commands

- `npm run prepare:assets`
  Fetches the emception worker, vendors its runtime assets locally, and rebuilds the Go/WASI probe.
- `npm run prepare:tinygo`
  Downloads and extracts the pinned TinyGo release into `.cache/tinygo-toolchain/` using a platform-appropriate archive format. The default path now uses `tar.gz` on Linux/macOS and `zip` on Windows, while explicit archive overrides such as `.deb` are still supported.
- `npm run dev`
  Starts the local app after preparing assets.
- `npm run build`
  Produces a production build after preparing assets.
- `npm run build:runtime-pack`
  Builds a compact runtime pack (`runtime-pack.index.json` + `runtime-pack.bin`)
  under `public/runtime-pack/`. Use this when you want to serve TinyGo runtime
  assets as a single compressed bundle. Set `WASM_TINYGO_RUNTIME_PACK_MANIFEST`
  to a JSON array of `{ runtimePath, filePath }` entries if you want to pack a
  custom file list instead of the default emception + go-probe assets. You can
  also supply a JSON object:

  - `root`: directory to scan
  - `include`: list of regex strings to keep
  - `exclude`: list of regex strings to drop
  - `entries`: explicit entries (overrides `root/include/exclude`)
- `npm run check`
  Runs TypeScript checking.
- `npm run probe:tinygo-host`
  Runs the real TinyGo host probe and writes `tinygo-host-probe.json`.
- `npm run probe:tinygo-driver-bridge`
  Runs the native driver and the real TinyGo host probe against the same request, reruns the package-graph-only `frontendAnalysisInput` seam, the synthetic `frontend-analysis` seam, the package-focused `frontend-real-adapter` seam, and the real-adapter-owned frontend build seam, and writes `tinygo-driver-bridge.json`, including verified target facts, package graph facts, canonical `frontendAnalysisInput`, canonical `frontendRealAdapter`, and the promoted `frontendHandoff` coverage fields (`compileUnitCount`, `compileUnitFileCount`, `graphPackageCount`, `bridgePackageCount`, `bridgeFileCount`, `coveredPackageCount`, `coveredFileCount`, `depOnlyPackageCount`, `standardPackageCount`, `localPackageCount`, `programImportAlias`).
- `go test ./...`
  Runs Go unit tests for the internal packages.
- `npm run test:host`
  Runs Node-based host/verifier tests.
- `npm run test:tinygo-host`
  Runs the repo-local TinyGo release through a real `tinygo build -target wasip1` smoke probe and executes the produced wasm artifact.
- `npm run test:wasi`
  Runs the built WASI probe through the integration suite.
- `npm run test:browser`
  Runs the browser smoke test in headless Chromium, including browser-side verification of the synthetic frontend compile-unit manifest against an injected normalized TinyGo bridge fixture and the `frontend bridge coverage ...` log line.

## Generated local files

These are generated locally and ignored by git:

- `public/vendor/emception/`
- `public/tools/go-probe.wasm`
- `public/runtime-pack/`
- `.cache/`
- `dist/`

Do not treat those as source files. Regenerate them through the normal npm scripts.

## Test strategy

### Go tests

`go test ./...` covers planner, bootstrap, target, front-end, backend, and driver behavior inside Go packages.

### Host tests

`npm run test:host` checks the browser-host verifier layer and asset/materialization helpers in Node.

### Real TinyGo host probe

`npm run test:tinygo-host` bootstraps the pinned TinyGo release under `.cache/tinygo-toolchain/`, runs the native driver and the real TinyGo host probe against the same request, reruns the synthetic frontend handoff, executes the resulting wasm module with a WASI shim, and rechecks the same contract in the integration test. This is the first real upstream TinyGo execution path in the repository.

The host probe writes a normalized `tinygo-host-probe.json` manifest next to the generated wasm artifact. That manifest records the concrete `tinygo build` command, the pinned toolchain paths, the artifact path/size, and the runtime execution result. The default smoke probe still expects `tinygo-ok`, but request-driven probes can now provide their own expected runtime logs instead of hard-coding that output.

The bridge probe also writes `tinygo-driver-bridge.json`. That manifest records the verified target facts, build tags, command argv, entry package summary when available, the normalized TinyGo package graph, the synthetic frontend handoff summary, direct import coverage, and the locations of both the native driver result and the host probe manifest.

The planner-owned `tinygo-frontend-input.json` now uses the same vocabulary shape deliberately: it carries `buildContext` and `packageGraph` alongside `compileUnits`, and the synthetic front-end rejects mismatches between those views before it emits downstream manifests.

The separate `frontend-real-adapter` mode hardens that seam further. It uses `packageGraph` as the source of truth for package-facing facts, fills missing `packageName` / `packageDir` / `imports` / `depOnly` / `standard` fields on compile units before analysis, and rejects mismatches instead of letting the adapter handoff drift away from the planner-owned package graph.

The browser smoke test reads the same normalized bridge vocabulary and checks the emitted coverage summary. It expects `alias=direct` when the program compile unit already matches the real entry package import path, and `alias=synthetic` when the program still carries the synthetic `command-line-arguments` alias. It also records whether the analysis-only handoff reached the browser as canonical `frontendAnalysisInput` facts (`frontend analysis input source=bridge`), whether the package-focused adapter facts came through canonical `frontendRealAdapter` or the compatibility-only `realFrontendAnalysis` alias, and whether the final synthetic build ran behind that adapter seam (`frontend build source=real-adapter`). The same summary now includes both package coverage and file coverage counts.

### WASI tests

`npm run test:wasi` executes the built `go-probe.wasm` module in driver, front-end, and backend modes.

### Browser smoke

`npm run test:browser` builds the app, boots emception, runs the planned commands, verifies the resulting wasm artifacts through headless Chromium, and checks that the browser-side compile-unit verifier can consume the same normalized TinyGo bridge vocabulary used by the host probe flow.

In restricted environments the browser smoke test may skip when loopback listen or browser launch is not allowed.

## Documentation map

- `README.md`
  Project entry point.
- `docs/architecture.md`
  High-level stage layout and ownership.
- `docs/roadmap.md`
  Remaining milestones toward the first real TinyGo demo.
- `docs/manifests.md`
  Manifest and artifact chain overview, including the current front-end handoff contract.
- `COMPATIBILITY.md`
  Compatibility claims and the tests backing them.
