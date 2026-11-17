// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const moduleBridge = vi.hoisted(() => ({
	hasWorkerRuntimeModuleBridge: vi.fn(() => true),
	loadWorkerRuntimeAsset: vi.fn(),
	loadWorkerRuntimeModule: vi.fn()
}));
vi.mock('./assets', () => moduleBridge);

import { withCachedPyodideModule } from './runtimeModule';
import {
	MAX_PYTHON_SNAPSHOT_BYTES,
	pythonSnapshotKey,
	readPythonSnapshot,
	writePythonSnapshot
} from './pythonSnapshot';

const baseUrl = 'https://assets.example.test/python/';
const emptyModule = () => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

afterEach(() => {
	moduleBridge.loadWorkerRuntimeModule.mockReset();
	vi.restoreAllMocks();
});

describe('Pyodide bootstrap interception', () => {
	it('enters Pyodide before the Wasm module is ready and instantiates it once ready', async () => {
		const module = deferred<WebAssembly.Module>();
		const order: string[] = [];
		const result = withCachedPyodideModule(
			baseUrl,
			async () => {
				order.push('initialize');
				// Pyodide starts its other downloads here, while the module still compiles.
				const response = await fetch(`${baseUrl}pyodide.asm.wasm`);
				const { instance } = await WebAssembly.instantiateStreaming(response, {});
				order.push('instantiated');
				return instance;
			},
			{ module: module.promise }
		);
		await Promise.resolve();
		expect(order).toEqual(['initialize']);
		module.resolve(emptyModule());
		expect(await result).toBeInstanceOf(WebAssembly.Instance);
		expect(order).toEqual(['initialize', 'instantiated']);
		expect(moduleBridge.loadWorkerRuntimeModule).not.toHaveBeenCalled();
	});

	it('rejects with the compilation failure instead of waiting for Pyodide', async () => {
		const failure = new Error('module compile failed');
		const result = withCachedPyodideModule(baseUrl, () => new Promise<never>(() => {}), {
			module: Promise.reject(failure)
		});
		await expect(result).rejects.toBe(failure);
		expect(globalThis.fetch.name).not.toBe('fetchRuntime');
	});

	it('serves the preloaded standard library and leaves other requests alone', async () => {
		const standardLibrary = new Uint8Array([80, 75, 3, 4]);
		const nativeFetch = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response('network'));
		const [library, other] = await withCachedPyodideModule(
			baseUrl,
			async () =>
				Promise.all([
					fetch(`${baseUrl}python_stdlib.zip`).then((response) => response.arrayBuffer()),
					fetch(`${baseUrl}pyodide-lock.json`).then((response) => response.text())
				]),
			{ module: Promise.resolve(emptyModule()), standardLibrary }
		);
		expect(new Uint8Array(library)).toEqual(standardLibrary);
		expect(other).toBe('network');
		expect(nativeFetch).toHaveBeenCalledOnce();
		expect(String(nativeFetch.mock.calls[0][0])).toBe(`${baseUrl}pyodide-lock.json`);
	});
});

function memoryCache() {
	const entries = new Map<string, Uint8Array>();
	return {
		entries,
		backend: {
			read: vi.fn(async (key: string) => entries.get(key)),
			write: vi.fn(async (key: string, bytes: Uint8Array) => {
				entries.set(key, Uint8Array.from(bytes));
				return true;
			}),
			remove: vi.fn(async (key: string) => void entries.delete(key))
		}
	};
}

describe('Pyodide memory snapshot storage', () => {
	const inputs = {
		entry: new TextEncoder().encode('entry'),
		emscripten: new TextEncoder().encode('emscripten'),
		standardLibrary: new TextEncoder().encode('stdlib')
	};

	it('keys snapshots by version and every heap-shaping runtime input', async () => {
		const key = await pythonSnapshotKey('314.0.7', inputs);
		expect(await pythonSnapshotKey('314.0.7', inputs)).toBe(key);
		expect(await pythonSnapshotKey('314.0.8', inputs)).not.toBe(key);
		for (const name of ['entry', 'emscripten', 'standardLibrary'] as const)
			expect(
				await pythonSnapshotKey('314.0.7', {
					...inputs,
					[name]: new TextEncoder().encode('changed')
				})
			).not.toBe(key);
	});

	it('stores a compressed snapshot and restores the exact heap bytes', async () => {
		const { backend, entries } = memoryCache();
		const snapshot = new Uint8Array(64 * 1024);
		snapshot.set([1, 2, 3, 4], 1000);
		expect(await writePythonSnapshot(backend, 'key', snapshot)).toBe(true);
		expect(entries.get('key')!.byteLength).toBeLessThan(snapshot.byteLength / 8);
		expect(await readPythonSnapshot(backend, 'key')).toEqual(snapshot);
		expect(await readPythonSnapshot(backend, 'missing')).toBeUndefined();
	});

	it('drops an undecodable entry so the next start rebuilds it', async () => {
		const { backend, entries } = memoryCache();
		entries.set('key', new Uint8Array([1, 2, 3]));
		expect(await readPythonSnapshot(backend, 'key')).toBeUndefined();
		expect(backend.remove).toHaveBeenCalledWith('key');
		expect(entries.has('key')).toBe(false);
	});

	it('treats storage failures as a cache miss', async () => {
		const { backend } = memoryCache();
		backend.read.mockRejectedValueOnce(new Error('storage unavailable'));
		expect(await readPythonSnapshot(backend, 'key')).toBeUndefined();
		backend.write.mockRejectedValueOnce(new Error('quota exceeded'));
		expect(await writePythonSnapshot(backend, 'key', new Uint8Array([1]))).toBe(false);
	});

	it('refuses implausibly large heaps', async () => {
		const { backend } = memoryCache();
		const oversized = { byteLength: MAX_PYTHON_SNAPSHOT_BYTES + 1 } as Uint8Array;
		expect(await writePythonSnapshot(backend, 'key', oversized)).toBe(false);
		expect(backend.write).not.toHaveBeenCalled();
	});
});
