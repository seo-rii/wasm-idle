# Browser compiler

This document records the stable knowledge discovered while moving `wasm-rust` from a placeholder
compiler to a real browser-hosted `rustc.wasm` pipeline.

## Current architecture

`wasm-rust` now uses two explicit browser areas:

- compile support
    - target-aware browser compilation for `wasm32-wasip1`, `wasm32-wasip2`, and transitional
      `wasm32-wasip3`
- in-browser execution
    - target-aware runtime execution for preview1 core wasm and preview2 components

The current pipeline is:

1. `src/compiler.ts`
    - top-level browser API surface
    - owns retries for transient browser-rustc failures
    - watches the shared mirrored `.no-opt.bc` buffer
2. `src/compiler-worker.ts`
    - launches the packaged `rustc.wasm`
    - creates the shared memory and preopened filesystem
    - starts the pooled rustc thread workers
    - reserves pooled helper slots through `src/thread-startup.ts` before returning a browser
      thread id to rustc
    - uses direct same-origin module workers instead of `blob:` wrappers so stricter deployed CSP
      pages do not fail with a generic `worker script error`
3. `src/rustc-thread-worker.ts`
    - runs rustc wasm helper threads
    - reuses the shared pool for nested rustc thread spawns
    - instantiates a fresh wasm helper runtime for each pooled dispatch and records the last
      start-arg context into `src/worker-status.ts`
4. `src/rustc-runtime.ts`
    - browser WASI host setup
    - injects `RUST_MIN_STACK=8388608` and required `env` function shims into `rustc.wasm`
    - mirrored bitcode inode preservation across rename/reopen paths
5. `src/browser-linker.ts`
    - links mirrored `.no-opt.bc` through packaged `llvm-wasm` `llc` + `lld`
    - returns either a preview1 core wasm artifact or a preview2 component artifact
6. `src/browser-component-tools.ts`
    - componentizes `wasm32-wasip2` core wasm into a browser-runnable component
    - accepts `wasm32-wasip3` only while emitted browser imports still stay on WASIp2 interfaces
    - transpiles preview2 components with vendored `jco`
7. `src/browser-execution.ts`
    - executes preview1 artifacts through `@bjorn3/browser_wasi_shim`
    - executes preview2/component artifacts through `preview2-shim` + transpiled `jco` output
8. `scripts/prepare-runtime.mjs`
    - packages runtime assets into `dist/runtime/`
    - patches the shipped `rustc.wasm` memory maximum
    - emits target-aware `runtime-manifest.v3.json` plus per-target sysroot/link packs
    - vendors and rewrites browser-safe `preview2-shim` and `jco` runtime modules

## Invariants

These are required for the browser path to work.

- The runtime must be cross-origin isolated.
    - `SharedArrayBuffer` and wasm threads are mandatory.
    - The standalone harness server sets COOP/COEP for this reason.
- The packaged `rustc.wasm` memory import maximum must match the runtime manifest.
    - Current packaged values:
        - initial pages: `16384`
        - maximum pages: `65536`
- The packaged `rustc.wasm` host must provide both:
    - callable `env` shims for current Rust/C++ imports such as
      `_ZNSt3__212basic_string...__grow_by...`
    - `RUST_MIN_STACK=8388608` so browser helper threads do not fail before mirroring bitcode
- The packaged runtime manifest must allow enough wall-clock time for real browser rustc startup.
    - Current packaged compile timeout: `120000ms`
- New bundles publish `dist/runtime/runtime-manifest.v3.json` first.
    - the runtime manifest points at per-target sysroot/link packs and compact sidecar indexes
    - the compiler still falls back to older `v2` and legacy `v1` manifests only when the newer
      manifest file is missing
    - parse errors, fetch failures, or other non-missing `v3` load failures now surface immediately
      instead of silently downgrading the bundle contract
- The mirrored bitcode file must survive:
    - direct rename into `/work/<bitcode>`
    - rename through the root preopen
    - rename after reopening `/work`
- The browser linker pack index must contain only materialized files.
    - `-L` directories stay in link args only.
    - directory-only entries must not appear in the generated pack index.
- Preview2 packaging requires an external toolchain prerequisite.
    - `wasm32-wasip2` packaging expects `wasi-sdk >= 22`
    - `prepare-runtime.mjs` now auto-detects cached `wasi-sdk-*` directories under the toolchain
      cache root and `$HOME/.cache/wasm-rust*/`
    - `WASM_RUST_WASI_SDK_ROOT` still overrides the detected path when needed
    - `bin/wasm-component-ld` must be present there
- Preview3 packaging currently requires an extra Rust build patch.
    - as documented by rustc on 2025-10-01, `wasm32-wasip3` does not build upstream without a `libc`
      patch yet
    - `scripts/prepare-wasip3-libc-overlay.sh` materializes a cargo-home overlay with
      `[patch.crates-io] libc = { path = ... }`
    - `scripts/prepare-wasip3-rust-source.sh` clones or updates a Rust checkout that already contains
      `compiler/rustc_target/src/spec/targets/wasm32_wasip3.rs`
    - `scripts/build-custom-rustc-toolchain.sh` automatically uses that overlay when
      `WASM_RUST_INSTALL_TARGETS` includes `wasm32-wasip3`
    - the same build script also writes an effective `x.py` config with the requested target list and
      auto-appends `target.'wasm32-wasip3'` from `WASM_RUST_WASI_SDK_ROOT` when the base config is
      older and lacks that section
    - it also prepends `WASM_RUST_WASI_SDK_ROOT/bin` to `PATH`, because Rust bootstrap sanity checks
      do not rely only on the absolute linker path in the generated config
    - if the fetched Rust checkout is still too old and lacks the target file, the build now fails
      immediately instead of starting a long `x.py` run

## Why the split backend exists

The browser frontend uses real `rustc.wasm`, but final code generation is not delegated to the old
browser clang/lld stack already present in `wasm-idle`.

Known reason:

- that stack is too old for Rust 1.79 LLVM IR
- the old browser clang/lld path fails on:
    - LLVM bitcode version mismatch
    - opaque-pointer-era textual LLVM IR

That is why the checked-in browser backend is:

- packaged `llvm-wasm` `llc`
- packaged `llvm-wasm` `lld`
- plus a separate preview2 componentization step for `wasm32-wasip2`
- plus the same preview2-style transitional component path for `wasm32-wasip3` until browser-safe
  preview3 shims exist

## Browser-specific instability

The real browser-hosted `rustc.wasm` still has a narrow transient failure mode:

- helper or LLVM worker threads may still throw `memory access out of bounds`
- this can happen before or during optimization/summary passes
- the failure is intermittent, but the shipped path now treats it as a recoverable internal fault

Observed recovery behavior:

- rustc often still mirrors `.no-opt.bc` before the worker failure becomes terminal
- `llvm-wasm` can link that mirrored bitcode into runnable wasm
- retrying the browser rustc attempt materially improves success rate

Shipped mitigation:

- `src/thread-startup.ts` now waits for helper workers to reach a minimum startup state before the
  browser thread id is returned to rustc
- `src/rustc-thread-worker.ts` instantiates a fresh helper runtime per pooled dispatch instead of
  reusing a stale wasm instance across multiple starts
- `src/rustc-runtime.ts` sets `RUST_MIN_STACK=8388608`, which materially improved helper-thread
  startup stability in Chromium
- `src/worker-status.ts` records the last helper-thread start-arg snapshot so recovered OOBs still
  leave actionable context in diagnostics
- `src/compiler.ts` retries transient browser failures up to `5` attempts
- `src/compiler.ts` now also gives mirrored-bitcode recovery a short grace window before turning a
  helper-thread failure into a user-visible compile failure
- retries are currently triggered for:
    - `memory access out of bounds`
    - `browser rustc timed out before producing LLVM bitcode`
    - transient metadata decode / invalid-rlib panic surfaces such as:
        - `invalid enum variant tag while decoding`
        - `found invalid metadata files for crate`
        - `failed to parse rlib`
- helper-worker/transient retry diagnostics are now emitted as visible warnings with the retry
  reason when `compile({ log: true })` is enabled
    - successful consumers should not surface those recovered internal failures as user-visible
      terminal errors
- when `compile({ log: true })` is used, compile-time browser-rustc log lines are returned through
  `result.logs`
    - the same data is also available as structured `result.logRecords` with preserved `level`
    - this includes retry warnings and forwarded `compiler-worker` log lines
    - consumers can forward those logs into their terminal surface without scraping browser console
- `compile({ onProgress })` now receives structured stage/attempt/percent updates directly instead
  of inferring progress from mixed stdout text
- successful recovered compiles also drop recovered compiler `stderr`
    - user-facing terminals should only show the final program output, not transient LLVM worker crash text

This is an intentional product behavior, not just a probe-only trick.

## Consumer-facing behavior

The browser retry path is now part of the consumer contract:

- compile retries are visible as warnings when `compile({ log: true })` is enabled
- recovered internal worker failures should not be forwarded into user-facing program output
- a final `success: true` compile result is the only outcome the consumer should treat as decisive
- `extendedTimeout: true` is the current public timeout knob
    - the legacy `prepare: true` alias still works, but it only raises the compile timeout floor to
      `120000ms`; it does not trigger a separate preparation step

For consumer-side stdin behavior:

- `wasm-rust` only produces the artifact
- the artifact now includes `targetTriple` and `format`
- line-based stdin vs EOF-based stdin depends on the consumer runtime and the Rust program
- `stdin()` should return `null` to signal EOF
- empty stdin chunks are rejected so the runtime cannot spin forever on repeated zero-byte reads
- the linked `wasm-idle` route now uses a line-based Rust sample by default so Enter alone is enough
  for the built-in example, while still exposing explicit EOF for read-to-end programs

## Runtime packaging and probes

New runtime/build helpers:

- `pnpm run prepare:runtime`
    - packages `rustc.wasm`, target sysroots, link assets, and `runtime-manifest.v3.json`
    - emitted bundles stay v3-first while the loader still falls back to `v2` and legacy `v1`
      manifests for older bundles only when the newer manifest file is absent
- `pnpm run toolchain:build:custom`
    - env-driven wrapper for rebuilding the custom browser `rustc.wasm` toolchain
- `pnpm run toolchain:prepare:wasip3-libc`
    - materializes a cargo-home overlay that patches Rust's build to a newer `libc` crate
- `pnpm run toolchain:prepare:wasip3-source`
    - clones or updates a Rust checkout from `WASM_RUST_RUST_SOURCE_REMOTE` / `..._REF`
- `pnpm run toolchain:build:custom:wasip3`
    - rebuilds the custom toolchain with `wasm32-wasip3` in `WASM_RUST_INSTALL_TARGETS`
    - `pnpm run toolchain:build:custom:wasip3 -- --foreground` keeps the build in the current shell
- `pnpm run toolchain:bootstrap:wasip3`
    - prepares the Rust checkout and then starts the patched custom toolchain build
- `pnpm run probe:native-link`
    - captures native link recipes for the configured targets
- `pnpm run probe:native-link:wasip1`
- `pnpm run probe:native-link:wasip2`
- `pnpm run probe:native-link:wasip3`
- `pnpm run prepare:runtime:wasip3`
    - packages a `wasm32-wasip1` + `wasm32-wasip2` + `wasm32-wasip3` runtime bundle by default and
      refuses to continue if the patched sysroot is missing
    - plain `pnpm run prepare:runtime` also keeps `wasm32-wasip3` in the default target list, but
      permissive packaging skips it with a warning when the patched prerequisites are unavailable

Important env vars:

- `WASM_RUST_RUNTIME_TARGET_TRIPLES`
    - comma-separated targets to package; default is `wasm32-wasip1,wasm32-wasip2,wasm32-wasip3`
- `WASM_RUST_DEFAULT_TARGET_TRIPLE`
    - default compile target for v2 consumers; default is `wasm32-wasip1`
- `WASM_RUST_ALLOW_MISSING_TARGETS`
    - defaults to permissive mode; missing non-default targets are skipped with a warning
- `WASM_RUST_ALLOW_PREBUILT_RUNTIME_FALLBACK`
    - opt-in compatibility escape hatch for CI/runtime hydration flows
    - when enabled, `prepare-runtime.mjs` may reuse an already-published runtime bundle only if all
      referenced manifest assets are present
- `WASM_RUST_WASI_SDK_ROOT`
    - required for preview2 packaging
- `WASM_RUST_WASIP3_LIBC_VERSION`
    - selects the `libc` crate version copied into the `wasip3` cargo overlay; default is `0.2.183`
- `WASM_RUST_WASIP3_LIBC_SOURCE`
    - optional explicit source directory for that `libc` crate
- `WASM_RUST_RUST_SOURCE_REMOTE`
    - override for the Rust checkout remote used by `toolchain:prepare:wasip3-source`
- `WASM_RUST_RUST_SOURCE_REF`
    - override for the Rust checkout ref used by `toolchain:prepare:wasip3-source`
    - defaults to `main` for `rust-lang/rust`
- See `docs/environment-variables.md` for the consolidated packaging/validation env reference.
- Compatibility policy:
    - new builds publish `runtime-manifest.v3.json`
    - `v2` and legacy `v1` loading remains only for consuming older bundles

## Latest standalone validation evidence

Latest fully-owned validation command:

```bash
cd /path/to/wasm-rust
pnpm run validate:standalone-browser
```

Latest observed outcome:

- `test:ci:fast` passed
- `test:ci:browser` passed, which includes:
    - `pnpm build`
    - Chromium harness probe
    - browser harness Vitest coverage
    - browser Playwright integration coverage
- targeted browser coverage still included:
    - helper-thread startup/retry/runtime shims
    - richer Chromium browser harness regression
    - `wasip3` build-pipeline normalization
- final browser results included:
    - `wasm32-wasip1` minimal sample
    - richer `wasm32-wasip2` sample with preview2 args/stdin
    - transitional `wasm32-wasip3` minimal sample
    - `wasm32-wasip2` stdout containing `preview2_component=preview2-cli`
    - `wasm32-wasip2` stdout containing `factorial_plus_bonus=27`
    - `wasm32-wasip3` stdout `hi\n`

Important observation from the same successful run:

- attempt `1/5` still hit transient browser-hosted LLVM worker failures
- observed failure texts included:
    - `memory access out of bounds`
    - `operation does not support unaligned accesses`
- despite that, the compiler mirrored `.no-opt.bc`, retried, and completed successfully on the next attempt

Observed recovery markers from the successful browser run:

- `result.logs` included `browser rustc attempt 1/5 failed; retrying` when `log: true` was enabled
- the shared mirror logged `mirrored artifact updated seq=2 bytes=4996 overflowed=false`
- the linker logged `mirrored bitcode settled; linking through llvm-wasm`

This confirms the current product behavior:

- transient browser-rustc worker faults are still expected
- the shipped retry plus mirrored-bitcode recovery path is what makes the standalone browser compile reliable enough today

Minor harness note:

- a `favicon.ico` `404` still appears in the browser probe console
- it is currently harmless and does not affect compile/run correctness

## Standalone browser validation surface

`wasm-rust` now owns a standalone browser validation path independent of `wasm-idle`.

Files:

- `browser-harness/index.html`
- `browser-harness/harness.js`
- `scripts/browser-harness-server.mjs`
- `scripts/probe-browser-harness.mjs`
- `test/browser-harness.test.ts`

What it proves:

- the shipped `/dist` module can compile Rust in Chromium
- the returned artifact is executable in-browser through the target-appropriate runtime
- the minimal regression target `fn main() { println!("hi"); }` prints `hi\n`
- consumer-side browser regressions can also pin line-based stdin behavior without requiring EOF

## Accepted current state

What is now proven:

- browser compile+run succeeds inside Chromium without `wasm-idle`
- the shipped module returns target-aware artifacts with `targetTriple` and `format`
- the standalone browser harness and Vitest browser regression both pass

What is still true:

- success currently relies on retrying around intermittent browser-rustc LLVM worker failures
- that is acceptable for `wasm-rust` standalone validation today
- consumer reintegration should treat that retry-based recovery as a conscious tradeoff
- local full preview2 packaging still depends on a matching custom install root that actually contains
  the `wasm32-wasip2` sysroot
