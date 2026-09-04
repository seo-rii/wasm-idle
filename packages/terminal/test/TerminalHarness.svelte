<script lang="ts">
	import Terminal from '../src/Terminal.svelte';
	import type { PlaygroundBinding, TerminalControl } from '../src/types.js';

	interface Props {
		playground: PlaygroundBinding;
		onload: () => void;
		onterminal: (terminal: TerminalControl) => void;
	}

	let { playground, onload, onterminal }: Props = $props();
	let terminal = $state<TerminalControl>();
	let reportedTerminal: TerminalControl | undefined;

	$effect(() => {
		if (terminal && terminal !== reportedTerminal) {
			reportedTerminal = terminal;
			onterminal(terminal);
		}
	});
</script>

<Terminal {playground} {onload} bind:terminal />
