// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	supportedLanguageIds,
	type CanonicalLanguageId,
	type RuntimeProgressEvent
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';
import { RuntimeProgressController } from '../../../packages/core/src/progress.js';
import { createLoadingProgressController, type LoadingProgressState } from './loadingProgress';
import { reportWorkerProgress } from './workerProgress';

type EntryReadiness = {
	strategy: 'entry-signal';
	hostModule: string;
	producerPath: string;
};

type StaticWorkerReadiness = {
	strategy: 'static-worker-fallback';
	hostModule: string;
};

type TerminalReadiness = {
	strategy: 'terminal-fallback';
	hostModule: string;
};

type RuntimeReadinessAudit = EntryReadiness | StaticWorkerReadiness | TerminalReadiness;

/**
 * This is deliberately exhaustive: adding a supported language requires an explicit decision
 * about the earliest truthful readiness boundary. `terminal-fallback` means that the runtime ABI
 * currently exposes no exact entry callback, so output, stdin, debugger pause, or the final result
 * is the first safe user-visible readiness signal.
 */
const runtimeReadinessAudit = {
	C: { strategy: 'terminal-fallback', hostModule: 'clang' },
	CPP: { strategy: 'terminal-fallback', hostModule: 'clang' },
	OBJC: { strategy: 'terminal-fallback', hostModule: 'objectivec' },
	PYTHON3: {
		strategy: 'entry-signal',
		hostModule: 'python',
		producerPath: 'src/lib/playground/worker/python.ts'
	},
	JAVA: {
		strategy: 'entry-signal',
		hostModule: 'java',
		producerPath: 'src/lib/playground/worker/java.ts'
	},
	RUST: { strategy: 'terminal-fallback', hostModule: 'rust' },
	GO: { strategy: 'terminal-fallback', hostModule: 'go' },
	D: { strategy: 'terminal-fallback', hostModule: 'd' },
	CSHARP: { strategy: 'terminal-fallback', hostModule: 'dotnet' },
	FSHARP: { strategy: 'terminal-fallback', hostModule: 'dotnet' },
	VBNET: { strategy: 'terminal-fallback', hostModule: 'dotnet' },
	ELIXIR: {
		strategy: 'entry-signal',
		hostModule: 'elixir',
		producerPath: 'src/lib/playground/worker/elixir.ts'
	},
	ERLANG: {
		strategy: 'entry-signal',
		hostModule: 'elixir',
		producerPath: 'src/lib/playground/worker/elixir.ts'
	},
	PROLOG: { strategy: 'static-worker-fallback', hostModule: 'prolog' },
	GLEAM: { strategy: 'static-worker-fallback', hostModule: 'gleam' },
	PERL: { strategy: 'static-worker-fallback', hostModule: 'perl' },
	TCL: { strategy: 'static-worker-fallback', hostModule: 'tcl' },
	AWK: { strategy: 'static-worker-fallback', hostModule: 'awk' },
	PASCAL: { strategy: 'static-worker-fallback', hostModule: 'pascal' },
	FORTH: { strategy: 'static-worker-fallback', hostModule: 'forth' },
	J: { strategy: 'static-worker-fallback', hostModule: 'j' },
	BQN: { strategy: 'static-worker-fallback', hostModule: 'bqn' },
	JANET: { strategy: 'static-worker-fallback', hostModule: 'janet' },
	JULIA: { strategy: 'static-worker-fallback', hostModule: 'julia' },
	NIM: { strategy: 'static-worker-fallback', hostModule: 'nim' },
	BASH: {
		strategy: 'entry-signal',
		hostModule: 'bash',
		producerPath: 'src/lib/playground/worker/bashRuntime.ts'
	},
	CLOJURESCRIPT: {
		strategy: 'static-worker-fallback',
		hostModule: 'clojurescript'
	},
	FORTRAN: { strategy: 'terminal-fallback', hostModule: 'fortran' },
	COBOL: { strategy: 'terminal-fallback', hostModule: 'cobol' },
	TINYGO: {
		strategy: 'entry-signal',
		hostModule: 'tinygo',
		producerPath: 'src/lib/playground/worker/tinygo.ts'
	},
	OCAML: { strategy: 'terminal-fallback', hostModule: 'ocaml' },
	JAVASCRIPT: {
		strategy: 'entry-signal',
		hostModule: 'typescript',
		producerPath: 'src/lib/playground/worker/typescript.ts'
	},
	TYPESCRIPT: {
		strategy: 'entry-signal',
		hostModule: 'typescript',
		producerPath: 'src/lib/playground/worker/typescript.ts'
	},
	ASSEMBLYSCRIPT: {
		strategy: 'entry-signal',
		hostModule: 'assemblyscript',
		producerPath: 'src/lib/playground/worker/assemblyscript.ts'
	},
	WAT: {
		strategy: 'entry-signal',
		hostModule: 'wat',
		producerPath: 'src/lib/playground/worker/wat.ts'
	},
	WASM: {
		strategy: 'entry-signal',
		hostModule: 'wasm',
		producerPath: 'src/lib/playground/worker/wasm.ts'
	},
	LUA: {
		strategy: 'entry-signal',
		hostModule: 'lua',
		producerPath: 'src/lib/playground/worker/lua.ts'
	},
	ZIG: {
		strategy: 'entry-signal',
		hostModule: 'zig',
		producerPath: 'src/lib/playground/worker/zig.ts'
	},
	LISP: {
		strategy: 'entry-signal',
		hostModule: 'lisp',
		producerPath: 'src/lib/playground/worker/lisp.ts'
	},
	RUBY: {
		strategy: 'entry-signal',
		hostModule: 'ruby',
		producerPath: 'src/lib/playground/worker/ruby.ts'
	},
	HASKELL: { strategy: 'terminal-fallback', hostModule: 'haskell' },
	R: {
		strategy: 'entry-signal',
		hostModule: 'r',
		producerPath: 'src/lib/playground/worker/r.ts'
	},
	OCTAVE: {
		strategy: 'entry-signal',
		hostModule: 'octave',
		producerPath: 'static/wasm-octave/runner-worker.js'
	},
	DUCKDB: {
		strategy: 'entry-signal',
		hostModule: 'duckdb',
		producerPath: 'src/lib/playground/worker/duckdb.ts'
	},
	SQLITE: {
		strategy: 'entry-signal',
		hostModule: 'sqlite',
		producerPath: 'src/lib/playground/worker/sqlite.ts'
	},
	PHP: {
		strategy: 'entry-signal',
		hostModule: 'php',
		producerPath: 'src/lib/playground/worker/php.ts'
	}
} as const satisfies Record<CanonicalLanguageId, RuntimeReadinessAudit>;

const readProjectSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const sorted = (values: readonly string[]) =>
	[...values].sort((left, right) => left.localeCompare(right));

describe('runtime progress readiness audit', () => {
	it('classifies every supported language exactly once, including Haskell', () => {
		expect(sorted(Object.keys(runtimeReadinessAudit))).toEqual(sorted(supportedLanguageIds));
		expect(Object.keys(runtimeReadinessAudit)).toHaveLength(46);
		expect(runtimeReadinessAudit.HASKELL).toEqual({
			strategy: 'terminal-fallback',
			hostModule: 'haskell'
		});

		const strategyCounts = Object.values(runtimeReadinessAudit).reduce<Record<string, number>>(
			(counts, row) => ({ ...counts, [row.strategy]: (counts[row.strategy] ?? 0) + 1 }),
			{}
		);
		expect(strategyCounts).toEqual({
			'entry-signal': 20,
			'static-worker-fallback': 13,
			'terminal-fallback': 13
		});
	});

	it('keeps every audited language connected to its declared playground host', () => {
		const playgroundIndexSource = readProjectSource('src/lib/playground/index.ts');
		for (const languageId of supportedLanguageIds) {
			const row = runtimeReadinessAudit[languageId];
			expect(playgroundIndexSource).toContain(`languageId: '${languageId}'`);
			expect(playgroundIndexSource).toContain(`import('$lib/playground/${row.hostModule}')`);
		}
	});

	it('forwards exact execution-entry signals from their producer through each host', () => {
		for (const [languageId, row] of Object.entries(runtimeReadinessAudit)) {
			if (row.strategy !== 'entry-signal') continue;
			const producerSource = readProjectSource(row.producerPath);
			const hostSource = readProjectSource(`src/lib/playground/${row.hostModule}.ts`);

			expect(producerSource, `${languageId} producer must emit ready`).toMatch(
				/kind:\s*['"]ready['"]/u
			);
			expect(producerSource, `${languageId} producer must identify execution start`).toMatch(
				/reason:\s*['"]started['"]/u
			);
			expect(
				hostSource,
				`${languageId} host must forward structured worker progress`
			).toContain('reportWorkerProgress');
		}
	});

	it('routes the 13 standalone workers through run-correlated readiness fallbacks', () => {
		const staticRuntimeSource = readProjectSource('src/lib/playground/staticWorkerRuntime.ts');
		for (const [languageId, row] of Object.entries(runtimeReadinessAudit)) {
			if (row.strategy !== 'static-worker-fallback') continue;
			const hostSource = readProjectSource(`src/lib/playground/${row.hostModule}.ts`);
			expect(
				hostSource,
				`${languageId} must use the shared static worker lifecycle`
			).toContain('extends StaticWorkerRuntimeSandbox');
		}

		expect(staticRuntimeSource).toContain("type?: 'execution-ready' | 'stdin-request'");
		expect(staticRuntimeSource).toContain('if (event.data?.runId !== activeRun.id) return;');
		expect(staticRuntimeSource).toContain("'stdin-request'");
		expect(staticRuntimeSource).toContain("'result'");
		expect(staticRuntimeSource).toContain('this.reportRunSettled(');
	});

	it('keeps ABI-limited runtimes wired to stdin and terminal-level safe fallbacks', () => {
		const workerProgressSource = readProjectSource('src/lib/playground/workerProgress.ts');
		for (const [languageId, row] of Object.entries(runtimeReadinessAudit)) {
			if (row.strategy !== 'terminal-fallback') continue;
			const hostSource = readProjectSource(`src/lib/playground/${row.hostModule}.ts`);
			expect(
				/reportWorkerInputReady|reason:\s*['"]stdin-request['"]/u.test(hostSource),
				`${languageId} host must convert a runtime input request into readiness`
			).toBe(true);
		}
		expect(workerProgressSource).toMatch(/reason:\s*['"]stdin-request['"]/u);
	});

	it('limits output readiness to ABI fallbacks while keeping debugger and terminal fallbacks common', () => {
		const terminalSource = readProjectSource('packages/terminal/src/Terminal.svelte');
		const outputFallbackStart = terminalSource.indexOf(
			'const terminalOutputReadinessLanguages'
		);
		const outputFallbackEnd = terminalSource.indexOf(']);', outputFallbackStart);
		const outputFallbackSource = terminalSource.slice(outputFallbackStart, outputFallbackEnd);
		expect(terminalSource).toContain('writeTerminalOutput(output.replaceAll');
		for (const [languageId, row] of Object.entries(runtimeReadinessAudit)) {
			const outputFallbackEntry = `'${languageId}'`;
			if (row.strategy === 'terminal-fallback') {
				expect(
					outputFallbackSource,
					`${languageId} must retain the safe output fallback`
				).toContain(outputFallbackEntry);
			} else {
				expect(
					outputFallbackSource,
					`${languageId} must wait for its structured readiness path`
				).not.toContain(outputFallbackEntry);
			}
		}
		expect(terminalSource).toContain("reason: 'stdout'");
		expect(terminalSource).toContain("reason: 'debug-paused'");
		expect(terminalSource).toContain("reason: 'result'");
		expect(terminalSource).toContain("kind: 'settled'");
		expect(terminalSource).toContain("outcome: 'completed'");
		expect(terminalSource).toContain("options.signal?.aborted ? 'cancelled' : 'failed'");
		expect(terminalSource).toMatch(
			/function activityOnlyProgress\([\s\S]+event\.kind === 'activity'[\s\S]+progress\.report\?\.\(event\)/u
		);
	});
});

describe('estimated progress presentation contract', () => {
	it('shows numeric and phase estimates while preserving valid measured byte ratios', () => {
		const states: LoadingProgressState[] = [];
		const controller = createLoadingProgressController({
			onChange: (state) => states.push(state)
		});
		const progress = controller.start('Starting runtime');
		expect(states.at(-1)).toMatchObject({ visible: true, value: 0, indeterminate: false });

		progress.set?.(0.2, 'Initializing compiler');
		expect(states.at(-1)).toMatchObject({
			visible: true,
			value: 0.2,
			stage: 'Initializing compiler',
			indeterminate: false
		});

		progress.report?.({
			kind: 'activity',
			phase: 'compiling',
			label: 'Compiling program'
		});
		expect(states.at(-1)).toMatchObject({ value: 0.75, indeterminate: false });

		progress.report?.({
			kind: 'activity',
			phase: 'downloading',
			phaseId: 'runtime-assets',
			label: 'Downloading runtime',
			measurement: { kind: 'bytes', completed: 25, total: 100 }
		});
		expect(states.at(-1)).toMatchObject({ value: 0.25, indeterminate: false });

		progress.report?.({
			kind: 'activity',
			phase: 'initializing',
			label: 'Initializing runtime'
		});
		expect(states.at(-1)).toMatchObject({ value: 0.65, indeterminate: false });
	});

	it.each([false, true])(
		'preserves worker percentages through runtime lifecycles (nested: %s) until actual readiness',
		(nested) => {
			const states: LoadingProgressState[] = [];
			const controller = createLoadingProgressController({
				onChange: (state) => states.push(state)
			});
			const terminal = new RuntimeProgressController().begin(
				'terminal-1',
				controller.start()
			);
			const runtime = nested
				? new RuntimeProgressController().begin('runtime-1', terminal.progress)
				: terminal;

			for (const [percent, expected] of [
				[20, 0.2],
				[75, 0.75],
				[100, 0.99]
			]) {
				const stage = `Preparing runtime: ${percent}%`;
				reportWorkerProgress(runtime.progress, { percent, stage });
				expect(states.at(-1)).toEqual({
					visible: true,
					value: expected,
					stage,
					indeterminate: false
				});
			}

			reportWorkerProgress(runtime.progress, {
				kind: 'ready',
				state: 'running',
				reason: 'started'
			});
			expect(states.at(-1)).toEqual({
				visible: false,
				value: 0,
				stage: '',
				indeterminate: false
			});
		}
	);

	it('hides at every safe ready fallback and at every settlement outcome', () => {
		const readyEvents: Extract<RuntimeProgressEvent, { kind: 'ready' }>[] = [
			{ kind: 'ready', state: 'running', reason: 'started' },
			{ kind: 'ready', state: 'running', reason: 'stdout' },
			{ kind: 'ready', state: 'running', reason: 'stderr' },
			{ kind: 'ready', state: 'waiting-input', reason: 'stdin-request' },
			{ kind: 'ready', state: 'paused', reason: 'debug-paused' },
			{ kind: 'ready', state: 'running', reason: 'result' }
		];
		const settledOutcomes = ['completed', 'failed', 'cancelled', 'timed-out'] as const;

		for (const terminalEvent of [
			...readyEvents,
			...settledOutcomes.map(
				(outcome) => ({ kind: 'settled', outcome }) as const satisfies RuntimeProgressEvent
			)
		]) {
			const states: LoadingProgressState[] = [];
			const controller = createLoadingProgressController({
				onChange: (state) => states.push(state)
			});
			controller.start().report?.(terminalEvent);
			expect(states.at(-1)).toEqual({
				visible: false,
				value: 0,
				stage: '',
				indeterminate: false
			});
		}
	});

	it('publishes determinate asset progress only after every total is known', () => {
		const assetBridgeSource = readProjectSource('src/lib/playground/assetBridge.ts');
		expect(assetBridgeSource).toContain('allTotalsKnown && !this.measurementInvalid');
		expect(assetBridgeSource).toContain("kind: 'bytes'");
		expect(assetBridgeSource).toContain('completed: completedBytes, total: totalBytes');
	});
});
