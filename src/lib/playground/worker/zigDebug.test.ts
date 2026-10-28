// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { configureRuntimeAssetCache } from '@wasm-idle/core';
import { createZigDebugBackendFetch, snapshotZigDebugBackend } from './zigDebug';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const raw = new TextEncoder().encode('real compiler fixture bytes');
const compressed = gzipSync(raw);
const receipt = {
	bytes: compressed.length,
	sha256: hash(compressed),
	uncompressedBytes: raw.length,
	uncompressedSha256: hash(raw)
};
const manifestReceipt = {
	bytes: 2,
	sha256: hash(new TextEncoder().encode('{}')),
	uncompressedBytes: 2,
	uncompressedSha256: hash(new TextEncoder().encode('{}'))
};
const config = () =>
	snapshotZigDebugBackend(
		'https://assets.example.test/clang',
		{
			'runtime-manifest.v1.json': manifestReceipt,
			'bin/clang.wasm.gz': receipt
		},
		1024 * 1024
	);
afterEach(() => vi.unstubAllGlobals());

describe('verified Zig debug backend delivery', () => {
	it('snapshots backend receipts and normalizes the base URL', () => {
		const receipts = { 'runtime-manifest.v1.json': { ...manifestReceipt } };
		const backend = snapshotZigDebugBackend('https://assets.example.test/clang', receipts, 100);
		receipts['runtime-manifest.v1.json'].sha256 = 'f'.repeat(64);
		expect(backend.path).toBe('https://assets.example.test/clang/');
		expect(backend.integrity['runtime-manifest.v1.json'].sha256).toBe(manifestReceipt.sha256);
		expect(Object.isFrozen(backend.integrity['runtime-manifest.v1.json'])).toBe(true);
	});

	it('verifies delivered and expanded bytes before exposing compiler modules', async () => {
		configureRuntimeAssetCache({ enabled: false });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(compressed))
		);
		const fetchImpl = createZigDebugBackendFetch(config());
		const response = await fetchImpl('https://assets.example.test/clang/bin/clang.wasm.gz');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(raw);
	});

	it('rejects decompressed-byte tampering even when the compressed receipt is correct', async () => {
		configureRuntimeAssetCache({ enabled: false });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(compressed))
		);
		const backend = config();
		const fetchImpl = createZigDebugBackendFetch({
			...backend,
			integrity: {
				...backend.integrity,
				'bin/clang.wasm.gz': { ...receipt, uncompressedSha256: '0'.repeat(64) }
			}
		});
		await expect(
			fetchImpl('https://assets.example.test/clang/bin/clang.wasm.gz')
		).rejects.toThrow();
	});

	it('rejects a delivered compiler that does not match its immutable receipt', async () => {
		configureRuntimeAssetCache({ enabled: false });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([0, 1, 2])))
		);
		await expect(
			createZigDebugBackendFetch(config())(
				'https://assets.example.test/clang/bin/clang.wasm.gz'
			)
		).rejects.toThrow();
	});

	it('does not fetch URLs outside the receipt-bound backend', async () => {
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const fetchImpl = createZigDebugBackendFetch(config());
		await expect(fetchImpl('https://evil.test/clang/bin/clang.wasm.gz')).rejects.toThrow(
			'Unpinned'
		);
		await expect(
			fetchImpl('https://assets.example.test/clang/bin/other.wasm.gz')
		).rejects.toThrow('Unpinned');
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each(['../outside', '/absolute', 'https://elsewhere.test/a', 'a?b', 'a\\b'])(
		'rejects unsafe receipt names: %s',
		(asset) => {
			expect(() =>
				snapshotZigDebugBackend(
					'https://assets.example.test/clang/',
					{ 'runtime-manifest.v1.json': manifestReceipt, [asset]: manifestReceipt },
					100
				)
			).toThrow('Invalid Zig debug Clang runtime asset name');
		}
	);
});
