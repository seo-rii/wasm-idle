import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readPhpWasmAsset } from './startup-assets.mjs';

async function fixture(t, declaration, { bytes = 8, declaredBytes = bytes } = {}) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'php-startup-assets-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const modeDir = path.join(root, 'jspi');
	await mkdir(path.join(modeDir, '8_4_25'), { recursive: true });
	const wasm = Buffer.alloc(bytes, 3);
	await writeFile(path.join(modeDir, '8_4_25/php_8_4.wasm'), wasm);
	await writeFile(
		path.join(modeDir, 'php_8_4.js'),
		`${declaration}\nexport const dependenciesTotalSize = ${declaredBytes};\n`
	);
	return { root, wasm };
}

test('reads versioned new URL assets without executing upstream loaders', async (t) => {
	const { root, wasm } = await fixture(
		t,
		"const dependencyFilename = new URL('./8_4_25/php_8_4.wasm', import.meta.url)\n\t.href;\nexport { dependencyFilename };"
	);
	const asset = await readPhpWasmAsset(root, 'jspi');
	assert.equal(asset.wasm, path.join(root, 'jspi/8_4_25/php_8_4.wasm'));
	assert.equal(asset.bytes, wasm.length);
	assert.equal(asset.sha256, createHash('sha256').update(wasm).digest('hex'));
});

test('accepts the older asset import declaration', async (t) => {
	const { root } = await fixture(
		t,
		"import dependencyFilename from './8_4_25/php_8_4.wasm';"
	);
	assert.equal((await readPhpWasmAsset(root, 'jspi')).bytes, 8);
});

test('rejects upstream asset paths outside the selected mode', async (t) => {
	const { root } = await fixture(
		t,
		"const dependencyFilename = new URL('../asyncify/php_8_4.wasm', import.meta.url).href;"
	);
	await assert.rejects(readPhpWasmAsset(root, 'jspi'), /Unsafe PHP Wasm package path/);
});

test('rejects a loader size that disagrees with the binary', async (t) => {
	const { root } = await fixture(
		t,
		"const dependencyFilename = new URL('./8_4_25/php_8_4.wasm', import.meta.url).href;",
		{ declaredBytes: 9 }
	);
	await assert.rejects(readPhpWasmAsset(root, 'jspi'), /dependency size differs/);
});

test('rejects unrecognized loader metadata', async (t) => {
	const { root } = await fixture(t, "const dependencyFilename = './8_4_25/php_8_4.wasm';");
	await assert.rejects(readPhpWasmAsset(root, 'jspi'), /Unknown pinned PHP jspi loader format/);
});
