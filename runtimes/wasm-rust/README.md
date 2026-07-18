# wasm-rust

`wasm-rust` is a browser-loadable ESM module around the full upstream Rust 1.99 compiler produced by
`wasm-llvm/producer/rust-browser`. The browser-hosted `rustc.wasm` contains its matching LLVM 22
code generator and in-process LLD; it does not use the historical split `llvm-wasm` `llc`/`lld`
backend and is not a handwritten parser, interpreter, or language subset.

It is designed to be consumed by `wasm-idle`, but it also owns a standalone Chromium harness and
validation flow. `wasm32-wasip1` returns a runnable Preview 1 core Wasm module. `wasm32-wasip2` and
`wasm32-wasip3` are compiled by the same rustc and component-encoded for browser execution.

## Status

- Browser compile and run works in Chromium.
- Browser compile, stdin, and execution are verified in Chromium for `wasm32-wasip1`,
  `wasm32-wasip2`, and `wasm32-wasip3` from the receipt-backed producer bundle.
- The standalone stdin regression reads to EOF and verifies exact `PRODUCER STDIN\n` output for all
  three targets. The wasm-idle page regression separately verifies line-based stdin, component
  args, target-specific output, and lazy runtime loading.
- The result is returned through the `wasm-idle` browser compiler contract:
    - module exports `default`, `createRustCompiler`, `preloadBrowserRustRuntime`, and
      `executeBrowserRustArtifact`
    - factory returns `{ compile(request) }`
    - `compile()` resolves to `{ success, stdout?, stderr?, diagnostics?, logs?, logRecords?, artifact }`
    - `artifact` contains `wasm`, `targetTriple`, and `format`

The compiler is upstream rustc rather than a reduced language implementation. The current browser
API accepts one `bin` source file, editions `2021` or `2024`, and the three bundled WASI targets. It
does not yet expose Cargo dependency resolution or a multi-file crate graph. A cross-origin-isolated
browser environment is required for Rust compiler threads.

`pnpm run build:js` also emits `dist/debug-instrumenter.js`, a self-contained browser ESM asset.
It bundles the Lezer Rust parser at producer build time so browser hosts can fetch source
instrumentation only when a debug execution starts; consumers do not install `@lezer/rust`.

## Quick start

Build the canonical compiler from pinned source and package its attested output:

```bash
cd /path/to/wasm-llvm
npm run producer:rust:verify
WASM_LLVM_RUST_BROWSER_WORK_DIR=/path/to/work NINJA_JOBS=8 \
  npm run producer:rust:build

cd /path/to/wasm-idle/runtimes/wasm-rust
WASM_RUST_PRODUCER_OUTPUT_ROOT=/path/to/work/output \
  pnpm run build:producer
```

For a no-cache audit, use `producer:rust:container-rebuild` with a new empty work directory. The
consumer rejects any output whose receipt, exact file set, source and submodule pins, patch hashes,
tool versions, or environment differs from `producer-lock.json`. The older split-backend packaging
commands remain for historical recovery and are documented in `docs/reproduction.md`; they are not
the canonical source build.

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
    - `runtime.stdout: "PRODUCER STDIN\n"`
- `wasm32-wasip2`
    - `compile.success: true`
    - `runtime.exitCode: 0`
    - `runtime.stdout: "PRODUCER STDIN\n"`
- `wasm32-wasip3`
    - `compile.success: true`
    - `runtime.exitCode: 0`
    - `runtime.stdout: "PRODUCER STDIN\n"`

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

1. The receipt-backed `rustc.wasm` compiles Rust source in a browser worker with its integrated
   LLVM 22 code generator.
2. Rust compiler helper workers share `/work` and `/tmp` through a bounded `SharedArrayBuffer`
   workspace so temporary objects and metadata are visible to the main rustc instance.
3. The WASI rustc invokes its statically linked LLD entry point and emits `/work/main.wasm`.
4. Preview 1 returns that core module. Preview 2 and Preview 3 pass it through the bundled component
   tooling and return a component artifact.

For `wasm32-wasip3`, the current browser runtime is transitional:

- packaging and compile support come from the same receipt-backed integrated rustc producer as the
  Preview 1 and Preview 2 targets
- emitted artifacts are still expected to use WASIp2-style browser imports for now
- if upstream starts emitting real preview3 browser imports, the runtime will reject them until a
  browser-safe preview3 shim exists

Important runtime notes:

- `SharedArrayBuffer` and wasm threads are required.
- The shipped browser harness serves COOP/COEP headers for that reason.
- The runtime manifest defaults the shared compiler workspace to 128 MiB through
  `workerSharedWorkspaceBytes`; deployments can raise it when compiling unusually large sources.
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
    - builds TypeScript and the debug instrumenter asset, then prepares the historical split-backend
      runtime under `dist/runtime/`
- `pnpm run build:producer`
    - builds TypeScript and packages the pinned, receipt-verified integrated rustc producer output
- `pnpm run release:upload -- --tag <tag> [asset...]`
    - uploads one or more assets to a GitHub release with `gh`, and can create the release first
- `pnpm test`
    - runs the normal test suite
- `pnpm run test:ci:browser`
    - split-backend compatibility lane: `build + probe + browser vitest + browser playwright`
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

The following `wasip3` toolchain scripts belong to the historical split-backend path. They are not
inputs to `build:producer` or evidence for the receipt-backed integrated runtime:

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
