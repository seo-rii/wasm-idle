# wasm-rust

`wasm-rust` is a browser-loadable ESM Rust compiler module.

It is designed to be consumed by `wasm-idle`, but it also owns its own standalone browser harness and
validation flow. The compiler uses a real `rustc.wasm` frontend and a packaged `llvm-wasm`
`llc`/`lld` backend to return either a runnable preview1 core wasm artifact (`wasm32-wasip1`) or a
preview2-style component artifact (`wasm32-wasip2` and transitional `wasm32-wasip3`). An
experimental `wasm32-wasip3` pipeline is also available when the custom Rust toolchain is rebuilt
with the upstream-required `libc` patch.

## Status

- Browser compile and run works in Chromium.
- The minimal regression target `fn main() { println!("hi"); }` compiles in the browser and prints
  `hi\n`.
- Browser compile and run is verified for `wasm32-wasip1`, `wasm32-wasip2`, and transitional
  `wasm32-wasip3` when the runtime bundle was prepared from the patched custom toolchain.
- The richer `wasm32-wasip2` browser regression now covers component args/stdin output such as
  `preview2_component=preview2-cli` and `factorial_plus_bonus=27`.
- The result is returned through the `wasm-idle` browser compiler contract:
    - module exports `default`, `createRustCompiler`, `preloadBrowserRustRuntime`, and
      `executeBrowserRustArtifact`
    - factory returns `{ compile(request) }`
    - `compile()` resolves to `{ success, stdout?, stderr?, diagnostics?, logs?, logRecords?, artifact }`
    - `artifact` contains `wasm`, `targetTriple`, and `format`

Current scope:

- single-file `bin`
- editions `2021` and `2024`
- targets `wasm32-wasip1` and `wasm32-wasip2`
- experimental `wasm32-wasip3` when the shipped runtime bundle was prepared from a patched custom
  toolchain
- the default packaging target list still attempts `wasm32-wasip3`, but permissive packaging skips
  it with a warning unless the patched sysroot and compatible `wasi-sdk` are actually present
- no Cargo dependency resolution
- cross-origin-isolated browser environment required

## Quick start

Build the shipped runtime bundle:

```bash
cd /path/to/wasm-rust
pnpm build
```

`pnpm build` now auto-detects a cached `wasi-sdk >= 22` under the toolchain cache root and
`$HOME/.cache/wasm-rust*/wasi-sdk-*`, so `wasm32-wasip2` is included again on this workspace
without exporting `WASM_RUST_WASI_SDK_ROOT` manually.
The default `rustc.wasm` and `llvm-wasm` cache roots also follow `$HOME/.cache/...` unless the
matching `WASM_RUST_*` overrides are set.
The default packaging target list also includes `wasm32-wasip3`, but permissive mode only keeps it
in the emitted bundle when the patched toolchain inputs are available.

Package the dual-target runtime bundle, including `wasm32-wasip2`:

```bash
cd /path/to/wasm-rust
pnpm run prepare:runtime:wasip2
```

Set `WASM_RUST_WASI_SDK_ROOT` only when you want to override that auto-detected cache path.

Prepare the patched toolchain inputs needed for `wasm32-wasip3`:

```bash
cd /path/to/wasm-rust
pnpm run toolchain:prepare:wasip3-source
pnpm run toolchain:prepare:wasip3-libc
WASM_RUST_WASI_SDK_ROOT=/path/to/wasi-sdk-22-or-newer \
pnpm run toolchain:build:custom:wasip3 -- --foreground
WASM_RUST_WASI_SDK_ROOT=/path/to/wasi-sdk-22-or-newer \
pnpm run prepare:runtime:wasip3
```

The `wasm32-wasip3` flow is still conditional on the upstream Rust limitation documented on
2025-10-01: the Rust checkout used for the custom toolchain must already contain `wasm32-wasip3`
target support, and the build must be forced through a newer `libc` crate via the generated cargo
overlay. When `wasm32-wasip3` is requested, the build script also generates an effective
`x.py` config that updates `[build].target` and appends a `target.'wasm32-wasip3'` section from
`WASM_RUST_WASI_SDK_ROOT` if the base config does not already contain one. The same script also
prepends `WASM_RUST_WASI_SDK_ROOT/bin` to `PATH` so Rust bootstrap sanity checks can resolve
`wasm-component-ld`.

For the shortest repo-owned path, use:

```bash
cd /path/to/wasm-rust
WASM_RUST_WASI_SDK_ROOT=/path/to/wasi-sdk-22-or-newer \
pnpm run toolchain:bootstrap:wasip3 -- --foreground
WASM_RUST_WASI_SDK_ROOT=/path/to/wasi-sdk-22-or-newer \
pnpm run prepare:runtime:wasip3
```

Run the full standalone validation sequence:

```bash
cd /path/to/wasm-rust
pnpm run validate:standalone-browser
```

That command runs:

1. `pnpm run test:ci:fast`
2. `pnpm run test:ci:browser`

And `pnpm run test:ci:browser` expands to:

1. `pnpm build`
2. `pnpm run probe:browser-harness`
3. `WASM_RUST_RUN_REAL_BROWSER_HARNESS=1 pnpm exec vitest run test/browser-harness.test.ts`
4. `WASM_RUST_RUN_REAL_BROWSER_HARNESS=1 pnpm exec vitest run test/browser-playwright-integration.test.ts`

Latest verified browser result:

- `wasm32-wasip1`
    - `compile.success: true`
    - `runtime.exitCode: 0`
    - `runtime.stdout: "hi\n"`
- `wasm32-wasip2`
    - `compile.success: true`
    - `runtime.exitCode: 0`
    - `runtime.stdout` contains `preview2_component=preview2-cli`
    - `runtime.stdout` contains `factorial_plus_bonus=27`
- `wasm32-wasip3`
    - `compile.success: true`
    - `runtime.exitCode: 0`
    - `runtime.stdout: "hi\n"`

## API

The published browser module exports:

- `default`
- `createRustCompiler`
- `preloadBrowserRustRuntime`
- `executeBrowserRustArtifact`

```ts
import createRustCompiler, {
	executeBrowserRustArtifact,
	preloadBrowserRustRuntime
} from './dist/index.js';

await preloadBrowserRustRuntime({
	targetTriple: 'wasm32-wasip3'
});
const compiler = await createRustCompiler();
const result = await compiler.compile({
	code: 'fn main() { println!("hi"); }',
	edition: '2021',
	crateType: 'bin',
	targetTriple: 'wasm32-wasip3',
	onProgress(progress) {
		console.log(progress.stage, progress.percent);
	}
});

if (result.success && result.artifact) {
	const runtime = await executeBrowserRustArtifact(result.artifact, {
		stdin: () => 'input line\n'
	});
	console.log(runtime.stdout, runtime.exitCode);
}
```

`executeBrowserRustArtifact()` defaults component runtime assets to the package-local
`./runtime/` bundle. If a consumer hosts those assets elsewhere, pass an explicit third-argument
override: `executeBrowserRustArtifact(result.artifact, runtimeBaseUrl, options)`.

Result shape:

```ts
{
  success: boolean;
  stdout?: string;
  stderr?: string;
  logs?: string[];
  logRecords?: Array<{
    level: 'log' | 'warn' | 'error' | 'debug';
    message: string;
  }>;
  diagnostics?: Array<{
    lineNumber: number;
    columnNumber: number;
    severity: 'error' | 'warning' | 'other';
    message: string;
  }>;
  artifact?: {
    wasm?: Uint8Array | ArrayBuffer;
    wat?: string;
    targetTriple: 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3';
    format: 'core-wasm' | 'component';
  };
}
```

## How it works

1. `rustc.wasm` compiles Rust source in a browser worker.
2. The worker mirrors the emitted `.no-opt.bc` into shared memory.
3. `llvm-wasm` `llc` and `lld` lower and link that bitcode in the browser.
4. The final artifact is returned to the caller as either preview1 core wasm or a preview2
   component, depending on `targetTriple`.

For `wasm32-wasip3`, the current browser runtime is transitional:

- packaging and compile support are wired through the patched custom toolchain flow above
- emitted artifacts are still expected to use WASIp2-style browser imports for now
- if upstream starts emitting real preview3 browser imports, the runtime will reject them until a
  browser-safe preview3 shim exists

Important runtime notes:

- `SharedArrayBuffer` and wasm threads are required.
- The shipped browser harness serves COOP/COEP headers for that reason.
- The packaged `rustc.wasm` host injects the required `env` function shims and
  `RUST_MIN_STACK=8388608` so current browser helper threads start reliably enough to mirror LLVM
  bitcode.
- The compiler currently retries transient browser-rustc worker failures up to five attempts.
- Retry transitions are intentionally surfaced as warnings when `compile({ log: true })` is used.
- Helper-thread startup is handshake-based before a pooled worker returns its thread id. This keeps
  recovered helper-thread failures out of the normal success path when mirrored bitcode already
  exists.
- Internal worker assets are spawned as direct same-origin module workers, not `blob:` wrappers.
  This avoids deployment-only CSP failures that otherwise show up as a generic `worker script error`.
- Successful compile results are still authoritative even if one or more transient browser-rustc
  retries happened beforehand.

## Standalone browser harness

Serve the standalone harness:

```bash
cd /path/to/wasm-rust
pnpm run serve:browser-harness
```

Probe it with Chromium:

```bash
cd /path/to/wasm-rust
pnpm run probe:browser-harness
```

## Scripts

- `pnpm build`
    - builds TypeScript and prepares runtime assets under `dist/runtime/`
- `pnpm run release:upload -- --tag <tag> [asset...]`
    - uploads one or more assets to a GitHub release with `gh`, and can create the release first
- `pnpm test`
    - runs the normal test suite
- `pnpm run test:ci:browser`
    - canonical browser CI lane: `build + probe + browser vitest + browser playwright`
    - clean GitHub runners hydrate the latest release `dist/runtime` bundle first and let
      `prepare-runtime` reuse it when local toolchain caches are unavailable
- `pnpm run test:ci:browser:clean-room`
    - clean-room browser lane for CI: rebuilds only the JS bundle and validates it against a freshly
      hydrated release runtime without enabling prebuilt-runtime fallback
- `pnpm run validate:standalone-browser`
    - full repo-owned validation: `test:ci:fast` followed by `test:ci:browser`
- `pnpm run serve:browser-harness`
    - local COOP/COEP harness server
- `pnpm run probe:browser-harness`
    - Playwright Chromium probe for the harness
- `pnpm run test:browser:playwright`
    - direct Vitest integration test that launches Playwright/Chromium in-process
- `pnpm run probe:browser-rustc-llvm-wasm-split`
    - low-level browser split-pipeline probe
- `pnpm run probe:llvm-wasm-rust-split`
    - backend-only `llvm-wasm` link probe
- `pnpm run toolchain:prepare:wasip3-libc`
    - materializes a cargo-home overlay that patches Rust's build to use a newer `libc` crate for
      `wasm32-wasip3`
- `pnpm run toolchain:prepare:wasip3-source`
    - clones or updates a Rust source checkout that already contains `wasm32-wasip3` target support
- `pnpm run toolchain:build:custom:wasip3`
    - rebuilds the custom browser toolchain with `wasm32-wasip3` enabled through that cargo overlay
    - accepts `pnpm run toolchain:build:custom:wasip3 -- --foreground` when you want to block on the
      current shell instead of spawning a background build
- `pnpm run toolchain:bootstrap:wasip3`
    - runs the source-checkout preparation step and then starts the patched custom toolchain build
- `pnpm run prepare:runtime:wasip3`
    - packages a runtime bundle that includes `wasm32-wasip1`, `wasm32-wasip2`, and
      `wasm32-wasip3` by default, failing fast when the patched sysroot is missing

## GitHub release upload

Upload one or more release assets with `gh`:

```bash
cd /path/to/wasm-rust
pnpm run release:upload -- --tag v0.1.0 ./dist/runtime/runtime-manifest.v3.json
```

Create the release at the latest local commit and tag it:

```bash
cd /path/to/wasm-rust
pnpm run release:upload -- --tag v0.1.0 --create-release
```

Package `dist/` and upload it in one step:

```bash
cd /path/to/wasm-rust
pnpm run release:upload -- --tag v0.1.0 --create-release --build --pack-dist
```

Notes:

- `--create-release` tags the latest local `HEAD` commit by default.
- Use `--target <ref>` to create the release from a different commit or branch.
- Use `--repo owner/name` if `origin` does not point at the upload target.
- Use `--clobber` to replace an existing asset with the same name.

## Project layout

- `src/`
    - browser compiler, runtime, workers, and linker
- `browser-harness/`
    - standalone debug and validation page
- `scripts/`
    - reproducible probes, server, and runtime preparation
- `test/`
    - unit, integration, and browser-facing regressions
- `docs/`
    - architecture notes and reproduction details

## Documentation

- [docs/browser-compiler.md](./docs/browser-compiler.md)
    - architecture, invariants, transient browser behavior, latest browser validation evidence
- [docs/consumer-integration.md](./docs/consumer-integration.md)
    - stable browser-consumer contract, runtime expectations, retry semantics, vendored-asset refresh flow
- [docs/reproduction.md](./docs/reproduction.md)
    - exact reproduction commands, cache/toolchain expectations, environment overrides
- [docs/environment-variables.md](./docs/environment-variables.md)
    - consolidated runtime packaging, browser validation, and wasip3 bootstrap knobs
- [PROGRESS.md](./PROGRESS.md)
    - current verified state, open limitation, and next decision
- [docs/real-rustc-history.md](./docs/real-rustc-history.md)
    - historical real-rustc blocker chain and the remaining runtime limitation
