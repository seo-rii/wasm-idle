# Architecture

`wasm-tinygo` is organized around explicit browser-safe boundaries instead of embedding the full upstream TinyGo compiler directly.

The current stack has five major pieces:

1. browser host app
2. emception toolchain worker
3. Go/WASI driver
4. browser-side front-end handoff consumer
5. browser-side backend lowering consumer

## Execution model

### 1. Browser host

The app in `src/main.ts` boots emception, materializes planner output into the browser filesystem, executes generated command batches, and verifies the resulting wasm artifacts.

### 2. Driver stage

`cmd/go-probe` runs in its default mode as a Go/WASI driver.

It reads `/workspace/tinygo-request.json`, validates the request, loads package files, resolves TinyGo-style target metadata, and asks the planner to emit the first normalized handoff artifacts.

### 3. Planner stage

`internal/tinygoplanner` emits:

- `/working/tinygo-bootstrap.json`
- `/working/tinygo-frontend-input.json`

The planner owns the first browser-facing contract: which files must be materialized, which target profile applies, and which entry/source set the next stage must consume.

That contract now includes explicit `compileUnits`, a normalized `packageGraph`, and a `buildContext`, so the front-end no longer has to reconstruct package grouping or target facts from a flat compile-file list plus implicit profile state.

### 4. Front-end stage

`internal/tinygofrontend` consumes `tinygo-frontend-input.json` and emits the front-end-owned manifest chain, including:

- `/working/tinygo-compile-unit.json`
- `/working/tinygo-intermediate.json`
- `/working/tinygo-lowering-input.json`
- `/working/tinygo-work-items.json`
- `/working/tinygo-lowering-plan.json`
- `/working/tinygo-backend-input.json`

This stage keeps bootstrap compilation and the next lowering steps explicit and deterministic, even before a real TinyGo compiler front-end is wired in.

At this point the front-end still synthesizes the next manifests, but it consumes planner-owned package grouping and target facts directly instead of rediscovering them from file paths and implicit profile defaults alone.

### 5. Backend stage

`internal/tinygobackend` consumes `tinygo-backend-input.json` and emits:

- lowered C sources
- lowered IR
- lowered bitcode manifest
- lowered command batches
- lowered and final artifact manifests
- `/working/tinygo-backend-result.json`

The backend owns lowered-source generation, lowering/body tables, placeholder signatures, and the final command graph that the browser executes.

## Package ownership

- `cmd/go-probe`
  WASI entrypoint that dispatches `driver`, `frontend`, and `backend` modes through `WASM_TINYGO_MODE`.
- `internal/driver`
  Request parsing, package scanning, import/module analysis, and planner invocation.
- `internal/tinygotarget`
  TinyGo-style target profile resolution.
- `internal/tinygoroot`
  Minimal TinyGo root asset seeding.
- `internal/tinygobootstrap`
  Bootstrap translation-unit generation and embedded manifest surface.
- `internal/tinygofrontend`
  Front-end handoff validation and compile/lowering manifest generation.
- `internal/tinygobackend`
  Lowered source generation, lowered IR, lowered export surface, and final artifact contracts.
- `src/bootstrap-exports.ts`
  Bootstrap wasm export reader/verifier.
- `src/compile-unit.ts`
  Host/browser verifiers for the manifest chain.
- `src/lowered-exports.ts`
  Verifiers for lowered wasm/object/bitcode/final artifact surfaces.

## Why the pipeline is split

The split is intentional.

- Upstream TinyGo is not yet browser-ready as a single WASM payload.
- Browser execution needs explicit filesystem materialization and tool invocation contracts.
- Deterministic manifests make each boundary testable in Go, Node, WASI, and Chromium.
- Ownership stays with the stage that derives the data, instead of copying derived fields forward.

## Reading order

If you are new to the repository, read the docs in this order:

1. `README.md`
2. `docs/architecture.md`
3. `docs/roadmap.md`
4. `docs/manifests.md`
5. `docs/development.md`
6. `COMPATIBILITY.md`
