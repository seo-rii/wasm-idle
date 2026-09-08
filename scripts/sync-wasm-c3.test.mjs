import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishC3Bundle } from './sync-wasm-c3.mjs';

// These bytes exercise only filesystem publication, after compiler verification.
const files = {
	'c3c.mjs': Buffer.from('verified compiler JavaScript'),
	'c3c.wasm': Buffer.from('verified compiler Wasm'),
	'producer-receipt.json': Buffer.from('{"verified":true}\n'),
	'runner-worker.js': Buffer.from('generated consumer worker')
};
const version = 'export const bundledC3Profile = { revision: "new" } as const;\n';

async function createExistingBundle(t) {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-c3-publication-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const targetDir = path.join(directory, 'wasm-c3');
	const versionModulePath = path.join(directory, 'wasmC3Version.ts');
	await mkdir(targetDir);
	await writeFile(path.join(targetDir, 'runner-worker.js'), 'existing worker');
	await writeFile(path.join(targetDir, 'stale-asset.js'), 'existing extra asset');
	return { directory, targetDir, versionModulePath };
}

test('C3 profile publication failure restores the existing bundle and preserves the profile', async (t) => {
	const { directory, targetDir, versionModulePath } = await createExistingBundle(t);
	// A directory makes the final profile rename fail after the new bundle is published.
	await mkdir(versionModulePath);
	await writeFile(path.join(versionModulePath, 'existing-profile'), 'existing profile');
	await assert.rejects(
		publishC3Bundle({ targetDir, versionModulePath, files, version }),
		(error) => error.code === 'EISDIR' || error.code === 'ENOTDIR' || error.code === 'EEXIST'
	);
	assert.deepEqual((await readdir(targetDir)).sort(), ['runner-worker.js', 'stale-asset.js']);
	assert.equal(
		await readFile(path.join(targetDir, 'runner-worker.js'), 'utf8'),
		'existing worker'
	);
	assert.equal(
		await readFile(path.join(targetDir, 'stale-asset.js'), 'utf8'),
		'existing extra asset'
	);
	assert.equal(
		await readFile(path.join(versionModulePath, 'existing-profile'), 'utf8'),
		'existing profile'
	);
	assert.deepEqual((await readdir(directory)).sort(), ['wasm-c3', 'wasmC3Version.ts']);
});

test('C3 publication replaces the complete bundle and generated profile together', async (t) => {
	const { directory, targetDir, versionModulePath } = await createExistingBundle(t);
	await writeFile(versionModulePath, 'existing profile');
	await publishC3Bundle({ targetDir, versionModulePath, files, version });
	assert.deepEqual((await readdir(targetDir)).sort(), Object.keys(files).sort());
	for (const [name, bytes] of Object.entries(files)) {
		assert.deepEqual(await readFile(path.join(targetDir, name)), bytes);
	}
	assert.equal(await readFile(versionModulePath, 'utf8'), version);
	assert.deepEqual((await readdir(directory)).sort(), ['wasm-c3', 'wasmC3Version.ts']);
});
