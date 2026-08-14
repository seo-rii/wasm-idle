import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const assets = vi.hoisted(() => ({
	byUrl: new Map<string, Uint8Array>()
}));

vi.mock('../src/external-asset.js', () => ({
	fetchBoundedExternalAsset: vi.fn(async ({ url }: { url: string }) => {
		const bytes = assets.byUrl.get(url);
		if (!bytes) throw new Error(`missing LSP Haskell fixture for ${url}`);
		return bytes.slice();
	})
}));

import { fetchBoundedExternalAsset } from '../src/external-asset.js';
import { loadDefaultHaskellCompilerHost } from '../src/haskell/service.js';

const moduleUrl = 'https://assets.example.test/wasm-haskell/dyld.mjs';
const rootfsUrl = 'https://assets.example.test/wasm-haskell/rootfs.tar.zst';
const bsdtarUrl = 'https://assets.example.test/wasm-haskell/bsdtar.wasm';
const originals = {
	'dyld.mjs': new TextEncoder().encode('export const trusted = true;\n'),
	'rootfs.tar.zst': new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]),
	'bsdtar.wasm': new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
};
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const integrity = Object.fromEntries(
	Object.entries(originals).map(([asset, bytes]) => [
		asset,
		{ bytes: bytes.byteLength, sha256: sha256(bytes) }
	])
) as {
	'dyld.mjs': { bytes: number; sha256: string };
	'rootfs.tar.zst': { bytes: number; sha256: string };
	'bsdtar.wasm': { bytes: number; sha256: string };
};

describe('Haskell LSP runtime asset boundary', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
		assets.byUrl.clear();
	});

	it('rejects an oversized custom receipt before starting any fetch', async () => {
		const oversizedIntegrity = {
			...integrity,
			'rootfs.tar.zst': {
				...integrity['rootfs.tar.zst'],
				bytes: 64 * 1024 * 1024 + 1
			}
		};

		await expect(
			loadDefaultHaskellCompilerHost(
				{ moduleUrl, rootfsUrl, bsdtarUrl, integrity: oversizedIntegrity },
				{
					documents: new Map(),
					publishDiagnostics: vi.fn(),
					reportProgress: vi.fn()
				}
			)
		).rejects.toThrow('Haskell LSP receipt exceeds the 64 MiB safety limit');
		expect(fetchBoundedExternalAsset).not.toHaveBeenCalled();
	});

	it.each([
		['dyld.mjs', moduleUrl],
		['rootfs.tar.zst', rootfsUrl],
		['bsdtar.wasm', bsdtarUrl]
	] as const)(
		'rejects a corrupt %s before importing or instantiating executable bytes',
		async (asset, url) => {
			assets.byUrl = new Map([
				[moduleUrl, originals['dyld.mjs'].slice()],
				[rootfsUrl, originals['rootfs.tar.zst'].slice()],
				[bsdtarUrl, originals['bsdtar.wasm'].slice()]
			]);
			const tampered = assets.byUrl.get(url)!;
			tampered[0] ^= 1;
			const instantiate = vi.spyOn(WebAssembly, 'instantiate');
			const createObjectUrl = vi.spyOn(URL, 'createObjectURL');

			await expect(
				loadDefaultHaskellCompilerHost(
					{ moduleUrl, rootfsUrl, bsdtarUrl, integrity },
					{
						documents: new Map(),
						publishDiagnostics: vi.fn(),
						reportProgress: vi.fn()
					}
				)
			).rejects.toMatchObject({
				name: 'AssetIntegrityError',
				code: 'asset-integrity',
				message: expect.stringContaining(asset),
				runtimeId: 'HASKELL'
			});
			expect(instantiate).not.toHaveBeenCalled();
			expect(createObjectUrl).not.toHaveBeenCalled();
		}
	);
});
