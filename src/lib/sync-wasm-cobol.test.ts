import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
	const archives = new Map(
		archiveFiles.map((filename) => [filename, Buffer.from(`PK\u0003\u0004fixture:${filename}`)])
	);
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
				toolchain,
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

	it('validates and atomically installs all wasm-llvm COBOL runtime assets', async () => {
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
				'c-sysroot.tar.zip',
				'cobc.zip',
				'rootfs.tar.zip',
				'runtime-build.json',
				'runtime-manifest.v1.json'
			].sort()
		);
		await expect(readFile(path.join(targetDir, 'cobc.zip'), 'utf8')).resolves.toContain(
			'fixture:cobc.zip'
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
