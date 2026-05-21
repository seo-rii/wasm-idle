# Progress

This file records the current checked-in state only. Historical investigation detail lives in
`docs/real-rustc-history.md`.

## Current state

- `wasm-rust` now uses the real-rustc split browser pipeline in `src/`.
- The standalone Chromium harness succeeds end to end without `wasm-idle`.
- The shipped browser runtime is target-aware through `runtime-manifest.v3.json`.
  - `wasm32-wasip1` returns a preview1 core wasm artifact.
  - `wasm32-wasip2` returns a preview2 component artifact.
  - `wasm32-wasip3` currently uses the same transitional preview2-style component runtime when the
    bundle was prepared from the patched custom toolchain.
- `wasm-idle` now consumes the returned Rust artifact through `browser_wasi_shim` on its Rust worker
  path instead of the generic `App` host.
- The shipped module returns a runnable WASI `wasm` artifact through the browser compiler contract.
- The internal compile/thread workers now use direct same-origin module workers instead of `blob:`
  wrappers so deployed pages with stricter CSP do not fail at browser worker bootstrap.
- Browser retries are now surfaced through `result.logs` and console warnings when
  `compile({ log: true })` is enabled instead of only debug transitions into attempts `2/5`,
  `3/5`, and so on.
- The public browser compiler request now accepts `onProgress`, and compile-time logs are returned
  separately through `result.logs` instead of being merged into `stdout`.
- The standalone browser harness now renders a real progress bar from structured progress events
  instead of inferring status from log text alone.
- Browser runtime assets are now shipped as per-target sysroot/link packs with sidecar indexes, so
  the compiler and linker stop issuing file-per-asset fetch storms.
- The default `pnpm build` path now auto-detects a cached `wasi-sdk >= 22`, which restores
  `wasm32-wasip2` packaging on this workspace without a manual env var export.
- Browser helper-thread startup is now handshake-based and the packaged `rustc.wasm` host injects
  `RUST_MIN_STACK=8388608` plus current required `env` shims, which materially improved helper
  startup stability.
- `dist/` is the distributable output:
  - `dist/index.js`
  - `dist/compiler-worker.js`
  - `dist/rustc-thread-worker.js`
  - `dist/runtime/runtime-manifest.v3.json`

## Last verified results

Validated command:

```bash
cd /path/to/wasm-rust
pnpm exec vitest run test/compiler-retry.test.ts test/rustc-runtime.test.ts test/thread-startup.test.ts test/worker-status.test.ts test/browser-harness.test.ts test/fixtures.test.ts test/wasip3-build-pipeline.test.ts
pnpm exec tsc -p tsconfig.json --noEmit
WASM_RUST_BROWSER_HARNESS_TARGET_TRIPLES=wasm32-wasip3 node ./scripts/probe-browser-harness.mjs
```

Latest verified outcome:

- targeted `vitest` coverage passed
- `tsc --noEmit` passed
- standalone Chromium harness probe passed for transitional `wasm32-wasip3`
- final browser probe results included:
  - `wasm32-wasip1`
    - `compile.success: true`
    - `runtime.exitCode: 0`
    - `runtime.stdout: "hi\n"`
  - richer `wasm32-wasip2`
    - `compile.success: true`
    - `runtime.exitCode: 0`
    - `runtime.stdout` contains `preview2_component=preview2-cli`
    - `runtime.stdout` contains `factorial_plus_bonus=27`
  - transitional `wasm32-wasip3`
    - `compile.success: true`
    - `runtime.exitCode: 0`
    - `runtime.stdout: "hi\n"`
- the linked `wasm-idle` localhost route also succeeded for every shipped Rust target in its synced
  manifest, including `wasm32-wasip3`

## Known limitation

The browser-hosted `rustc.wasm` worker still has intermittent LLVM-worker failures, including:

- `memory access out of bounds`
- `operation does not support unaligned accesses`

Current product behavior:

- the compiler retries transient failures up to `5` attempts
- mirrored `.no-opt.bc` recovery plus `llvm-wasm` linking is what makes the standalone browser path
  reliable enough today
- `wasm32-wasip3` is still a transitional browser target
  - toolchain and packaging work with the patched custom Rust build
  - browser execution still assumes WASIp2-style browser imports

## Next decision

- Decide whether the current transitional `wasm32-wasip3` runtime is acceptable until a browser-safe
  preview3 shim exists.
- Keep reducing the underlying browser-rustc helper/LLVM-worker failure rate so fewer compiles need
  mirrored-bitcode recovery.

## Related docs

- `README.md`
- `docs/browser-compiler.md`
- `docs/reproduction.md`
- `docs/real-rustc-history.md`
