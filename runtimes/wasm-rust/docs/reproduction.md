# Reproduction

This document lists the commands and script entrypoints needed to reproduce the current
`wasm-rust` browser compiler state.

## Fast path

One command runs the standalone browser validation sequence:

```bash
cd /path/to/wasm-rust
pnpm run validate:standalone-browser
```

That script runs:

1. `pnpm run test:ci:fast`
2. `pnpm run test:ci:browser`

And `pnpm run test:ci:browser` expands to:

1. `pnpm build`
2. `pnpm run probe:browser-harness`
3. `WASM_RUST_RUN_REAL_BROWSER_HARNESS=1 pnpm exec vitest run test/browser-harness.test.ts`
4. `WASM_RUST_RUN_REAL_BROWSER_HARNESS=1 pnpm exec vitest run test/browser-playwright-integration.test.ts`

Script file:

- `scripts/validate-standalone-browser.mjs`

Latest validated outcome from that wrapper:

- `test:ci:fast` succeeds
- `test:ci:browser` succeeds
- Chromium harness probe succeeds
- Chromium Vitest harness succeeds
- final hello-world result is:
  - `compile.success: true`
  - `runtime.exitCode: 0`
  - `runtime.stdout: "hi\n"`

Observed during the same successful run:

- browser rustc attempt `1/5` may still fail with transient LLVM worker faults
- the current shipped behavior is to retry and continue once mirrored `.no-opt.bc` is available
- a `favicon.ico` `404` in the harness console is expected noise and not a product failure

## Standalone browser harness

Serve the standalone browser harness:

```bash
cd /path/to/wasm-rust
pnpm run serve:browser-harness
```

Probe it through Chromium:

```bash
cd /path/to/wasm-rust
pnpm run probe:browser-harness
```

Expected success shape:

- `success: true`
- `result.compile.success: true`
- `result.runtime.exitCode: 0`
- `result.runtime.stdout: "hi\n"`

Owned browser regression:

```bash
cd /path/to/wasm-rust
WASM_RUST_RUN_REAL_BROWSER_HARNESS=1 pnpm exec vitest run test/browser-harness.test.ts
```

Direct Playwright integration regression:

```bash
cd /path/to/wasm-rust
WASM_RUST_RUN_REAL_BROWSER_HARNESS=1 pnpm exec vitest run test/browser-playwright-integration.test.ts
```

## Split backend probes

These are still useful for deeper diagnosis.

Browser clang/lld incompatibility probe:

```bash
cd /path/to/wasm-rust
pnpm run probe:browser-clang-rust-split
```

`llvm-wasm` textual IR backend probe:

```bash
cd /path/to/wasm-rust
pnpm run probe:llvm-wasm-rust-split
```

Browser rustc + llvm-wasm split probe:

```bash
cd /path/to/wasm-rust
pnpm run probe:browser-rustc-llvm-wasm-split
```

Heavy regression for the split probe:

```bash
cd /path/to/wasm-rust
WASM_RUST_RUN_REAL_RUSTC_SPLIT_PROBE=1 \
pnpm exec vitest run test/backend-probes.test.ts \
  -t "links browser-produced Rust bitcode through llvm-wasm when the real rustc.wasm toolchain is available"
```

## Runtime packaging

Rebuild the shipped runtime assets:

```bash
cd /path/to/wasm-rust
pnpm build
```

This runs:

- `tsc -p tsconfig.json`
- `node scripts/prepare-runtime.mjs`

Rebuild a patched custom toolchain and ship a runtime bundle that also contains
`wasm32-wasip3`:

```bash
cd /path/to/wasm-rust
pnpm run toolchain:prepare:wasip3-source
pnpm run toolchain:prepare:wasip3-libc
WASM_RUST_WASI_SDK_ROOT=/path/to/wasi-sdk-22-or-newer \
pnpm run toolchain:build:custom:wasip3 -- --foreground
WASM_RUST_WASI_SDK_ROOT=/path/to/wasi-sdk-22-or-newer \
pnpm run prepare:runtime:wasip3
```

The default runtime scripts now auto-detect cached `wasi-sdk-*` directories under the toolchain
cache root and `$HOME/.cache/wasm-rust*/`. Keep `WASM_RUST_WASI_SDK_ROOT` only when you need to
override that cache path.

Important expectations for that path:

- the Rust checkout must already contain `compiler/rustc_target/src/spec/targets/wasm32_wasip3.rs`
- the build script writes an effective `x.py` config under the custom toolchain root so the build
  target list actually includes `wasm32-wasip3`
- if the base config lacks `target.'wasm32-wasip3'`, the build script appends one from
  `WASM_RUST_WASI_SDK_ROOT`
- `prepare:runtime:wasip3` packages `wasm32-wasip1`, `wasm32-wasip2`, and `wasm32-wasip3` by
  default so adding preview3 does not drop preview2 from the browser bundle

Repo-owned bootstrap shortcut:

```bash
cd /path/to/wasm-rust
WASM_RUST_WASI_SDK_ROOT=/path/to/wasi-sdk-22-or-newer \
pnpm run toolchain:bootstrap:wasip3 -- --foreground
```

The source-preparation step defaults to `https://github.com/rust-lang/rust.git` at ref `main`.

## GitHub release asset upload

Upload existing files to an existing GitHub release:

```bash
cd /path/to/wasm-rust
pnpm run release:upload -- --tag v0.1.0 ./dist/runtime/runtime-manifest.v3.json
```

Create a release from the latest local commit and tag it:

```bash
cd /path/to/wasm-rust
pnpm run release:upload -- --tag v0.1.0 --create-release
```

Create the release, build, package `dist/`, and upload the resulting tarball:

```bash
cd /path/to/wasm-rust
pnpm run release:upload -- --tag v0.1.0 --create-release --build --pack-dist
```

Useful flags:

- `--create-release`
- `--target <ref>`
- `--repo owner/name`
- `--clobber`
- `--pack-dist ./artifacts/custom-name.tgz`

`prepare-runtime.mjs` is responsible for:

- copying `rustc.wasm`
- patching the wasm memory maximum
- packing per-target sysroot and link assets
- copying `llvm-wasm`
- generating `dist/runtime/runtime-manifest.v3.json`

## Default cache roots

Unless overridden, the checked-in scripts expect:

- browser-host rustc bundle:
  - `$HOME/.cache/wasm-rust-real-rustc-20260317/rust/dist-emit-ir`
- matching native stage2 toolchain:
  - `$HOME/.cache/wasm-rust-real-rustc-20260317/rust/build/x86_64-unknown-linux-gnu/stage2`
- `llvm-wasm` cache:
  - `$HOME/.cache/llvm-wasm-20260319`

## Environment overrides

Useful overrides:

- `WASM_RUST_RUSTC_ROOT`
- `WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT`
- `WASM_RUST_LLVM_WASM_ROOT`
- `WASM_RUST_RUSTC_MEMORY_INITIAL_PAGES`
- `WASM_RUST_RUSTC_MEMORY_MAXIMUM_PAGES`
- `WASM_RUST_BROWSER_HARNESS_COMPILE_TIMEOUT_MS`
- `WASM_RUST_BROWSER_HARNESS_ARTIFACT_IDLE_MS`
- `WASM_RUST_BROWSER_HARNESS_INITIAL_PAGES`
- `WASM_RUST_BROWSER_HARNESS_MAXIMUM_PAGES`

For the broader packaging/bootstrap list, see `docs/environment-variables.md`.

## Supporting docs

- `README.md`
- `PROGRESS.md`
- `docs/consumer-integration.md`
- `docs/real-rustc-history.md`
- `docs/browser-compiler.md`
- `docs/environment-variables.md`

## wasm-idle consumer route

The linked consumer-side browser route is also reproducible:

```bash
cd /path/to/wasm-rust
pnpm build

cd /path/to/wasm-idle
pnpm run sync:wasm-rust

WASM_IDLE_BROWSER_URL='http://localhost:5173/absproxy/5173/' \
WASM_IDLE_REUSE_LOCAL_PREVIEW=1 \
node scripts/probe-rust-browser.mjs
```

Default probe behavior on the `wasm-idle` route:

- sends `5\n`
- does not send EOF unless `WASM_IDLE_RUST_SEND_EOF=1`
- expects `factorial_plus_bonus=123`
- fails if the browser route regresses back to needing EOF for the default line-based sample
