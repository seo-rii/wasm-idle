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

## Interactive runs

Set `interactive: true` only for a run that remains under explicit user control and has a working
stop/dispose path. The shared execution boundary then omits the wall-clock deadline only for the
final `run(..., prepare = false)` call. Runtime loading and `prepare()` keep their configured
deadlines, and AbortSignal cancellation, output/diagnostic limits, exclusive sandbox ownership, and
teardown remain enforced. wasm-idle uses this contract for Debug runs, which may stay paused at a
breakpoint indefinitely; ordinary Run requests remain time-bounded.

## Input generations

Input submitted while `prepare()` is still running remains queued for the matching `run()` when the
same language and runtime assets reuse that sandbox. `stop()`, `clear()`, `destroy()`, runtime
restart, component teardown, and a language or asset change discard queued input and EOF state
before retiring the sandbox. A later debug session therefore cannot consume stdin entered for an
older generation. Clipboard reads are asynchronous, so pasted text is accepted only if the input
generation that requested it is still current when the browser returns the clipboard contents.
