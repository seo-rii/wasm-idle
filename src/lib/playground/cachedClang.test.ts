import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Sandbox, SandboxExecutionOptions, SandboxRuntimeAssets } from '@wasm-idle/core';
import { createPlaygroundBinding } from '@wasm-idle/core';
import type { BrowserClangArtifact } from '@wasm-idle/llvm-core/clang';

import type { RuntimeAssetCache } from './runtimeAssetCache';
const bridges = vi.hoisted(() => ({
	instances: [] as {
		worker: Worker;
		cache: unknown;
		config: any;
		handleMessage: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	}[]
}));
vi.mock('./assetBridge', () => ({
	WorkerAssetBridge: class {
		handleMessage = vi.fn(() => false);
		dispose = vi.fn();
		constructor(
			public worker: Worker,
			_runtime: unknown,
			public config: unknown,
			_progress: unknown,
			_limit: unknown,
			_profiles: unknown,
			public cache: unknown
		) {
			bridges.instances.push(this);
		}
	}
}));

import { createCachedClangSandbox } from './cachedClang';
import { CompiledArtifactCache } from './compiledArtifactCache';

const assets = { rootUrl: 'https://assets.example/repl-v1' };
const source = 'int main(void) { return 0; }';

type WorkerMessage = Record<string, any>;
type WorkerBehavior = (worker: FakeWorker, message: WorkerMessage) => void;

class FakeWorker {
	onmessage: ((event: { data: WorkerMessage }) => void) | null = null;
	onerror: ((event: { message: string }) => void) | null = null;
	onmessageerror: (() => void) | null = null;
	messages: WorkerMessage[] = [];
	terminate = vi.fn();

	constructor(private behavior: WorkerBehavior) {}

	postMessage(message: WorkerMessage) {
		// Real workers reject reactive Proxy arrays/records at this boundary.
		structuredClone(message);
		this.messages.push(message);
		queueMicrotask(() => {
			if (!this.terminate.mock.calls.length) this.behavior(this, message);
		});
	}

	respond(data: WorkerMessage) {
		this.onmessage?.({ data });
	}
}

function makeLegacy() {
	return {
		load: vi.fn(async () => {}),
		run: vi.fn(async () => true),
		clear: vi.fn(async () => {}),
		terminate: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
		write: vi.fn(),
		eof: vi.fn(),
		output: vi.fn(),
		oncompilerdiagnostic: vi.fn<(diagnostic: any) => void>()
	} satisfies Sandbox;
}

function makeHarness(cache = new CompiledArtifactCache(), language: 'C' | 'CPP' = 'C') {
	const compileWorkers: FakeWorker[] = [];
	const executionWorkers: FakeWorker[] = [];
	const artifact: BrowserClangArtifact = {
		bytes: new Uint8Array([0, 97, 115, 109]),
		target: 'wasm32-wasi',
		format: 'wasi-core-wasm',
		language
	};
	const behavior = {
		compile: ((worker) => worker.respond({ type: 'compiled', artifact })) as WorkerBehavior,
		execute: ((worker) => worker.respond({ type: 'done', exitCode: 0 })) as WorkerBehavior
	};
	const factories = {
		compile() {
			const worker = new FakeWorker((...args) => behavior.compile(...args));
			compileWorkers.push(worker);
			return worker as unknown as Worker;
		},
		execute() {
			const worker = new FakeWorker((...args) => behavior.execute(...args));
			executionWorkers.push(worker);
			return worker as unknown as Worker;
		}
	};
	const legacy = makeLegacy();
	const runtimeCache = {} as RuntimeAssetCache;
	const sandbox = createCachedClangSandbox(legacy, language, runtimeCache, cache, factories);
	return {
		sandbox,
		runtimeCache,
		legacy,
		cache,
		factories,
		behavior,
		artifact,
		compileWorkers,
		executionWorkers
	};
}

async function run(
	sandbox: Pick<Sandbox, 'run'>,
	code = source,
	options: SandboxExecutionOptions = {},
	prepare = false
) {
	return sandbox.run(code, prepare, false, undefined, [], options);
}

describe('cached C/C++ sandbox', () => {
	it('forwards compile warnings on misses and replays immutable diagnostics on hits', async () => {
		const h = makeHarness();
		const warning = {
			fileName: 'main.c',
			lineNumber: 2,
			severity: 'warning',
			message: 'unused value'
		};
		h.behavior.compile = (worker) =>
			worker.respond({ type: 'compiled', artifact: h.artifact, diagnostics: [warning] });
		await h.sandbox.load(assets);
		await run(h.sandbox);
		expect(h.legacy.oncompilerdiagnostic).toHaveBeenCalledWith(warning);
		h.legacy.oncompilerdiagnostic.mock.calls[0][0].message = 'caller changed the warning';
		await run(h.sandbox);
		expect(h.compileWorkers).toHaveLength(1);
		expect(h.legacy.oncompilerdiagnostic).toHaveBeenLastCalledWith(warning);
		expect(h.legacy.oncompilerdiagnostic).toHaveBeenCalledTimes(2);
	});

	it('delivers structured errors when compilation fails and does not cache the failure', async () => {
		const h = makeHarness();
		const diagnostic = {
			fileName: 'main.c',
			lineNumber: 1,
			severity: 'error',
			message: 'expected expression'
		};
		h.behavior.compile = (worker) =>
			worker.respond({ type: 'error', error: 'compile failed', diagnostics: [diagnostic] });
		await h.sandbox.load(assets);
		await expect(run(h.sandbox)).rejects.toThrow('compile failed');
		expect(h.legacy.oncompilerdiagnostic).toHaveBeenCalledWith(diagnostic);
		expect(h.cache.stats().entries).toBe(0);
		expect(h.executionWorkers).toHaveLength(0);
	});

	it('enforces the core diagnostic ceiling on both misses and cached warning replays', async () => {
		const h = makeHarness();
		const diagnostics = [1, 2].map((lineNumber) => ({
			lineNumber,
			severity: 'warning',
			message: 'warning'
		}));
		h.behavior.compile = (worker) =>
			worker.respond({ type: 'compiled', artifact: h.artifact, diagnostics });
		const binding = createPlaygroundBinding(assets, async () => h.sandbox);
		const bound = await binding.load('C');
		await bound.load();
		await expect(run(bound, source, { limits: { maxDiagnostics: 1 } })).rejects.toMatchObject({
			code: 'diagnostic-limit'
		});
		expect(h.executionWorkers).toHaveLength(0);
		await run(bound, source, { limits: { maxDiagnostics: 2 } });
		expect(h.compileWorkers).toHaveLength(2);
		expect(h.executionWorkers).toHaveLength(1);
		await expect(run(bound, source, { limits: { maxDiagnostics: 1 } })).rejects.toMatchObject({
			code: 'diagnostic-limit'
		});
		expect(h.compileWorkers).toHaveLength(2);
		expect(h.executionWorkers).toHaveLength(1);
		await binding.dispose();
	});

	it('forwards memory ceilings on cache misses and hits and recompiles when the ceiling changes', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets, '', false, [], { limits: { maxWasmMemoryBytes: 4 * 65536 } });
		await run(h.sandbox, source, { limits: { maxWasmMemoryBytes: 2 * 65536 } });
		await run(h.sandbox, source, { limits: { maxWasmMemoryBytes: 2 * 65536 } });
		expect(h.compileWorkers).toHaveLength(1);
		expect(h.compileWorkers[0].messages[0].request.maxWasmMemoryBytes).toBe(2 * 65536);
		for (const worker of h.executionWorkers) {
			expect(worker.messages[0].maxWasmMemoryBytes).toBe(2 * 65536);
		}
		await run(h.sandbox, source, { limits: { maxWasmMemoryBytes: 8 * 65536 } });
		expect(h.compileWorkers).toHaveLength(2);
		expect(h.compileWorkers[1].messages[0].request.maxWasmMemoryBytes).toBe(4 * 65536);
		expect(h.executionWorkers[2].messages[0].maxWasmMemoryBytes).toBe(4 * 65536);
	});

	it('uses one-call persistent overrides without mutating the load baseline', async () => {
		const h = makeHarness();
		await h.sandbox.load({ ...assets, persistentCache: { enabled: true, maxBytes: 4096 } });
		await run(h.sandbox, source, { persistentCache: false }, true);
		expect(h.compileWorkers[0].messages[0].persistentCache).toMatchObject({
			enabled: false,
			maxBytes: 4096
		});
		expect(bridges.instances.at(-1)?.config.persistentCache).toMatchObject({
			enabled: false,
			maxBytes: 4096
		});
		await run(h.sandbox, `${source}\n`, {}, true);
		expect(h.compileWorkers[1].messages[0].persistentCache).toMatchObject({
			enabled: true,
			maxBytes: 4096
		});
		expect(bridges.instances.at(-1)?.config.persistentCache).toMatchObject({
			enabled: true,
			maxBytes: 4096
		});
		await run(h.sandbox, source, { debug: true, persistentCache: false });
		expect(h.legacy.load).toHaveBeenLastCalledWith(
			expect.anything(),
			source,
			false,
			[],
			expect.objectContaining({
				persistentCache: expect.objectContaining({ enabled: true, maxBytes: 4096 })
			}),
			undefined
		);
		expect(h.legacy.run).toHaveBeenLastCalledWith(
			source,
			false,
			false,
			undefined,
			[],
			expect.objectContaining({ persistentCache: false })
		);
	});
	it('disposal is terminal and waits for legacy cleanup on every call', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets);
		let finish!: () => void;
		h.legacy.dispose.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const disposing = h.sandbox.dispose!();
		expect(h.sandbox.dispose!()).toBe(disposing);
		await expect(run(h.sandbox)).rejects.toThrow(/disposed/);
		await expect(h.sandbox.load(assets)).rejects.toThrow(/disposed/);
		finish();
		await disposing;
		expect(h.legacy.dispose).toHaveBeenCalledOnce();
	});
	it('keeps artifacts across clear/dispose and a new sandbox while every run gets a fresh worker', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets);
		await run(h.sandbox);
		await h.sandbox.clear();
		await run(h.sandbox);
		await h.sandbox.dispose?.();

		const next = createCachedClangSandbox(
			makeLegacy(),
			'C',
			h.runtimeCache,
			h.cache,
			h.factories
		);
		await next.load(assets);
		await run(next);

		expect(h.compileWorkers).toHaveLength(1);
		expect(h.executionWorkers).toHaveLength(3);
		expect(new Set(h.executionWorkers).size).toBe(3);
		for (const worker of [...h.compileWorkers, ...h.executionWorkers]) {
			expect(worker.terminate).toHaveBeenCalledExactlyOnceWith();
		}
		expect(h.legacy.dispose).toHaveBeenCalledOnce();
		expect(h.cache.stats().entries).toBe(1);
	});

	it('prepare compiles once and later execution reuses that artifact', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets);
		await run(h.sandbox, source, {}, true);
		expect(h.compileWorkers).toHaveLength(1);
		expect(h.executionWorkers).toHaveLength(0);
		await run(h.sandbox);
		expect(h.compileWorkers).toHaveLength(1);
		expect(h.executionWorkers[0].messages[0].artifact).toBe(h.artifact);
	});

	it('snapshots reactive arrays and records for both compiler and executor workers', async () => {
		const h = makeHarness();
		const compileArgs = new Proxy(['-DVALUE=3'], {});
		const programArgs = new Proxy(['one'], {});
		const file = new Proxy({ path: 'value.h', content: '#define VALUE 3' }, {});
		const workspaceFiles = new Proxy([file], {});
		const env = new Proxy({ MODE: 'test' }, {});
		const options = new Proxy({ compileArgs, programArgs, workspaceFiles, env }, {});
		expect(() => structuredClone(compileArgs)).toThrow();
		await h.sandbox.load(assets);
		await run(h.sandbox, source, options);
		await run(h.sandbox, source, options);
		expect(h.compileWorkers).toHaveLength(1);
		expect(h.compileWorkers[0].messages[0].request).toMatchObject({
			compileArgs: ['-DVALUE=3'],
			workspaceFiles: [{ path: 'value.h', content: '#define VALUE 3' }]
		});
		expect(h.executionWorkers[0].messages[0]).toMatchObject({
			programArgs: ['one'],
			env: { MODE: 'test' },
			workspaceFiles: [{ path: 'value.h', content: '#define VALUE 3' }]
		});
	});

	it('snapshots legacy positional compile arguments that are reactive arrays', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets);
		await h.sandbox.run(source, true, false, undefined, new Proxy(['-O2'], {}));
		expect(h.compileWorkers[0].messages[0].request.compileArgs).toEqual(['-O2']);
	});

	it('uses one input snapshot across asynchronous compilation and execution', async () => {
		const h = makeHarness();
		const options = {
			activePath: 'main.c',
			stdin: 'before',
			compileArgs: ['-DVALUE=3'],
			programArgs: ['before'],
			env: { MODE: 'before' },
			workspaceFiles: [{ path: 'value.h', content: 'before' }]
		};
		h.behavior.compile = (worker) => {
			options.activePath = 'changed.c';
			options.stdin = 'after';
			options.compileArgs[0] = '-DVALUE=9';
			options.programArgs[0] = 'after';
			options.env.MODE = 'after';
			options.workspaceFiles[0].content = 'after';
			worker.respond({ type: 'compiled', artifact: h.artifact });
		};
		await h.sandbox.load(assets);
		await run(h.sandbox, source, options);
		expect(h.executionWorkers[0].messages[0]).toMatchObject({
			activePath: 'main.c',
			stdin: 'before',
			programArgs: ['before'],
			env: { MODE: 'before' },
			workspaceFiles: [{ path: 'value.h', content: 'before' }]
		});
		expect(h.compileWorkers[0].messages[0].request.compileArgs).toEqual(['-DVALUE=3']);
	});

	it.each([
		['source', `${source}\n`, {}],
		['compile options', source, { compileArgs: ['-O2'] }],
		['language standard', source, { cVersion: 'c11' }],
		['active file', source, { activePath: 'other.c' }],
		['workspace', source, { workspaceFiles: [{ path: 'value.h', content: '#define VALUE 2' }] }]
	] satisfies [string, string, SandboxExecutionOptions][])(
		'recompiles when %s changes',
		async (_name, code, options) => {
			const h = makeHarness();
			await h.sandbox.load(assets);
			await run(h.sandbox);
			await run(h.sandbox, code, options);
			expect(h.compileWorkers).toHaveLength(2);
		}
	);

	it('does not reuse an artifact from another runtime base URL or language', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets);
		await run(h.sandbox);
		await h.sandbox.load({ rootUrl: 'https://assets.example/repl-v2' });
		await run(h.sandbox);
		const cpp = createCachedClangSandbox(
			makeLegacy(),
			'CPP',
			h.runtimeCache,
			h.cache,
			h.factories
		);
		await cpp.load(assets);
		await run(cpp);
		expect(h.compileWorkers).toHaveLength(3);
		expect(h.compileWorkers.map((worker) => worker.messages[0].runtimeBaseUrl)).toEqual([
			'https://assets.example/repl-v1/clang/',
			'https://assets.example/repl-v2/clang/',
			'https://assets.example/repl-v1/clang/'
		]);
	});

	it('reuses compilation when only stdin, environment or program arguments change', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets);
		await run(h.sandbox, source, { stdin: '1', programArgs: ['one'], env: { MODE: 'first' } });
		await run(h.sandbox, source, { stdin: '2', programArgs: ['two'], env: { MODE: 'second' } });
		expect(h.compileWorkers).toHaveLength(1);
		expect(h.executionWorkers[1].messages[0]).toMatchObject({
			stdin: '2',
			programArgs: ['two'],
			env: { MODE: 'second' }
		});
	});

	it('preserves compilation diagnostics without caching a failed build', async () => {
		const h = makeHarness();
		h.behavior.compile = (worker) =>
			worker.respond({
				type: 'error',
				error: 'compile failed',
				stdout: 'context',
				stderr: 'error'
			});
		await h.sandbox.load(assets);
		await expect(run(h.sandbox)).rejects.toThrow('compile failed');
		expect(h.cache.stats().entries).toBe(0);
		expect(h.legacy.output.mock.calls).toEqual([['context'], ['error']]);
		h.behavior.compile = (worker) => worker.respond({ type: 'compiled', artifact: h.artifact });
		await run(h.sandbox);
		expect(h.compileWorkers).toHaveLength(2);
		expect(h.cache.stats().entries).toBe(1);
	});

	it('terminates an in-flight compilation without caching a late result', async () => {
		const h = makeHarness();
		h.behavior.compile = () => {};
		await h.sandbox.load(assets);
		const pending = run(h.sandbox);
		const rejection = expect(pending).rejects.toThrow('Process terminated');
		await h.sandbox.terminate();
		await rejection;
		h.compileWorkers[0].respond({ type: 'compiled', artifact: h.artifact });
		expect(h.cache.stats().entries).toBe(0);
		expect(h.executionWorkers).toHaveLength(0);
		expect(h.compileWorkers[0].terminate).toHaveBeenCalledOnce();
		h.behavior.compile = (worker) => worker.respond({ type: 'compiled', artifact: h.artifact });
		await run(h.sandbox);
		expect(h.compileWorkers).toHaveLength(2);
	});

	it('killing execution preserves its immutable artifact for a fresh retry', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets);
		await run(h.sandbox, source, {}, true);
		h.behavior.execute = () => {};
		const pending = run(h.sandbox);
		const rejection = expect(pending).rejects.toThrow('Process terminated');
		await h.sandbox.kill?.();
		await rejection;
		expect(h.cache.stats().entries).toBe(1);
		expect(h.executionWorkers[0].terminate).toHaveBeenCalledOnce();
		h.behavior.execute = (worker) => worker.respond({ type: 'done', exitCode: 0 });
		await h.sandbox.clear();
		await run(h.sandbox);
		expect(h.compileWorkers).toHaveLength(1);
		expect(h.executionWorkers).toHaveLength(2);
	});

	it('forwards queued UTF-8 input and EOF only on requests and resets EOF after a run', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets);
		await run(h.sandbox, source, {}, true);
		h.sandbox.write?.('한글\n');
		h.sandbox.eof();
		h.behavior.execute = (worker, message) => {
			const control = new Int32Array(message.inputBuffer, 0, 2);
			worker.respond({ type: 'stdin' });
			expect(control[0]).toBe(1);
			expect(
				new TextDecoder().decode(new Uint8Array(message.inputBuffer, 8, control[1]))
			).toBe('한글\n');
			Atomics.store(control, 0, 0);
			worker.respond({ type: 'stdin' });
			expect(control[0]).toBe(2);
			expect(() => h.sandbox.write?.('leftover')).toThrow('stdin is closed');
			worker.respond({ type: 'done', exitCode: 0 });
		};
		await run(h.sandbox);
		h.behavior.execute = (worker, message) => {
			const control = new Int32Array(message.inputBuffer, 0, 2);
			worker.respond({ type: 'stdin' });
			expect(control[0]).toBe(0);
			worker.respond({ type: 'done', exitCode: 0 });
		};
		await run(h.sandbox);
	});

	it('bounds repeated writes to a program that never reads stdin and drops unused bytes on completion', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets);
		await run(h.sandbox, source, {}, true);
		h.behavior.execute = () => {};
		const pending = run(h.sandbox);
		await vi.waitFor(() => expect(h.executionWorkers).toHaveLength(1));
		for (let chunk = 0; chunk < 4; chunk++) h.sandbox.write?.('x'.repeat(32 * 1024));
		expect(() => h.sandbox.write?.('x')).toThrow('stdin buffered bytes exceed 131072');
		h.executionWorkers[0].respond({ type: 'done', exitCode: 0 });
		await pending;
		expect(() => h.sandbox.write?.('x'.repeat(128 * 1024))).not.toThrow();
		await h.sandbox.dispose?.();
		expect(() => h.sandbox.write?.('x')).toThrow('sandbox was disposed');
	});

	it('counts UTF-8 bytes against the load limit and preserves accepted input after overflow', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets, '', false, [], { limits: { maxWorkspaceBytes: 8 } });
		h.sandbox.write?.('한🙂');
		expect(() => h.sandbox.write?.('é')).toThrow('stdin buffered bytes exceed 8');
		h.sandbox.write?.('a');
		h.sandbox.eof();
		h.behavior.execute = (worker, message) => {
			const control = new Int32Array(message.inputBuffer, 0, 2);
			expect(message.inputBuffer.byteLength).toBe(8 + 8);
			worker.respond({ type: 'stdin' });
			expect(control[1]).toBe(7);
			expect(
				new TextDecoder().decode(new Uint8Array(message.inputBuffer, 8, control[1]))
			).toBe('한🙂');
			Atomics.store(control, 0, 0);
			worker.respond({ type: 'stdin' });
			expect(control[1]).toBe(1);
			expect(new Uint8Array(message.inputBuffer, 8, 1)[0]).toBe('a'.charCodeAt(0));
			Atomics.store(control, 0, 0);
			worker.respond({ type: 'stdin' });
			expect(control[0]).toBe(2);
			worker.respond({ type: 'done', exitCode: 0 });
		};
		await run(h.sandbox);
	});

	it('includes published bytes in backpressure until the worker requests its next chunk', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets, '', false, [], { limits: { maxWorkspaceBytes: 8 } });
		h.sandbox.write?.('abcd');
		h.behavior.execute = (worker) => worker.respond({ type: 'stdin' });
		const pending = run(h.sandbox);
		await vi.waitFor(() => expect(h.executionWorkers).toHaveLength(1));
		const [worker] = h.executionWorkers;
		const { inputBuffer } = worker.messages[0];
		const control = new Int32Array(inputBuffer, 0, 2);
		expect(control[1]).toBe(4);
		h.sandbox.write?.('efgh');
		expect(() => h.sandbox.write?.('i')).toThrow('stdin buffered bytes exceed 8');
		Atomics.store(control, 0, 0);
		worker.respond({ type: 'stdin' });
		expect(new TextDecoder().decode(new Uint8Array(inputBuffer, 8, control[1]))).toBe('efgh');
		h.sandbox.write?.('ijkl');
		h.sandbox.eof();
		Atomics.store(control, 0, 0);
		worker.respond({ type: 'stdin' });
		expect(new TextDecoder().decode(new Uint8Array(inputBuffer, 8, control[1]))).toBe('ijkl');
		Atomics.store(control, 0, 0);
		worker.respond({ type: 'stdin' });
		expect(control[0]).toBe(2);
		worker.respond({ type: 'done', exitCode: 0 });
		await pending;
	});

	it('rechecks queued input against tighter run limits before constructing workers', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets, '', false, [], { limits: { maxWorkspaceBytes: 8 } });
		h.sandbox.write?.('12345678');
		await expect(run(h.sandbox, source, { limits: { maxWorkspaceBytes: 4 } })).rejects.toThrow(
			'stdin buffered bytes exceed 4'
		);
		expect(h.compileWorkers).toHaveLength(0);
		h.behavior.execute = (worker, message) => {
			worker.respond({ type: 'stdin' });
			const control = new Int32Array(message.inputBuffer, 0, 2);
			expect(
				new TextDecoder().decode(new Uint8Array(message.inputBuffer, 8, control[1]))
			).toBe('12345678');
			worker.respond({ type: 'done', exitCode: 0 });
		};
		await run(h.sandbox);
	});

	it('applies the same byte limit and closed-stream policy to explicit stdin', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets, '', false, [], { limits: { maxWorkspaceBytes: 6 } });
		await expect(run(h.sandbox, source, { stdin: '한한a' })).rejects.toThrow(
			'stdin buffered bytes exceed 6'
		);
		expect(h.compileWorkers).toHaveLength(0);
		h.sandbox.write?.('queued');
		h.behavior.execute = (worker, message) => {
			expect(message.stdin).toBe('한한');
			expect(() => h.sandbox.write?.('x')).toThrow('stdin is closed');
			worker.respond({ type: 'done', exitCode: 0 });
		};
		await run(h.sandbox, source, { stdin: '한한' });
		expect(() => h.sandbox.write?.('fresh')).not.toThrow();
	});

	it('keeps the load input ceiling after rejected, prepared, completed, and cancelled runs', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets, '', false, [], { limits: { maxWorkspaceBytes: 8 } });
		h.sandbox.write?.('12345');
		await expect(run(h.sandbox, source, { limits: { maxWorkspaceBytes: 4 } })).rejects.toThrow(
			'stdin buffered bytes exceed 4'
		);
		expect(() => h.sandbox.write?.('678')).not.toThrow();
		await h.sandbox.clear();
		await run(h.sandbox, source, { limits: { maxWorkspaceBytes: 4 } }, true);
		expect(() => h.sandbox.write?.('12345678')).not.toThrow();
		await h.sandbox.clear();
		await run(h.sandbox, source, { limits: { maxWorkspaceBytes: 4 } });
		expect(() => h.sandbox.write?.('12345678')).not.toThrow();
		await h.sandbox.clear();
		h.behavior.execute = () => {};
		const pending = run(h.sandbox, source, { limits: { maxWorkspaceBytes: 4 } });
		const rejected = expect(pending).rejects.toThrow('Process terminated');
		await vi.waitFor(() => expect(h.executionWorkers).toHaveLength(2));
		await h.sandbox.cancel?.();
		await rejected;
		expect(() => h.sandbox.write?.('12345678')).not.toThrow();
	});

	it('preserves a multibyte character split across transport chunks', async () => {
		const h = makeHarness();
		const input = 'a'.repeat(65535) + '🙂';
		await h.sandbox.load(assets);
		h.sandbox.write?.(input);
		h.sandbox.eof();
		h.behavior.execute = (worker, message) => {
			const control = new Int32Array(message.inputBuffer, 0, 2);
			const chunks: Uint8Array[] = [];
			for (let chunk = 0; chunk < 2; chunk++) {
				Atomics.store(control, 0, 0);
				worker.respond({ type: 'stdin' });
				chunks.push(new Uint8Array(message.inputBuffer, 8, control[1]).slice());
			}
			expect(chunks.map((chunk) => chunk.byteLength)).toEqual([65536, 3]);
			expect(new TextDecoder().decode(Uint8Array.from([...chunks[0], ...chunks[1]]))).toBe(
				input
			);
			Atomics.store(control, 0, 0);
			worker.respond({ type: 'stdin' });
			expect(control[0]).toBe(2);
			worker.respond({ type: 'done', exitCode: 0 });
		};
		await run(h.sandbox);
	});

	it('clears queued input and EOF on cancellation before the next execution', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets);
		h.sandbox.write?.('old');
		h.sandbox.eof();
		h.behavior.execute = () => {};
		const pending = run(h.sandbox);
		const rejected = expect(pending).rejects.toThrow('Process terminated');
		await vi.waitFor(() => expect(h.executionWorkers).toHaveLength(1));
		await h.sandbox.cancel?.();
		await rejected;
		h.sandbox.write?.('fresh');
		h.behavior.execute = (worker, message) => {
			worker.respond({ type: 'stdin' });
			const control = new Int32Array(message.inputBuffer, 0, 2);
			expect(control[0]).toBe(1);
			expect(
				new TextDecoder().decode(new Uint8Array(message.inputBuffer, 8, control[1]))
			).toBe('fresh');
			worker.respond({ type: 'done', exitCode: 0 });
		};
		await run(h.sandbox);
	});

	it('reports a nonzero execution exit without discarding the compiled artifact', async () => {
		const h = makeHarness();
		h.behavior.execute = (worker) => worker.respond({ type: 'done', exitCode: 3 });
		await h.sandbox.load(assets);
		await expect(run(h.sandbox)).rejects.toThrow('Program exited with code 3');
		expect(h.cache.stats().entries).toBe(1);
	});

	it.each(['compiled', 'error'] as const)(
		'settles %s even when bridge and Worker cleanup both throw',
		async (type) => {
			const h = makeHarness();
			h.behavior.compile = (worker) => {
				const bridge = bridges.instances.find(
					(entry) => entry.worker === (worker as unknown as Worker)
				)!;
				bridge.dispose.mockImplementationOnce(() => {
					throw new Error('bridge cleanup failed');
				});
				worker.terminate.mockImplementationOnce(() => {
					throw new Error('Worker cleanup failed');
				});
				worker.respond({ type, artifact: h.artifact, error: 'original compile failure' });
			};
			await h.sandbox.load(assets);
			if (type === 'compiled')
				await expect(run(h.sandbox, source, {}, true)).resolves.toBe(true);
			else
				await expect(run(h.sandbox, source, {}, true)).rejects.toThrow(
					'original compile failure'
				);
			expect(h.compileWorkers[0].terminate).toHaveBeenCalledOnce();
			h.behavior.compile = (worker) =>
				worker.respond({ type: 'compiled', artifact: h.artifact });
			await expect(run(h.sandbox, `${source}\n`, {}, true)).resolves.toBe(true);
		}
	);

	it('settles cancellation and permits a fresh run when bridge cleanup throws', async () => {
		const h = makeHarness();
		h.behavior.compile = () => {};
		await h.sandbox.load(assets);
		const pending = run(h.sandbox);
		const rejected = expect(pending).rejects.toThrow('Process terminated');
		await vi.waitFor(() => expect(h.compileWorkers).toHaveLength(1));
		const bridge = bridges.instances.find(
			(entry) => entry.worker === (h.compileWorkers[0] as unknown as Worker)
		)!;
		bridge.dispose.mockImplementationOnce(() => {
			throw new Error('bridge cleanup failed');
		});
		await h.sandbox.cancel?.();
		await rejected;
		expect(h.compileWorkers[0].terminate).toHaveBeenCalledOnce();
		h.behavior.compile = (worker) => worker.respond({ type: 'compiled', artifact: h.artifact });
		await expect(run(h.sandbox, source, {}, true)).resolves.toBe(true);
	});

	it.each([
		['debug', assets, { debugMode: 'lldb' }],
		['custom asset integrity', { ...assets, clang: { integrity: {} } }, {}],
		['custom clang loader', { ...assets, clang: { loader: () => ({ url: 'custom' }) } }, {}]
	] as [string, SandboxRuntimeAssets, SandboxExecutionOptions][])(
		'uses the legacy sandbox for %s',
		async (_name, runtimeAssets, options) => {
			const h = makeHarness();
			await h.sandbox.load(runtimeAssets, source, false, [], options);
			await run(h.sandbox, source, options);
			h.sandbox.write?.('input');
			h.sandbox.eof();
			expect(h.legacy.load).toHaveBeenCalledOnce();
			expect(h.legacy.run).toHaveBeenCalledOnce();
			expect(h.legacy.write).toHaveBeenCalledWith('input');
			expect(h.legacy.eof).toHaveBeenCalledOnce();
			expect(h.compileWorkers).toHaveLength(0);
			expect(h.executionWorkers).toHaveLength(0);
		}
	);

	it('uses the debugger fallback when debug mode is enabled after a normal load', async () => {
		const h = makeHarness();
		await h.sandbox.load(assets);
		await run(h.sandbox, source, { debugMode: 'lldb' });
		expect(h.legacy.load).toHaveBeenCalledOnce();
		expect(h.legacy.run).toHaveBeenCalledOnce();
		expect(h.compileWorkers).toHaveLength(0);
	});
});

describe('precompiled <bits/stdc++.h> in the cached C++ sandbox', () => {
	const stdcpp = '#include <bits/stdc++.h>\nint main() { return 0; }';
	afterEach(() => vi.useRealTimers());

	it('expires an unresponsive header builder and ignores its captured late callback', async () => {
		vi.useFakeTimers();
		const h = makeHarness(undefined, 'CPP');
		h.behavior.compile = (worker) =>
			worker.respond({
				type: 'compiled',
				artifact: h.artifact,
				precompiledHeader: 'building'
			});
		await h.sandbox.load(assets);
		await run(h.sandbox, stdcpp, {}, true);
		const [builder] = h.compileWorkers;
		const lateMessage = builder.onmessage!;
		const bridge = bridges.instances.find(
			(entry) => entry.worker === (builder as unknown as Worker)
		)!;
		await vi.advanceTimersByTimeAsync(29_999);
		expect(builder.terminate).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(builder.terminate).toHaveBeenCalledOnce();
		expect(bridge.dispose).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
		lateMessage({
			data: {
				type: 'precompiled-header',
				header: { key: 'late', bytes: new Uint8Array([1]) }
			}
		});
		h.behavior.compile = (worker) => worker.respond({ type: 'compiled', artifact: h.artifact });
		await run(h.sandbox, `${stdcpp}\n`, {}, true);
		expect(h.compileWorkers[1].messages[0]).not.toHaveProperty('precompiledHeader');
		expect(builder.terminate).toHaveBeenCalledOnce();
	});

	it.each([
		[10, 20],
		[20, 10]
	])(
		'uses the tighter load (%s) or run (%s) compile deadline',
		async (loadTimeout, runTimeout) => {
			vi.useFakeTimers();
			const h = makeHarness(undefined, 'CPP');
			h.behavior.compile = (worker) =>
				worker.respond({
					type: 'compiled',
					artifact: h.artifact,
					precompiledHeader: 'building'
				});
			await h.sandbox.load(assets, '', false, [], {
				limits: { compileTimeoutMs: loadTimeout }
			});
			await run(h.sandbox, stdcpp, { limits: { compileTimeoutMs: runTimeout } }, true);
			await vi.advanceTimersByTimeAsync(9);
			expect(h.compileWorkers[0].terminate).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(h.compileWorkers[0].terminate).toHaveBeenCalledOnce();
			expect(vi.getTimerCount()).toBe(0);
		}
	);

	it.each([
		[1, 2, false],
		[2, 1, false],
		[2, 2, true]
	] as const)(
		'counts the header builder against load/run Worker budgets (%s/%s)',
		async (loadWorkers, runWorkers, retained) => {
			vi.useFakeTimers();
			const h = makeHarness(undefined, 'CPP');
			h.behavior.compile = (worker) =>
				worker.respond({
					type: 'compiled',
					artifact: h.artifact,
					precompiledHeader: 'building'
				});
			const createExecutor = h.factories.execute;
			h.factories.execute = () => {
				expect(h.compileWorkers[0].terminate.mock.calls.length).toBe(retained ? 0 : 1);
				return createExecutor();
			};
			await h.sandbox.load(assets, '', false, [], { limits: { maxWorkers: loadWorkers } });
			await run(h.sandbox, stdcpp, { limits: { maxWorkers: runWorkers } });
			expect(vi.getTimerCount()).toBe(retained ? 1 : 0);
			await h.sandbox.dispose?.();
			expect(h.compileWorkers[0].terminate).toHaveBeenCalledOnce();
			expect(vi.getTimerCount()).toBe(0);
		}
	);

	it('keeps a budgeted header build alive through foreground cancellation until its deadline', async () => {
		vi.useFakeTimers();
		const h = makeHarness(undefined, 'CPP');
		h.behavior.compile = (worker) =>
			worker.respond({
				type: 'compiled',
				artifact: h.artifact,
				precompiledHeader: 'building'
			});
		let started!: () => void;
		const executionStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		h.behavior.execute = () => started();
		await h.sandbox.load(assets, '', false, [], { limits: { maxWorkers: 2 } });
		const pending = run(h.sandbox, stdcpp, { limits: { maxWorkers: 2, compileTimeoutMs: 10 } });
		const rejected = expect(pending).rejects.toThrow('Process terminated');
		await executionStarted;
		await h.sandbox.cancel?.();
		await rejected;
		expect(h.executionWorkers[0].terminate).toHaveBeenCalledOnce();
		expect(h.compileWorkers[0].terminate).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(10);
		expect(h.compileWorkers[0].terminate).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('retires a replaced builder before accepting any later header result', async () => {
		vi.useFakeTimers();
		const h = makeHarness(undefined, 'CPP');
		h.behavior.compile = (worker) =>
			worker.respond({
				type: 'compiled',
				artifact: h.artifact,
				precompiledHeader: 'building'
			});
		await h.sandbox.load(assets);
		await run(h.sandbox, stdcpp, {}, true);
		const lateMessage = h.compileWorkers[0].onmessage!;
		await run(h.sandbox, `${stdcpp}\n`, {}, true);
		expect(h.compileWorkers[0].terminate).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(1);
		lateMessage({
			data: {
				type: 'precompiled-header',
				header: { key: 'retired', bytes: new Uint8Array([1]) }
			}
		});
		expect(h.compileWorkers[1].terminate).not.toHaveBeenCalled();
		h.compileWorkers[1].respond({ type: 'precompiled-header' });
		expect(vi.getTimerCount()).toBe(0);
		h.behavior.compile = (worker) => worker.respond({ type: 'compiled', artifact: h.artifact });
		await run(h.sandbox, `${stdcpp}\n\n`, {}, true);
		expect(h.compileWorkers[2].messages[0]).not.toHaveProperty('precompiledHeader');
	});

	it('attempts Worker and sandbox cleanup even if the header bridge cleanup throws', async () => {
		vi.useFakeTimers();
		const h = makeHarness(undefined, 'CPP');
		h.behavior.compile = (worker) =>
			worker.respond({
				type: 'compiled',
				artifact: h.artifact,
				precompiledHeader: 'building'
			});
		await h.sandbox.load(assets);
		await run(h.sandbox, stdcpp, {}, true);
		const bridge = bridges.instances.find(
			(entry) => entry.worker === (h.compileWorkers[0] as unknown as Worker)
		)!;
		bridge.dispose.mockImplementationOnce(() => {
			throw new Error('bridge disposal failed');
		});
		await expect(h.sandbox.dispose?.()).resolves.toBeUndefined();
		expect(h.compileWorkers[0].terminate).toHaveBeenCalledOnce();
		expect(h.legacy.dispose).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('keeps the compile worker until its header arrives and sends it with later compiles', async () => {
		const h = makeHarness(undefined, 'CPP');
		const header = { key: 'stdc++', bytes: new Uint8Array([1, 2, 3]) };
		h.behavior.compile = (worker) =>
			worker.respond({
				type: 'compiled',
				artifact: h.artifact,
				precompiledHeader: 'building'
			});
		await h.sandbox.load(assets);
		await run(h.sandbox, stdcpp, {}, true);
		const [builder] = h.compileWorkers;
		expect(builder.terminate).not.toHaveBeenCalled();
		expect(builder.messages[0]).not.toHaveProperty('precompiledHeader');

		builder.respond({ type: 'precompiled-header', header });
		expect(builder.terminate).toHaveBeenCalledTimes(1);

		h.behavior.compile = (worker) => worker.respond({ type: 'compiled', artifact: h.artifact });
		await run(h.sandbox, `${stdcpp}\n`, {}, true);
		expect(h.compileWorkers[1].messages[0].precompiledHeader).toEqual(header);
		expect(h.compileWorkers[1].terminate).toHaveBeenCalledTimes(1);
	});

	it('builds after compile errors and keeps the last header when a build fails', async () => {
		const h = makeHarness(undefined, 'CPP');
		const header = { key: 'stdc++', bytes: new Uint8Array([4]) };
		h.behavior.compile = (worker) =>
			worker.respond({
				type: 'compiled',
				artifact: h.artifact,
				precompiledHeader: 'building'
			});
		await h.sandbox.load(assets);
		await run(h.sandbox, stdcpp, {}, true);
		h.compileWorkers[0].respond({ type: 'precompiled-header', header });

		h.behavior.compile = (worker) =>
			worker.respond({
				type: 'error',
				error: 'compile failed',
				stdout: '',
				stderr: '',
				precompiledHeader: 'building'
			});
		await expect(run(h.sandbox, `${stdcpp}\nx`, {}, true)).rejects.toThrow('compile failed');
		const failed = h.compileWorkers[1];
		expect(failed.terminate).not.toHaveBeenCalled();
		failed.respond({ type: 'precompiled-header' });
		expect(failed.terminate).toHaveBeenCalledTimes(1);

		h.behavior.compile = (worker) => worker.respond({ type: 'compiled', artifact: h.artifact });
		await run(h.sandbox, `${stdcpp}\ny`, {}, true);
		expect(h.compileWorkers[2].messages[0].precompiledHeader).toEqual(header);
	});

	it('replaces an older pending build and stops a pending build on dispose', async () => {
		const h = makeHarness(undefined, 'CPP');
		h.behavior.compile = (worker) =>
			worker.respond({
				type: 'compiled',
				artifact: h.artifact,
				precompiledHeader: 'building'
			});
		await h.sandbox.load(assets);
		await run(h.sandbox, stdcpp, {}, true);
		await run(h.sandbox, `${stdcpp}\n`, {}, true);
		expect(h.compileWorkers[0].terminate).toHaveBeenCalledTimes(1);
		expect(h.compileWorkers[1].terminate).not.toHaveBeenCalled();
		await h.sandbox.dispose?.();
		expect(h.compileWorkers[1].terminate).toHaveBeenCalledTimes(1);
	});
});
