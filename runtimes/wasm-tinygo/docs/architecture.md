# Architecture

`wasm-tinygo` keeps its legacy porting harness and its real upstream compiler consumer as separate
browser entries. The legacy path uses explicit handoff boundaries; the independent upstream path
loads the source-pinned wasm-llvm compiler and never falls back to that harness.

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

## Independent upstream path

`src/upstream-entry.ts` exports a separate end-to-end path with these boundaries:

1. load the compiler, Go 1.24.6 `cmd/go` WASI package provider, reduced root archive, both producer
   receipts, and raw WASI LLD declared by the upstream asset manifest
2. verify every byte count and SHA-256 plus the compiler and provider identities
3. expand the gzip/tar root into a bounded binary VFS while rejecting traversal, links, and
   unsupported entries
4. run the fixed offline `go list` request over the mounted workspace and validate the resulting
   package graph against restricted `/tinygo-root`, `/workspace`, and `/work` mounts
5. run the real TinyGo builder/compiler with that graph and validate its receipt-selected v1-v6
   complete object-set link plan
6. for v4-v6, require LLVM 20.1.1 module/object validation evidence and independently reject
   malformed bitcode envelopes, fake relocatable-Wasm metadata, TLS/init ABI use, and
   out-of-profile metadata; v5 binds hosted libc++/libc++abi and v6 binds native flags plus offline
   vendoring; require final `target_features` and decode the actual core Wasm streams for forbidden
   feature use
7. run raw LLVM 20 LLD, then compile-check its WASI-only result and the Binaryen 129 asyncify/O1 result
8. return the final wasm without executing it; a separate API supplies stdin and executes the
   program

The fixed `wasip1-asyncify-precise-o1` path uses separate producer and consumer fixtures spanning
ordinary TinyGo semantics, CGo/C, hosted C++17, Clang assembly, native/linker flags, and offline
vendoring. Public compilation executes in a disposable Worker; the host terminates it when a phase
deadline, abort, or crash occurs and rewrites defined wasm32 memories to a verified maximum before
instantiation. `TINYGO` is public for this receipt-bound profile and never falls back to the legacy
AST-to-C path.

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

- The upstream compiler is browser-proven as a verified multi-asset pipeline, not packaged as a
  single payload or exposed as a general browser TinyGo CLI.
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
