<script lang="ts">
	import Terminal from '../src/Terminal.svelte';
	import type { PlaygroundBinding, TerminalControl } from '../src/types.js';

	interface Props {
		playground: PlaygroundBinding;
		onReady?: (terminal: TerminalControl) => void;
		onload?: () => void;
		onterminal?: (terminal: TerminalControl) => void;
	}

	let { playground, onReady, onload, onterminal }: Props = $props();
	let terminal = $state<TerminalControl>();
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
