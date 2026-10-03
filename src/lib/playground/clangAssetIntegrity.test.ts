import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { BUNDLED_CLANG_ASSET_INTEGRITY } from './clangAssetIntegrity';

interface RuntimeBuildAsset {
	asset: string;
	size: number;
	sha256: string;
}

interface LanguageSysrootReceipt {
	bytes: number;
	sha256: string;
	uncompressedBytes: number;
	uncompressedSha256: string;
	files: Array<{ path: string; bytes: number; sha256: string }>;
}

const hasPreparedClangRuntime = existsSync(
	resolve(process.cwd(), 'static/clang/bin/memfs.wasm.gz')
);

describe('bundled clang asset integrity', () => {
	it('pins the separate long double archive, its ABI receipt and bundled license', async () => {
		const root = resolve(process.cwd(), 'static/clang');
		const receipt = JSON.parse(
			await readFile(resolve(root, 'long-double-library.v1.json'), 'utf8')
		);
		const compressed = await readFile(resolve(root, receipt.asset.path));
		const archive = gunzipSync(compressed);
		const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
		expect(receipt.format).toBe('wasm-clang-long-double-library-v1');
		expect(receipt.target).toBe('wasm32-wasi');
		expect(archive.subarray(0, 8).toString()).toBe('!<arch>\n');
		expect(BUNDLED_CLANG_ASSET_INTEGRITY['libc-printscan-long-double.a.gz']).toEqual({
			bytes: compressed.byteLength,
			sha256: digest(compressed),
			uncompressedBytes: archive.byteLength,
			uncompressedSha256: digest(archive)
		});
		expect(receipt.asset).toMatchObject(
			BUNDLED_CLANG_ASSET_INTEGRITY['libc-printscan-long-double.a.gz']
		);
		expect(receipt.archive).toMatchObject({
			bytes: archive.byteLength,
			sha256: digest(archive)
		});
		const license = await readFile(resolve(root, receipt.license.path));
		expect(license.byteLength).toBe(receipt.license.bytes);
		expect(digest(license)).toBe(receipt.license.sha256);
		const manifest = JSON.parse(
			await readFile(resolve(root, 'runtime-manifest.v1.json'), 'utf8')
		);
		expect(manifest.compiler.sysroot.printscanLongDouble.asset).toBe(receipt.asset.path);
		expect(receipt.compatibility.linkOrder).toEqual(['-lc-printscan-long-double', '-lc']);
	});

	it('matches the checked-in runtime build receipt', async ({ skip }) => {
		if (!hasPreparedClangRuntime) skip();
		const receiptPath = resolve(process.cwd(), 'static/clang/runtime-build.json');
		const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as {
			assets: RuntimeBuildAsset[];
			toolchain: { llvmVersion: string; llvmCommit: string };
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
				bytes: record?.size,
				sha256: record?.sha256,
				uncompressedBytes: runtimeBytes.byteLength,
				uncompressedSha256: createHash('sha256').update(runtimeBytes).digest('hex')
			});
		}

		const manifestBytes = await readFile(
			resolve(process.cwd(), 'static/clang/runtime-manifest.v1.json')
		);
		expect(BUNDLED_CLANG_ASSET_INTEGRITY['runtime-manifest.v1.json']).toEqual({
			bytes: manifestBytes.byteLength,
			sha256: createHash('sha256').update(manifestBytes).digest('hex'),
			uncompressedBytes: manifestBytes.byteLength,
			uncompressedSha256: createHash('sha256').update(manifestBytes).digest('hex')
		});
		const profileManifestBytes = await readFile(
			resolve(process.cwd(), 'static/clang/language-sysroots.v1.json')
		);
		const profiles = JSON.parse(profileManifestBytes.toString()) as {
			format: string;
			source: { llvmVersion: string; llvmCommit: string; inventorySha256: string };
			assets: Record<string, LanguageSysrootReceipt>;
		};
		expect(profiles.format).toBe('wasm-clang-language-sysroots-v1');
		expect(profiles.source).toMatchObject({
			llvmVersion: receipt.toolchain.llvmVersion,
			llvmCommit: receipt.toolchain.llvmCommit
		});
		const profileNames = ['c-sysroot.tar.gz', 'cpp-addon.tar.gz'] as const;
		const paths = new Set<string>();
		for (const name of profileNames) {
			const assetReceipt = profiles.assets[name];
			const compressed = await readFile(resolve(process.cwd(), 'static/clang/bin', name));
			const logical = gunzipSync(compressed);
			expect(BUNDLED_CLANG_ASSET_INTEGRITY[`bin/${name}`]).toEqual({
				bytes: compressed.byteLength,
				sha256: createHash('sha256').update(compressed).digest('hex'),
				uncompressedBytes: logical.byteLength,
				uncompressedSha256: createHash('sha256').update(logical).digest('hex')
			});
			expect(assetReceipt).toMatchObject(BUNDLED_CLANG_ASSET_INTEGRITY[`bin/${name}`]);
			for (const file of assetReceipt.files) {
				expect(paths.has(file.path)).toBe(false);
				paths.add(file.path);
			}
		}
		expect(paths.size).toBe(900);
		expect(BUNDLED_CLANG_ASSET_INTEGRITY['language-sysroots.v1.json']).toEqual({
			bytes: profileManifestBytes.byteLength,
			sha256: createHash('sha256').update(profileManifestBytes).digest('hex'),
			uncompressedBytes: profileManifestBytes.byteLength,
			uncompressedSha256: createHash('sha256').update(profileManifestBytes).digest('hex')
		});
		expect(Object.keys(BUNDLED_CLANG_ASSET_INTEGRITY).sort()).toEqual(
			[
				'runtime-manifest.v1.json',
				'libc-printscan-long-double.a.gz',
				'language-sysroots.v1.json',
				'bin/c-sysroot.tar.gz',
				'bin/cpp-addon.tar.gz',
				...Object.keys(sourceByRuntimeAsset)
			].sort()
		);
	}, 30_000);
});
