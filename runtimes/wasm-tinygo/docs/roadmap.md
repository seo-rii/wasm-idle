# Roadmap

This roadmap tracks both the public upstream TinyGo browser path and the isolated legacy porting
harness. Public milestones refer to `upstream.js`; `runtime.js` milestones describe only the
legacy wasm-idle-authored bootstrap/subset path.

## Goal

The first demo means:

- a non-trivial Go program is compiled in the browser
- the front-end is backed by real TinyGo compiler logic instead of the current synthetic bootstrap/front-end handoff
- the backend path is no longer just a placeholder lowered-C generator
- the browser still executes and verifies the final wasm artifact end to end

## Current state

### Status checklist

Implemented now:

- [x] reusable `runtime.js` library entry for legacy porting-harness consumers
- [x] public `upstream.js` integration in `wasm-idle` without a hidden iframe or subset fallback
- [x] host-assisted TinyGo compile path for legacy bridge consumers
- [x] static browser execution for the legacy TinyGo starter compatibility subset
- [x] real-browser TinyGo probes in `wasm-tinygo` and `wasm-idle`
- [x] TinyGo runtime asset loader support
- [x] TinyGo runtime pack support (`runtime-pack.index.json` + `runtime-pack.bin`)
- [x] source-pinned Go 1.24.6 `cmd/go` package discovery for local module workspaces
- [x] receipt-verified provider → TinyGo → LLD → Binaryen execution in Chromium

Not done yet:

- [ ] guarantee runnable pure-browser TinyGo output for arbitrary user programs
- [x] replace the synthetic `frontend-analysis` path with a real TinyGo frontend
- [x] replace the placeholder backend/lowering path with real TinyGo compiler output
- [x] add independent producer/consumer fixtures for generics, init, goroutines/channels, CGo, C++, and assembly
- [x] publish and verify TinyGo-generated `go:embed` objects in compile protocol v2
- [x] publish and verify target CGo/C sources, dependencies, and objects in compile protocol v3
- [x] publish and verify freestanding-C++17 and CGo-package uppercase `.S` objects in protocol v4
- [x] bind hosted libc++/libc++abi without exceptions/RTTI/global constructors in protocol v5
- [x] bind exact CXXFLAGS and restricted CGo linker flags in protocol v6
- [x] accept complete offline `vendor/modules.txt` workspaces without a network fallback
- [x] isolate package discovery and compilation in disposable Workers with phase and wasm-memory limits

### What already works

- an independent upstream path that derives source-pinned package graphs and compiles separate
  producer and consumer fixtures with TinyGo semantics, CGo/C/hosted-C++/assembly, native flags,
  and vendored modules entirely in Node or Chromium without a host compile service
- browser-side emception boot and command execution
- Go/WASI driver, front-end, and backend stage boundaries
- normalized manifest chain with host/browser verification
- bootstrap wasm artifact generation
- lowered wasm artifact generation and probe verification
- repo-local host TinyGo execution through the pinned upstream release
- pure-browser execution for the legacy starter compatibility subset in Chromium-based porting-harness smoke tests
- the static subset now covers `fmt.Print`/`fmt.Println`, multi-placeholder `fmt.Printf` for `%s`/`%d`, integer/string/boolean constants, scalar package variables, local scalar `var`/`const` declarations, integer expressions and compound integer assignments, string `len(...)`, string equality/inequality, logical conditions, recursion, main-package integer or string helper functions, simple loops with `break`/`continue`, conditionals with simple init statements, simple integer/string/expressionless `switch` statements with optional simple init statements, and local imported packages that expose integer or string helper functions plus package-level scalar state
- normalized `tinygo-driver-bridge.json` generation that compares native driver metadata with the real host-side TinyGo probe for the same request and records how the synthetic frontend handoff lines up with the real entry package facts, package graph facts, direct imports, and promoted bridge coverage summary fields
- the bridge manifest now exposes the package-focused adapter result as canonical `frontendRealAdapter` while keeping `realFrontendAnalysis` as a compatibility-only alias for older consumers
- browser-side consumption of the same normalized bridge vocabulary during smoke verification, including the `frontend bridge coverage ...` summary line
- planner-owned `tinygo-frontend-input.json` now carries explicit `buildContext` and `packageGraph` sections and the synthetic front-end validates them against `toolchain`, `buildTags/modulePath`, and `compileUnits`
- `cmd/go-probe frontend-real-adapter` now turns that same handoff into a package-focused adapter result, filling missing compile-unit package facts from `packageGraph` and rejecting graph mismatches before the browser/host bridge consumes it
- the host bridge now canonicalizes the analysis-only `buildContext` from verified TinyGo host facts before `frontend-analysis` runs, which removes another synthetic-only patch point from the real frontend seam
- browser/runtime execution now promotes the patched TinyGo WASI frontend probe into `frontendAnalysisInput`, runs `frontend-analysis` from that probe-backed input when bridge analysis is absent, and derives the bridge-less adapter path from `frontend-real-adapter-analysis` instead of skipping the analysis seam entirely
- the host bridge can now embed that same `upstreamFrontendProbe` summary into `frontendAnalysisInput` and `frontendRealAdapter` when the upstream frontend probe is enabled, so host/browser manifests share the same first real TinyGo frontend fact vocabulary
- the host bridge now also embeds a runnable `hostArtifact` built by the real TinyGo CLI, re-targeting `wasm` requests to a `wasip1` execution artifact when needed so the browser can execute and verify a real TinyGo-produced final wasm instead of the synthetic backend lowering output
- browser/runtime execution now consumes that bridge-owned `hostArtifact` directly when present, which moves the host-assisted browser path off the synthetic backend/lowering stage while keeping the existing manifest seam and verification flow intact
- browser smoke now keeps stable demo coverage for both the host-assisted bridge path and the bridge-less static starter-subset path, including a local imported-package demo instead of only a single-file happy path
- browser/runtime execution now promotes lowered-IR-backed unsupported-feature summaries for bridge-less static fallback failures, and browser smoke also asserts that invalid target overrides surface as explicit planner failures in the UI/test-hook path
- runtime asset indirection now supports both per-asset loaders and compressed runtime packs so host apps can ship TinyGo assets as a bundle instead of exposing every nested file individually

### What is still synthetic in the legacy bridge-less fallback

- `runtime.js` still derives compile units and downstream manifests from normalized package-graph
  state when no real TinyGo bridge manifest is available
- `runtime.js` still lowers through the synthetic backend path when no bridge-owned `hostArtifact`
  is available
- the legacy path only guarantees its starter subset. The public `upstream.js` path instead runs
  the receipt-verified upstream compiler and never enters this fallback.

## Execution order

### 1. Make the front-end handoff explicit enough for a real TinyGo frontend

The current handoff is still bootstrap-oriented. The first step is to make package graph ownership explicit and future-proof the front-end input contract.

Near-term slices:

- keep `buildContext` and `packageGraph` stable as planner-owned handoff vocabulary
- keep host/WASI/browser verification aligned with that stronger handoff
- attach package metadata needed by a real TinyGo frontend instead of only file grouping
- keep compile-unit package facts such as `importPath`, `packageName`, `depOnly`, and `standard` stable through the manifest chain

### 2. Replace the synthetic front-end with a build-only TinyGo front-end

Once the handoff is strong enough, the next milestone is swapping out the synthetic front-end logic for real TinyGo compiler analysis.

Expected deliverables:

- build-only TinyGo frontend mode in `cmd/go-probe`
- real package/type analysis from browser materialized sources
- compile-unit/lowering manifests derived from real TinyGo frontend state
- host-side TinyGo probe output promoted into the same manifest vocabulary first, then moved into WASI/browser execution

Status:

- done for the host-assisted bridge path
- the bridge-less static fallback still keeps the old synthetic reconstruction path as a fallback-only mode

### 3. Replace placeholder lowered-C generation with real backend integration

After the real frontend is present, the backend needs to stop inventing placeholder lowered sources and start consuming real compiler output.

Expected deliverables:

- backend input derived from real TinyGo frontend output
- real lowering/backend bridge instead of synthetic lowered C
- final wasm artifact still verified in the browser host

Status:

- done for the host-assisted bridge path via bridge-owned real TinyGo `hostArtifact` execution
- the bridge-less static fallback still keeps the old synthetic lowering path for the starter compatibility subset

### 4. Expand the demo from “works once” to “repeatable and broader”

The first convincing demo needs stable examples and regression coverage.

Expected deliverables:

- one or more non-trivial demo programs
- browser smoke coverage against those programs
- clearer failure modes for unsupported language/target cases

Status:

- done for the current demo/stability slice
- compatibility breadth beyond the checked-in bridge/static demos is still tracked separately by the broader compatibility checklist above

## Immediate next slice

The reusable runtime entry, public `wasm-idle` integration, upstream package provider/compiler
path, hosted C++, Clang assembly, native flags, offline vendoring, disposable Worker limits, and
differential fixtures are done for the receipt-bound `wasip1` profile. The next upstream slice is
compatibility breadth while the legacy seam stays isolated:

- track upstream TinyGo support for Go/Plan 9 assembly instead of translating it locally
- expand libc++ header/library coverage while keeping exceptions, RTTI, and global constructors fail-closed
- add more vendored-module and weak/strong native symbol differential fixtures
- keep the public upstream browser path green while adding broader program coverage
- use the host compile seam as the correctness oracle for new browser-facing demo cases
- keep shrinking the bridge-less synthetic fallback until it is no longer needed for supported demo cases
- keep `frontend-real-adapter` as the package-focused normalization boundary so newer TinyGo-owned facts can keep replacing fallback-only synthetic state without changing the browser/bridge vocabulary
