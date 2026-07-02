import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '..');
const manifestPath = path.join(
	projectRoot,
	'.cache',
	'browser-native-bundle',
	'browser-native-manifest.v1.json'
);

test('browser-native bundle records wasm_of_ocaml bridge patch metadata', async () => {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	const patch = manifest.toolPatches?.wasm_of_ocaml_binaryen_bridge;

	assert.ok(patch, 'missing wasm_of_ocaml bridge patch metadata');
	assert.equal(patch.tool, 'wasm_of_ocaml.bc.browser.js');
	assert.equal(patch.bridgeSymbol, 'globalThis.__wasm_of_js_system_command');
	assert.equal(typeof patch.systemFunctionName, 'string');
	assert.notEqual(patch.systemFunctionName, '');
	assert.equal(typeof patch.alreadyPatched, 'boolean');
	assert.equal(typeof patch.sourceSha256, 'string');
	assert.equal(patch.sourceSha256.length, 64);
	assert.equal(typeof patch.patchedSha256, 'string');
	assert.equal(patch.patchedSha256.length, 64);
});

test('browser-native bundle includes static Binaryen tool assets and patch metadata', async () => {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	const patch = manifest.toolPatches?.browser_binaryen_tools;

	assert.deepEqual(manifest.binaryenTools, {
		wasm_opt: '/.cache/browser-native-bundle/tools/wasm-opt.browser.js',
		wasm_merge: '/.cache/browser-native-bundle/tools/wasm-merge.browser.js',
		wasm_metadce: '/.cache/browser-native-bundle/tools/wasm-metadce.browser.js'
	});
	assert.ok(Array.isArray(patch));
	assert.equal(patch.length, 3);
	assert.deepEqual(patch.map((entry) => entry.tool).sort(), [
		'wasm-merge',
		'wasm-metadce',
		'wasm-opt'
	]);
	for (const entry of patch) {
		assert.equal(typeof entry.sourcePath, 'string');
		assert.equal(typeof entry.outPath, 'string');
		assert.equal(typeof entry.sourceSha256, 'string');
		assert.equal(entry.sourceSha256.length, 64);
		assert.equal(typeof entry.patchedSha256, 'string');
		assert.equal(entry.patchedSha256.length, 64);
	}
});

test('browser-native bundle records static version patch metadata', async () => {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	const patch = manifest.toolPatches?.version_dune_static_placeholder;

	assert.ok(patch, 'missing version dune patch metadata');
	assert.equal(typeof patch.path, 'string');
	assert.match(patch.path, /tools\/version\/dune$/);
	assert.equal(typeof patch.placeholderVersion, 'string');
	assert.notEqual(patch.placeholderVersion, '');
	assert.equal(typeof patch.alreadyPatched, 'boolean');
	assert.equal(typeof patch.sourceSha256, 'string');
	assert.equal(patch.sourceSha256.length, 64);
	assert.equal(typeof patch.patchedSha256, 'string');
	assert.equal(patch.patchedSha256.length, 64);
});

test('browser-native bundle includes the yojson package manifest', async () => {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	const yojsonPackage = manifest.packages?.find((entry) => entry.name === 'yojson');

	assert.ok(yojsonPackage, 'missing yojson package manifest');
	assert.equal(yojsonPackage.rootPath, '/static/toolchain/lib/yojson');
	assert.equal(yojsonPackage.archiveBytePath, '/static/toolchain/lib/yojson/yojson.cma');
	assert.deepEqual(yojsonPackage.requires, []);
	assert.ok(
		yojsonPackage.files.some((file) => file.path.endsWith('/yojson.cma')),
		'expected yojson.cma in browser-native bundle'
	);
	assert.ok(
		yojsonPackage.files.some((file) => file.path.endsWith('/META')),
		'expected yojson META in browser-native bundle'
	);
});

test('browser-native bundle records runtime pack metadata', async () => {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

	assert.ok(manifest.runtimePack, 'missing browser-native runtime pack metadata');
	assert.equal(manifest.runtimePack.format, 'wasm-of-js-of-ocaml-browser-native-runtime-pack-v1');
	assert.equal(
		manifest.runtimePack.asset,
		'/.cache/browser-native-bundle/browser-native-runtime-pack.v1.bin.gz'
	);
	assert.equal(
		manifest.runtimePack.index,
		'/.cache/browser-native-bundle/browser-native-runtime-pack.v1.index.json'
	);
	assert.equal(typeof manifest.runtimePack.fileCount, 'number');
	assert.equal(typeof manifest.runtimePack.totalBytes, 'number');
	assert.ok(manifest.runtimePack.fileCount > 0);
	assert.ok(manifest.runtimePack.totalBytes > 0);
});

test('browser-native runtime pack index includes stdlib and yojson entries', async () => {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	const runtimePackIndexPath = path.join(
		projectRoot,
		'.cache',
		'browser-native-bundle',
		'browser-native-runtime-pack.v1.index.json'
	);
	const runtimePackIndex = JSON.parse(await readFile(runtimePackIndexPath, 'utf8'));

	assert.equal(
		runtimePackIndex.format,
		'wasm-of-js-of-ocaml-browser-native-runtime-pack-index-v1'
	);
	assert.equal(runtimePackIndex.fileCount, manifest.runtimePack.fileCount);
	assert.equal(runtimePackIndex.totalBytes, manifest.runtimePack.totalBytes);
	assert.ok(
		runtimePackIndex.entries.some(
			(entry) => entry.runtimePath === '/static/toolchain/lib/ocaml/stdlib.cma'
		),
		'expected stdlib.cma in browser-native runtime pack'
	);
	assert.ok(
		runtimePackIndex.entries.some(
			(entry) => entry.runtimePath === '/static/toolchain/lib/yojson/yojson.cma'
		),
		'expected yojson.cma in browser-native runtime pack'
	);
});
