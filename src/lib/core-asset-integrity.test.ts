import { createHash } from 'node:crypto';
import {
	AssetIntegrityError,
	verifyRuntimeAssetIntegrity,
	verifyRuntimeAssetPair,
	type RuntimeAssetIntegrityEntry
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

const encoder = new TextEncoder();

const integrityEntry = (
	compressed: Uint8Array,
	uncompressed: Uint8Array
): RuntimeAssetIntegrityEntry => ({
	sha256: createHash('sha256').update(compressed).digest('hex'),
	bytes: compressed.byteLength,
	mediaType: 'application/wasm',
	uncompressedSha256: createHash('sha256').update(uncompressed).digest('hex'),
	uncompressedBytes: uncompressed.byteLength
});

describe('runtime asset integrity', () => {
	it('verifies compressed and uncompressed bytes as one immutable receipt', async () => {
		const compressed = encoder.encode('compressed payload');
		const uncompressed = encoder.encode('logical wasm payload');

		const receipt = await verifyRuntimeAssetPair({
			asset: 'compiler.wasm.gz',
			compressed,
			uncompressed,
			expected: integrityEntry(compressed, uncompressed),
			mimeType: 'Application/Wasm; charset=binary',
			runtimeId: 'clang',
			profileId: 'clang-wasi-v1'
		});

		expect(receipt).toEqual({
			compressed: {
				asset: 'compiler.wasm.gz',
				stage: 'compressed',
				sha256: createHash('sha256').update(compressed).digest('hex'),
				bytes: compressed.byteLength,
				mediaType: undefined
			},
			uncompressed: {
				asset: 'compiler.wasm.gz',
				stage: 'uncompressed',
				sha256: createHash('sha256').update(uncompressed).digest('hex'),
				bytes: uncompressed.byteLength,
				mediaType: 'application/wasm'
			}
		});
		expect(Object.isFrozen(receipt)).toBe(true);
		expect(Object.isFrozen(receipt.compressed)).toBe(true);
	});

	it('rejects corrupt compressed bytes with a typed integrity error', async () => {
		const expected = encoder.encode('expected');
		const corrupted = encoder.encode('corrupt!');

		await expect(
			verifyRuntimeAssetIntegrity({
				asset: 'runtime.js',
				bytes: corrupted,
				expected: createHash('sha256').update(expected).digest('hex'),
				runtimeId: 'runtime-a',
				profileId: 'profile-a'
			})
		).rejects.toMatchObject({
			name: 'AssetIntegrityError',
			code: 'asset-integrity',
			phase: 'asset',
			runtimeId: 'runtime-a',
			profileId: 'profile-a'
		} satisfies Partial<AssetIntegrityError>);
	});

	it('treats MIME metadata on a legacy receipt as the delivery media type', async () => {
		const bytes = encoder.encode('export default 1;');
		const expected: RuntimeAssetIntegrityEntry = {
			sha256: createHash('sha256').update(bytes).digest('hex'),
			bytes: bytes.byteLength,
			mediaType: 'text/javascript'
		};

		await expect(
			verifyRuntimeAssetIntegrity({
				asset: 'runtime.js',
				bytes,
				expected,
				mimeType: 'Text/JavaScript; charset=utf-8'
			})
		).resolves.toMatchObject({ mediaType: 'text/javascript' });
		await expect(
			verifyRuntimeAssetIntegrity({
				asset: 'runtime.js',
				bytes,
				expected,
				mimeType: 'text/plain'
			})
		).rejects.toThrow(
			'Runtime asset runtime.js MIME type mismatch: expected text/javascript, received text/plain'
		);
	});

	it('rejects decompression expansion that violates the declared logical size', async () => {
		const compressed = encoder.encode('compressed');
		const uncompressed = encoder.encode('expanded payload');
		const expected = {
			...integrityEntry(compressed, uncompressed),
			uncompressedBytes: uncompressed.byteLength - 1
		};

		await expect(
			verifyRuntimeAssetPair({
				asset: 'runtime.wasm.gz',
				compressed,
				uncompressed,
				expected,
				mimeType: 'application/wasm'
			})
		).rejects.toThrow('uncompressed size mismatch');
	});

	it('requires a complete post-decompression contract', async () => {
		const bytes = encoder.encode('payload');

		await expect(
			verifyRuntimeAssetIntegrity({
				asset: 'runtime.wasm.gz',
				bytes,
				expected: createHash('sha256').update(bytes).digest('hex'),
				stage: 'uncompressed'
			})
		).rejects.toThrow('missing uncompressed integrity metadata');
	});
});
