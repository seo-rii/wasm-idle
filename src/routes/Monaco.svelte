<script lang="ts">
	import { MonacoDebugView } from '$lib';
	import type { ClangdSession as ClangdSessionType } from '$lib/clangd/session';
	import type { ClangdStatus } from '$lib/clangd/config';
	import type { DebugLanguageAdapter } from '$lib/debug/language';
	import type { DebugVariable } from '$lib/playground/options';
	import type monaco from 'monaco-editor';
	import { onMount } from 'svelte';
	import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

	export const value = () => editor?.getValue() || '';

	const defaults: Record<'cpp' | 'python', string> = {
		cpp: `#include <stdio.h>

int add_one(int value) {
    return value + 1;
}

int main() {
    int sum = add_one(9);
    printf("sum=%d\\n", sum);
}`,
		python: `values = [1, 2, 3, 4]
print(f"sum={sum(values)}")`
	};

	let divEl: HTMLDivElement | null = $state(null);
	let clangdStatus = $state<ClangdStatus>({ state: 'disabled' });
	let session: ClangdSessionType | null = null;
	let model: monaco.editor.ITextModel | null = null;
	let debugView = $state<MonacoDebugView | null>(null);
	interface Props {
		editor: monaco.editor.IStandaloneCodeEditor | null;
		language: any;
		clangdBaseUrl?: string;
		breakpoints?: number[];
		debugLocals?: DebugVariable[];
		debugLanguage?: DebugLanguageAdapter | null;
		pausedLine?: number | null;
		onBreakpointsChange?: (lines: number[]) => void;
	}

	let {
		editor = $bindable(),
		language,
		clangdBaseUrl,
		breakpoints = [],
		debugLocals = [],
		debugLanguage = null,
		pausedLine = null,
		onBreakpointsChange
	}: Props = $props();
	let Monaco: typeof monaco | null = null;
	let clangdLabel = $derived.by(() => {
		if (clangdStatus.state === 'ready') return 'clangd ready';
		if (clangdStatus.state === 'error') return `clangd failed: ${clangdStatus.message}`;
		if (clangdStatus.state === 'loading') {
			if (clangdStatus.total && clangdStatus.loaded) {
				return `clangd loading ${Math.min(100, Math.round((clangdStatus.loaded / clangdStatus.total) * 100))}%`;
			}
			return 'clangd loading';
		}
		return '';
	});

	$effect(() => {
		if (!debugView) return;
		debugView.setBreakpoints(debugLanguage ? breakpoints : []);
		debugView.setPauseState(debugLanguage ? pausedLine : null, debugLocals, debugLanguage);
	});

	onMount(() => {
		let disposed = false;
		// @ts-ignore
		self.MonacoEnvironment = {
			getWorker: function (_moduleId: any, label: string) {
				return new editorWorker();
			}
		};

		import('monaco-editor').then(async (m) => {
			if (disposed) return;
			Monaco = m;
			const defaultValue = defaults[language as keyof typeof defaults] || '';
			if (language === 'cpp') {
				const { ClangdSession } = await import('$lib/clangd/session');
				editor = Monaco.editor.create(divEl!, {
					value: defaultValue,
					language,
					automaticLayout: true,
					glyphMargin: true
				});
				debugView = new MonacoDebugView(Monaco, editor, onBreakpointsChange);
				debugView.setBreakpoints(breakpoints);
				debugView.setPauseState(pausedLine, debugLocals, debugLanguage);
				if (!clangdBaseUrl) {
					clangdStatus = { state: 'disabled' };
					return;
				}
				session = new ClangdSession(Monaco, clangdBaseUrl, (status) => {
					if (!disposed) clangdStatus = status;
				});
				model = session.createModel(defaultValue);
				editor.setModel(model);
				try {
					await session.start();
				} catch (error) {
					if (!disposed) {
						clangdStatus = {
							state: 'error',
							message: error instanceof Error ? error.message : String(error)
						};
					}
				}
				return;
			}
			clangdStatus = { state: 'disabled' };
			editor = Monaco.editor.create(divEl!, {
				value: defaultValue,
				language,
				automaticLayout: true,
				glyphMargin: !!debugLanguage
			});
			if (debugLanguage) {
				debugView = new MonacoDebugView(Monaco, editor, onBreakpointsChange);
				debugView.setBreakpoints(breakpoints);
				debugView.setPauseState(pausedLine, debugLocals, debugLanguage);
			}
		});

		return () => {
			disposed = true;
			session?.dispose();
			session = null;
			debugView?.dispose();
			debugView = null;
			model?.dispose();
			model = null;
			editor?.dispose();
		};
	});
</script>

<main>
	{#if language === 'cpp' && clangdStatus.state !== 'disabled'}
		<div class="clangd-status" data-state={clangdStatus.state}>
			{clangdLabel}
		</div>
	{/if}
	<div bind:this={divEl} class="editor-host h-screen"></div>
</main>

<style>
	main {
		flex: 1;
		border-left: 1px solid #e5e7eb;
		position: relative;
	}

	.editor-host {
		height: 100%;
	}

	.clangd-status {
		position: absolute;
		top: 10px;
		right: 10px;
		z-index: 100;
		font-size: 12px;
		padding: 6px 10px;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.82);
		color: white;
		backdrop-filter: blur(8px);
	}

	.clangd-status[data-state='ready'] {
		background: rgba(6, 95, 70, 0.88);
	}

	.clangd-status[data-state='error'] {
		background: rgba(153, 27, 27, 0.9);
		max-width: 280px;
	}

	:global(.monaco-editor .debug-breakpoint-glyph) {
		background: #dc2626;
		border-radius: 999px;
		margin-left: 5px;
		width: 10px !important;
		height: 10px !important;
	}

	:global(.debug-paused-line-widget) {
		background: rgba(37, 99, 235, 0.16);
		box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.12);
		border-radius: 3px;
		pointer-events: none;
	}

	:global(.monaco-editor .debug-inline-values) {
		color: #475569;
		font-style: italic;
		font-weight: 500;
	}
</style>
