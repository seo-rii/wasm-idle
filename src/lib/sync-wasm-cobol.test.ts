import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { syncWasmCobolAssets } from '../../scripts/sync-wasm-cobol.mjs';

const tempDirs: string[] = [];
const archiveFiles = ['cobc.zip', 'rootfs.tar.zip', 'c-sysroot.tar.zip'];

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-cobol-'));
	tempDirs.push(directory);
	return directory;
}

function sha256(contents: Buffer) {
	return createHash('sha256').update(contents).digest('hex');
}

function tar(files: Record<string, string>) {
	const parts: Buffer[] = [];
	for (const [name, contents] of Object.entries(files)) {
		const bytes = Buffer.from(contents);
		const header = Buffer.alloc(512);
		header.write(name, 0, 100);
		header.write('0000644\0', 100, 8);
		header.write('0000000\0', 108, 8);
		header.write('0000000\0', 116, 8);
		header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12);
		header.write('00000000000\0', 136, 12);
		header.fill(32, 148, 156);
		header[156] = 48;
		header.write('ustar\0', 257, 6);
		header.write('00', 263, 2);
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
		parts.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
	}
	return Buffer.concat([...parts, Buffer.alloc(1024)]);
}

async function replaceArchive(sourceDir: string, asset: string, bytes: Buffer) {
	await writeFile(path.join(sourceDir, asset), bytes);
	const file = path.join(sourceDir, 'runtime-build.json');
	const build = JSON.parse(await readFile(file, 'utf8'));
	const metadata = build.assets.find((entry: { asset: string }) => entry.asset === asset);
	metadata.size = bytes.length;
	metadata.sha256 = sha256(bytes);
	build.toolchain.assets[asset] = metadata.sha256;
	await writeFile(file, JSON.stringify(build));
}

async function writeFixture(sourceDir: string) {
	const rootfsTar = tar({
		'include/gmp.h': '/* gmp */',
		'include/libcob.h': '/* cob */',
		'include/libcob/common.h': '/* common */',
		'lib/libcob.a': '!<arch>\n',
		'lib/libcobwasi.a': '!<arch>\n',
		'lib/libgmp.a': '!<arch>\n',
		'lib/libsetjmp.a': '!<arch>\n',
		'share/gnucobol/config/default.conf': 'config',
		'share/gnucobol/copy/screenio.cpy': 'copy'
	});
	const cSysrootTar = tar({
		'include/wasm32-wasi/stdio.h': '/* stdio */',
		'lib/wasm32-wasi/crt1.o': 'crt',
		'lib/wasm32-wasi/libc.a': '!<arch>\n',
		'lib/clang/22/lib/wasi/libclang_rt.builtins-wasm32.a': '!<arch>\n'
	});
	const archives = new Map([
		['cobc.zip', Buffer.from(zipSync({ cobc: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0) }))],
		['rootfs.tar.zip', Buffer.from(zipSync({ 'rootfs.tar': rootfsTar }))],
		['c-sysroot.tar.zip', Buffer.from(zipSync({ 'c-sysroot.tar': cSysrootTar }))]
	]);
	for (const [filename, contents] of archives) {
		await writeFile(path.join(sourceDir, filename), contents);
	}
	const toolchain = {
		version: 'gnucobol-3.2-wasi-preview1-v1',
		gnucobolVersion: '3.2',
		gmpVersion: '6.3.0',
		frontendTarget: 'wasm32-wasi',
		backend: 'wasm-llvm-clang'
	};
	await writeFile(
		path.join(sourceDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(
			{
				manifestVersion: 1,
				version: toolchain.version,
				frontend: { asset: 'cobc.zip', argv0: 'cobc' },
				rootfs: { asset: 'rootfs.tar.zip' },
				cSysroot: { asset: 'c-sysroot.tar.zip' },
				profile: {
					name: 'gnucobol-wasi-clang',
					version: 1,
					gnucobolVersion: toolchain.gnucobolVersion,
					gmpVersion: toolchain.gmpVersion,
					frontendTarget: toolchain.frontendTarget,
					backend: toolchain.backend
				}
			},
			null,
			2
		)}\n`
	);
	await writeFile(
		path.join(sourceDir, 'runtime-build.json'),
		`${JSON.stringify(
			{
				toolchain: {
					...toolchain,
					assets: Object.fromEntries(
						archiveFiles.map((asset) => [asset, sha256(archives.get(asset)!)])
					)
				},
				assets: archiveFiles.map((asset) => ({
					asset,
					size: archives.get(asset)!.byteLength,
					sha256: sha256(archives.get(asset)!)
				}))
			},
			null,
			2
		)}\n`
	);
}

describe('syncWasmCobolAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
		);
	});

	it('requires an explicit source directory', async () => {
		await expect(syncWasmCobolAssets()).rejects.toThrow(
			'wasm-cobol sync requires an explicit source directory'
		);
	});

	it('validates producer ZIPs and atomically installs native gzip delivery assets', async () => {
		const sourceDir = await makeTempDir();
		const targetParent = await makeTempDir();
		const targetDir = path.join(targetParent, 'wasm-cobol');
		await writeFixture(sourceDir);
		await mkdir(targetDir);
		await writeFile(path.join(targetDir, 'stale.zip'), 'stale');

		const result = await syncWasmCobolAssets({ sourceDir, targetDir });

		expect(result).toEqual({ sourceDir, targetDir });
		expect((await readdir(targetDir)).sort()).toEqual(
			[
				'c-sysroot.tar.gz',
				'cobc.wasm.gz',
				'rootfs.tar.gz',
				'runtime-build.json',
				'runtime-manifest.v1.json'
			].sort()
		);
		expect(gunzipSync(await readFile(path.join(targetDir, 'cobc.wasm.gz')))).toEqual(
			Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
		);
		const deliveryManifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		);
		expect(deliveryManifest).toEqual(
			expect.objectContaining({
				frontend: { asset: 'cobc.wasm.gz', argv0: 'cobc' },
				rootfs: { asset: 'rootfs.tar.gz' },
				cSysroot: { asset: 'c-sysroot.tar.gz' }
			})
		);
		const deliveryBuild = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-build.json'), 'utf8')
		);
		expect(deliveryBuild.delivery).toEqual(
			expect.objectContaining({
				format: 'wasm-idle-cobol-native-gzip-v1',
				sourceAssets: expect.arrayContaining([
					expect.objectContaining({ asset: 'cobc.zip' })
				])
			})
		);
		expect((await readdir(targetParent)).filter((name) => name.includes('.next-'))).toEqual([]);
		expect((await readdir(targetParent)).filter((name) => name.includes('.previous-'))).toEqual(
			[]
		);
	});

	it('keeps the existing target when source metadata does not match an archive', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-cobol');
		await writeFixture(sourceDir);
		await writeFile(path.join(sourceDir, 'cobc.zip'), 'corrupted');
		await mkdir(targetDir);
		await writeFile(path.join(targetDir, 'existing.txt'), 'existing');

		await expect(syncWasmCobolAssets({ sourceDir, targetDir })).rejects.toThrow(
			'cobc.zip does not match runtime-build.json'
		);
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});

	it('keeps the existing target when a required runtime asset is missing', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-cobol');
		await writeFixture(sourceDir);
		await rm(path.join(sourceDir, 'rootfs.tar.zip'));
		await mkdir(targetDir);
		await writeFile(path.join(targetDir, 'existing.txt'), 'existing');

		await expect(syncWasmCobolAssets({ sourceDir, targetDir })).rejects.toThrow(
			'rootfs.tar.zip was not found'
		);
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});
	it.each([
		['missing required header', tar({ 'include/gmp.h': 'gmp' })],
		['empty required library', tar({ 'lib/libcob.a': '' })],
		[
			'invalid checksum',
			(() => {
				const bytes = tar({ 'include/gmp.h': 'gmp' });
				bytes[0] ^= 1;
				return bytes;
			})()
		]
	] as const)(
		'rejects %s with matching metadata and preserves existing delivery bytes',
		async (_label, bytes) => {
			const sourceDir = await makeTempDir();
			const targetDir = path.join(await makeTempDir(), 'wasm-cobol');
			await writeFixture(sourceDir);
			await mkdir(targetDir);
			await writeFile(path.join(targetDir, 'existing.txt'), 'existing');
			await replaceArchive(
				sourceDir,
				'rootfs.tar.zip',
				Buffer.from(zipSync({ 'rootfs.tar': bytes }))
			);
			await expect(syncWasmCobolAssets({ sourceDir, targetDir })).rejects.toThrow(
				/TAR|rootfs.tar/
			);
			expect(await readdir(targetDir)).toEqual(['existing.txt']);
			expect(await readFile(path.join(targetDir, 'existing.txt'), 'utf8')).toBe('existing');
		}
	);

	it('rejects invalid compiler Wasm even when the archive hash matches', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-cobol');
		await writeFixture(sourceDir);
		await replaceArchive(
			sourceDir,
			'cobc.zip',
			Buffer.from(zipSync({ cobc: Uint8Array.of(0, 97, 115, 109, 255) }))
		);
		await expect(syncWasmCobolAssets({ sourceDir, targetDir })).rejects.toThrow(
			'not valid WebAssembly'
		);
	});
});
