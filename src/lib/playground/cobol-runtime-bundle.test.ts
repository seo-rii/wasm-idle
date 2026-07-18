// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const runtimeRoot = path.resolve(process.cwd(), 'static/wasm-cobol');

interface RuntimeAssetReceipt {
	asset: string;
	size: number;
	sha256: string;
}

describe('bundled wasm-cobol runtime', () => {
	it('ships receipt-backed native gzip frontend and filesystem assets', async () => {
		const manifest = JSON.parse(
			await readFile(path.join(runtimeRoot, 'runtime-manifest.v1.json'), 'utf8')
		);
		const buildInfo = JSON.parse(
			await readFile(path.join(runtimeRoot, 'runtime-build.json'), 'utf8')
		);
		expect(buildInfo.delivery?.format).toBe('wasm-idle-cobol-native-gzip-v1');

		const assets = [
			[manifest.frontend.asset, 'cobc.wasm.gz', 'wasm'],
			[manifest.rootfs.asset, 'rootfs.tar.gz', 'tar'],
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
