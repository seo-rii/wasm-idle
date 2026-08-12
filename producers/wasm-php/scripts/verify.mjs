import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	collectRuntimeFiles,
	MANIFEST_FILE,
	PINNED_PACKAGE_NAMES,
	readJson,
	RUNTIME_PACKAGE_NAMES
} from './runtime-manifest.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PRODUCER_ROOT = path.resolve(SCRIPT_DIR, '..');
const DIST_DIR = path.join(PRODUCER_ROOT, 'dist');
const require = createRequire(import.meta.url);
const packageJson = await readJson(path.join(PRODUCER_ROOT, 'package.json'));
/** @typedef {{ path: string; bytes: number; sha256: string }} RuntimeManifestFile */
/** @type {{ formatVersion: number; runtimeModule: string; packages: Record<string, string>; files: RuntimeManifestFile[] }} */
const manifest = await readJson(path.join(DIST_DIR, MANIFEST_FILE));
assert.equal(manifest.formatVersion, 1, 'unsupported runtime manifest format');
assert.equal(manifest.runtimeModule, 'runtime.mjs', 'unexpected runtime module path');

/** @type {Record<string, string>} */
const expectedPackages = {};
for (const packageName of PINNED_PACKAGE_NAMES) {
	const declaredVersion =
		packageJson.dependencies?.[packageName] ?? packageJson.devDependencies?.[packageName];
	assert.match(declaredVersion ?? '', /^\d+\.\d+\.\d+$/, `${packageName} is not pinned`);
	const installedPackage = await readJson(require.resolve(`${packageName}/package.json`));
	assert.equal(
		installedPackage.version,
		declaredVersion,
		`${packageName} does not match its declared version`
	);
	if (RUNTIME_PACKAGE_NAMES.includes(packageName)) {
		expectedPackages[packageName] = installedPackage.version;
	}
}
assert.deepEqual(manifest.packages, expectedPackages, 'manifest package versions are stale');

const actualFiles = await collectRuntimeFiles(DIST_DIR);
assert.deepEqual(manifest.files, actualFiles, 'manifest file sizes or hashes are stale');
assert.ok(
	actualFiles.some((file) => file.path === manifest.runtimeModule),
	'runtime module is missing'
);
assert.ok(
	actualFiles.some((file) => file.path.startsWith('assets/')),
	'PHP runtime assets are missing'
);
const filePaths = new Set(actualFiles.map((file) => file.path));
assert.deepEqual(
	actualFiles.map((file) => file.path).filter((filePath) => filePath.endsWith('.wasm')),
	['assets/php_8_4-BR2RjfzA.wasm', 'assets/php_8_4-By-NgDvF.wasm'],
	'unexpected JSPI or Asyncify PHP WASM assets'
);
assert.equal(
	actualFiles.filter((file) => file.path.endsWith('.so')).length,
	2,
	'unexpected PHP extension asset count'
);
assert.equal(
	actualFiles.filter((file) => /^chunks\/php_8_4-.*\.mjs$/.test(file.path)).length,
	2,
	'expected separate JSPI and Asyncify PHP loader chunks'
);
assert.equal(
	actualFiles.filter((file) => file.path.startsWith('chunks/')).length,
	3,
	'unexpected PHP runtime chunk count'
);
assert.ok(filePaths.has('LICENSE.txt'), 'PHP runtime license is missing');

const runtimeSource = await readFile(path.join(DIST_DIR, manifest.runtimeModule), 'utf8');
assert.match(runtimeSource, /createPhp84/, 'runtime does not export createPhp84');
assert.match(runtimeSource, /phpWasmAsyncMode/, 'runtime does not select a PHP async mode');
assert.match(runtimeSource, /jspi/, 'runtime is missing its JSPI branch');
assert.match(runtimeSource, /asyncify/, 'runtime is missing its Asyncify branch');

for (const file of actualFiles.filter((entry) => entry.path.endsWith('.mjs'))) {
	const source = await readFile(path.join(DIST_DIR, ...file.path.split('/')), 'utf8');
	const referencePattern = /(?:from|import\(|new URL\()\s*(["'`])(\.\.?\/[^"'`]+)\1/g;
	for (const match of source.matchAll(referencePattern)) {
		const referencedPath = path.posix.normalize(
			path.posix.join(path.posix.dirname(file.path), match[2])
		);
		assert.ok(
			filePaths.has(referencedPath),
			`${file.path} references missing output ${referencedPath}`
		);
	}
}
for (const file of actualFiles) {
	assert.ok(
		Number.isSafeInteger(file.bytes) && file.bytes >= 0,
		`${file.path} has an invalid size`
	);
	assert.match(file.sha256, /^[a-f0-9]{64}$/, `${file.path} has an invalid sha256`);
}

const totalBytes = actualFiles.reduce((sum, file) => sum + file.bytes, 0);
process.stdout.write(
	`Verified ${actualFiles.length} PHP runtime files (${totalBytes} uncompressed bytes).\n`
);
