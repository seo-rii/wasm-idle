# Consumer integration

This document describes the stable contract that a browser app should rely on when consuming
`wasm-rust`.

## What a consumer gets

`wasm-rust` exposes a browser-loadable ESM module that exports:

- `default`
- `createRustCompiler`
- `preloadBrowserRustRuntime`
- `executeBrowserRustArtifact`

Typical consumer flow:

```ts
import createRustCompiler, {
	executeBrowserRustArtifact,
	preloadBrowserRustRuntime
} from '/wasm-rust/index.js';

await preloadBrowserRustRuntime({
	targetTriple: 'wasm32-wasip2'
});
const compiler = await createRustCompiler();
const result = await compiler.compile({
	code: 'fn main() { println!("hi"); }',
	edition: '2024',
	crateType: 'bin',
	targetTriple: 'wasm32-wasip2',
	extendedTimeout: true,
	log: true
});

if (result.success && result.artifact) {
	const runtime = await executeBrowserRustArtifact(result.artifact, {
		stdin: () => '7\n'
	});
	console.log(runtime.stdout, runtime.exitCode);
}
```

`executeBrowserRustArtifact()` uses the package-local `./runtime/` bundle by default. If your app
serves those runtime assets from a different base URL, call the explicit overload instead:

```ts
await executeBrowserRustArtifact(result.artifact, runtimeBaseUrl, {
	stdin: () => '7\n'
});
```

Successful result shape:

```ts
{
  success: true,
  artifact: {
    wasm: Uint8Array,
    targetTriple: 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3',
    format: 'core-wasm' | 'component'
  }
}
```

Current supported source shape:

- single-file Rust source
- `bin` crate type
- editions `2021` and `2024`
- targets `wasm32-wasip1` and `wasm32-wasip2`
- transitional `wasm32-wasip3` when the shipped runtime bundle actually contains that target in
  `runtime-manifest.v3.json`

## Browser requirements

The compiler itself is a browser-worker runtime, not a server API. A consumer must provide:

- a cross-origin-isolated page
- `SharedArrayBuffer`
- wasm threads
- same-origin access to the nested `wasm-rust` worker/runtime assets

In practice that means:

- serve COOP/COEP correctly
- do not rewrite the worker/runtime asset URLs to a different origin without making them same-origin
  to the compiler entry module
- expect nested module workers, not `blob:` wrappers

## Runtime expectations after compile

The returned artifact is target-aware and should be executed with the matching host.

Recommended behavior:

- for `artifact.targetTriple === 'wasm32-wasip1'`
    - provide `wasi_snapshot_preview1`
    - use a stricter preview1 WASI host such as `@bjorn3/browser_wasi_shim`
- for `artifact.targetTriple === 'wasm32-wasip2'`
    - execute the component through `preview2-shim` plus `jco`-transpiled bindings
- for `artifact.targetTriple === 'wasm32-wasip3'`
    - currently execute it through the same `preview2-shim` plus `jco` transitional component path
    - this only works while emitted browser imports still stay on WASIp2 interfaces
    - if upstream starts emitting real preview3 browser imports, the consumer should reject that
      artifact until a browser-safe preview3 shim exists
- treat successful `compile()` as authoritative even if the browser console showed transient internal
  retry warnings before success

`wasm-idle` now follows this path on its Rust worker runtime.

## Retry behavior

`wasm-rust` intentionally retries transient browser-rustc failures up to five attempts.

This is currently expected product behavior, not an exceptional local workaround. A consumer should
expect to see warning logs like the following when `compile({ log: true })` is enabled:

```text
[wasm-rust] browser rustc attempt 1/5 failed; retrying
```

Important implications:

- a retry warning does not mean compile failed
- user-facing terminals should only surface the final compile failure, not recovered internal worker
  crashes
- if `compile()` returns `success: true`, the recovered path is considered valid
- when `log: true` is enabled, compile-time browser-rustc logs are returned in `result.logs`
    - `result.logRecords` exposes the same lines with preserved `level` metadata
    - consumers can forward those logs into their terminal before running the final wasm artifact
    - the browser console is no longer the only place to inspect retry and worker log lines
- when `onProgress` is provided, progress bar state should come from that callback instead of
  parsing stdout/log text
- `extendedTimeout: true` is the current public timeout knob
    - the legacy `prepare: true` alias still works, but it only means "raise the compile timeout
      floor to 120s"; it does not run a separate prewarm or preparation phase

## Stdin behavior

`wasm-rust` only produces the Rust program artifact. Line-based stdin vs EOF-based stdin is decided by
the consumer runtime and by the Rust program itself.

Two common cases:

- line-based programs using `read_line`, `Scanner`, `>>`, etc.
    - pressing Enter should be enough
- read-to-end programs using `read_to_string` or equivalent
    - the consumer should expose an EOF action such as `Ctrl+D` or a button

Concrete callback contract:

- `stdin()` should return `null` to signal EOF
- `stdin()` should return a non-empty chunk for actual input
- empty strings or empty buffers are rejected so the runtime does not spin forever waiting for more data

`wasm-idle` now documents both behaviors and uses a line-based Rust sample by default.

## Refreshing vendored assets

If a consumer vendors the built output locally, treat the whole `dist/` tree as one bundle.

In `wasm-idle`, the refresh flow is:

```bash
cd /path/to/wasm-rust
pnpm build

cd /path/to/wasm-idle
pnpm run sync:wasm-rust
```

If you need the transitional `wasm32-wasip3` target in that vendored bundle, prepare the runtime
first:

```bash
cd /path/to/wasm-rust
WASM_RUST_WASI_SDK_ROOT=/path/to/wasi-sdk-22-or-newer \
pnpm run prepare:runtime:wasip3

cd /path/to/wasm-idle
pnpm run sync:wasm-rust
```

If the browser reports stale sysroot/archive errors after a rebuild, hard refresh the page so the new
bundle version is used.

See `docs/environment-variables.md` for the packaging and validation env overrides that most often
matter during local integration.
