// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeAssetCache, requestRuntimeWasmModule } from '@wasm-idle/core';
import type { PlaygroundRuntimeAssets } from './assets';

// One private, exported memory per instance.
const wasm = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 1, 7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0
]);
const workers: ModuleWorker[] = [];

class ModuleWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	bytes = wasm;
	modules: WebAssembly.Module[] = [];
	instances: WebAssembly.Instance[] = [];
	files = new Map<string, string>();
	usedHostService = false;
	private controller?: AbortController;
	stopped = false;

	constructor() {
		workers.push(this);
	}

	postMessage(message: any) {
		if (message.load) {
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent));
			return;
		}
		this.controller = new AbortController();
		this.usedHostService = !!message.compilerModulePorts;
		void Promise.all(
			(['ldc2', 'lld'] as const).map(async (kind) => {
				const port = message.compilerModulePorts?.[kind];
				const module = port
					? await requestRuntimeWasmModule(this.bytes.slice(), port, {
							signal: this.controller!.signal,
							timeoutMs: 1_000
						})
					: await WebAssembly.compile(this.bytes.slice());
				this.modules.push(module);
				this.instances.push(await WebAssembly.instantiate(module));
			})
		).then(
			() => {
				if (!this.stopped) this.onmessage?.({ data: { results: true } } as MessageEvent);
			},
			(error) => {
				if (!this.stopped)
					this.onmessage?.({ data: { error: error.message } } as MessageEvent);
			}
		);
	}

	terminate() {
		this.stopped = true;
		this.controller?.abort(new Error('D test worker retired'));
	}
}

vi.mock('$lib/playground/worker/d?worker', () => ({ default: ModuleWorker }));
vi.mock('$lib/playground/wasmDVersion', async () => {
	const { WASM_D_OUTER_ASSET_RECEIPTS } = await import('./wasmDIntegrity');
	const receipt = {
		bytes: 25,
		sha256: '86b83c292b6362ce9b0e8b468f00c88186366ca4292be39a7acb5808d9f13d39'
	};
	return {
		WASM_D_ASSET_VERSION: 'test',
		WASM_D_COMPILER_PROFILE: {
			version: 'ldc-test',
			manifestSha256: WASM_D_OUTER_ASSET_RECEIPTS['runtime/runtime-manifest.v1.json'].sha256,
			lldProfile: 'emscripten-lld-v2-llvm-16.0.4',
			lldLoaderSha256: '1'.repeat(64),
			lldDataSha256: '2'.repeat(64),
			ldc2: receipt,
			lld: receipt
		}
	};
});

import D from './d';
import { WASM_D_OUTER_ASSET_RECEIPTS } from './wasmDIntegrity';

const sandboxes: D[] = [];
const caches: RuntimeAssetCache[] = [];
const assets: PlaygroundRuntimeAssets = {
	d: { moduleUrl: 'https://example.test/wasm-d/index.js' }
};

function cache() {
	const owner = new RuntimeAssetCache();
	caches.push(owner);
	return owner;
}

async function sandbox(owner?: RuntimeAssetCache, runtimeAssets = assets) {
	const instance = new D();
	sandboxes.push(instance);
	if (owner) instance.setRuntimeAssetCache(owner);
	await instance.load(runtimeAssets);
	return instance;
}

beforeEach(() => {
	workers.length = 0;
});
afterEach(async () => {
	await Promise.all(sandboxes.splice(0).map((instance) => instance.dispose()));
	for (const owner of caches.splice(0)) owner.dispose();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('D compiler modules across isolated worker sessions', () => {
	it('reuses both native modules while retiring workers and keeping memories and files private', async () => {
		const owner = cache();
		const compile = vi.spyOn(WebAssembly, 'compile');
		const first = await sandbox(owner);
		await first.run('void main() {}', false);
		const retired = workers[0];
		expect(retired.stopped).toBe(true);
		expect(first.worker).toBeUndefined();
		new Uint8Array((retired.instances[0].exports.memory as WebAssembly.Memory).buffer)[0] = 99;
		retired.files.set('private.d', 'first run');
		await first.run('void main() { }', false);
		expect(workers).toHaveLength(2);
		expect(workers[1].files.size).toBe(0);
		expect(
			new Uint8Array((workers[1].instances[0].exports.memory as WebAssembly.Memory).buffer)[0]
		).toBe(0);
		expect(workers[1].instances[0]).not.toBe(retired.instances[0]);
		await first.dispose();
		expect(owner.stats().disposed).toBe(false);
		const second = await sandbox(owner);
		await second.run('void main() {}', false);
		// Node can lazily compile its HTTP parser while the first worker loads.
		expect(
			compile.mock.calls.filter(([bytes]) => bytes.byteLength === wasm.length)
		).toHaveLength(2);
		expect(workers.every((worker) => worker.usedHostService)).toBe(true);
	});

	it('checks worker bytes again before a warm module can be reused', async () => {
		const owner = cache();
		const compile = vi.spyOn(WebAssembly, 'compile');
		const first = await sandbox(owner);
		await first.run('void main() {}', false);
		const second = await sandbox(owner);
		workers[1].bytes = wasm.slice();
		workers[1].bytes[4] = 2;
		await expect(second.run('void main() {}', false)).rejects.toContain('integrity');
		expect(compile).toHaveBeenCalledTimes(2);
		expect(workers[1].instances).toHaveLength(0);
	});

	it('cancels one consumer without cancelling another waiting for the same modules', async () => {
		const nativeModule = await WebAssembly.compile(wasm);
		const completions: Array<(module: WebAssembly.Module) => void> = [];
		const compile = vi
			.spyOn(WebAssembly, 'compile')
			.mockImplementation(() => new Promise((resolve) => completions.push(resolve)));
		const owner = cache();
		const first = await sandbox(owner);
		const second = await sandbox(owner);
		const controller = new AbortController();
		const pending = first.run('void main() {}', false, true, undefined, [], {
			signal: controller.signal
		});
		const cancelled = expect(pending).rejects.toThrow('stop first D');
		await vi.waitFor(() => expect(completions).toHaveLength(2));
		const remaining = second.run('void main() {}', false);
		await vi.waitFor(() => expect(owner.stats().misses).toBe(4));
		controller.abort(new Error('stop first D'));
		await cancelled;
		for (const complete of completions) complete(nativeModule);
		await expect(remaining).resolves.toBe(true);
		await second.run('void main() { }', false);
		expect(compile).toHaveBeenCalledTimes(2);
		expect(workers[0].instances).toHaveLength(0);
	});

	it('partitions the native cache by asset policy and per-run byte limit', async () => {
		const owner = cache();
		const compile = vi.spyOn(WebAssembly, 'compile');
		const first = await sandbox(owner);
		await first.run('void main() {}', false);
		const other = await sandbox(owner, {
			d: { moduleUrl: 'https://other.test/wasm-d/index.js' }
		});
		await other.run('void main() {}', false);
		await other.run('void main() {}', false, true, undefined, [], {
			limits: { maxAssetBytes: 100 }
		});
		expect(compile).toHaveBeenCalledTimes(6);
	});

	it('keeps custom bundles on their independent path and supports standalone ownership', async () => {
		const compile = vi.spyOn(WebAssembly, 'compile');
		const custom = await sandbox(undefined, {
			d: {
				moduleUrl: 'https://custom.test/index.js',
				integrity: {
					...WASM_D_OUTER_ASSET_RECEIPTS,
					'index.js': {
						...WASM_D_OUTER_ASSET_RECEIPTS['index.js'],
						sha256: 'f'.repeat(64),
						uncompressedSha256: 'f'.repeat(64)
					}
				}
			}
		});
		await custom.run('void main() {}', false);
		expect(workers[0].usedHostService).toBe(false);
		const standalone = await sandbox();
		await standalone.run('void main() {}', false);
		await standalone.run('void main() {}', false);
		expect(compile).toHaveBeenCalledTimes(4);
	});

	it('permits reinjecting the same owner and refuses replacing it after loading', async () => {
		const owner = cache();
		const first = await sandbox(owner);
		expect(() => first.setRuntimeAssetCache(owner)).not.toThrow();
		expect(() => first.setRuntimeAssetCache(cache())).toThrow('worker is active');
	});
});
