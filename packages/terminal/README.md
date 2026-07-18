# @wasm-idle/terminal

Optional Svelte/xterm terminal UI for a wasm-idle playground binding. Install it only in browser
applications that render the terminal:

```bash
pnpm add wasm-idle @wasm-idle/terminal svelte
```

```svelte
<script lang="ts">
	import Terminal from '@wasm-idle/terminal';
	import { createPlaygroundBinding } from 'wasm-idle';

	const playground = createPlaygroundBinding({
		rootUrl: 'https://cdn.example.com/wasm-idle'
	});
</script>

<Terminal {playground} />
```

Compiler and language-runtime payloads are not included in this package. Configure their external
URLs through the injected playground binding.
