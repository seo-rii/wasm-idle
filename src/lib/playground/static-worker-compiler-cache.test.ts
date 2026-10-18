// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto';
import { MessageChannel, MessagePort } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeAssetCache, requestRuntimeWasmModule } from '@wasm-idle/core';
import { StaticWorkerRuntimeSandbox, type StaticWorkerCompilerModule } from './staticWorkerRuntime';
import { limitC3WasmMemory } from '../../../scripts/runtime-workers/c3-memory.mjs';

const wasm = Uint8Array.from([
	0, 97, 115, 109, 1, 0, 0, 0, 5, 4, 1, 1, 1, 8, 7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0
]);
const receipt = {
	bytes: wasm.byteLength,
	sha256: createHash('sha256').update(wasm).digest('hex')
};
const payloads: Uint8Array[] = [];
const workers: CompilerWorker[] = [];
const sandboxes: StaticWorkerRuntimeSandbox[] = [];
const caches: RuntimeAssetCache[] = [];
let failDispatch = false;

class CompilerWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent) => void) | null = null;
	module?: WebAssembly.Module;
	instance?: WebAssembly.Instance;
	transfers?: Transferable[];
	message: any;
	private controller = new AbortController();
	terminate = vi.fn(() => this.controller.abort(new Error('Worker retired')));

	constructor() {
		workers.push(this);
		queueMicrotask(() =>
			this.onmessage?.({
				data: { __wasmIdleStaticWorkerReady: true }
			} as MessageEvent)
		);
	}

	postMessage(message: any, transfer: Transferable[]) {
		this.transfers = transfer;
		if (failDispatch) throw new Error('Worker dispatch failed');
		this.message = structuredClone(message, { transfer });
		const received = this.message;
		void requestRuntimeWasmModule(
			received.runtimePreflight.wasmBytes,
			received.runtimeWasmModulePorts.compiler,
			{ signal: this.controller.signal, timeoutMs: 2_000 }
		).then(
			async (module) => {
				this.module = module;
				this.instance = await WebAssembly.instantiate(module);
				this.onmessage?.({
					data: { runId: received.runId, results: true }
				} as MessageEvent);
			},
			(error) => {
				this.onmessage?.({
					data: { runId: received.runId, error: error.message }
				} as MessageEvent);
			}
		);
	}
}

function cache() {
	const cache = new RuntimeAssetCache();
	caches.push(cache);
	return cache;
}

function sandbox(
	owner: RuntimeAssetCache,
	options: {
		identity?: string;
		bytes?: Uint8Array;
		descriptor?: StaticWorkerCompilerModule;
		capMemory?: boolean;
	} = {}
) {
	const sandbox = new StaticWorkerRuntimeSandbox({
		languageId: 'C3',
		displayName: 'compiler fixture',
		defaultActivePath: 'main.c3',
		stdin: { mode: 'none' },
		workerLifetime: { mode: 'per-run' },
		runtimePreflightDelivery: 'transfer-owned',
		resolveRuntimeAssets: () => ({
			baseUrl: `https://assets.test/${options.identity ?? 'default'}/`,
			workerUrl: 'https://assets.test/runner-worker.js',
			manifestFingerprint: receipt.sha256
		}),
		preflightRuntimeAssets(_urls, context) {
			const bytes = Uint8Array.from(options.bytes ?? wasm);
			payloads.push(bytes);
			return context.createOwnedDelivery(Object.freeze({ wasmBytes: bytes }));
		},
		compilerModules(_urls, limits) {
			return {
				compiler: options.descriptor ?? {
					receipt,
					compileKey: options.capMemory
						? `c3-defined-memory-cap-v1:${limits.maxWasmMemoryBytes}`
						: 'native-default-v1',
					compile: options.capMemory
						? async (bytes) =>
								WebAssembly.compile(
									(
										await limitC3WasmMemory(bytes, limits.maxWasmMemoryBytes, {
											verifyModules: false
										})
									).bytes
								)
						: undefined
				}
			};
		}
	});
	sandbox.setRuntimeAssetCache(owner);
	sandboxes.push(sandbox);
	return sandbox;
}

beforeEach(() => {
	vi.stubGlobal('Worker', CompilerWorker);
	vi.stubGlobal('MessageChannel', MessageChannel);
	vi.stubGlobal('MessagePort', MessagePort);
	vi.stubGlobal('crypto', webcrypto);
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('self.onmessage = () => {};'))
	);
	failDispatch = false;
	workers.length = 0;
	payloads.length = 0;
});

afterEach(async () => {
	await Promise.all(sandboxes.splice(0).map((sandbox) => sandbox.dispose()));
	for (const owner of caches.splice(0)) owner.dispose();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('static worker session compiler module services', () => {
	it('reuses a verified module across fresh workers without sharing instances or owned payloads', async () => {
		const owner = cache();
		const compile = vi.spyOn(WebAssembly, 'compile');
		for (let index = 0; index < 2; index++) {
			const next = sandbox(owner);
			await next.load('');
			await next.run('fixture', false);
			await next.dispose();
		}
		expect(owner.stats()).toMatchObject({ entries: 1, hits: 1, misses: 1 });
		// Browser feature detection may compile its own small probe on the first load.
		expect(
			compile.mock.calls.filter(([bytes]) => bytes.byteLength === receipt.bytes)
		).toHaveLength(1);
		expect(workers).toHaveLength(2);
		expect(workers[0].instance).not.toBe(workers[1].instance);
		expect(workers[0].transfers).toHaveLength(2);
		expect(workers[0].transfers![1]).toBeInstanceOf(MessagePort);
		for (const bytes of payloads) expect(bytes.byteLength).toBe(0);
		for (const worker of workers) expect(worker.terminate).toHaveBeenCalledOnce();
		expect(owner.stats()).toMatchObject({ entries: 1, disposed: false, inFlight: 0 });
	});

	it('checks the logical receipt on every request, including cache hits', async () => {
		const owner = cache();
		const compile = vi.spyOn(WebAssembly, 'compile');
		const first = sandbox(owner);
		await first.load('');
		await first.run('fixture', false);
		const bad = Uint8Array.from(wasm);
		bad[4] = 2;
		const next = sandbox(owner, { bytes: bad });
		await next.load('');
		await expect(next.run('fixture', false)).rejects.toThrow('integrity mismatch');
		expect(compile).toHaveBeenCalledOnce();
	});

	it('keeps relocated authorization profiles separate', async () => {
		const owner = cache();
		const compile = vi.spyOn(WebAssembly, 'compile');
		for (const identity of ['first-profile', 'other-profile']) {
			const next = sandbox(owner, { identity });
			await next.load('');
			await next.run('fixture', false);
		}
		expect(compile).toHaveBeenCalledTimes(2);
	});

	it('partitions transformed modules by memory cap and preserves actual engine limits', async () => {
		const owner = cache();
		const compile = vi.spyOn(WebAssembly, 'compile');
		for (const pages of [1, 1, 2]) {
			const next = sandbox(owner, { capMemory: true });
			await next.load('', '', false, [], { limits: { maxWasmMemoryBytes: pages * 65_536 } });
			await next.run('fixture', false, false, undefined, [], {
				limits: { maxWasmMemoryBytes: pages * 65_536 }
			});
			const memory = workers.at(-1)!.instance!.exports.memory as WebAssembly.Memory;
			if (pages === 2) expect(memory.grow(1)).toBe(1);
			expect(() => memory.grow(1)).toThrow(RangeError);
		}
		expect(compile).toHaveBeenCalledTimes(2);
	});

	it('unsubscribes a retired worker without cancelling another consumer', async () => {
		const module = await WebAssembly.compile(wasm);
		let resolveCompile!: (module: WebAssembly.Module) => void;
		const compile = vi.fn(
			() => new Promise<WebAssembly.Module>((resolve) => (resolveCompile = resolve))
		);
		const descriptor = { receipt, compileKey: 'deferred-native-v1', compile };
		const owner = cache();
		const share = vi.spyOn(owner, 'share');
		const first = sandbox(owner, { descriptor });
		const second = sandbox(owner, { descriptor });
		await first.load('');
		await second.load('');
		const controller = new AbortController();
		const cancelled = first.run('fixture', false, false, undefined, [], {
			signal: controller.signal
		});
		const rejection = expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
		await vi.waitFor(() => expect(compile).toHaveBeenCalledOnce());
		const other = second.run('fixture', false);
		await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(2));
		controller.abort(new Error('obsolete run'));
		await rejection;
		resolveCompile(module);
		await expect(other).resolves.toBe(true);
		expect(compile).toHaveBeenCalledOnce();
		expect(owner.stats()).toMatchObject({ entries: 1, inFlight: 0 });
	});

	it('closes subscriptions after dispatch failure and never retains abandoned compilation', async () => {
		const owner = cache();
		const next = sandbox(owner);
		await next.load('');
		failDispatch = true;
		await expect(next.run('fixture', false)).rejects.toMatchObject({ code: 'protocol' });
		expect(owner.stats()).toMatchObject({ entries: 0, inFlight: 0 });
		expect(workers[0].terminate).toHaveBeenCalledOnce();
	});

	it('rejects bad descriptor sizes and prevents rebinding a live cache owner', async () => {
		const owner = cache();
		const next = sandbox(owner, {
			descriptor: { receipt: { ...receipt, bytes: 0 }, compileKey: 'native-default-v1' }
		});
		await next.load('');
		expect(() => next.setRuntimeAssetCache(owner)).not.toThrow();
		expect(() => next.setRuntimeAssetCache(cache())).toThrow('active');
		await expect(next.run('fixture', false)).rejects.toMatchObject({ code: 'protocol' });
		expect(owner.stats()).toMatchObject({ entries: 0, inFlight: 0 });
	});
});
