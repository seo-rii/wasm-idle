# @wasm-idle/svelte

Svelte helpers around the `@wasm-idle/core` playground binding: a host object that owns the binding
and a terminal store, with cleanup that can be tied to a component's lifecycle.

This package contains no runtimes or UI. `loadSandbox` is any `SandboxLoader` from
`@wasm-idle/core`: `(language) => Promise<Sandbox>`. For a terminal component, see
`@wasm-idle/terminal`.

```bash
pnpm add @wasm-idle/svelte @wasm-idle/core svelte
```

Peer dependencies: `svelte ^5.0.0` and the matching `@wasm-idle/core` version.

## Usage

```svelte
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { createSvelteWasmIdleHost } from '@wasm-idle/svelte';
	import { loadSandbox } from './sandboxes'; // your SandboxLoader

	let { code }: { code: string } = $props();
	let output = $state('');
	const host = createSvelteWasmIdleHost('https://cdn.example.com/wasm-idle', loadSandbox, {
		registerDispose: onDestroy
	});

	async function run() {
		output = '';
		const sandbox = await host.binding.load('PYTHON3');
		sandbox.output = (chunk) => (output += chunk);
		try {
			await sandbox.load(code);
			await sandbox.run(code, false);
		} finally {
			await sandbox.dispose?.();
		}
	}
</script>

<button onclick={run}>Run</button>

<pre>{output}</pre>
```

## API

- `createSvelteWasmIdleHost(runtimeAssets, loadSandbox, options?)` returns `binding`, a `terminal`
  writable store, `setTerminal()`, `terminalProps`, and `dispose()`. `dispose()` destroys the
  registered terminal and then disposes the binding and every sandbox it created.
- `options.registerDispose` receives the host's cleanup callback. Pass `onDestroy` (from `svelte`)
  to dispose the host with the component; otherwise call `host.dispose()` yourself.
- `createSveltePlaygroundBinding(runtimeAssets, loadSandbox)` returns a plain `PlaygroundBinding`
  without terminal state or lifecycle registration; call `binding.dispose()` when finished.

`runtimeAssets` is a root URL string or a per-runtime configuration object. See the
[wasm-idle repository](https://github.com/seo-rii/wasm-idle) for the runtime asset configuration and
the [runtime execution and cleanup contract](https://github.com/seo-rii/wasm-idle/blob/main/docs/runtime-execution-contract.md).
