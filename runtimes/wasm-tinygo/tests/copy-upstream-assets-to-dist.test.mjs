import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { copyUpstreamAssetsToDist } from '../scripts/copy-upstream-assets-to-dist.mjs';

const temporaryDirectories = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
	);
});

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-tinygo-upstream-dist-'));
	temporaryDirectories.push(directory);
	return directory;
}

test('copies only a complete prepared upstream toolchain into a fresh dist tree', async () => {
	const root = await makeTempDir();
	const sourceDir = path.join(root, 'public', 'tools', 'upstream');
	const targetDir = path.join(root, 'dist', 'tools', 'upstream');
	await mkdir(sourceDir, { recursive: true });
	await writeFile(
		path.join(sourceDir, 'upstream-toolchain.v2.json'),
		'{"format":"wasm-idle-tinygo-upstream-assets-v2"}\n'
	);
	await writeFile(path.join(sourceDir, 'tinygo-compiler.wasm'), 'compiler');

	const result = await copyUpstreamAssetsToDist({ sourceDir, targetDir });

	assert.equal(result.sourceDir, sourceDir);
	assert.equal(result.targetDir, targetDir);
	assert.equal(await readFile(path.join(targetDir, 'tinygo-compiler.wasm'), 'utf8'), 'compiler');
});

test('rejects incomplete inputs and an existing destination', async () => {
	const root = await makeTempDir();
	const sourceDir = path.join(root, 'source');
	const targetDir = path.join(root, 'target');
	await mkdir(sourceDir, { recursive: true });

	await assert.rejects(
		copyUpstreamAssetsToDist({ sourceDir, targetDir }),
		/upstream-toolchain\.v2\.json/u
	);
	await writeFile(path.join(sourceDir, 'upstream-toolchain.v2.json'), '{}\n');
	await mkdir(targetDir, { recursive: true });
	await assert.rejects(
		copyUpstreamAssetsToDist({ sourceDir, targetDir }),
		/destination already exists/u
	);
});
