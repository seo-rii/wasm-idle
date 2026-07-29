import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { BUNDLED_CLANGD_ASSET_INTEGRITY } from '../src/bundledClangdAssetIntegrity.js';

interface RuntimeBuildAsset {
	asset: string;
	size: number;
	sha256: string;
}

describe('bundled clangd asset integrity', () => {
	it('matches the checked-in runtime build receipt', async () => {
		const receiptPath = resolve(process.cwd(), '../../static/clang/runtime-build.json');
		const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as {
			assets: RuntimeBuildAsset[];
		};
		const receiptByAsset = new Map(receipt.assets.map((asset) => [asset.asset, asset]));

		for (const asset of ['clangd.js', 'clangd.wasm.gz'] as const) {
			const record = receiptByAsset.get(`clangd/${asset}`);
			expect(record, `clangd/${asset} is missing from runtime-build.json`).toBeDefined();
			const deliveryBytes = await readFile(
				resolve(process.cwd(), `../../static/clangd/${asset}`)
			);
			const runtimeBytes = asset.endsWith('.gz') ? gunzipSync(deliveryBytes) : deliveryBytes;
			expect(BUNDLED_CLANGD_ASSET_INTEGRITY[asset]).toEqual({
				bytes: record?.size,
				sha256: record?.sha256,
				uncompressedBytes: runtimeBytes.byteLength,
				uncompressedSha256: createHash('sha256').update(runtimeBytes).digest('hex')
			});
		}

		expect(Object.keys(BUNDLED_CLANGD_ASSET_INTEGRITY).sort()).toEqual([
			'clangd.js',
			'clangd.wasm.gz'
		]);
	});
});
