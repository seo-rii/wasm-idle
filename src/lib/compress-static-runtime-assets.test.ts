import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { compressStaticRuntimeAssets } from '../../scripts/compress-static-runtime-assets.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-compress-assets-'));
	tempDirs.push(dir);
	return dir;
}

async function writeAsset(baseDir: string, relativePath: string, bytes: Uint8Array) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, bytes);
	return targetPath;
}

function repeatedBytes(size: number, value: number) {
	return Uint8Array.from({ length: size }, () => value);
}

describe('compressStaticRuntimeAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('compresses large Swift compiler wasm assets and leaves precompressed SDK archives', async () => {
		const rootDir = await makeTempDir();
		await writeAsset(rootDir, 'wasm-swift/swiftc.wasm', repeatedBytes(1_000_001, 0));
		await writeAsset(rootDir, 'wasm-swift/swiftpm.wasm', repeatedBytes(1_000_001, 1));
		await writeAsset(rootDir, 'wasm-swift/sdk.tar.gz', repeatedBytes(1_000_001, 2));
		await writeAsset(rootDir, 'not-a-runtime/tool.wasm', repeatedBytes(1_000_001, 3));

		const result = await compressStaticRuntimeAssets({ rootDir });

		expect(
			result.compressed.map((entry) => path.relative(rootDir, entry.originalPath)).sort()
		).toEqual([
			path.join('wasm-swift', 'swiftc.wasm'),
			path.join('wasm-swift', 'swiftpm.wasm')
		]);
		await expect(stat(path.join(rootDir, 'wasm-swift', 'swiftc.wasm'))).rejects.toThrow();
		await expect(stat(path.join(rootDir, 'wasm-swift', 'swiftpm.wasm'))).rejects.toThrow();
		await expect(stat(path.join(rootDir, 'wasm-swift', 'sdk.tar.gz'))).resolves.toMatchObject({
			size: 1_000_001
		});
		await expect(stat(path.join(rootDir, 'not-a-runtime', 'tool.wasm'))).resolves.toMatchObject(
			{
				size: 1_000_001
			}
		);

		expect(
			Array.from(
				gunzipSync(
					await readFile(path.join(rootDir, 'wasm-swift', 'swiftc.wasm.gz'))
				).subarray(0, 4)
			)
		).toEqual([0, 0, 0, 0]);
		const manifest = JSON.parse(
			await readFile(path.join(rootDir, 'compressed-runtime-assets.v1.json'), 'utf8')
		) as { assets: string[]; sizes: Record<string, number> };
		expect(manifest.assets).toContain('wasm-swift/swiftc.wasm');
		expect(manifest.assets).toContain('wasm-swift/swiftpm.wasm');
		expect(manifest.assets).not.toContain('wasm-swift/sdk.tar.gz');
		expect(manifest.assets).not.toContain('not-a-runtime/tool.wasm');
		expect(manifest.sizes['wasm-swift/swiftc.wasm']).toBe(1_000_001);
		expect(manifest.sizes['wasm-swift/swiftpm.wasm']).toBe(1_000_001);
	});
});
