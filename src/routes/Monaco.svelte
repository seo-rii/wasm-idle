<script lang="ts">
	import { MonacoDebugView } from '$lib';
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

	export const value = () => editor?.getValue() || '';

	const defaults: Record<'cpp' | 'python' | 'java', string> = {
		cpp: `#include <iostream>

int bonus = 3;

int factorial(int n) {
    return n <= 1 ? 1 : n * factorial(n - 1);
}

int main() {
    int n = 4;
    if (!(std::cin >> n)) n = 4;
    std::cout << "factorial_plus_bonus=" << factorial(n) + bonus << "\\n";
}`,
		python: `import sys

BONUS = 3

def factorial(n):
    return 1 if n <= 1 else n * factorial(n - 1)

tokens = sys.stdin.read().split()
n = int(tokens[0]) if tokens else 4
print(f"factorial_plus_bonus={factorial(n) + BONUS}")`,
		java: `import java.util.Scanner;

public class Main {
    static int bonus = 3;

    static int factorial(int n) {
        return n <= 1 ? 1 : n * factorial(n - 1);
    }

    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int n = scanner.hasNextInt() ? scanner.nextInt() : 4;
        System.out.println("factorial_plus_bonus=" + (factorial(n) + bonus));
    }
		}`
	};

	const rustDefaults: Record<RustTargetTriple, string> = {
		'wasm32-wasip1': `use std::io;

static BONUS: i32 = 3;

fn factorial(n: i32) -> i32 {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}

fn main() {
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    println!("factorial_plus_bonus={}", factorial(n) + BONUS);
}`,
		'wasm32-wasip2': `#[cfg(not(target_env = "p2"))]
compile_error!("This example requires wasm32-wasip2.");

use std::env;
use std::io;

// Pass an optional label through Args to prove preview2 CLI args are wired.
static BONUS: i32 = 3;

fn factorial(n: i32) -> i32 {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}

fn main() {
    let preview2_label = env::args().nth(1).unwrap_or_else(|| "preview2-cli".to_string());
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    let n = input.trim().parse::<i32>().unwrap_or(4);
    println!("preview2_component={}", preview2_label);
    println!("factorial_plus_bonus={}", factorial(n) + BONUS);
}`
	};

	let divEl: HTMLDivElement | null = $state(null);
	let clangdStatus = $state<ClangdStatus>({ state: 'disabled' });
	let session: ClangdSessionType | null = null;
	let model: monaco.editor.ITextModel | null = null;
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
				if (
					previousModel &&
					previousModel !== nextModel &&
					previousModelUri !== nextModel.uri.toString()
				) {
					previousModel.dispose();
				}
				await nextSession.start();
			} catch (error) {
				if (cancelled) return;
				nextSession?.dispose();
				if (session === nextSession) session = null;
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
			language === 'java' || language === 'rust'
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
		if (!editor || language !== 'rust') return;
		const currentValue = editor.getValue();
		if (
			currentValue !== rustDefaults['wasm32-wasip1'] &&
			currentValue !== rustDefaults['wasm32-wasip2']
		) {
			return;
		}
		const nextValue = rustDefaults[rustTargetTriple];
		if (currentValue !== nextValue) {
			editor.setValue(nextValue);
		}
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
			const defaultValue =
				language === 'rust'
					? rustDefaults[rustTargetTriple]
					: defaults[language as keyof typeof defaults] || '';
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
			}
		});

		return () => {
			disposed = true;
			session?.dispose();
			session = null;
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
