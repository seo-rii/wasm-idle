<script lang="ts">
	import Terminal from '../src/Terminal.svelte';
	import type { PlaygroundBinding, TerminalControl } from '../src/types.js';

	interface Props {
		playground: PlaygroundBinding;
		onReady: (terminal: TerminalControl) => void;
	}

	let { playground, onReady }: Props = $props();
	let terminal = $state<TerminalControl>();

	function handleLoad() {
		if (!terminal) throw new Error('Terminal control was not bound before load');
		onReady(terminal);
	}
</script>

<Terminal {playground} bind:terminal onload={handleLoad} />
