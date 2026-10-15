// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeAssetCache, requestRuntimeWasmModule } from '@wasm-idle/core';
import type { PlaygroundRuntimeAssets } from './assets';

const emptyWasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const instances: ModuleWorker[] = [];

class ModuleWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	bytes = emptyWasm;
	module?: WebAssembly.Module;
	private controller?: AbortController;
	private stopped = false;

	constructor() {
		instances.push(this);
	}

	postMessage(message: any) {
		if (message.load) {
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		this.controller = new AbortController();
		const channel = new MessageChannel();
		message.rustcModuleBroker.postMessage(
			{
				type: 'rustc-module-service',
				port: channel.port1,
				// Caller metadata cannot replace the host's bundled receipt.
				receipt: { bytes: emptyWasm.length, sha256: 'f'.repeat(64) }
			},
			[channel.port1]
		);
		void requestRuntimeWasmModule(this.bytes.slice(), channel.port2, {
			signal: this.controller.signal,
			timeoutMs: 1_000
		}).then(
			(module) => {
				this.module = module;
				if (!this.stopped) {
					this.onmessage?.({ data: { results: true } } as MessageEvent<any>);
				}
			},
			(error) => {
				if (!this.stopped) {
					this.onmessage?.({ data: { error: error.message } } as MessageEvent<any>);
				}
			}
		);
	}

	terminate() {
		this.stopped = true;
		this.controller?.abort(new Error('Test worker terminated'));
	}
}

vi.mock('$lib/playground/worker/rust?worker', () => ({ default: ModuleWorker }));
vi.mock('$lib/playground/wasmRustVersion', () => ({
	WASM_RUST_EXECUTABLE_GRAPH_PROFILE: { fingerprint: 'a'.repeat(64) },
	WASM_RUST_RUNTIME_PROFILE: {
		profileId: `wasm-rust-${'1'.repeat(64)}`,
		protocolVersion: 1,
		manifestPath: 'runtime/runtime-manifest.v3.json',
		manifestFingerprint: '1'.repeat(64),
		manifestReceipt: { bytes: 42, sha256: '2'.repeat(64) },
		assetReceipts: {
			'wasm-rust/runtime/rustc/rustc.wasm.gz': {
				bytes: 8,
				sha256: '93a44bbb96c751218e4c00d479e4c14358122a389acca16205b1e4d0dc5f9476',
				uncompressedBytes: 8,
				uncompressedSha256:
					'93a44bbb96c751218e4c00d479e4c14358122a389acca16205b1e4d0dc5f9476'
			}
		}
	}
}));
vi.mock('$lib/playground/rustExecutableGraph', () => ({
	loadVerifiedRustExecutableGraph: async ({ moduleUrl }: { moduleUrl: string }) => ({
		entryUrl: 'blob:https://example.test/rust-entry',
		runtimeProfile: { moduleUrl },
		networkModuleUrls: { [moduleUrl]: 'blob:https://example.test/rust-entry' },
		dispose() {}
	})
}));

import Rust from './rust';

const sandboxes: Rust[] = [];
const caches: RuntimeAssetCache[] = [];
const assets = {
	rootUrl: 'https://example.test/',
	rust: { compilerUrl: 'https://example.test/wasm-rust/index.js' }
};

async function createSandbox(
	cache: RuntimeAssetCache,
	runtimeAssets: PlaygroundRuntimeAssets = assets
) {
	const sandbox = new Rust();
	sandboxes.push(sandbox);
	sandbox.output = vi.fn();
	sandbox.setRuntimeAssetCache(cache);
	await sandbox.load(runtimeAssets);
	return sandbox;
}

function createCache() {
	const cache = new RuntimeAssetCache();
	caches.push(cache);
	return cache;
}

beforeEach(() => {
	instances.length = 0;
});

afterEach(async () => {
	await Promise.all(sandboxes.splice(0).map((sandbox) => sandbox.dispose()));
	for (const cache of caches.splice(0)) cache.dispose();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Rust app-session compiler module cache', () => {
	it('ignores retired broker errors and malformed messages after restarting the worker', async () => {
		const channels: MessageChannel[] = [];
		const NativeMessageChannel = MessageChannel;
		vi.stubGlobal(
			'MessageChannel',
			class extends NativeMessageChannel {
				constructor() {
					super();
					channels.push(this);
				}
			}
		);
		const sandbox = await createSandbox(createCache());
		const firstRun = sandbox.run('fn main() {}', true);
		const retiredPort = channels[0].port1;
		const retiredMessage = retiredPort.onmessage!;
		const retiredError = retiredPort.onmessageerror!;
		await firstRun;
		await sandbox.terminate();
		await sandbox.load(assets);
		const worker = instances[1];
		const terminate = vi.spyOn(worker, 'terminate');
		const currentRun = sandbox.run('fn main() { }', true);
		const completed = expect(currentRun).resolves.toBe(true);
		retiredError.call(retiredPort, new MessageEvent('messageerror'));
		retiredMessage.call(retiredPort, new MessageEvent('message', { data: null }));
		retiredMessage.call(
			retiredPort,
			new MessageEvent('message', { data: { type: 'invalid' } })
		);
		const late = new NativeMessageChannel();
		const close = vi.spyOn(late.port1, 'close').mockImplementationOnce(() => {
			throw new Error('retired port close failed');
		});
		expect(() =>
			retiredMessage.call(
				retiredPort,
				new MessageEvent('message', {
					data: { type: 'rustc-module-service', port: late.port1 }
				})
			)
		).not.toThrow();
		expect(close).toHaveBeenCalledTimes(1);
		late.port1.close();
		late.port2.close();
		expect(terminate).not.toHaveBeenCalled();
		await completed;
	});

	it('permits the same owner hook and rejects replacing the cache after loading a worker', async () => {
		const cache = createCache();
		const sandbox = await createSandbox(cache);
		expect(() => sandbox.setRuntimeAssetCache(cache)).not.toThrow();
		expect(() => sandbox.setRuntimeAssetCache(createCache())).toThrow('worker is active');
	});

	it('reuses a verified module after replacing the application worker and keeps instances private', async () => {
		const cache = createCache();
		const compile = vi.spyOn(WebAssembly, 'compile');
		const first = await createSandbox(cache);
		await first.run('fn main() {}', true);
		const firstModule = instances[0].module!;
		await first.dispose();
		expect(cache.stats().disposed).toBe(false);
		const second = await createSandbox(cache);
		await second.run('fn main() { println!("second"); }', true);
		const secondModule = instances[1].module!;
		expect(compile).toHaveBeenCalledTimes(1);
		expect(await WebAssembly.instantiate(firstModule)).not.toBe(
			await WebAssembly.instantiate(secondModule)
		);
	});

	it('checks pinned bytes again before a cached module is reused', async () => {
		const cache = createCache();
		const compile = vi.spyOn(WebAssembly, 'compile');
		const first = await createSandbox(cache);
		await first.run('fn main() {}', true);
		const second = await createSandbox(cache);
		instances[1].bytes = emptyWasm.slice();
		instances[1].bytes[4] = 2;
		await expect(second.run('fn main() {}', true)).rejects.toContain('integrity');
		expect(compile).toHaveBeenCalledTimes(1);
	});

	it('partitions modules by the runtime asset policy and per-run asset limit', async () => {
		const cache = createCache();
		const compile = vi.spyOn(WebAssembly, 'compile');
		const first = await createSandbox(cache);
		await first.run('fn main() {}', true, false, undefined, [], {
			limits: { maxAssetBytes: 128 * 1024 * 1024 }
		});
		const second = await createSandbox(cache, {
			...assets,
			rootUrl: 'https://example.test/alternate/'
		});
		await second.run('fn main() {}', true, false, undefined, [], {
			limits: { maxAssetBytes: 128 * 1024 * 1024 }
		});
		await second.run('fn main() { }', true, false, undefined, [], {
			limits: { maxAssetBytes: 256 * 1024 * 1024 }
		});
		expect(compile).toHaveBeenCalledTimes(3);
	});

	it('cancels one shared compilation consumer without cancelling another runtime', async () => {
		const module = await WebAssembly.compile(emptyWasm);
		let resolveCompile!: (module: WebAssembly.Module) => void;
		const compile = vi.spyOn(WebAssembly, 'compile').mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveCompile = resolve;
				})
		);
		const cache = createCache();
		const first = await createSandbox(cache);
		const second = await createSandbox(cache);
		const controller = new AbortController();
		const firstRun = first.run('fn main() {}', true, false, undefined, [], {
			signal: controller.signal
		});
		const rejected = expect(firstRun).rejects.toThrow('caller stopped Rust');
		await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(1));
		const secondRun = second.run('fn main() {}', true);
		await vi.waitFor(() => expect(cache.stats().misses).toBe(2));
		controller.abort(new Error('caller stopped Rust'));
		await rejected;
		resolveCompile(module);
		await expect(secondRun).resolves.toBe(true);
		const third = await createSandbox(cache);
		await third.run('fn main() {}', true);
		expect(compile).toHaveBeenCalledTimes(1);
	});
});
