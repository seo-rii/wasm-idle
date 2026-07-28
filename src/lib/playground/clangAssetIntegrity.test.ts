import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
			expect(BUNDLED_CLANG_ASSET_INTEGRITY[runtimeAsset]).toEqual({
				bytes: record?.size,
				sha256: record?.sha256
			});
		}

		expect(Object.keys(BUNDLED_CLANG_ASSET_INTEGRITY).sort()).toEqual(
			Object.keys(sourceByRuntimeAsset).sort()
		);
	});
});
