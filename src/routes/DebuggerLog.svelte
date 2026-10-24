<script lang="ts">
	import type { DebugSessionEvent } from '@wasm-idle/core';

	type Diagnostic = Readonly<Extract<DebugSessionEvent, { type: 'output' }>>;
	let {
		diagnostics,
		importantDiagnostic
	}: {
		diagnostics: readonly Diagnostic[];
		importantDiagnostic: Diagnostic | null;
	} = $props();
</script>

{#if diagnostics.length}
	<section class="debugger-log" aria-label="Debugger log">
		{#if importantDiagnostic}
			<pre class="debugger-log__important" role="alert">{importantDiagnostic.output}</pre>
		{/if}
		<details data-testid="debugger-log">
			<summary>Debugger log</summary>
			<pre data-testid="debugger-log-output">{#each diagnostics as entry (entry)}<span
						class={{ 'debugger-log__important': entry.category === 'important' }}
						>{entry.output}</span
					>{/each}</pre>
		</details>
	</section>
{/if}

<style>
	.debugger-log {
		flex: none;
		min-width: 0;
		padding: 8px 12px;
		border-radius: var(--radius-md);
		background: var(--surface-muted);
		color: var(--text-2);
		font-size: 12px;
	}

	summary {
		cursor: pointer;
		font-weight: 600;
	}

	pre {
		max-height: 160px;
		margin: 8px 0 0;
		overflow: auto;
		font-family: var(--mono);
		font-size: 12px;
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	pre.debugger-log__important {
		max-height: 80px;
		margin: 0 0 8px;
	}

	.debugger-log__important {
		color: var(--danger-text, #b0202d);
	}
</style>
