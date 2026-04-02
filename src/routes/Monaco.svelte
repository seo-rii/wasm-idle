<script lang="ts">
	import { attachMonacoDebugActions, MonacoDebugView } from '$lib';
	import type { ClangdSession as ClangdSessionType } from '$lib/clangd/session';
	import type { ClangdStatus } from '$lib/clangd/config';
	import type { DebugLanguageAdapter } from '$lib/debug/language';
	import type {
		CompilerDiagnostic,
		DebugVariable,
		RustTargetTriple
	} from '$lib/playground/options';
	import type monaco from 'monaco-editor';
	import { onMount } from 'svelte';
	import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
	import {
		isEditorDefaultSource,
		isLegacyEditorDefaultSource,
		resolveEditorDefaultSource
	} from './editor-defaults';

	export const value = () => editor?.getValue() || '';

	let divEl: HTMLDivElement | null = $state(null);
	let clangdStatus = $state<ClangdStatus>({ state: 'disabled' });
	let session: ClangdSessionType | null = null;
	let model: monaco.editor.ITextModel | null = null;
	let clangdSessionVersion = 0;
	let debugView = $state<MonacoDebugView | null>(null);
	interface Props {
		editor: monaco.editor.IStandaloneCodeEditor | null;
		language: any;
		rustTargetTriple?: RustTargetTriple;
		clangdEnabled?: boolean;
		clangdBaseUrl?: string;
		breakpoints?: number[];
		debugLocals?: DebugVariable[];
		debugLanguage?: DebugLanguageAdapter | null;
		compilerDiagnostics?: CompilerDiagnostic[];
		pausedLine?: number | null;
		onCursorLineChange?: (line: number | null) => void;
		onRunToCursor?: (line: number | null) => void;
		onBreakpointsChange?: (lines: number[]) => void;
	}

	let {
		editor = $bindable(),
		language,
		rustTargetTriple = 'wasm32-wasip1',
		clangdEnabled = false,
		clangdBaseUrl,
		breakpoints = [],
		debugLocals = [],
		debugLanguage = null,
		compilerDiagnostics = [],
		pausedLine = null,
		onCursorLineChange,
		onRunToCursor,
		onBreakpointsChange
	}: Props = $props();
	let Monaco: typeof monaco | null = null;

	$effect(() => {
		if (!debugView) return;
		debugView.setBreakpoints(debugLanguage ? breakpoints : []);
		debugView.setPauseState(debugLanguage ? pausedLine : null, debugLocals, debugLanguage);
	});

	$effect(() => {
		if (language !== 'cpp' || !editor || !clangdEnabled || !clangdBaseUrl) {
			session?.dispose();
			session = null;
			clangdStatus = { state: 'disabled' };
			return;
		}
		if (session || !Monaco) return;

		let cancelled = false;
		let nextSession: ClangdSessionType | null = null;
		const nextSessionVersion = ++clangdSessionVersion;

		(async () => {
			try {
				const { ClangdSession } = await import('$lib/clangd/session');
				if (cancelled || !Monaco) return;
				nextSession = new ClangdSession(Monaco, clangdBaseUrl, (status) => {
					if (!cancelled) clangdStatus = status;
				});
				const previousModel = editor.getModel();
				const previousModelUri = previousModel?.uri.toString();
				const nextModel = nextSession.createModel(editor.getValue());
				session = nextSession;
				model = nextModel;
				editor.setModel(nextModel);
				if (previousModel && previousModelUri !== nextModel.uri.toString()) {
					previousModel.dispose();
				}
				await nextSession.start();
			} catch (error) {
				if (cancelled) return;
				nextSession?.dispose();
				if (clangdSessionVersion === nextSessionVersion) session = null;
				clangdStatus = {
					state: 'error',
					message: error instanceof Error ? error.message : String(error)
				};
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const monacoApi = Monaco;
		if (!monacoApi || !editor) return;
		const activeModel = model || editor.getModel();
		if (!activeModel) return;
			const markers =
				language === 'java' || language === 'rust' || language === 'go'
					? compilerDiagnostics.map((diagnostic) => ({
						severity:
							diagnostic.severity === 'warning'
								? monacoApi.MarkerSeverity.Warning
								: diagnostic.severity === 'other'
									? monacoApi.MarkerSeverity.Info
									: monacoApi.MarkerSeverity.Error,
						message: diagnostic.message,
						startLineNumber: Math.max(1, diagnostic.lineNumber || 1),
						startColumn: Math.max(1, diagnostic.columnNumber || 1),
						endLineNumber: Math.max(1, diagnostic.lineNumber || 1),
						endColumn: Math.max(
							1,
							diagnostic.endColumnNumber || diagnostic.columnNumber || 2
						)
					}))
				: [];
		monacoApi.editor.setModelMarkers(activeModel, 'wasm-idle-compiler', markers);
	});

	$effect(() => {
		if (!editor) return;
		const currentValue = editor.getValue();
		if (!isEditorDefaultSource(currentValue) && !isLegacyEditorDefaultSource(currentValue)) {
			return;
		}
		const nextValue = resolveEditorDefaultSource(
			language as 'cpp' | 'python' | 'java' | 'go' | 'rust',
			rustTargetTriple
		);
		if (currentValue !== nextValue) {
			editor.setValue(nextValue);
		}
	});

	onMount(() => {
		let disposed = false;
		let debugActionBindings: { dispose(): void } | null = null;
		// @ts-ignore
		self.MonacoEnvironment = {
			getWorker: function (_moduleId: any, label: string) {
				return new editorWorker();
			}
		};

		import('monaco-editor').then(async (m) => {
			if (disposed) return;
			Monaco = m;
			const defaultValue = resolveEditorDefaultSource(
				language as 'cpp' | 'python' | 'java' | 'go' | 'rust',
				rustTargetTriple
			);
			if (language === 'cpp') {
				editor = Monaco.editor.create(divEl!, {
					value: defaultValue,
					language,
					automaticLayout: true,
					occurrencesHighlight: 'off',
					glyphMargin: true
				});
				debugView = new MonacoDebugView(Monaco, editor, onBreakpointsChange);
				debugView.setBreakpoints(breakpoints);
				debugView.setPauseState(pausedLine, debugLocals, debugLanguage);
				debugActionBindings = attachMonacoDebugActions(editor, {
					onCursorLineChange,
					onRunToCursor
				});
				clangdStatus = { state: 'disabled' };
				return;
			}
			clangdStatus = { state: 'disabled' };
			editor = Monaco.editor.create(divEl!, {
				value: defaultValue,
				language,
				automaticLayout: true,
				occurrencesHighlight: 'off',
				glyphMargin: !!debugLanguage
			});
			if (debugLanguage) {
				debugView = new MonacoDebugView(Monaco, editor, onBreakpointsChange);
				debugView.setBreakpoints(breakpoints);
				debugView.setPauseState(pausedLine, debugLocals, debugLanguage);
				debugActionBindings = attachMonacoDebugActions(editor, {
					onCursorLineChange,
					onRunToCursor
				});
			}
		});

		return () => {
			disposed = true;
			session?.dispose();
			session = null;
			debugActionBindings?.dispose();
			debugActionBindings = null;
			debugView?.dispose();
			debugView = null;
			const activeModel = model || editor?.getModel();
			if (Monaco && activeModel)
				Monaco.editor.setModelMarkers(activeModel, 'wasm-idle-compiler', []);
			model?.dispose();
			model = null;
			editor?.dispose();
		};
	});
</script>

<main>
	<div bind:this={divEl} class="editor-host"></div>
</main>

<style>
	main {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		border-left: 1px solid #e5e7eb;
		position: relative;
		overflow: hidden;
	}

	.editor-host {
		flex: 1;
		min-height: 0;
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

	@media (max-width: 960px) {
		main {
			min-height: 360px;
			border-left: 0;
			border-top: 1px solid #e5e7eb;
		}
	}
</style>
