import { describe, expect, it, vi } from 'vitest';
import type { Sandbox, SandboxExecutionOptions, SandboxRuntimeAssets } from '@wasm-idle/core';
import type { BrowserClangArtifact } from '@wasm-idle/llvm-core/clang';

import type { RuntimeAssetCache } from './runtimeAssetCache';
vi.mock('$env/dynamic/public', () => ({ env: {} }));

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
		output: vi.fn()
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
	sandbox: Sandbox,
	code = source,
	options: SandboxExecutionOptions = {},
	prepare = false
) {
	return sandbox.run(code, prepare, false, undefined, [], options);
}

describe('cached C/C++ sandbox', () => {
	it('uses one-call persistent overrides without mutating the load baseline', async () => {
		const h = makeHarness();
		await h.sandbox.load({ ...assets, persistentCache: { enabled: true, maxBytes: 4096 } });
		await run(h.sandbox, source, { persistentCache: false }, true);
		expect(bridges.instances.at(-1)?.config.persistentCache).toMatchObject({
			enabled: false,
			maxBytes: 4096
		});
		await run(h.sandbox, `${source}\n`, {}, true);
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

	it('forwards queued UTF-8 input and EOF only on requests and drops unused input after a run', async () => {
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
			h.sandbox.write?.('leftover');
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

	it('reports a nonzero execution exit without discarding the compiled artifact', async () => {
		const h = makeHarness();
		h.behavior.execute = (worker) => worker.respond({ type: 'done', exitCode: 3 });
		await h.sandbox.load(assets);
		await expect(run(h.sandbox)).rejects.toThrow('Program exited with code 3');
		expect(h.cache.stats().entries).toBe(1);
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
