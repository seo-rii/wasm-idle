# @wasm-idle/node

Node.js host helpers for wasm-idle sandboxes. They load a sandbox through a `@wasm-idle/core`
playground binding, run one program with optional stdin, stream its output, and clean the sandbox
up afterwards.

This package does not include or select runtimes. Pass a `loadSandbox` function that returns
Node-capable `Sandbox` implementations, or an existing `playground` binding.

```bash
pnpm add @wasm-idle/node @wasm-idle/core
```

## Usage

```ts
import { executeWasmIdleInNode, fileAssetUrl, runWasmIdleInNode } from '@wasm-idle/node';
import { loadSandbox } from './sandboxes'; // your Node-capable SandboxLoader

const runtimeAssets = fileAssetUrl('/opt/wasm-idle/runtimes');

// Legacy load/run path: output is streamed, failures are returned rather than thrown.
const run = await runWasmIdleInNode({
	language: 'PYTHON3',
	code: 'print(input().upper())',
	stdin: 'hello\n',
	runtimeAssets,
	loadSandbox
});
if (!run.ok) process.exitCode = 1;

// Structured path: requires a sandbox that implements execute().
const result = await executeWasmIdleInNode({
	language: 'PYTHON3',
	request: { code: 'print(input().upper())', stdin: 'hello\n' },
	runtimeAssets,
	loadSandbox
});
console.log(result.exitCode, result.stdout);
```

## API

- `runWasmIdleInNode(options)` loads the sandbox, writes `stdin` followed by EOF when provided, and
  runs `code`. It resolves to `{ ok, result, elapsedMs, error?, cleanupErrors? }`: a runtime failure
  is written to `stderr` and returned with the original error in `error`. Errors from the loader
  itself still reject.
- `executeWasmIdleInNode(options)` calls the sandbox's structured `execute(request)` and resolves to
  its `ExecutionResult`. It rejects with the original error on failure, or with a
  `NodeExecutionCleanupError` (an `AggregateError` whose `cause` is the original error) when cleanup
  also failed. A sandbox without `execute()` rejects with `RuntimeConfigurationError`.
- `fileAssetUrl(path)` converts a local path into a `file:` URL string for `runtimeAssets`.

## Options worth knowing

- Provide either `playground` (an existing `PlaygroundBinding`, whose lifetime stays with you) or
  `loadSandbox` with optional `runtimeAssets`.
- Sandbox output goes to the `stdout` callback (default `process.stdout`); failure messages go to
  the `stderr` callback (default `process.stderr`).
- For `runWasmIdleInNode`, `args`, `executionOptions`, `log`, and `progress` are forwarded to the
  sandbox's `load()` and `run()` calls.
- The sandbox is disposed after each call unless `disposeAfterRun: false`. `runWasmIdleInNode`
  can also clear it first with `clearAfterRun: true`. Cleanup failures are reported in
  `cleanupErrors` instead of replacing a returned result.

See the [wasm-idle repository](https://github.com/seo-rii/wasm-idle) for the runtime contracts and
the [runtime execution and cleanup contract](https://github.com/seo-rii/wasm-idle/blob/main/docs/runtime-execution-contract.md).
