# Manifest chain

The repository is built around explicit handoff files between stages.

Each stage owns the artifacts it derives. Later stages consume those artifacts instead of reconstructing hidden state from earlier steps.

## Primary flow

| Artifact | Producer | Consumer | Purpose |
| --- | --- | --- | --- |
| `/workspace/tinygo-request.json` | browser host / caller | driver | TinyGo-style build request |
| `/workspace/tinygo-result.json` | driver | browser host | initial plan result plus generated bootstrap/front-end files |
| `/working/tinygo-bootstrap.json` | planner | browser host | normalized bootstrap manifest and dispatch list |
| `/working/tinygo-frontend-input.json` | planner | front-end stage | front-end handoff contract, including explicit `compileUnits`, normalized `packageGraph`, and `buildContext` |
| `/working/tinygo-frontend-result.json` | front-end stage | browser host | front-end execution result envelope |
| `/working/tinygo-compile-unit.json` | front-end stage | browser host | bootstrap compile-unit source of truth |
| `/working/tinygo-intermediate.json` | front-end stage | host verifiers | resolved compile graph for the next stages |
| `/working/tinygo-lowering-input.json` | front-end stage | host verifiers | lowering-specific grouping and support files |
| `/working/tinygo-work-items.json` | front-end stage | host verifiers | deterministic lowering work graph |
| `/working/tinygo-lowering-plan.json` | front-end stage | host verifiers / backend | compile/link lowering plan |
| `/working/tinygo-backend-input.json` | front-end stage | backend stage | backend-owned lowering input contract |
| `/working/tinygo-backend-result.json` | backend stage | browser host | backend execution result envelope |
| `/working/tinygo-lowered-sources.json` | backend stage | browser host / verifiers | lowered source ownership and paths |
| `/working/tinygo-lowered-ir.json` | backend stage | browser host / verifiers | lowered IR summaries, placeholder blocks, lowering blocks |
| `/working/tinygo-lowered-bitcode.json` | backend stage | browser host / verifiers | lowered bitcode outputs |
| `/working/tinygo-lowered-command-batch.json` | backend stage | browser host | executable lowered object command batch |
| `/working/tinygo-lowered-artifact.json` | backend stage | browser host / verifiers | lowered wasm artifact contract |
| `/working/tinygo-command-batch.json` | backend stage | browser host | final bitcode command batch |
| `/working/tinygo-command-artifact.json` | backend stage | browser host / verifiers | final wasm artifact contract |

## Host bridge flow

The repository also has a host-side normalization flow around the real TinyGo CLI:

- `tinygo-host-probe.json`
- `tinygo-driver-bridge.json`

`tinygo-driver-bridge.json` combines:

- target/build metadata verified against the native driver output
- an `entryPackage` summary for the requested program
- a normalized `packageGraph` derived from `tinygo list -deps -json`
- a package-graph-only `frontendAnalysisInput` handoff produced by `go-probe frontend-analysis`
- an optional `upstreamFrontendProbe` package summary produced by the patched TinyGo WASI frontend probe
- a `frontendAnalysis` result produced by `go-probe frontend-analysis`, optionally carrying that same upstream probe summary
- a package-focused `frontendRealAdapter` result produced by `go-probe frontend-real-adapter`
- a compatibility-only `realFrontendAnalysis` alias that mirrors `frontendRealAdapter` for older verifiers
- a bridge-owned `hostArtifact` that carries a real TinyGo-built wasm execution artifact as base64 plus its detected entrypoint, command argv, target, and runnable state
- a `frontendHandoff` summary that proves the synthetic compile-unit manifest still lines up with those normalized TinyGo facts

The promoted `frontendHandoff`/bridge coverage vocabulary returned by `verifyCompileUnitManifestAgainstDriverBridgeManifest` is:

- `compileUnitCount`
- `compileUnitFileCount`
- `graphPackageCount`
- `bridgePackageCount`
- `bridgeFileCount`
- `coveredPackageCount`
- `coveredFileCount`
- `depOnlyPackageCount`
- `standardPackageCount`
- `localPackageCount`
- `programImportAlias`

Browser logs use the same summary to print `frontend bridge coverage ...` with the package coverage counts, file coverage counts, and alias state in one line. `alias=direct` means the program compile unit already uses the real entry package import path. `alias=synthetic` means the program compile unit still uses the synthetic `command-line-arguments` alias for that entry package.

When the host bridge can also provide a runnable real TinyGo wasm artifact, it records that artifact as `hostArtifact`. For `wasm` requests the bridge retargets a separate host compile to `wasip1` so the browser still gets a runnable execution artifact with a supported entrypoint. Browser/runtime execution now prefers that bridge-owned `hostArtifact` over the synthetic backend stage, so the host-assisted path no longer depends on `/working/tinygo-backend-result.json`, `/working/tinygo-lowered-*.json`, or the placeholder lowered-C artifact path to reach a final runnable wasm.

## Front-end handoff contract

`/working/tinygo-frontend-input.json` is now the planner-owned source of truth for front-end package grouping.

The key sections are:

- `buildContext`
- `toolchain`
- `sourceSelection`
- `compileUnits`
- `packageGraph`
- `upstreamFrontendProbe`

`compileUnits` remains the execution-facing package grouping for the synthetic front-end. When the planner or bridge omits it, `frontend-analysis` now synthesizes the same grouping from `packageGraph` before it derives downstream manifests.

`packageGraph` is the new analysis-facing vocabulary. It uses `dir + files.goFiles + importPath + imports + depOnly + standard` so the future real TinyGo front-end can consume the same package facts that the host bridge already normalizes from `tinygo list -deps -json`.

`upstreamFrontendProbe` is the first real TinyGo frontend-owned fact promoted into that same contract. It carries the patched TinyGo WASI loader's package summary (`mainImportPath`, per-package `fileCount`, sorted `imports`, and package count) so `frontend-analysis` can reject package-graph drift against real TinyGo frontend state before the browser build continues.

`buildContext` makes the planner-owned target facts explicit in the same handoff:

- `target`
- `llvmTarget`
- `goos`
- `goarch`
- `gc`
- `scheduler`
- `buildTags`
- `modulePath`

Each compile unit currently carries:

- `kind`
- `importPath`
- `imports`
- `modulePath`
- `packageName`
- `packageDir`
- `files`
- `depOnly`
- `standard`

The front-end validates that every `allCompile` file is covered exactly once by the compile units, then carries the same grouping into the downstream manifest chain:

- `/working/tinygo-compile-unit.json`
- `/working/tinygo-intermediate.json`
- `/working/tinygo-lowering-input.json`
- `/working/tinygo-work-items.json`
- `/working/tinygo-lowering-plan.json`
- `/working/tinygo-backend-input.json`

Today the front-end validates that `buildContext` and `packageGraph` agree with the existing `toolchain`, top-level `buildTags/modulePath`, and `compileUnits`, including preserving per-package `modulePath` on every compile unit before the normalized compile-unit view is emitted into the downstream manifest chain. That same per-package `modulePath` now remains attached to each work item, lowering compile job, backend compile job, lowered source unit, and lowered IR unit instead of being reconstructed later.

The `frontend-analysis` seam now consumes bridged `buildContext` and `packageGraph` facts directly, including normalizing the program package from `command-line-arguments` to the real entry import path when the graph provides it. The host-side real TinyGo bridge now exercises that path with an analysis-only input that drops `compileUnits` and relies on package-graph synthesis before bridge verification runs. Before that analysis step runs, the bridge canonicalizes `buildContext` and `toolchain` from verified TinyGo host facts instead of reusing the synthetic driver copy verbatim, rewrites `packageGraph` to the normalized `tinygo list -deps -json` vocabulary when host facts are available, and still prefers the analysis-owned program package when `tinygo list` is empty or continues to report the entry package as `command-line-arguments`.

That analysis-only bridge artifact is recorded in `tinygo-driver-bridge.json` as `frontendAnalysisInput`. When the host bridge already has an `upstreamFrontendProbe`, it now embeds that same summary into `frontendAnalysisInput` and `frontendRealAdapter`. When the browser only has the bridge package graph, it reruns the patched TinyGo WASI frontend probe locally, injects the resulting `upstreamFrontendProbe` into `frontendAnalysisInput`, re-verifies the bridged analysis input, and then runs `frontend-analysis` from that probe-backed input before the adapter/build seam continues.

The front-end build seam now has two equivalent entry points:

- `go-probe frontend-analysis-build`, which consumes `/working/tinygo-frontend-analysis.json` directly
- `go-probe frontend-real-adapter-build`, which consumes `/working/tinygo-frontend-real-adapter.json` alongside the verified analysis handoff as an explicit adapter-owned build seam
- `go-probe frontend`, which prefers `/working/tinygo-frontend-real-adapter.json` when it exists, otherwise falls back to `/working/tinygo-frontend-analysis.json`, and only rereads `/working/tinygo-frontend-input.json` when neither verified handoff is present

That moves the synthetic emitter behind the package-focused adapter seam instead of keeping it input-owned. The build now reconstructs the synthetic manifest chain from the adapter-owned `buildContext/packageGraph/compileUnits/allCompileFiles` view while still reusing the verified analysis toolchain and optimize facts, so package-facing drift shows up in the emitted `/working/tinygo-compile-unit.json` instead of being hidden behind the older analysis payload. The browser smoke path now reaches that same boundary through the generic `frontend` mode and exposes it as `frontend build mode=frontend` plus `frontend build source=real-adapter`.

The `frontend-real-adapter` seam sits immediately after that step: it reuses the normalized analysis payload, preserves the same `buildContext/packageGraph` vocabulary, fills any remaining package-facing compile-unit facts, rejects mismatches against the package graph, and emits the narrower `frontendRealAdapter` handoff that the host bridge and browser smoke tests compare against real TinyGo facts. The browser runtime now also uses `frontend-real-adapter-analysis` for bridge-less static execution so the adapter is derived from the just-verified analysis payload instead of bypassing that seam. The host bridge still verifies that package-focused adapter view directly against the normalized analysis payload before it compares either side against the final bridge manifest, so analysis-to-adapter drift is caught without waiting for a later bridge-specific mismatch.

At the bridge boundary, the verifier now checks not only package identity and direct imports but also package file coverage:

- local packages are matched against normalized `dir + goFiles`
- stdlib packages require every compile-unit file basename to appear in the normalized `goFiles` set

## Design rules

### Ownership stays local

Derived fields stay with the stage that computes them.

For example:

- the planner owns bootstrap dispatch
- the front-end owns compile/lowering handoff manifests
- the backend owns lowered sources, lowered IR, and final command artifacts

### Normalized nested sections are the source of truth

The repository prefers normalized nested contracts such as:

- `toolchain`
- `sourceSelection`
- `compileInputs`
- `bootstrapDispatch`

Legacy top-level mirrors are intentionally rejected by the verifier layer instead of being silently accepted.

### Verifiers run at multiple boundaries

The same artifacts are checked in several contexts:

- Go unit tests for planner/front-end/backend behavior
- Node-based host verifier tests
- WASI integration tests against the built probe
- browser smoke tests against the real built app

## Practical reading order

When debugging a run, the shortest useful order is usually:

1. `tinygo-request.json`
2. `tinygo-result.json`
3. `tinygo-frontend-input.json`
4. `tinygo-compile-unit.json`
5. `tinygo-backend-input.json`
6. `tinygo-backend-result.json`
7. lowered/final artifact manifests

## Where the verifiers live

- bootstrap artifact verification: `src/bootstrap-exports.ts`
- compile/lowering/backend manifest verification: `src/compile-unit.ts`
- lowered wasm/object/bitcode/final artifact verification: `src/lowered-exports.ts`
