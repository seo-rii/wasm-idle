# @wasm-idle/react

React hooks around the `@wasm-idle/core` playground binding. They create a binding for your
runtime assets and sandbox loader, and dispose it when the component unmounts.

This package contains no runtimes or UI. `loadSandbox` is any `SandboxLoader` from
`@wasm-idle/core`: `(language) => Promise<Sandbox>`.

```bash
pnpm add @wasm-idle/react @wasm-idle/core react
```

Peer dependencies: `react >= 18` and the matching `@wasm-idle/core` version.

## Usage

```tsx
import { useState } from 'react';
import { useWasmIdlePlayground } from '@wasm-idle/react';
import { loadSandbox } from './sandboxes'; // your SandboxLoader

// Keep both hook arguments referentially stable: a new value replaces the binding.
const runtimeAssets = 'https://cdn.example.com/wasm-idle';

export function RunPython({ code }: { code: string }) {
	const playground = useWasmIdlePlayground(runtimeAssets, loadSandbox);
	const [output, setOutput] = useState('');

	async function run() {
		setOutput('');
		const sandbox = await playground.load('PYTHON3');
		sandbox.output = (chunk) => setOutput((previous) => previous + chunk);
		try {
			await sandbox.load(code);
			await sandbox.run(code, false);
		} finally {
			await sandbox.dispose?.();
		}
	}

	return (
		<>
			<button onClick={run}>Run</button>
			<pre>{output}</pre>
		</>
	);
}
```

## API

- `useWasmIdlePlayground(runtimeAssets, loadSandbox)` returns a `PlaygroundBinding`. The binding is
  memoized on both arguments; when either changes identity, or the component unmounts, the
  previous binding and every sandbox it created are disposed.
- `useWasmIdleHost(runtimeAssets, loadSandbox)` returns the same binding plus terminal state:
  `terminal` / `terminalRef` hold the current `TerminalControl`, `setTerminal()` registers one,
  `terminalProps` is the binding's `{ playground, runtimeAssets, trustProfile }` object, and
  `dispose()` destroys the terminal and then disposes the binding. The registered terminal is also
  destroyed on unmount.

Define `runtimeAssets` (a root URL string or per-runtime configuration object) and `loadSandbox` at
module scope or memoize them; an inline object literal creates a new binding on every render.

See the [wasm-idle repository](https://github.com/seo-rii/wasm-idle) for the runtime asset
configuration and the [runtime execution and cleanup contract](https://github.com/seo-rii/wasm-idle/blob/main/docs/runtime-execution-contract.md).
