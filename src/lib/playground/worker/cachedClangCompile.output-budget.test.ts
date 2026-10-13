import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlaygroundBinding, type Sandbox } from '@wasm-idle/core';
import { createCachedClangSandbox } from '../cachedClang';
import type { RuntimeAssetCache } from '../runtimeAssetCache';
import type { ClangCompileWorkerRequest, ClangCompileWorkerResponse } from '../clangWorkerProtocol';
import { extractCompilerDiagnostics } from '../../../../packages/llvm-core/runtime/clang/src/compiler-diagnostics';

const state = vi.hoisted(() => ({
	chunks: [] as string[],
	swallowOutputErrors: false,
	prepareHeader: false,
	headerChunks: [] as string[],
	returnHeader: false,
	signals: [] as AbortSignal[],
	emissions: 0,
	compilations: 0,
	headerBuilds: 0
}));

vi.mock('@wasm-idle/llvm-core/clang', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@wasm-idle/llvm-core/clang')>();
	return {
		...actual,
		extractCompilerDiagnostics,
		resolveRuntimeManifestUrl: (base: string) => `${base}/manifest.json`,
		loadRuntimeManifest: async () => ({
			compiler: { clang: { asset: 'clang.gz' }, lld: { asset: 'lld.gz' }, sysroot: {} }
		}),
		BrowserClangRuntime: class {
			ready = Promise.resolve();
			usedPrecompiledHeader = false;
			precompiledHeaderPlan = state.prepareHeader ? {} : undefined;
			constructor(private options: { stdout(chunk: string): void; signal: AbortSignal }) {
				state.signals.push(options.signal);
			}
			async compileArtifact(_code: string, options: { language: 'C' | 'CPP' }) {
				state.compilations++;
				for (const chunk of state.chunks) {
					state.emissions++;
					try {
						this.options.stdout(chunk);
					} catch (error) {
						if (!state.swallowOutputErrors) throw error;
					}
				}
				// A valid bounded WASI module; the actual execution worker uses it below.
				return {
					bytes: Uint8Array.from([
						0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 1, 1,
						2, 7, 19, 2, 6, 109, 101, 109, 111, 114, 121, 2, 0, 6, 95, 115, 116, 97,
						114, 116, 0, 0, 10, 4, 1, 2, 0, 11
					]),
					target: 'wasm32-wasi',
					format: 'wasi-core-wasm',
					language: options.language
				};
			}
			async buildPrecompiledHeader() {
				state.headerBuilds++;
				for (const chunk of state.headerChunks) {
					try {
						this.options.stdout(chunk);
					} catch (error) {
						if (!state.swallowOutputErrors) throw error;
					}
				}
				return state.returnHeader
					? { key: 'header-key', bytes: Uint8Array.of(1, 2) }
					: undefined;
			}
		}
	};
});
vi.mock('./assets', () => ({
	configureWorkerRuntimeAssets() {},
	handleWorkerAssetMessage: () => false
}));
vi.mock('./runtimeModule', () => ({ compileWorkerRuntimeAsset: vi.fn() }));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
	state.chunks = [];
	state.swallowOutputErrors = false;
	state.prepareHeader = false;
	state.headerChunks = [];
	state.returnHeader = false;
	state.signals = [];
	state.emissions = 0;
	state.compilations = 0;
	state.headerBuilds = 0;
});

async function createHarness(language: 'C' | 'CPP' = 'C') {
	vi.stubGlobal('postMessage', vi.fn());
	vi.stubGlobal('onmessage', null);
	await import('./cachedClangCompile');
	const compile = globalThis.onmessage as unknown as (event: {
		data: ClangCompileWorkerRequest;
	}) => Promise<void>;
	await import('./cachedClangExecute');
	const execute = globalThis.onmessage as unknown as (event: { data: any }) => Promise<void>;
	const messages: ClangCompileWorkerResponse[] = [];
	const requests: ClangCompileWorkerRequest[] = [];
	const workers: TestWorker[] = [];
	const output: string[] = [];
	const diagnostics: any[] = [];
	let executing = 0;
	class TestWorker {
		onmessage: ((event: { data: unknown }) => void) | null = null;
		onerror: ((event: { message: string }) => void) | null = null;
		onmessageerror: (() => void) | null = null;
		terminations = 0;
		constructor(
			private phase: 'compile' | 'execute',
			private handle: (event: { data: any }) => Promise<void>
		) {
			workers.push(this);
		}
		terminate() {
			this.terminations++;
		}
		postMessage(data: any) {
			vi.stubGlobal('postMessage', (message: ClangCompileWorkerResponse) => {
				if (this.phase === 'compile') messages.push(message);
				queueMicrotask(() => this.onmessage?.({ data: message }));
			});
			if (this.phase === 'compile') requests.push(data);
			else executing++;
			void this.handle({ data }).catch((error) => this.onerror?.({ message: String(error) }));
		}
	}
	const legacy: Sandbox = {
		constructor: Object,
		output: (chunk) => output.push(chunk),
		oncompilerdiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		eof() {},
		async load() {},
		async run() {
			return true;
		},
		terminate() {},
		async clear() {}
	};
	const cached = createCachedClangSandbox(legacy, language, {} as RuntimeAssetCache, undefined, {
		compile: async () => {
			vi.resetModules();
			await import('./cachedClangCompile');
			const freshCompile = globalThis.onmessage as unknown as typeof compile;
			return new TestWorker('compile', freshCompile) as unknown as Worker;
		},
		execute: () => new TestWorker('execute', execute) as unknown as Worker
	});
	const binding = createPlaygroundBinding(
		{ rootUrl: 'https://assets.example/repl-v1' },
		async () => cached
	);
	const sandbox = await binding.load(language);
	await sandbox.load();
	return {
		binding,
		sandbox,
		messages,
		requests,
		workers,
		output,
		diagnostics,
		executing: () => executing
	};
}

describe('compiler output byte budget', () => {
	it('disposes an overflowing background header worker and preserves the completed foreground cache entry', async () => {
		state.chunks = ['fit'];
		state.prepareHeader = true;
		state.headerChunks = ['x'.repeat(32)];
		state.swallowOutputErrors = true;
		state.returnHeader = true;
		const harness = await createHarness('CPP');
		const code = '#include <bits/stdc++.h>\nint main() {}';
		const options = { stdin: '', limits: { maxOutputBytes: 16 } };
		try {
			await expect(
				harness.sandbox.run(code, false, false, undefined, [], options)
			).resolves.toBe(true);
			expect(state.headerBuilds).toBe(1);
			expect(harness.messages.some((message) => message.type === 'compiled')).toBe(true);
			expect(harness.messages).toContainEqual(
				expect.objectContaining({ type: 'error', code: 'output-limit' })
			);
			expect(harness.messages.some((message) => message.type === 'precompiled-header')).toBe(
				false
			);
			expect(harness.workers[0].terminations).toBe(1);
			expect(state.signals[0].aborted).toBe(true);
			state.prepareHeader = false;
			await expect(
				harness.sandbox.run(code, false, false, undefined, [], options)
			).resolves.toBe(true);
			expect(state.compilations).toBe(1);
			await expect(
				harness.sandbox.run(code + '\n', false, false, undefined, [], options)
			).resolves.toBe(true);
			expect(state.compilations).toBe(2);
			expect(harness.requests[1].precompiledHeader).toBeUndefined();
			expect(state.signals[1].aborted).toBe(false);
		} finally {
			await harness.binding.dispose();
		}
	});
	it('preserves the worker output error when the buffered prefix contains too many diagnostics', async () => {
		state.chunks = ['main.c:1:1: warning: one\nmain.c:2:1: warning: two\n', 'x'.repeat(64)];
		const harness = await createHarness();
		try {
			await expect(
				harness.sandbox.run('int main(void) {}', false, false, undefined, [], {
					stdin: '',
					limits: { maxOutputBytes: 64, maxDiagnostics: 1 }
				})
			).rejects.toMatchObject({ code: 'output-limit', phase: 'compile' });
			expect(harness.workers[0].terminations).toBe(1);
		} finally {
			await harness.binding.dispose();
		}
	});
	it.each([
		{
			chunks: ['12345678', '12345678', '12345678', 'never'],
			limit: 16,
			actual: 24,
			emissions: 3
		},
		{ chunks: ['é', '🙂', 'never'], limit: 5, actual: 6, emissions: 2 },
		{ chunks: ['', '', 'first', 'never'], limit: 1, actual: 5, emissions: 3 },
		{ chunks: ['x'.repeat(64), 'never'], limit: 16, actual: 64, emissions: 1 }
	])('stops the compiler at $actual bytes with a $limit-byte quota', async (scenario) => {
		state.chunks = scenario.chunks;
		const harness = await createHarness();
		try {
			await expect(
				harness.sandbox.run('int main(void) {}', false, false, undefined, [], {
					stdin: '',
					limits: { maxOutputBytes: scenario.limit }
				})
			).rejects.toMatchObject({
				code: 'output-limit',
				limit: scenario.limit,
				actual: scenario.actual
			});
			expect(harness.requests[0].maxOutputBytes).toBe(scenario.limit);
			expect(state.emissions).toBe(scenario.emissions);
			expect(state.signals[0].aborted).toBe(true);
			expect(harness.executing()).toBe(0);
			expect(harness.workers[0].terminations).toBe(1);
			const failure = harness.messages.find((message) => message.type === 'error');
			expect(failure).toMatchObject({
				code: 'output-limit',
				limit: scenario.limit,
				actual: scenario.actual
			});
			expect(
				new TextEncoder().encode((failure as any).stdout).byteLength
			).toBeLessThanOrEqual(scenario.limit);
			expect(harness.messages.some((message) => message.type === 'compiled')).toBe(false);
		} finally {
			await harness.binding.dispose();
		}
	});

	it('does not publish an artifact or retain a header worker when the compiler catches output errors', async () => {
		state.chunks = ['12345678', '12345678', '12345678', 'still rejected'];
		state.swallowOutputErrors = true;
		state.prepareHeader = true;
		const harness = await createHarness();
		try {
			await expect(
				harness.sandbox.run('int main(void) {}', false, false, undefined, [], {
					stdin: '',
					limits: { maxOutputBytes: 16 }
				})
			).rejects.toMatchObject({ code: 'output-limit' });
			expect(harness.messages.filter((message) => message.type === 'error')).toHaveLength(1);
			expect(harness.messages.some((message) => message.type === 'compiled')).toBe(false);
			expect(harness.workers[0].terminations).toBe(1);
			expect(state.headerBuilds).toBe(0);
		} finally {
			await harness.binding.dispose();
		}
	});

	it('recompiles after overflow, preserves bounded diagnostics and keeps cache-hit output policy', async () => {
		const warning = 'main.c:1:1: warning: retained\n';
		state.chunks = [warning, 'too much output'];
		const harness = await createHarness();
		const code = 'int main(void) { return 0; }';
		try {
			await expect(
				harness.sandbox.run(code, false, false, undefined, [], {
					stdin: '',
					limits: { maxOutputBytes: 32 }
				})
			).rejects.toMatchObject({ code: 'output-limit' });
			state.chunks = [warning];
			await expect(
				harness.sandbox.run(code, false, false, undefined, [], {
					stdin: '',
					limits: { maxOutputBytes: 32 }
				})
			).resolves.toBe(true);
			expect(state.compilations).toBe(2);
			const outputBeforeHit = harness.output.join('');
			await expect(
				harness.sandbox.run(code, false, false, undefined, [], {
					stdin: '',
					limits: { maxOutputBytes: 1 }
				})
			).resolves.toBe(true);
			expect(state.compilations).toBe(2);
			expect(harness.output.join('')).toBe(outputBeforeHit);
			expect(harness.diagnostics.at(-1)).toMatchObject({
				severity: 'warning',
				message: 'retained'
			});
			expect(harness.executing()).toBe(2);
		} finally {
			await harness.binding.dispose();
		}
	});
});
