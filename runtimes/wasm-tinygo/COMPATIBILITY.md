# Compatibility

This document describes the compatibility level of `wasm-tinygo` as of 2026-04-24.

The current implementation is a **browser-side bootstrap driver**, not a full TinyGo port.

## Overall status

| Area | Status | Notes |
| --- | --- | --- |
| Browser runtime bootstrap | Working | `emception` worker boots in-browser and can run `clang`/`wasm-ld` |
| Go/WASI driver execution | Working | `cmd/go-probe` runs as a WASI module in the browser |
| Build request/result contract | Working | Driver reads `tinygo-request.json`, writes `tinygo-result.json`, and the `tinygo` planner emits a minimal bootstrap manifest with normalized `compileInputs` and `bootstrapDispatch`, plus a separate `tinygo-frontend-input.json` handoff file whose compile groups now live under nested `sourceSelection`, whose compile toolchain now lives under nested `toolchain`, and whose analysis seam now carries explicit `buildContext` and `packageGraph`; it embeds a normalized compile-input/dispatch JSON payload into the bootstrap translation unit shape, emits a target-specific minimal TinyGo root tree that the browser host materializes strictly from `bootstrapDispatch.materializedFiles`, omits duplicate `compileInputs.allFiles`, leaves dispatch/materialization sizes to be derived from the embedded manifest instead of mirrored through wasm exports or planner JSON, and the browser-side front-end now consumes that handoff to regenerate `tinygo-bootstrap.c` while deriving its final materialization set from nested `sourceSelection`, deriving target asset and runtime-support files from `materializedFiles` plus shared TinyGo root/target rules, validating `buildContext` and `packageGraph` against the execution-facing compile-unit view, reconstructing program/stdlib/imported groups from `entryFile` and `allCompile`, restoring default bootstrap translation-unit/object paths plus default target-profile `llvmTarget` / `linker` / `cflags` / `ldflags` when they are omitted from either the handoff or the emitted compile-unit/embedded manifest, and deriving the executable tool plan directly from `tinygo-compile-unit.json` without carrying dead bootstrap-only `imports`, `materializedFiles`, `targetAssets`, `runtimeSupport`, `program`, or `imported` metadata in the front-end handoff |
| TinyGo-style planning metadata | Working | Driver emits `llvmTarget`, `goos`, `goarch`, `gc`, `scheduler`, `panic`, `buildTags`, and bootstrap target-profile metadata parsed from shared target JSON |
| Same-directory package loading | Working | Driver loads `.go` files in the entry directory, filters them by `//go:build` and target suffixes, and validates one package |
| Import inspection | Partial | Driver records stdlib-like imports, recursively loads current-module package files from the nearest `go.mod`, honors local `replace` directives, resolves local `go.work` workspace modules, follows workspace-module local `replace` directives, honors `go.work` local `replace` directives, explicitly rejects local/workspace/replaced package import cycles, explicitly rejects non-local `replace` directives, and rejects other unresolved external module imports |
| Ignored-file filtering | Working | `_test.go`, dotfiles, and `_`-prefixed Go files are ignored before package validation |
| Bootstrap artifact generation | Working | Current planner and front-end share a deterministic bootstrap C translation-unit generator, the planner exports only an embedded-manifest pointer/length from that unit, emits a separate `tinygo-frontend-input.json` handoff file with nested `toolchain` and `sourceSelection` sections plus planner-owned `buildContext` and `packageGraph` sections for the next stage, the browser-side front-end consumes that handoff to regenerate the translation unit and write `tinygo-compile-unit.json`, and the browser host materializes that front-end-generated source before deriving and executing the compile-unit-owned mode/tool plan to produce `.wasm`; the emitted compile-unit/embedded JSON payload now keeps `entryFile`, `materializedFiles`, and nested `sourceSelection.allCompile`, but no longer mirrors export-count fields at the top level or duplicate `modulePath` / `imports` / `buildTags`, the generator no longer keeps `imports`, top-level source-file group mirrors, top-level toolchain mirrors, an internal `packageLayout` mirror, or any internal derived source-group mirrors beyond `allCompile` in its compile-unit struct, the front-end handoff itself now omits `tinygoRoot`, `materializedFiles`, `imports`, `targetAssets`, `runtimeSupport`, `program`, `stdlib`, `imported`, and fixed bootstrap translation-unit/object paths while keeping `modulePath` and `buildTags` at the top level and carrying the richer planner-owned analysis seam in `buildContext`/`packageGraph`, the emitted compile-unit/embedded manifest also omits derived `targetAssets` / `runtimeSupport`, default bootstrap translation-unit/object paths, and default target-profile `llvmTarget` / `linker` / `cflags` / `ldflags`, and browser-side bootstrap verification now requires `entryFile`, `materializedFiles`, and nested `sourceSelection.allCompile` instead of legacy top-level compile-file arrays |
| Front-end intermediate artifact | Working | In addition to the minimal `tinygo-compile-unit.json` execution contract, the front-end now emits `/working/tinygo-intermediate.json`, `/working/tinygo-lowering-input.json`, `/working/tinygo-work-items.json`, `/working/tinygo-lowering-plan.json`, and a thinner `/working/tinygo-backend-input.json`, carrying the fully resolved target/runtime/program/imported/stdlib grouping, package-level `compileUnits`, lowering support files, deterministic per-package work items, a deterministic compile/link lowering plan, a backend-owned command-input contract, and execution-ready toolchain needed for the next TinyGo-backed lowering stage without mirroring derived lowered-source paths, final link bitcode inputs, or a top-level optimize-flag mirror |
| Backend WASI stage | Working fallback | A separate `backend` mode in `cmd/go-probe` still owns the bridge-less static fallback path, reading `/working/tinygo-backend-input.json`, deriving lowered `/working/tinygo-lowered/*.c` paths, final link bitcode inputs, and the shared optimize flag from compile jobs, seeding lowered source probes from readable `.go` inputs, writing `/working/tinygo-backend-result.json`, and owning `/working/tinygo-lowered-sources.json`, `/working/tinygo-lowered-ir.json`, `/working/tinygo-lowered-bitcode.json`, `/working/tinygo-lowered/*.c`, `/working/tinygo-lowered-command-batch.json`, `/working/tinygo-lowered-artifact.json`, `/working/tinygo-command-artifact.json`, and `/working/tinygo-command-batch.json`; when a normalized TinyGo driver bridge now includes a real `hostArtifact`, the browser runtime bypasses this synthetic lowering stage and executes the bridge-owned real TinyGo artifact directly |
| Real TinyGo build planning | Partial bootstrap only | The driver still does not call TinyGo internals, but the planner now carries a first transitive stdlib source seed for recognized imports (`fmt` currently expands to `errors`, `io`, `runtime`, `unsafe`) |
| TinyGo CLI parity | Not compatible yet | `flash`, `monitor`, board upload, package/module resolution are not present |

## Current request compatibility

The browser-side driver currently accepts only this narrow request shape:

```json
{
  "command": "build",
  "planner": "tinygo",
  "entry": "/workspace/main.go",
  "output": "/working/out.wasm",
  "target": "wasm",
  "optimize": "z",
  "scheduler": "tasks",
  "panic": "trap"
}
```

### Supported fields

| Field | Supported values | Notes |
| --- | --- | --- |
| `command` | `build` | Anything else is rejected |
| `planner` | `tinygo`, `bootstrap`, `""` | Empty planner is normalized to `tinygo` |
| `entry` | absolute `.go` file path | Current implementation assumes a single entry file |
| `output` | path ending in `.wasm` | Current planner only emits WebAssembly output |
| `target` | `wasm`, `wasip1`, `wasip2`, `wasip3`, `""` | Empty target is normalized to `wasm`; `wasip3` is a transitional local profile that mirrors the current `wasip2` shape with a `wasip3` build tag |
| `optimize` | `""`, `z`, `s`, `0`, `1`, `2`, `3` | Mapped to `-Oz`, `-Os`, `-O0`, `-O1`, `-O2`, `-O3` |
| `scheduler` | `""`, `none`, `tasks`, `asyncify` | TinyGo-style option surface only |
| `panic` | `""`, `print`, `trap` | TinyGo-style option surface only |

### Source constraints

The entry package is only validated at a **bootstrap** level:

- the entry path must point to a `.go` file
- `.go` files in the same directory are treated as one package
- `//go:build` constraints are evaluated against the current target/profile tags before package validation
- `*_js.go`, `*_wasip1.go`, `*_wasm.go`, and `*_GOOS_GOARCH.go` filename suffixes are filtered against the current target before package validation
- `wasip2` and `wasip3` are exposed as build tags; their profile GOOS/GOARCH values are `linux`/`arm`, so filename suffix filtering follows those values rather than `_wasip2.go` or `_wasip3.go`
- `_test.go`, hidden `.go`, and `_`-prefixed `.go` files are ignored
- if the entry file or an imported local package exists but all matching `.go` files are filtered out by target/build constraints, the driver returns a specific exclusion diagnostic
- relative imports are rejected
- the nearest ancestor `go.mod` is read when present, and its `module` directive is recorded in metadata
- imports whose first path element contains `.` are treated as current-module imports only when they stay under that `module` prefix
- current-module imports are recursively mapped back to local source directories under that module root and must resolve to non-`main` Go package files
- local `replace old/module => ./relative/path` directives are honored when mapping import paths back to workspace source directories
- the nearest ancestor `go.work` is read when present, and `use ./local/module` entries are mapped to local module roots via their own `go.mod`
- workspace modules discovered through `go.work` can use their own local `replace` directives while their package imports are traversed
- local `replace` directives in `go.work` are also honored and take precedence over plain workspace module lookup
- local/workspace/replaced package import cycles are rejected with a specific diagnostic
- non-local `replace old/module => other/module vX.Y.Z` directives are rejected with a specific diagnostic
- other imports whose first path element contains `.` are rejected until module resolution exists
- remaining imports are recorded as stdlib-like imports in metadata
- every included file must parse as Go
- every included file must declare the same package
- the package must be `main`
- the package must define `func main()`
- `main` must not take parameters
- `main` must not return values

The driver does **not** currently do any of the following:

- resolve Go modules
- type-check a multi-file package
- compile the Go program semantics with TinyGo

That means a file can pass validation even though a future real TinyGo-backed planner would reject it.

## Current build compatibility

The driver currently translates a valid build request into a target-aware bootstrap plan:

1. emit `/working/tinygo-bootstrap.json` and `/working/tinygo-frontend-input.json`
2. resolve the TinyGo-style target profile (`wasm`, `wasip1`, `wasip2`, or `wasip3`)
3. run `clang` with the target triple and selected target `cflags`
4. run `wasm-ld` with filtered target `ldflags`
5. seed the first recognized stdlib source files into `.tinygo-root`
6. run the browser-side front-end handoff consumer to regenerate `/working/tinygo-bootstrap.c` and build `/working/tinygo-compile-unit.json`
7. materialize the front-end-generated bootstrap source, derive the executable tool plan from `/working/tinygo-compile-unit.json`, and run that manifest-owned plan to produce the bootstrap `/working/out.wasm`
8. when no real TinyGo bridge artifact is available, run the separate backend WASI stage on `/working/tinygo-backend-input.json` to produce `/working/tinygo-backend-result.json`
9. either materialize `/working/tinygo-lowered-sources.json`, `/working/tinygo-lowered-ir.json`, `/working/tinygo-lowered-bitcode.json`, `/working/tinygo-lowered/*.c`, `/working/tinygo-lowered-command-batch.json`, `/working/tinygo-lowered-artifact.json`, `/working/tinygo-command-artifact.json`, and `/working/tinygo-command-batch.json` from that backend result and execute the lowered and final command batches, or bypass that whole synthetic stage and execute a bridge-owned real TinyGo `hostArtifact`
10. read the embedded manifest payload back out of the final wasm artifact in the browser host

This proves the browser stack can already do these pieces together:

- Go/WASI control logic
- TinyGo-style target/profile metadata generation
- TinyGo-style target-profile resolution for `wasm`, `wasip1`, `wasip2`, and `wasip3`
- planner-side manifest generation for validated entry/module/package graph data
- planner-side lowering of normalized compile inputs into a generated bootstrap C translation unit
- planner-side target-specific minimal TinyGo root generation for future target/data-driven planning
- planner-side bootstrap stdlib source seeding for recognized imports
- planner-side normalized compile input manifest generation for the next TinyGo front-end stage
- planner-side bootstrap export generation for embedded-manifest pointer/length, with planner JSON no longer mirroring export data
- planner-side explicit dispatch grouping for target assets, runtime-support files, and materialized planner output files, with JSON count duplication removed from `bootstrapDispatch` and program files derived from `compileInputs`
- planner-side generation of a normalized `tinygo-frontend-input.json` handoff file for future TinyGo front-end execution
- front-end-side validation now requires nested `toolchain` and `sourceSelection` sections in `tinygo-frontend-input.json`; legacy top-level compile metadata/source-file arrays are no longer treated as valid handoff input
- front-end-side validation now also rejects legacy top-level source-group arrays explicitly instead of silently ignoring them
- front-end-side materialization is now derived from nested `sourceSelection` plus generated outputs instead of a separate `materializedFiles` list in `tinygo-frontend-input.json`
- front-end-side handoff generation now omits `program`, and the front-end reconstructs entry-package files from `entryFile` plus `allCompile`
- front-end-side handoff generation now omits `stdlib` and `imported`, and the front-end reconstructs both groups from `allCompile` plus path/selection rules
- front-end-side execution now also treats nested `sourceSelection.allCompile` as the only source-file input truth, deriving target/runtime/program/imported/stdlib groups internally instead of accepting separate derived group arrays
- front-end-side handoff generation now omits fixed bootstrap translation-unit/object paths, and the front-end restores `/working/tinygo-bootstrap.{c,o}` by default
- front-end-side handoff generation now also omits default target-profile `llvmTarget` / `linker` / `cflags` / `ldflags`, and the front-end restores them from `toolchain.target`
- emitted `tinygo-compile-unit.json` and embedded bootstrap manifests now also omit those same default bootstrap translation-unit/object paths and default target-profile compile/link fields, and the browser host restores them while building the executable tool plan
- front-end-side handoff generation now omits dead `imports` and `buildTags` fields
- front-end-side regeneration of the bootstrap translation unit from the normalized handoff metadata
- front-end-side generation of a normalized `tinygo-compile-unit.json` artifact that acts as the sole execution handoff instead of duplicating metadata into a separate compile-request file, front-end result metadata, top-level toolchain fields, or top-level dispatch/source-selection/source-file-group fields
- front-end-side compile-unit generation now carries only concrete file paths (`entryFile`, `materializedFiles`, `sourceSelection.allCompile`) and leaves program/imported/stdlib grouping to the browser-side verifier
- planner-side embedding of a normalized compile-input/dispatch JSON payload into the generated bootstrap wasm
- request/result file exchange
- `emception` tool invocation
- nested planner-output materialization into emception's virtual filesystem
- browser-side enforcement that generated planner files exactly match `bootstrapDispatch.materializedFiles` before materialization
- post-build browser-side wasm export probing for the embedded manifest payload
- browser-side visibility into the front-end-owned compile-unit manifest via the materialized `tinygo-compile-unit.json`
- browser-side execution of a separate backend WASI stage that consumes a thinner `tinygo-backend-input.json`, derives lowered source ownership, final link inputs, and the shared optimize flag from compile jobs, seeds lowered source probes from actual source bytes when those files are present in the browser filesystem, records a backend-owned `tinygo-lowered-ir.json` manifest with per-unit package/import/function/type/const/var/declaration summaries, parses Go `package` clauses, import counts, blank/dot/aliased import counts, import path sequences, top-level function counts, top-level function name hashes, func-literal counts, function parameter/result counts, variadic-parameter counts, named-result counts, type-parameter counts, generic-function counts, generic-type counts, call-expression counts, builtin/`append`/`len`/`make`/`cap`/`copy`/`panic`/`recover`/`new`/`delete` call counts, composite literal counts, selector expression counts, selector name hashes, index/slice/key-value expression counts, type-assertion counts, blank identifier counts, blank-assignment-target counts, unary/binary expression counts, send-statement counts, receive-expression counts, assign-statement counts, short-define counts, increment/decrement statement counts, return-statement counts, go-statement counts, defer-statement counts, if-statement counts, range-statement counts, switch-statement counts, type-switch-statement counts, type-switch case clause counts, type-switch guard name hashes, type-switch case type hashes, select-statement counts, switch case clause counts, select comm clause counts, for-statement counts, break-statement counts, break label name hashes, continue-statement counts, continue label name hashes, labeled-statement counts, label name hashes, `goto` counts, goto label name hashes, `fallthrough` counts, method counts, method name hashes, method signature hashes, exported method name hashes, exported method signature hashes, exported free-function counts, exported free-function name hashes, type counts, type name hashes, exported type counts, exported type name hashes, struct/interface/map/channel/send-only-channel/receive-only-channel/array/slice/pointer type counts, struct field counts, embedded struct field counts, tagged struct field counts, struct field name hashes, struct field type hashes, embedded struct field type hashes, tagged struct field tag hashes, interface method counts, interface method name hashes, interface method signature hashes, embedded interface method counts, embedded interface method name hashes, const counts, const name hashes, var counts, var name hashes, exported const counts, exported const name hashes, exported var counts, exported var name hashes, declaration counts, declaration name hashes, declaration signature hashes, declaration kind hashes, declaration exported counts, declaration exported name hashes, declaration exported signature hashes, declaration exported kind hashes, declaration method counts, declaration method name hashes, declaration method signature hashes, declaration method kind hashes, and `main`/`init` counts from readable `.go` inputs, writes `tinygo-backend-result.json`, materializes backend-owned lowered source/IR/bitcode manifests, lowered source stubs, lowered command/artifact manifests, and final command artifacts, and now routes placeholder lowering through dedicated import/function/declaration probe dispatchers while keeping separate lowering body tables for each stage whose lowering runners return body-table entries directly before executing the backend-owned lowered and final command batches
- browser-side validation that the compile-unit manifest itself is sufficient to recover execution metadata, including the executable tool plan, with optional caller-provided fields still checked when supplied
- browser-side validation now requires `entryFile`, `materializedFiles`, and nested `sourceSelection.allCompile` in `tinygo-compile-unit.json`; legacy top-level source-file arrays and derived target/runtime groups are no longer treated as required execution input
- browser-side validation now also rejects legacy top-level toolchain fields explicitly instead of silently ignoring them when normalized nested `toolchain` data is present
- browser-side validation now also rejects legacy top-level source-file group arrays explicitly instead of silently ignoring them when normalized nested `sourceSelection` data is present
- browser-side embedded-manifest validation now also rejects legacy top-level source-file group arrays explicitly instead of silently ignoring them when normalized nested `sourceSelection` data is present
- browser-side verification that the materialized `tinygo-compile-unit.json` and the bootstrap wasm embedded manifest are the same payload
- browser-side verification that the front-end-generated `tinygo-compile-unit.json` is present before emception executes the compile-unit-derived plan
- browser-side materialization of front-end-generated bootstrap source files and compile-unit manifests into emception before execution
- browser-side round-trip verification between the front-end-owned `tinygo-compile-unit.json` expectation and the embedded manifest payload read back from the built wasm, with that compile-unit expectation now acting as the single bootstrap verification contract
- wasm artifact generation in the browser

It does **not** yet prove TinyGo compiler compatibility.

### Static browser execution subset

When the host compile seam is unavailable, the browser backend can still produce a runnable `main`-entry wasm artifact for the checked-in starter compatibility subset. That subset is intentionally narrow, but it is no longer just a metadata/probe artifact path.

Currently covered in automated tests:

- `fmt.Print`, `fmt.Println`, and multi-placeholder `fmt.Printf` for string and integer values (`%s` and `%d`)
- integer/string/boolean constants, scalar package variables, local scalar `var`/`const` declarations, arithmetic, compound integer assignments, comparisons, string `len(...)`, string equality/inequality, logical conditions, local variables, simple loops with `break`/`continue`, conditionals with simple init statements, and simple integer/string/expressionless `switch` statements with optional simple init statements
- recursive integer and string helper functions in the main package
- local imported packages that expose integer or string helper functions, including recursive helpers and package-level integer/string/boolean constants or scalar variables
- explicit browser-side failure surfacing for unsupported bridge-less fallback programs that introduce methods or interface/struct-heavy package shapes, plus explicit invalid-target planner diagnostics in the same smoke path

This remains a compatibility slice, not a full compiler. Unsupported Go syntax or package patterns still fall back to the synthetic bridge-less backend path unless the normalized TinyGo driver bridge provides a real TinyGo `hostArtifact`.

## Browser compatibility

### Verified

| Browser/runtime | Status | Evidence |
| --- | --- | --- |
| Chromium headless | Verified when environment permits | `npm run test:browser` drives the built app through the full boot/plan/execute flow in headless Playwright/Chromium, and now exits early in restricted sandboxes that forbid loopback listen or browser launch |

### Not yet verified

- Chrome interactive
- Firefox
- Safari
- mobile browsers

The app may work outside Chromium-family browsers, but this has not been verified in this repository.

## TinyGo compatibility level

### Compatible concepts

- browser-side `build` request planning
- browser-side wasm output generation
- delegation of external tool invocations to a browser-resident backend

### Not compatible yet

- actual TinyGo compiler graph / package loading
- `tinygo build` parity
- `tinygo run`
- `tinygo test`
- `tinygo flash`
- serial monitor / USB / board-specific flows
- multi-package workspaces
- board targets beyond the placeholder `wasm` / `wasip1` / `wasip2` / `wasip3` bootstrap targets

## Test coverage backing this document

### Automated unit tests

`go test ./...` currently covers:

- valid bootstrap plan generation
- supported optimize flag aliases
- planner default/selection
- supported TinyGo-style scheduler / panic options
- target-profile resolution for `wasm`, `wasip1`, `wasip2`, and `wasip3`
- same-directory package loading
- `//go:build` filtering for target-matching package files
- filename target suffix filtering for target-matching package files
- explicit diagnostics when the entry file or a local imported package is excluded by target/build constraints
- stdlib-like import classification
- current-module import recognition from the nearest `go.mod`
- transitive current-module package file loading and package-name validation
- local `replace` directive resolution into workspace package files
- local `go.work` workspace module resolution into workspace package files
- workspace module-local `replace` directive resolution into workspace package files
- `go.work`-level local `replace` directive resolution into workspace package files
- explicit diagnostics for local/workspace/replaced package import cycles
- explicit diagnostics for unsupported non-local `replace` directives
- rejection of relative and unresolved external imports
- ignored-file filtering for `_test.go`, dotfiles, and `_`-prefixed files
- rejection of non-Go entry paths
- rejection of non-wasm output paths
- rejection of non-main packages
- rejection of missing `func main()`
- rejection of invalid `main` signatures
- rejection of unsupported command / target / optimize settings
- success/failure result-file writing through `ExecutePaths`

### Automated WASI integration tests

`npm run test:wasi` currently covers:

- valid WASI driver execution with `tinygo-bootstrap` metadata
- `wasip1`, `wasip2`, and `wasip3` target metadata from the built WASI driver
- multi-file package loading with `//go:build` filtering in the built WASI driver
- multi-file package loading with filename target suffix filtering in the built WASI driver
- explicit diagnostics when a local imported package is excluded by target/build constraints in the built WASI driver
- current-module import recognition from `go.mod` in the built WASI driver
- transitive current-module package file loading in the built WASI driver
- local `replace` directive resolution in the built WASI driver
- local `go.work` workspace module resolution in the built WASI driver
- workspace module-local `replace` directive resolution in the built WASI driver
- `go.work`-level local `replace` directive resolution in the built WASI driver
- explicit diagnostics for local/workspace/replaced package import cycles in the built WASI driver
- explicit diagnostics for unsupported non-local `replace` directives in the built WASI driver

### Automated browser smoke tests

`npm run test:browser` currently covers:

- booting the patched emception worker in the built app
- driving the browser-side TinyGo bootstrap flow through the same boot/plan/execute codepath exposed by minimal test hooks in `src/main.ts`
- producing a browser-built wasm artifact
- verifying that the final browser phases reach `ready`, `steps`, `bytes`, and `verified`
- browser-side consumption of an injected normalized TinyGo driver bridge fixture while re-verifying `frontendAnalysisInput`, `frontendAnalysis`, `frontendRealAdapter`, and the downstream synthetic compile-unit manifest
- confirming that the terminal log includes `frontend analysis input source=bridge`, canonical versus `compat-alias` `frontend real adapter bridge verified ... source=...`, `frontend bridge coverage ...`, and `frontend build source=real-adapter`
- rejecting drifted `frontendAnalysisInput` and `frontendAnalysis` bridge facts before the browser build continues past front-end verification
- exiting early instead of failing when the current sandbox forbids loopback listen or Chromium launch
- unresolved external import diagnostics in the built WASI driver
- invalid source diagnostics flowing through the generated result file
- browser-side TinyGo front-end handoff consumption that keeps `frontend` behind the verified real-adapter seam before it writes `tinygo-compile-unit.json`
- static pure-browser execution for a local imported package helper that computes and prints `imported_total=123` without using the host compile seam
- browser-side unsupported fallback diagnostics for method/interface/struct-heavy programs before the UI silently degrades into a generic browser failure
- invalid target override diagnostics flowing through the same browser plan/execute/test-hook surface

The relevant tests live in:

- [browser-smoke.test.mjs](./tests/browser-smoke.test.mjs)

### Browser smoke verification

The checked-in headless Chromium smoke test exercises the browser flow end to end:

1. boot `emception`
2. run the Go/WASI driver
3. inject and verify normalized TinyGo driver bridge handoffs
4. run probe-backed `frontend-analysis`, `frontend-real-adapter`, and the generic `frontend` build behind that verified seam
5. execute the emitted compile, lowering, backend, and final artifact plan
6. generate and verify `/working/out.wasm`

This is checked-in runtime verification via `npm run test:browser`, not just an ad-hoc manual smoke pass.

## Practical interpretation

If you want to know whether `wasm-tinygo` is already “TinyGo in the browser”, the answer is:

- **infrastructure compatibility:** yes, for the first bootstrap slice
- **TinyGo compiler compatibility:** not yet

The next major compatibility step is replacing the remaining synthetic compile-unit derivation inside that probe-backed front-end seam with direct TinyGo-owned frontend state while keeping `clang`/`wasm-ld` execution delegated to `emception`.
