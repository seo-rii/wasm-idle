import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncPyodidePackage } from './sync-pyodide.mjs';

const temporaryDirectories = [];
const version = '314.0.7';
const coreFiles = [
	'ffi.d.ts',
	'package.json',
	'pyodide-lock.json',
	'pyodide.asm.mjs',
	'pyodide.asm.wasm',
	'pyodide.d.ts',
	'pyodide.js',
	'pyodide.mjs',
	'python_stdlib.zip'
];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function fixture() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-pyodide-sync-'));
	temporaryDirectories.push(directory);
	const sourceDir = path.join(directory, 'source');
	const targetDir = path.join(directory, 'target');
	await mkdir(sourceDir);
	await mkdir(targetDir);
	await writeFile(path.join(targetDir, 'keep-until-validated'), 'previous runtime');
	await Promise.all(coreFiles.map((file) => writeFile(path.join(sourceDir, file), file)));
	await writeFile(
		path.join(sourceDir, 'package.json'),
		JSON.stringify({ name: 'pyodide', version, type: 'module' })
	);
	await writeFile(path.join(sourceDir, 'pyodide.mjs'), `export const version = '${version}';`);
	await writeFile(
		path.join(sourceDir, 'pyodide-lock.json'),
		JSON.stringify({
			info: {
				arch: 'wasm32',
				abi_version: '2026_0',
				platform: 'emscripten_5_0_3',
				python: '3.14.2'
			},
			packages: {}
		})
	);
	return { sourceDir, targetDir };
}

test('syncs the ES module runtime with Python and ABI provenance and removes stale assets', async () => {
	const options = await fixture();
	const receipt = await syncPyodidePackage(options);
	assert.equal(receipt.version, version);
	assert.equal(receipt.pythonVersion, '3.14.2');
	assert.equal(receipt.abiVersion, '2026_0');
	assert.deepEqual(receipt.assets, coreFiles);
	for (const file of coreFiles) {
		assert.deepEqual(
			await readFile(path.join(options.targetDir, file)),
			await readFile(path.join(options.sourceDir, file))
		);
	}
	await assert.rejects(readFile(path.join(options.targetDir, 'keep-until-validated')), {
		code: 'ENOENT'
	});
	await assert.rejects(readFile(path.join(options.targetDir, 'pyodide.asm.js')), {
		code: 'ENOENT'
	});
});

test('leaves the previous runtime intact when the ES module is missing', async () => {
	const options = await fixture();
	await rm(path.join(options.sourceDir, 'pyodide.asm.mjs'));
	await assert.rejects(syncPyodidePackage(options), /Required Pyodide asset.*pyodide\.asm\.mjs/u);
	assert.equal(
		await readFile(path.join(options.targetDir, 'keep-until-validated'), 'utf8'),
		'previous runtime'
	);
});

test('rejects a package whose entry loader is from a different release before copying', async () => {
	const options = await fixture();
	await writeFile(
		path.join(options.sourceDir, 'pyodide.mjs'),
		"export const version = '0.29.3';"
	);
	await assert.rejects(syncPyodidePackage(options), /package and loader versions do not match/u);
	assert.equal(
		await readFile(path.join(options.targetDir, 'keep-until-validated'), 'utf8'),
		'previous runtime'
	);
});

test('accepts the informational lock version independently of the compatible Python and ABI', async () => {
	const options = await fixture();
	const lockPath = path.join(options.sourceDir, 'pyodide-lock.json');
	const lock = JSON.parse(await readFile(lockPath, 'utf8'));
	lock.info.version = '0.28.0.dev0';
	await writeFile(lockPath, JSON.stringify(lock));
	const receipt = await syncPyodidePackage(options);
	assert.equal(receipt.version, version);
	assert.equal(receipt.abiVersion, '2026_0');
});

test('rejects missing Python and ABI compatibility metadata before copying', async () => {
	const options = await fixture();
	await writeFile(
		path.join(options.sourceDir, 'pyodide-lock.json'),
		JSON.stringify({ info: {}, packages: {} })
	);
	await assert.rejects(syncPyodidePackage(options), /invalid Python or ABI metadata/u);
	assert.equal(
		await readFile(path.join(options.targetDir, 'keep-until-validated'), 'utf8'),
		'previous runtime'
	);
});
