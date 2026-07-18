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

async function writeFixture(sourceDir: string) {
	const rootfsTar = Buffer.alloc(1024);
	rootfsTar.write('./', 0, 100, 'utf8');
	rootfsTar.write('ustar  \0', 257, 8, 'ascii');
	const cSysrootTar = Buffer.from(rootfsTar);
	cSysrootTar.write('lib/', 0, 100, 'utf8');
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
});
