import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { BUNDLED_CLANG_ASSET_INTEGRITY } from './clangAssetIntegrity';

interface RuntimeBuildAsset {
	asset: string;
	size: number;
	sha256: string;
}

describe('bundled clang asset integrity', () => {
	it('matches the checked-in runtime build receipt', async () => {
		const receiptPath = resolve(process.cwd(), 'static/clang/runtime-build.json');
		const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as {
			assets: RuntimeBuildAsset[];
		};
		const receiptByAsset = new Map(receipt.assets.map((asset) => [asset.asset, asset]));
		const sourceByRuntimeAsset = {
			'bin/memfs.wasm.gz': 'memfs.wasm.gz',
			'bin/clang.wasm.gz': 'clang.wasm.gz',
			'bin/lld.wasm.gz': 'lld.wasm.gz',
			'bin/sysroot.tar.gz': 'sysroot.tar.gz'
		} as const;

		for (const [runtimeAsset, receiptAsset] of Object.entries(sourceByRuntimeAsset)) {
			const record = receiptByAsset.get(receiptAsset);
			expect(record, `${receiptAsset} is missing from runtime-build.json`).toBeDefined();
			const compressedBytes = await readFile(
				resolve(process.cwd(), 'static/clang/bin', receiptAsset)
			);
			expect(compressedBytes.byteLength).toBe(record?.size);
			expect(createHash('sha256').update(compressedBytes).digest('hex')).toBe(record?.sha256);
			const runtimeBytes = gunzipSync(compressedBytes);
			expect(
				BUNDLED_CLANG_ASSET_INTEGRITY[
					runtimeAsset as keyof typeof BUNDLED_CLANG_ASSET_INTEGRITY
				]
			).toEqual({
				bytes: runtimeBytes.byteLength,
				sha256: createHash('sha256').update(runtimeBytes).digest('hex')
			});
		}

		const manifestBytes = await readFile(
			resolve(process.cwd(), 'static/clang/runtime-manifest.v1.json')
		);
		expect(BUNDLED_CLANG_ASSET_INTEGRITY['runtime-manifest.v1.json']).toEqual({
			bytes: manifestBytes.byteLength,
			sha256: createHash('sha256').update(manifestBytes).digest('hex')
		});
		expect(Object.keys(BUNDLED_CLANG_ASSET_INTEGRITY).sort()).toEqual(
			['runtime-manifest.v1.json', ...Object.keys(sourceByRuntimeAsset)].sort()
		);
	});
});
