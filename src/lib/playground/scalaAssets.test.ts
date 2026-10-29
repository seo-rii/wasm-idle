import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import lock from '../../../runtimes/wasm-scala/assets.lock.json';
import { fetchPinnedRuntimeAsset } from '@wasm-idle/core';
import {
	assertScalaBrowserSupport,
	createScalaCompilerPayload,
	SCALA_ASSET_BASE_URL,
	SCALA_ASSET_RECEIPTS,
	SCALA_ASSET_REVISION
} from './scalaAssets';
import { loadScalaCompilerAssets } from './worker/scala/asset-bootstrap.js';

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	fetchPinnedRuntimeAsset: vi.fn()
}));
const fetchAsset = vi.mocked(fetchPinnedRuntimeAsset);
const wasm = { ...WebAssembly, JSTag: {}, Suspending: () => {}, promising: () => {} };
beforeEach(() => {
	vi.stubGlobal('WebAssembly', wasm);
	fetchAsset.mockReset().mockImplementation(async () => new Uint8Array([1]));
});
afterEach(() => vi.unstubAllGlobals());

describe('pinned Scala compiler graph', () => {
	it('shares exactly the reviewed immutable lock with the compiler Worker', () => {
		expect(SCALA_ASSET_RECEIPTS).toEqual(lock.files);
		expect(SCALA_ASSET_REVISION).toBe(lock.revision);
		expect(SCALA_ASSET_BASE_URL).toContain(`/${lock.repository}/${lock.revision}/`);
	});
	it('rejects unsupported browsers before downloading any asset', async () => {
		vi.stubGlobal('WebAssembly', {});
		await expect(createScalaCompilerPayload()).rejects.toThrow(/Scala 3 requires WebAssembly/);
		expect(fetchAsset).not.toHaveBeenCalled();
		expect(() => assertScalaBrowserSupport({} as typeof WebAssembly)).toThrow();
	});
	it('fetches all bytes through the core integrity/cache boundary with pinned identities', async () => {
		const controller = new AbortController();
		const progress = vi.fn();
		const persistentCache = { namespace: 'scala-test', maxBytes: 100_000_000 };
		const payload = await createScalaCompilerPayload({
			baseUrl: 'https://assets.example/scala',
			signal: controller.signal,
			persistentCache,
			maxAssetBytes: 40_000_000,
			onProgress: progress
		});
		expect(Object.keys(payload)).toEqual(lock.files.map((receipt) => receipt.path));
		for (const [index, receipt] of lock.files.entries()) {
			expect(fetchAsset.mock.calls[index][0]).toMatchObject({
				url: `https://assets.example/scala/${receipt.path}`,
				receipt: { bytes: receipt.bytes, sha256: receipt.sha256 },
				signal: controller.signal,
				persistentCache,
				maxAssetBytes: 40_000_000
			});
		}
	});
	it('does not continue graph loading after integrity/cache failure or cancellation', async () => {
		fetchAsset.mockRejectedValueOnce(new Error('Asset integrity mismatch'));
		await expect(createScalaCompilerPayload()).rejects.toThrow('Asset integrity mismatch');
		expect(fetchAsset).toHaveBeenCalledTimes(1);
		fetchAsset.mockClear();
		const controller = new AbortController();
		controller.abort();
		await expect(createScalaCompilerPayload({ signal: controller.signal })).rejects.toThrow();
		expect(fetchAsset).not.toHaveBeenCalled();
	});
	it.each([
		'data:text/javascript,evil',
		'https://user:password@example.com/',
		'https://example.com/?version=latest',
		'https://example.com/#part'
	])('rejects unsafe custom base %s', async (baseUrl) => {
		await expect(createScalaCompilerPayload({ baseUrl })).rejects.toThrow(/HTTP\(S\)/);
		expect(fetchAsset).not.toHaveBeenCalled();
	});
	it('worker rejects missing and corrupt transferred assets before creating an executable module', async () => {
		await expect(loadScalaCompilerAssets({})).rejects.toThrow(/exactly the pinned/);
		const payload = Object.fromEntries(
			lock.files.map((entry) => [entry.path, new Uint8Array(0)])
		);
		await expect(loadScalaCompilerAssets(payload)).rejects.toThrow(/size mismatch/);
		payload[lock.files[0].path] = new Uint8Array(lock.files[0].bytes);
		await expect(loadScalaCompilerAssets(payload)).rejects.toThrow(/integrity mismatch/);
	});
});
