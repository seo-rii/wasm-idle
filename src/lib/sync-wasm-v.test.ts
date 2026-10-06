import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { syncWasmVAssets } from '../../scripts/sync-wasm-v.mjs';

const tempDirs: string[] = [];
const archiveFiles = ['v.zip', 'vroot.tar.zip', 'c-sysroot.tar.zip'];

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-v-'));
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
		['v.zip', Buffer.from(zipSync({ v: Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0) }))],
		['vroot.tar.zip', Buffer.from(zipSync({ 'vroot.tar': rootfsTar }))],
		['c-sysroot.tar.zip', Buffer.from(zipSync({ 'c-sysroot.tar': cSysrootTar }))]
	]);
	for (const [filename, contents] of archives) {
		await writeFile(path.join(sourceDir, filename), contents);
	}
	const toolchain = {
		version: 'v-0.5.2-wasi-preview1-v1',
		vVersion: '0.5.2',
		vCommit: '7647ce1c6fad63b5578bc07883139906de74b2f8',
		frontendTarget: 'wasm32-wasi',
		backend: 'wasm-llvm-clang',
		acceptance: { results: { stdinStdout: true } }
	};
	await writeFile(
		path.join(sourceDir, 'runtime-manifest.v1.json'),
		`${JSON.stringify(
			{
				manifestVersion: 1,
				version: toolchain.version,
				frontend: { asset: 'v.zip', argv0: 'v' },
				rootfs: { asset: 'vroot.tar.zip' },
				cSysroot: { asset: 'c-sysroot.tar.zip' },
				profile: {
					name: 'v-wasi-clang',
					version: 1,
					vVersion: toolchain.vVersion,
					vCommit: toolchain.vCommit,
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

describe('syncWasmVAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
		);
	});

	it('requires an explicit source directory', async () => {
		await expect(syncWasmVAssets()).rejects.toThrow(
			'wasm-v sync requires an explicit source directory'
		);
	});

	it('validates producer ZIPs and atomically installs native gzip delivery assets', async () => {
		const sourceDir = await makeTempDir();
		const targetParent = await makeTempDir();
		const targetDir = path.join(targetParent, 'wasm-v');
		await writeFixture(sourceDir);
		await mkdir(targetDir);
		await writeFile(path.join(targetDir, 'stale.zip'), 'stale');

		const result = await syncWasmVAssets({ sourceDir, targetDir });

		expect(result).toEqual({ sourceDir, targetDir });
		expect((await readdir(targetDir)).sort()).toEqual(
			[
				'c-sysroot.tar.gz',
				'v.wasm.gz',
				'vroot.tar.gz',
				'runtime-build.json',
				'runtime-manifest.v1.json'
			].sort()
		);
		expect(gunzipSync(await readFile(path.join(targetDir, 'v.wasm.gz')))).toEqual(
			Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])
		);
		const deliveryManifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		);
		expect(deliveryManifest).toEqual(
			expect.objectContaining({
				frontend: { asset: 'v.wasm.gz', argv0: 'v' },
				rootfs: { asset: 'vroot.tar.gz' },
				cSysroot: { asset: 'c-sysroot.tar.gz' }
			})
		);
		const deliveryBuild = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-build.json'), 'utf8')
		);
		expect(deliveryBuild.delivery).toEqual(
			expect.objectContaining({
				format: 'wasm-idle-v-native-gzip-v1',
				sourceAssets: expect.arrayContaining([
					expect.objectContaining({ asset: 'v.zip' })
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
		const targetDir = path.join(await makeTempDir(), 'wasm-v');
		await writeFixture(sourceDir);
		await writeFile(path.join(sourceDir, 'v.zip'), 'corrupted');
		await mkdir(targetDir);
		await writeFile(path.join(targetDir, 'existing.txt'), 'existing');

		await expect(syncWasmVAssets({ sourceDir, targetDir })).rejects.toThrow(
			'v.zip does not match runtime-build.json'
		);
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});

	it('rejects a producer bundle for a different V revision', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-v');
		await writeFixture(sourceDir);
		const manifestPath = path.join(sourceDir, 'runtime-manifest.v1.json');
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.profile.vCommit = '0'.repeat(40);
		await writeFile(manifestPath, JSON.stringify(manifest));

		await expect(syncWasmVAssets({ sourceDir, targetDir })).rejects.toThrow(
			'unsupported compiler profile'
		);
	});

	it('keeps the existing target when a required runtime asset is missing', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-v');
		await writeFixture(sourceDir);
		await rm(path.join(sourceDir, 'vroot.tar.zip'));
		await mkdir(targetDir);
		await writeFile(path.join(targetDir, 'existing.txt'), 'existing');

		await expect(syncWasmVAssets({ sourceDir, targetDir })).rejects.toThrow(
			'vroot.tar.zip was not found'
		);
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});
});
