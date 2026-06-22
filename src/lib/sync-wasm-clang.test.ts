import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { syncWasmClangDist } from '../../scripts/sync-wasm-clang.mjs';

const tempDirs: string[] = [];
const assets = [
	'bin/clang.zip',
	'bin/lld.zip',
	'bin/memfs.zip',
	'bin/sysroot.tar.zip',
	'clangd/clangd.js',
	'clangd/clangd.wasm.gz'
];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-clang-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixture(sourceDir: string) {
	for (const asset of assets) {
		const filePath = path.join(sourceDir, asset);
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, `fixture:${asset}`);
	}
}

describe('syncWasmClangDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('generates the legacy static paths from the runtime-owned assets', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = await makeTempDir();
		await writeFixture(sourceDir);
		await mkdir(path.join(staticDir, 'clang', 'bin'), { recursive: true });
		await writeFile(path.join(staticDir, 'clang', 'bin', 'stale.zip'), 'stale');

		await syncWasmClangDist({ sourceDir, staticDir });

		await expect(
			readFile(path.join(staticDir, 'clang', 'bin', 'clang.zip'), 'utf8')
		).resolves.toBe('fixture:bin/clang.zip');
		await expect(readFile(path.join(staticDir, 'clangd', 'clangd.js'), 'utf8')).resolves.toBe(
			'fixture:clangd/clangd.js'
		);
		await expect(
			readFile(path.join(staticDir, 'clang', 'bin', 'stale.zip'), 'utf8')
		).rejects.toThrow();
	});

	it('does not clear existing assets when the runtime build is incomplete', async () => {
		const sourceDir = await makeTempDir();
		const staticDir = await makeTempDir();
		await mkdir(path.join(staticDir, 'clangd'), { recursive: true });
		await writeFile(path.join(staticDir, 'clangd', 'clangd.js'), 'existing');

		await expect(syncWasmClangDist({ sourceDir, staticDir })).rejects.toThrow(
			'Build it first with'
		);
		await expect(readFile(path.join(staticDir, 'clangd', 'clangd.js'), 'utf8')).resolves.toBe(
			'existing'
		);
	});
});
