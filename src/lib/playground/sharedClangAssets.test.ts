import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { PlaygroundRuntimeAssets, RuntimeAssetLoader } from './assets';
import { RuntimeAssetCache } from './runtimeAssetCache';

const state = vi.hoisted(() => ({ modules: [] as WebAssembly.Module[], workers: [] as any[] }));

class CompilerWorker {
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror = null;
	onmessageerror = null;
	terminate = vi.fn();
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			queueMicrotask(() =>
				this.onmessage?.({
					data: { assetRequest: { id: 1, asset: 'bin/memfs.wasm.gz', module: true } }
				} as MessageEvent)
			);
		} else if (message.assetResponse) {
			const response = message.assetResponse;
			if (response.ok) state.modules.push(response.module);
			queueMicrotask(() =>
				this.onmessage?.({
					data: response.ok ? { load: true } : { error: response.error }
				} as MessageEvent)
			);
		}
	});
	constructor() {
		state.workers.push(this);
	}
}

vi.mock('$lib/playground/worker/cobol?worker', () => ({ default: CompilerWorker }));
vi.mock('$lib/playground/worker/fortran?worker', () => ({ default: CompilerWorker }));
vi.mock('$lib/playground/worker/v?worker', () => ({ default: CompilerWorker }));
vi.mock('$lib/playground/worker/objectivec?worker', () => ({ default: CompilerWorker }));

import Cobol from './cobol';
import Fortran from './fortran';
import VLang from './v';
import ObjectiveC from './objectivec';

const moduleBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const compressed = new Uint8Array(gzipSync(moduleBytes));
const receipt = {
	bytes: compressed.byteLength,
	sha256: createHash('sha256').update(compressed).digest('hex'),
	uncompressedBytes: moduleBytes.byteLength,
	uncompressedSha256: createHash('sha256').update(moduleBytes).digest('hex')
};

const assets = (loader: RuntimeAssetLoader): PlaygroundRuntimeAssets => ({
	rootUrl: 'https://assets.test/repl',
	clang: {
		baseUrl: 'https://assets.test/clang/',
		loader,
		integrity: { 'bin/memfs.wasm.gz': receipt }
	}
});

describe('Clang assets shared by language adapters', () => {
	beforeEach(() => {
		state.modules.length = 0;
		state.workers.length = 0;
	});
	afterEach(() => vi.restoreAllMocks());

	it('loads and compiles the same verified module once across disposable language workers', async () => {
		const cache = new RuntimeAssetCache();
		const loader = vi.fn(async () => ({ data: compressed, mimeType: 'application/gzip' }));
		const compile = vi.spyOn(WebAssembly, 'compile');
		const configuration = assets(loader);
		const sandboxes = [
			new Cobol(),
			new Fortran(),
			new VLang(),
			new ObjectiveC(),
			new ObjectiveC('OBJECTIVECXX')
		];
		for (const sandbox of sandboxes) {
			sandbox.setRuntimeAssetCache(cache);
			await sandbox.load(configuration, '', false);
			if ('dispose' in sandbox) await sandbox.dispose();
			else sandbox.terminate();
		}
		expect(loader).toHaveBeenCalledOnce();
		expect(compile).toHaveBeenCalledOnce();
		expect(state.modules).toHaveLength(sandboxes.length);
		for (const module of state.modules) expect(module).toBe(state.modules[0]);
		for (const worker of state.workers) expect(worker.terminate).toHaveBeenCalledOnce();
		expect(cache.stats().disposed).toBe(false);
		cache.dispose();
	});

	it('keeps different custom loaders in separate authorization scopes', async () => {
		const cache = new RuntimeAssetCache();
		const firstLoader = vi.fn(async () => ({
			data: compressed,
			mimeType: 'application/gzip'
		}));
		const secondLoader = vi.fn(async () => ({
			data: compressed,
			mimeType: 'application/gzip'
		}));
		const first = new Cobol();
		const second = new VLang();
		first.setRuntimeAssetCache(cache);
		second.setRuntimeAssetCache(cache);
		await first.load(assets(firstLoader), '', false);
		await first.dispose();
		await second.load(assets(secondLoader), '', false);
		expect(firstLoader).toHaveBeenCalledOnce();
		expect(secondLoader).toHaveBeenCalledOnce();
		await second.dispose();
		cache.dispose();
	});
});
