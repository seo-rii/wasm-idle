# @wasm-idle/core

Framework-neutral contracts and helpers for wasm-idle hosts: the `Sandbox` / `SandboxLoader`
adapter contract, `createPlaygroundBinding()`, canonical language IDs, typed runtime errors, the
structured execution request/result types and limits, and the persistent runtime asset cache. The
React, Vue, Svelte, Node, terminal, and debug packages are built on these contracts.

This package contains code only. It does not include or select language runtimes: hosts pass a
`SandboxLoader` that returns a `Sandbox` for a language, plus the runtime asset URLs those sandboxes
load from.

```bash
pnpm add @wasm-idle/core
```

## Usage

```ts
import { createPlaygroundBinding, isWasmIdleError } from '@wasm-idle/core';
import { loadSandbox } from './sandboxes'; // your SandboxLoader

const binding = createPlaygroundBinding('https://cdn.example.com/wasm-idle', loadSandbox);
const code = 'int main(void) { return 0; }';
const options = { limits: { runTimeoutMs: 10_000 } };

try {
	const sandbox = await binding.load('c'); // normalized to the canonical ID 'C'
	sandbox.output = (chunk) => console.log(chunk);
	await sandbox.load(code, false, [], options);
	const result = await sandbox.run(code, false, false, undefined, [], options);
	console.log(result === false ? 'failed' : 'ok');
} catch (error) {
	if (!isWasmIdleError(error)) throw error;
	console.error(error.code, error.phase, error.message);
} finally {
	await binding.dispose();
}
```

`binding.load(language)` normalizes the language ID, calls the loader, and returns a
`BoundSandbox` with the binding's runtime assets applied. Every sandbox call goes through one
admission boundary: execution limits, `AbortSignal` cancellation, output and diagnostic caps, and
exclusive ownership are enforced there. Sandboxes that implement `execute(request)` also accept a
structured `ExecutionRequest` and return a validated `ExecutionResult` with `stdout`, `stderr`,
`exitCode`, diagnostics, and timings. `binding.dispose()` disposes every sandbox the binding
created.

## Options worth knowing

- `createPlaygroundBinding(runtimeAssets, loadSandbox, options)`: `runtimeAssets` is a root URL
  string or a per-runtime configuration object. `options.persistentCache` overrides the runtime
  asset cache policy for this binding, `options.prewarm: true` allows explicit
  `binding.prewarm(language)` calls (nothing is warmed automatically), and `options.trustProfile`
  applies a `defineRuntimeTrustProfile()` policy.
- `SandboxExecutionOptions` (the `options` argument of `load` and `run`): `limits`, `signal`,
  `stdin`, `workspaceFiles` / `activePath`, `env`, and `interactive`. Unspecified limits fall back
  to the sandbox's own defaults and then `DEFAULT_EXECUTION_LIMITS` (for example a 30-second run
  timeout and 1 MiB of output).
- Languages: `supportedLanguageIds`, `normalizeLanguageId()`, `isSupportedLanguageId()`, and
  `getLanguageAliasInfo()` describe canonical IDs such as `PYTHON3` and aliases such as `PYTHON`.
- Errors: runtime failures are `WasmIdleError` subclasses (`CompileError`, `TimeoutError`,
  `CancelledError`, `OutputLimitError`, `AssetIntegrityError`, and others) with `code`, `phase`, and
  `recoverable` fields. Use `isWasmIdleError()` to narrow them.
- Asset cache: `configureRuntimeAssetCache()`, `getRuntimeAssetCacheStats()`,
  `clearRuntimeAssetCache()`, and `pruneRuntimeAssetCache()` control the browser cache for verified
  runtime downloads.

The runtime-specific preflight and manifest helpers (`preflight*RuntimeAssets`, `snapshot*Profile`,
and similar exports) are the verification contracts used by wasm-idle's own runtimes.

## Runtime loading helpers

Compiler hosts share bounded HTTP(S) asset loading and decompression through
`@wasm-idle/core/runtime-asset-loader` (`readBuffer`, `fetchRuntimeJson`, `decompressGzip`, and
WebAssembly compilation helpers). Cached buffers and modules are scoped to the supplied fetch
provider; cancellable loads bypass those shared caches. Hosts still verify manifest and asset
hashes before executing downloaded code.

`@wasm-idle/core/runtime-tar` exports the default `untar` function and `TarFileSystem` type for
installing regular files and directories into a host filesystem. Encoding helpers are available
from `@wasm-idle/core/runtime-encode`. These modules are shared by the GCC and LLVM packages and
contain no compiler binaries or target libraries.

## Documentation

- [Runtime execution and cleanup contract](https://github.com/seo-rii/wasm-idle/blob/main/docs/runtime-execution-contract.md)
- [Persistent runtime asset cache](https://github.com/seo-rii/wasm-idle/blob/main/docs/runtime-asset-cache.md)
- [wasm-idle repository](https://github.com/seo-rii/wasm-idle)
