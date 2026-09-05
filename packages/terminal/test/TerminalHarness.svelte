<script lang="ts">
	import type { RuntimeProgressEvent } from '@wasm-idle/core';
	import Terminal from '../src/Terminal.svelte';
	import type { PlaygroundBinding, TerminalControl } from '../src/types.js';

	interface Props {
		playground: PlaygroundBinding;
		onReady?: (terminal: TerminalControl) => void;
		onload?: () => void;
		onterminal?: (terminal: TerminalControl) => void;
		onprogress?: (event: RuntimeProgressEvent) => void;
	}

	let { playground, onReady, onload, onterminal, onprogress }: Props = $props();
	let terminal = $state<TerminalControl>();
	let progressLabel = $state('');
	let reportedTerminal: TerminalControl | undefined;

	$effect(() => {
		if (terminal && terminal !== reportedTerminal) {
			reportedTerminal = terminal;
			onterminal?.(terminal);
		}
	});

	function handleLoad() {
		onload?.();
		if (onReady) {
			if (!terminal) throw new Error('Terminal control was not bound before load');
			onReady(terminal);
		}
	}
</script>

<Terminal {playground} bind:terminal onload={handleLoad} />

<button
	onclick={() =>
		terminal?.run('PYTHON', 'print(1)', true, {
			report(event) {
				progressLabel = event.label || '';
				onprogress?.(event);
			}
		})}>Run with progress</button
>
<output aria-label="Runtime progress">{progressLabel}</output>
