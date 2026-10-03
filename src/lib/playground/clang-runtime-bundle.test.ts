// @vitest-environment node

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { MemFS } from '@wasm-idle/llvm-core';
import { describe, expect, it, vi } from 'vitest';

const runtimeRoot = path.resolve(process.cwd(), 'static/clang');
const hasPreparedClangRuntime = existsSync(path.join(runtimeRoot, 'bin', 'memfs.wasm.gz'));

interface RuntimeAssetReceipt {
	asset: string;
	size: number;
	sha256: string;
}

describe('bundled wasm-clang runtime', () => {
	it('can mount thousands of headers and project files in the shipped MemFS', async () => {
		const compressed = await readFile(path.join(runtimeRoot, 'bin', 'memfs.wasm.gz'));
		const fetch = vi
			.spyOn(globalThis, 'fetch')
			.mockImplementation(
				async () =>
					new Response(compressed, {
						headers: { 'Content-Type': 'application/octet-stream' }
					})
			);
		try {
			const memfs = new MemFS({
				moduleUrl: 'https://memfs-capacity.test/memfs.wasm.gz',
				stdin: () => '',
				stdout: () => {}
			});
			await memfs.ready;
			// The C++ sysroot and Objective-C headers exhausted the old 1,024-node table.
			// Exercise native nodes, including directories, rather than the JS overlay map.
			for (let directory = 0; directory < 64; directory++) {
				memfs.addDirectory(`headers-${directory}`);
				for (let file = 0; file < 64; file++) {
					memfs.addFile(`headers-${directory}/${file}.h`, `${directory}:${file}`);
				}
			}
			for (let directory = 0; directory < 64; directory++) {
				expect(
					new TextDecoder().decode(memfs.getFileContents(`headers-${directory}/63.h`))
				).toBe(`${directory}:63`);
			}
			memfs.addFile('main.m', 'int main(void) { return 0; }');
			expect(new TextDecoder().decode(memfs.getFileContents('main.m'))).toBe(
				'int main(void) { return 0; }'
			);
		} finally {
			fetch.mockRestore();
		}
	});

	it('ships receipt-backed native gzip compiler and sysroot assets', async ({ skip }) => {
		if (!hasPreparedClangRuntime) skip();
		const manifest = JSON.parse(
			await readFile(path.join(runtimeRoot, 'runtime-manifest.v1.json'), 'utf8')
		);
		const buildInfo = JSON.parse(
			await readFile(path.join(runtimeRoot, 'runtime-build.json'), 'utf8')
		);
		expect(buildInfo.delivery?.format).toBe('wasm-idle-clang-native-gzip-v1');
		expect(manifest.compiler.provenance).toEqual({
			name: 'clang',
			version: buildInfo.toolchain.llvmVersion,
			revision: buildInfo.toolchain.llvmCommit
		});

		const assets = [
			[manifest.compiler.memfs.asset, 'memfs.wasm.gz', 'wasm'],
			[manifest.compiler.clang.asset, 'clang.wasm.gz', 'wasm'],
			[manifest.compiler.lld.asset, 'lld.wasm.gz', 'wasm'],
			[manifest.compiler.sysroot.asset, 'sysroot.tar.gz', 'tar']
		] as const;
		const metadata = new Map<string, RuntimeAssetReceipt>(
			buildInfo.assets.map((asset: RuntimeAssetReceipt) => [asset.asset, asset])
		);

		for (const [manifestPath, assetName, kind] of assets) {
			expect(manifestPath).toBe(`bin/${assetName}`);
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
	}, 30_000);
});
