import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
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

	it('compresses generic runtime payloads and immutable Vite assets', async () => {
		const rootDir = await makeTempDir();
		const compressiblePaths = [
			'wasm-bash/bash.webc',
			'wasm-nim/sysroot.tar',
			'wasm-octave/octave_interpreter.qch',
			'wasm-octave/doc-cache',
			'_app/immutable/assets/ruby-runtime.1234.wasm',
			'_app/immutable/assets/duckdb-mvp.1234.wasm',
			'_app/immutable/assets/wasmer.1234.wasm',
			'_app/immutable/workers/compiler.1234.js'
		];
		for (const [index, relativePath] of compressiblePaths.entries()) {
			await writeAsset(rootDir, relativePath, repeatedBytes(1_000_001, index));
		}
		await writeAsset(
			rootDir,
			'_app/immutable/chunks/application.1234.js',
			repeatedBytes(1_000_001, 90)
		);

		const result = await compressStaticRuntimeAssets({ rootDir });

		expect(
			result.compressed
				.map((entry) => relativeToPortablePath(rootDir, entry.originalPath))
				.sort()
		).toEqual([...compressiblePaths].sort());
		for (const relativePath of compressiblePaths) {
			await expect(stat(path.join(rootDir, relativePath))).rejects.toThrow();
			await expect(stat(path.join(rootDir, `${relativePath}.gz`))).resolves.toBeTruthy();
		}
		await expect(
			stat(path.join(rootDir, '_app/immutable/chunks/application.1234.js'))
		).resolves.toMatchObject({ size: 1_000_001 });

		const manifest = JSON.parse(
			await readFile(path.join(rootDir, 'compressed-runtime-assets.v1.json'), 'utf8')
		) as { assets: string[]; sizes: Record<string, number> };
		expect(manifest.assets).toEqual([...compressiblePaths].sort());
		expect(Object.keys(manifest.sizes).sort()).toEqual([...compressiblePaths].sort());
		for (const relativePath of compressiblePaths) {
			expect(manifest.sizes[relativePath]).toBe(1_000_001);
		}
	});

	it('rebuilds complete and accurate sizes for existing gzip-only assets', async () => {
		const rootDir = await makeTempDir();
		const webcBytes = repeatedBytes(1_234, 1);
		const extensionlessBytes = repeatedBytes(4_321, 2);
		await writeAsset(rootDir, 'wasm-bash/bash.webc.gz', gzipSync(webcBytes));
		await writeAsset(rootDir, 'wasm-octave/doc-cache.gz', gzipSync(extensionlessBytes));
		await writeAsset(
			rootDir,
			'compressed-runtime-assets.v1.json',
			new TextEncoder().encode(
				JSON.stringify({
					assets: ['wasm-bash/bash.webc', 'wasm-octave/doc-cache'],
					sizes: { 'wasm-bash/bash.webc': 7, 'stale/runtime.wasm': 99 }
				})
			)
		);

		const result = await compressStaticRuntimeAssets({ rootDir });

		expect(result.compressed).toEqual([]);
		const manifest = JSON.parse(
			await readFile(path.join(rootDir, 'compressed-runtime-assets.v1.json'), 'utf8')
		) as { assets: string[]; sizes: Record<string, number> };
		expect(manifest).toEqual({
			assets: ['wasm-bash/bash.webc', 'wasm-octave/doc-cache'],
			sizes: {
				'wasm-bash/bash.webc': webcBytes.byteLength,
				'wasm-octave/doc-cache': extensionlessBytes.byteLength
			}
		});
	});

	it('keeps original assets when the manifest cannot be committed', async () => {
		const rootDir = await makeTempDir();
		const assetPath = await writeAsset(
			rootDir,
			'wasm-swift/swiftc.wasm',
			repeatedBytes(1_000_001, 4)
		);
		const manifestPath = path.join(rootDir, 'compressed-runtime-assets.v1.json');
		await mkdir(manifestPath);

		await expect(compressStaticRuntimeAssets({ rootDir })).rejects.toThrow();
		await expect(stat(assetPath)).resolves.toMatchObject({ size: 1_000_001 });
		await expect(stat(`${assetPath}.gz`)).resolves.toBeTruthy();

		await rm(manifestPath, { recursive: true });
		await expect(compressStaticRuntimeAssets({ rootDir })).resolves.toMatchObject({
			manifestAssets: ['wasm-swift/swiftc.wasm']
		});
		await expect(stat(assetPath)).rejects.toThrow();
	});
});

function relativeToPortablePath(rootDir: string, filePath: string) {
	return path.relative(rootDir, filePath).split(path.sep).join('/');
}
