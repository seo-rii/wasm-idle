import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '..');
const manifestPath = path.join(
	projectRoot,
	'.cache',
	'browser-native-bundle',
	'browser-native-manifest.v1.json'
);

async function assertAssetReceipt(asset, expectedUrl) {
	assert.equal(asset.url, expectedUrl);
	assert.equal(typeof asset.bytes, 'number');
	assert.ok(asset.bytes > 0);
	assert.match(asset.sha256, /^[0-9a-f]{64}$/u);
	const bundlePrefix = '/.cache/browser-native-bundle/';
	assert.ok(asset.url.startsWith(bundlePrefix));
	const assetBytes = await readFile(
		path.join(
			projectRoot,
			'.cache',
			'browser-native-bundle',
			asset.url.slice(bundlePrefix.length)
		)
	);
	assert.equal(asset.bytes, assetBytes.byteLength);
	assert.equal(createHash('sha256').update(assetBytes).digest('hex'), asset.sha256);
}

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

	const expectedTools = {
		wasm_opt: '/.cache/browser-native-bundle/tools/wasm-opt.browser.js',
		wasm_merge: '/.cache/browser-native-bundle/tools/wasm-merge.browser.js',
		wasm_metadce: '/.cache/browser-native-bundle/tools/wasm-metadce.browser.js'
	};
	for (const [name, url] of Object.entries(expectedTools)) {
		await assertAssetReceipt(manifest.binaryenTools?.[name], url);
	}
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

test('browser-native bundle records compiler and findlib asset receipts', async () => {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	await assertAssetReceipt(manifest.findlibConf, '/.cache/browser-native-bundle/findlib.conf');
	await assertAssetReceipt(
		manifest.tools?.ocamlc,
		'/.cache/browser-native-bundle/tools/ocamlc.byte.browser.js'
	);
	await assertAssetReceipt(
		manifest.tools?.js_of_ocaml,
		'/.cache/browser-native-bundle/tools/js_of_ocaml.bc.browser.js'
	);
	await assertAssetReceipt(
		manifest.tools?.wasm_of_ocaml,
		'/.cache/browser-native-bundle/tools/wasm_of_ocaml.bc.browser.js'
	);
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
	assert.equal(typeof manifest.runtimePack.indexBytes, 'number');
	assert.match(manifest.runtimePack.indexSha256, /^[0-9a-f]{64}$/u);
	assert.equal(typeof manifest.runtimePack.compressedBytes, 'number');
	assert.match(manifest.runtimePack.compressedSha256, /^[0-9a-f]{64}$/u);
	assert.match(manifest.runtimePack.uncompressedSha256, /^[0-9a-f]{64}$/u);
	assert.ok(manifest.runtimePack.fileCount > 0);
	assert.ok(manifest.runtimePack.totalBytes > 0);
	assert.ok(manifest.runtimePack.indexBytes > 0);
	assert.ok(manifest.runtimePack.compressedBytes > 0);
});

test('browser-native runtime pack index includes stdlib and yojson entries', async () => {
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	const runtimePackIndexPath = path.join(
		projectRoot,
		'.cache',
		'browser-native-bundle',
		'browser-native-runtime-pack.v1.index.json'
	);
	const runtimePackAssetPath = path.join(
		projectRoot,
		'.cache',
		'browser-native-bundle',
		'browser-native-runtime-pack.v1.bin.gz'
	);
	const runtimePackIndexBytes = await readFile(runtimePackIndexPath);
	const runtimePackAssetBytes = await readFile(runtimePackAssetPath);
	const runtimePackBytes = gunzipSync(runtimePackAssetBytes);
	const runtimePackIndex = JSON.parse(runtimePackIndexBytes.toString('utf8'));

	assert.equal(
		runtimePackIndex.format,
		'wasm-of-js-of-ocaml-browser-native-runtime-pack-index-v1'
	);
	assert.equal(runtimePackIndex.fileCount, manifest.runtimePack.fileCount);
	assert.equal(runtimePackIndex.totalBytes, manifest.runtimePack.totalBytes);
	assert.equal(runtimePackIndexBytes.byteLength, manifest.runtimePack.indexBytes);
	assert.equal(
		createHash('sha256').update(runtimePackIndexBytes).digest('hex'),
		manifest.runtimePack.indexSha256
	);
	assert.equal(runtimePackAssetBytes.byteLength, manifest.runtimePack.compressedBytes);
	assert.equal(
		createHash('sha256').update(runtimePackAssetBytes).digest('hex'),
		manifest.runtimePack.compressedSha256
	);
	assert.equal(runtimePackBytes.byteLength, manifest.runtimePack.totalBytes);
	assert.equal(
		createHash('sha256').update(runtimePackBytes).digest('hex'),
		manifest.runtimePack.uncompressedSha256
	);
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
