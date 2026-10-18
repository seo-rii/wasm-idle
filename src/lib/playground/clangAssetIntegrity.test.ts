import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { untar } from '@wasm-idle/llvm-core';

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

// MemFS is checked in; these compiler payloads are installed by prepare:test-assets.
const hasPreparedClangRuntime = ['clang.wasm.gz', 'lld.wasm.gz', 'sysroot.tar.gz'].every((asset) =>
	existsSync(resolve(process.cwd(), 'static/clang/bin', asset))
);

// Keep the complete selected SDK inventory, including headers outside bits/stdc++.h's closure.
const publicCppHeaders = `
algorithm any array atomic barrier bit bitset cassert ccomplex cctype cerrno cfenv
cfloat charconv chrono cinttypes ciso646 climits clocale cmath codecvt compare
complex complex.h concepts condition_variable coroutine csetjmp csignal cstdalign
cstdarg cstdbool cstddef cstdint cstdio cstdlib cstring ctgmath ctime ctype.h cuchar
cwchar cwctype cxxabi.h deque errno.h exception execution expected fenv.h filesystem
flat_map flat_set float.h format forward_list fstream functional future initializer_list
inttypes.h iomanip ios iosfwd iostream istream iterator latch limits list locale map
math.h mdspan memory memory_resource mutex new numbers numeric optional ostream print
queue random ranges ratio regex scoped_allocator semaphore set shared_mutex source_location
span sstream stack stdatomic.h stddef.h stdexcept stdio.h stdlib.h stop_token streambuf
string string.h string_view strstream syncstream system_error tgmath.h thread tuple
type_traits typeindex typeinfo uchar.h unordered_map unordered_set utility valarray variant
vector version wchar.h wctype.h
`
	.trim()
	.split(/\s+/u);

describe('bundled clang asset integrity', () => {
	it('pins the rebuilt MemFS source receipt and its shipped sidecars', async () => {
		const root = resolve(process.cwd(), 'static/clang');
		const build = JSON.parse(await readFile(resolve(root, 'runtime-build.json'), 'utf8'));
		const metadata = build.toolchain.memfs;
		const receipt = metadata.buildReceipt;
		expect(receipt.format).toBe('wasm-llvm-memfs-build-v1');
		expect(receipt).not.toHaveProperty('buildReceipt');
		expect(receipt).not.toHaveProperty('files');
		expect(Object.keys(metadata.files).sort()).toEqual([
			'LICENSE.memfs-llvm.txt',
			'LICENSE.memfs-stb_sprintf.txt',
			'memfs-build-receipt.json'
		]);
		for (const [name, pin] of Object.entries(metadata.files)) {
			const bytes = await readFile(resolve(root, name));
			expect(pin).toEqual({
				bytes: bytes.byteLength,
				sha256: createHash('sha256').update(bytes).digest('hex')
			});
			if (name === 'memfs-build-receipt.json')
				expect(JSON.parse(bytes.toString('utf8'))).toEqual(receipt);
		}
		const module = gunzipSync(await readFile(resolve(root, 'bin/memfs.wasm.gz')));
		expect(receipt.outputs['memfs.wasm']).toMatchObject({
			bytes: module.byteLength,
			sha256: createHash('sha256').update(module).digest('hex')
		});
	});

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
		const splitFiles = new Map<string, Uint8Array>();
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
			const mountedFiles = new Map<string, Uint8Array>();
			untar(logical, {
				addDirectory: () => {},
				addFile: (filePath, contents) => {
					expect(mountedFiles.has(filePath), `duplicate mounted file: ${filePath}`).toBe(
						false
					);
					mountedFiles.set(filePath, contents);
				}
			});
			expect([...mountedFiles.keys()].sort()).toEqual(
				assetReceipt.files.map((file) => file.path).sort()
			);
			for (const file of assetReceipt.files) {
				expect(paths.has(file.path)).toBe(false);
				paths.add(file.path);
				const contents = mountedFiles.get(file.path)!;
				expect(contents.byteLength, file.path).toBe(file.bytes);
				expect(createHash('sha256').update(contents).digest('hex'), file.path).toBe(
					file.sha256
				);
				splitFiles.set(file.path, contents);
			}
		}
		const monolithicFiles = new Map<string, Uint8Array>();
		untar(
			gunzipSync(await readFile(resolve(process.cwd(), 'static/clang/bin/sysroot.tar.gz'))),
			{
				addDirectory: () => {},
				addFile: (filePath, contents) => monolithicFiles.set(filePath, contents)
			}
		);
		expect([...paths].sort()).toEqual([...monolithicFiles.keys()].sort());
		for (const [filePath, contents] of splitFiles) {
			expect(Buffer.compare(monolithicFiles.get(filePath)!, contents), filePath).toBe(0);
		}
		const requiredHeaders = [
			...publicCppHeaders.map((header) => `include/c++/v1/${header}`),
			...['complex.h', 'fenv.h', 'inttypes.h', 'signal.h', 'threads.h', 'uchar.h'].map(
				(header) => `include/wasm32-wasi/${header}`
			),
			'include/c++/v1/__bit/byteswap.h',
			'include/c++/v1/experimental/simd',
			'include/c++/v1/libcxx.imp',
			'include/c++/v1/module.modulemap',
			'lib/clang/22/include/wasm_simd128.h'
		];
		for (const header of requiredHeaders) {
			expect(paths.has(header), `selected SDK header is missing: ${header}`).toBe(true);
		}
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
