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

## Stop lifecycle

`TerminalControl.stop()` does not resolve until the active sandbox's `kill()` or `terminate()`
operation resolves. Sandbox implementations may return either `void` or `Promise<void>` from those
methods; an asynchronous implementation must keep its promise pending until runtime resources are
released.

The C/C++ and Rust LLDB sandboxes use this contract to wait for both LLDB and WAMR worker teardown.
Callers can therefore await `stop()` before launching another debug session without overlapping the
previous session's workers or receiving its late events.
