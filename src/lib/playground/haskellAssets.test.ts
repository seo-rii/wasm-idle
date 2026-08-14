import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	loadVerifiedHaskellRuntimeAssets,
	snapshotHaskellRuntimeAssetConfig,
	type HaskellRuntimeAssetConfig
} from './haskellAssets';

const moduleBytes = new TextEncoder().encode('export const verified = true;\n');
const rootfsBytes = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]);
const bsdtarBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const config = (): HaskellRuntimeAssetConfig => ({
	moduleUrl: 'https://assets.example.test/wasm-haskell/dyld.mjs?v=test',
	rootfsUrl: 'https://assets.example.test/wasm-haskell/rootfs.tar.zst?v=test',
	bsdtarUrl: 'https://assets.example.test/wasm-haskell/bsdtar.wasm?v=test',
	integrity: {
		'dyld.mjs': { bytes: moduleBytes.byteLength, sha256: digest(moduleBytes) },
		'rootfs.tar.zst': { bytes: rootfsBytes.byteLength, sha256: digest(rootfsBytes) },
		'bsdtar.wasm': { bytes: bsdtarBytes.byteLength, sha256: digest(bsdtarBytes) }
	},
	maxAssetBytes: 1024
});

function responseFor(bytes: Uint8Array) {
	return new Response(bytes.slice(), {
		status: 200,
		headers: { 'content-length': String(bytes.byteLength) }
	});
}

function installAssetFetch(module = moduleBytes) {
	const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
		const href = String(url);
		if (href.includes('dyld.mjs')) return responseFor(module);
		if (href.includes('rootfs.tar.zst')) return responseFor(rootfsBytes);
		if (href.includes('bsdtar.wasm')) return responseFor(bsdtarBytes);
		return new Response(null, { status: 404 });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('Haskell runtime asset boundary', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('fetches and verifies all three assets before returning executable bytes', async () => {
		const fetchMock = installAssetFetch();
		const progress = vi.fn();

		const verified = await loadVerifiedHaskellRuntimeAssets(config(), { onProgress: progress });

		expect(verified.moduleSource).toBe('export const verified = true;\n');
		expect(verified.rootfsBytes).toEqual(rootfsBytes);
		expect(verified.bsdtarBytes).toEqual(bsdtarBytes);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		for (const [, request] of fetchMock.mock.calls) {
			expect(request).toMatchObject({
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: expect.any(AbortSignal)
			});
		}
		expect(progress).toHaveBeenCalled();
	});

	it('rejects a mismatched module, aborts the sibling operation, and permits a clean retry', async () => {
		const tampered = moduleBytes.slice();
		tampered[0] ^= 1;
		installAssetFetch(tampered);

		await expect(loadVerifiedHaskellRuntimeAssets(config())).rejects.toMatchObject({
			name: 'AssetIntegrityError',
			code: 'asset-integrity',
			message: expect.stringContaining('dyld.mjs'),
			runtimeId: 'HASKELL'
		});

		vi.unstubAllGlobals();
		installAssetFetch();
		await expect(loadVerifiedHaskellRuntimeAssets(config())).resolves.toMatchObject({
			moduleSource: 'export const verified = true;\n'
		});
	});

	it('rejects receipt limits and unsafe URLs before starting any fetch', () => {
		const fetchMock = installAssetFetch();
		const limited = { ...config(), maxAssetBytes: moduleBytes.byteLength - 1 };
		expect(() => snapshotHaskellRuntimeAssetConfig(limited)).toThrow(
			'Haskell runtime receipt exceeds its limit'
		);
		expect(() =>
			snapshotHaskellRuntimeAssetConfig({
				...config(),
				moduleUrl: 'https://user:secret@assets.example.test/dyld.mjs'
			})
		).toThrow('must not include credentials');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('preserves the exact caller abort reason', async () => {
		installAssetFetch();
		const controller = new AbortController();
		const reason = { kind: 'cancel-haskell-assets' };
		controller.abort(reason);

		await expect(
			loadVerifiedHaskellRuntimeAssets(config(), { signal: controller.signal })
		).rejects.toBe(reason);
	});
});
