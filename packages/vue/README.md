# @wasm-idle/vue

Vue composables around the `@wasm-idle/core` playground binding. They accept plain values or refs,
recreate the binding when either input changes, and dispose it when the owning effect scope (for
example a component) is disposed.

This package contains no runtimes or UI. `loadSandbox` is any `SandboxLoader` from
`@wasm-idle/core`: `(language) => Promise<Sandbox>`.

```bash
pnpm add @wasm-idle/vue @wasm-idle/core vue
```

Peer dependencies: `vue >= 3.4` and the matching `@wasm-idle/core` version.

## Usage

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { useWasmIdleHost } from '@wasm-idle/vue';
import { loadSandbox } from './sandboxes'; // your SandboxLoader

const props = defineProps<{ code: string }>();
const { binding } = useWasmIdleHost('https://cdn.example.com/wasm-idle', loadSandbox);
const output = ref('');

async function run() {
	output.value = '';
	const sandbox = await binding.value.load('PYTHON3');
	sandbox.output = (chunk) => (output.value += chunk);
	try {
		await sandbox.load(props.code);
		await sandbox.run(props.code, false);
	} finally {
		await sandbox.dispose?.();
	}
}
</script>

<template>
	<button @click="run">Run</button>
	<pre>{{ output }}</pre>
</template>
```

## API

- `useWasmIdlePlayground(runtimeAssets, loadSandbox)` returns a `Ref<PlaygroundBinding>`. Both
  arguments may be refs; when either value changes, a new binding is created and the previous one
  is disposed in the background.
- `useWasmIdleHost(runtimeAssets, loadSandbox)` returns that `binding` ref plus a `terminal`
  shallow ref, `setTerminal()`, a computed `terminalProps`, and `dispose()`. `dispose()` destroys
  the registered terminal and disposes the current binding, and rejects if either step fails
  (with an `AggregateError` when both fail).

When called inside an effect scope, both composables dispose their resources when the scope ends.
Outside a scope, call `host.dispose()` or `binding.value.dispose()` yourself.

`runtimeAssets` is a root URL string or a per-runtime configuration object. See the
[wasm-idle repository](https://github.com/seo-rii/wasm-idle) for the runtime asset configuration and
the [runtime execution and cleanup contract](https://github.com/seo-rii/wasm-idle/blob/main/docs/runtime-execution-contract.md).
