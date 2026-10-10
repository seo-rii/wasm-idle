// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { RUNTIME_ASSET_LOCK } from '../../../packages/core/src/runtime-asset-lock.generated';

const runtimeRoot = path.resolve(process.cwd(), 'static/wasm-v');

interface RuntimeAssetReceipt {
	asset: string;
	size: number;
	sha256: string;
}

describe('bundled wasm-v runtime', () => {
	it('pins every shipped V asset in the published core lock', async () => {
		for (const asset of [
			'runtime-manifest.v1.json',
			'runtime-build.json',
			'v.wasm.gz',
			'vroot.tar.gz',
			'c-sysroot.tar.gz'
		]) {
			const bytes = await readFile(path.join(runtimeRoot, asset));
			const receipt = RUNTIME_ASSET_LOCK.assets[`wasm-v/${asset}`];
			expect(receipt, `missing V asset receipt: ${asset}`).toMatchObject({
				bytes: bytes.byteLength,
				sha256: createHash('sha256').update(bytes).digest('hex')
			});
			if (asset.endsWith('.gz')) {
				const decoded = gunzipSync(bytes);
				expect(receipt).toMatchObject({
					encoding: 'gzip',
					uncompressedBytes: decoded.byteLength,
					uncompressedSha256: createHash('sha256').update(decoded).digest('hex')
				});
			}
		}
	});

	it('ships receipt-backed native gzip compiler, V root and C sysroot assets', async () => {
		const manifest = JSON.parse(
			await readFile(path.join(runtimeRoot, 'runtime-manifest.v1.json'), 'utf8')
		);
		const buildInfo = JSON.parse(
			await readFile(path.join(runtimeRoot, 'runtime-build.json'), 'utf8')
		);
		expect(buildInfo.delivery?.format).toBe('wasm-idle-v-native-gzip-v1');

		const assets = [
			[manifest.frontend.asset, 'v.wasm.gz', 'wasm'],
			[manifest.rootfs.asset, 'vroot.tar.gz', 'tar'],
			[manifest.cSysroot.asset, 'c-sysroot.tar.gz', 'tar']
		] as const;
		const metadata = new Map<string, RuntimeAssetReceipt>(
			buildInfo.assets.map((asset: RuntimeAssetReceipt) => [asset.asset, asset])
		);

		for (const [manifestPath, assetName, kind] of assets) {
			expect(manifestPath).toBe(assetName);
			const compressed = await readFile(path.join(runtimeRoot, manifestPath));
			const receipt = metadata.get(assetName);
			expect(receipt?.size).toBe(compressed.byteLength);
			expect(receipt?.sha256).toBe(createHash('sha256').update(compressed).digest('hex'));
			const decompressed = gunzipSync(compressed);
			if (kind === 'wasm') {
				expect(decompressed.subarray(0, 4)).toEqual(Buffer.from([0, 97, 115, 109]));
			} else {
				expect(decompressed.subarray(257, 262).toString('ascii')).toBe('ustar');
			}
		}
	});
});
