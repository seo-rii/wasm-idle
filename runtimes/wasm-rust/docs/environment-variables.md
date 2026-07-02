# Environment variables

This document collects the day-to-day `WASM_RUST_*` knobs that affect packaged runtime builds,
browser validation, and the optional `wasm32-wasip3` toolchain bootstrap flow.

## Runtime packaging defaults

These are the main inputs for `pnpm build` and `pnpm run prepare:runtime`.

- `WASM_RUST_RUSTC_ROOT`
    - path to the browser-hosted `rustc.wasm` install root
    - default: `$HOME/.cache/wasm-rust-real-rustc-20260317/rust/dist-emit-ir`
- `WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT`
    - matching native stage2 toolchain root used for link recipes and native metadata
    - default: `$HOME/.cache/wasm-rust-real-rustc-20260317/rust/build/x86_64-unknown-linux-gnu/stage2`
- `WASM_RUST_MATCHING_NATIVE_SYSROOT_ROOT`
    - optional override for the native sysroot lookup path
    - default: same as `WASM_RUST_RUSTC_ROOT`
- `WASM_RUST_LLVM_WASM_ROOT`
    - packaged `llvm-wasm` tool directory
    - default: `$HOME/.cache/llvm-wasm-20260319`
- `WASM_RUST_WASI_SDK_ROOT`
    - explicit `wasi-sdk >= 22` root
    - when omitted, `prepare-runtime.mjs` first tries auto-detected cache roots
- `WASM_RUST_RUNTIME_TARGET_TRIPLES`
    - comma-separated packaged targets
    - default: `wasm32-wasip1,wasm32-wasip2,wasm32-wasip3`
- `WASM_RUST_DEFAULT_TARGET_TRIPLE`
    - default compile target recorded in the manifest
    - default: `wasm32-wasip1`
- `WASM_RUST_ALLOW_MISSING_TARGETS`
    - `0` makes missing non-default targets fatal
    - default: permissive mode
- `WASM_RUST_PRECOMPRESS_SCOPES`
    - compression scopes for emitted assets
    - supported values: `all`, `none`, or comma-separated subsets such as `rustc,llvm`
- `WASM_RUST_RUNTIME_VERSION`
    - version string written into `runtime-manifest.v3.json`
- `WASM_RUST_BITCODE_FILE_NAME`
    - mirrored `.no-opt.bc` filename expected from `rustc.wasm`
- `WASM_RUST_RUSTC_MEMORY_INITIAL_PAGES`
    - packaged shared memory initial pages for `rustc.wasm`
    - default: `16384`
- `WASM_RUST_RUSTC_MEMORY_MAXIMUM_PAGES`
    - packaged shared memory maximum pages for `rustc.wasm`
    - default: `65536`
- `WASM_RUST_HOST_TRIPLE`
    - manifest host triple
- `WASM_RUST_SAMPLE_PROGRAM`
    - sample Rust source used by probes and some packaging checks

## Browser validation and harness

These control the repo-owned Chromium validation path.

- `WASM_RUST_RUN_REAL_BROWSER_HARNESS`
    - enables the real browser harness Vitest/Playwright coverage
- `WASM_RUST_BROWSER_HARNESS_TARGET_TRIPLES`
    - comma-separated targets exercised by the browser harness probe
- `WASM_RUST_BROWSER_HARNESS_COMPILE_TIMEOUT_MS`
    - compile timeout override for the harness probe
- `WASM_RUST_BROWSER_HARNESS_ARTIFACT_IDLE_MS`
    - mirrored-bitcode idle window override for the harness probe
- `WASM_RUST_BROWSER_HARNESS_INITIAL_PAGES`
    - harness-side memory initial pages override
- `WASM_RUST_BROWSER_HARNESS_MAXIMUM_PAGES`
    - harness-side memory maximum pages override
- `WASM_RUST_BROWSER_HARNESS_RUN_TIMEOUT_MS`
    - end-to-end browser probe timeout
- `WASM_RUST_CHROMIUM_EXECUTABLE`
    - explicit Chromium/Chrome binary path for local probes
- `WASM_RUST_ALLOW_PREBUILT_RUNTIME_FALLBACK`
    - disabled by default
    - when set to `1`, `prepare-runtime.mjs` may reuse an already-built `dist/runtime` bundle if all
      manifest-referenced assets are present

## wasip3 bootstrap and source patching

These are mainly relevant when rebuilding the patched toolchain.

- `WASM_RUST_INSTALL_TARGETS`
    - target list passed into the custom Rust build
- `WASM_RUST_RUST_SOURCE_REMOTE`
    - Git remote for the Rust checkout used by `toolchain:prepare:wasip3-source`
- `WASM_RUST_RUST_SOURCE_REF`
    - Git ref for that checkout
- `WASM_RUST_WASIP3_LIBC_VERSION`
    - `libc` crate version copied into the generated cargo overlay
- `WASM_RUST_WASIP3_LIBC_SOURCE`
    - optional explicit source path for that `libc` crate

## Compatibility policy

- New `pnpm build` and `pnpm run prepare:runtime` outputs publish `runtime-manifest.v3.json`.
- The runtime loader still accepts `v2` and legacy `v1` manifests only to consume already-built
  older bundles.
- New publishers and consumers should treat `v3` as the only current manifest contract.
