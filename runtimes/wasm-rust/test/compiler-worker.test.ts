import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchRuntimeAssetBytes, validateRuntimeAssetBytes } from '../src/compiler-worker.js';

describe('compiler-worker runtime asset validation', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('accepts ar-formatted rust runtime archives', () => {
		expect(() =>
			validateRuntimeAssetBytes(
				'sysroot/lib/rustlib/wasm32-wasip1/lib/libcore.rlib',
				new Uint8Array([0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a, 0x41])
			)
		).not.toThrow();
	});

	it('ignores non-archive runtime assets', () => {
		expect(() =>
			validateRuntimeAssetBytes('rustc/rustc.wasm.gz', new Uint8Array([0x00, 0x61, 0x73, 0x6d]))
		).not.toThrow();
	});

	it('fails early with a stale-bundle hint when an rlib fetch returns html', () => {
		expect(() =>
			validateRuntimeAssetBytes(
				'sysroot/lib/rustlib/wasm32-wasip1/lib/libcore.rlib',
				new TextEncoder().encode('<!doctype html><html><body>login</body></html>')
			)
		).toThrowError(/stale or wrong wasm-rust bundle/);
	});

	it('adds the asset URL and a refresh hint when a nested runtime fetch throws', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);

		await expect(
			fetchRuntimeAssetBytes(
				new URL('https://example.test/wasm-rust/runtime/sysroot/lib/rustlib/wasm32-wasip1/lib/libcore.rlib'),
				'wasm-rust sysroot asset sysroot/lib/rustlib/wasm32-wasip1/lib/libcore.rlib'
			)
		).rejects.toThrowError(
			/failed to fetch wasm-rust sysroot asset .*libcore\.rlib.*stale wasm-rust bundle|blocked a nested runtime asset request/i
		);
	});

	it('gunzips precompressed rustc runtime assets before compiling them', async () => {
		const rustcBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01]);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(gzipSync(rustcBytes), {
					status: 200
				})
			)
		);

		await expect(
			fetchRuntimeAssetBytes(
				new URL('https://example.test/wasm-rust/runtime/rustc/rustc.wasm.gz'),
				'rustc.wasm'
			)
		).resolves.toEqual(rustcBytes);
	});
});
