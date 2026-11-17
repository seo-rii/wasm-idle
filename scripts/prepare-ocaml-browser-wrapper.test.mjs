import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { prepareOcamlBrowserWrapper } from './prepare-ocaml-browser-wrapper.mjs';

async function seedBundle(sourceBundleDir) {
	await mkdir(path.join(sourceBundleDir, 'tools'), { recursive: true });
	const bytes = Buffer.from('console.log("verified Binaryen fixture");');
	const binaryenTools = {};
	for (const tool of ['wasm-opt', 'wasm-merge', 'wasm-metadce']) {
		const name = `tools/${tool}.browser.js`;
		binaryenTools[tool.replaceAll('-', '_')] = {
			url: '/.cache/browser-native-bundle/' + name,
			bytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex')
		};
		await writeFile(path.join(sourceBundleDir, name + '.gz'), gzipSync(bytes));
	}
	await writeFile(
		path.join(sourceBundleDir, 'browser-native-manifest.v1.json'),
		JSON.stringify({ binaryenTools })
	);
}

test('compiles the real wrapper under the chosen parent and removes staging after success or failure', async (t) => {
	for (const corrupt of [false, true]) {
		await t.test(corrupt ? 'failed tool receipt' : 'successful install', async (t) => {
			const root = await mkdtemp(path.join(os.tmpdir(), 'ocaml-wrapper-chosen-parent-'));
			t.after(() => rm(root, { recursive: true, force: true }));
			const temporaryParentDir = path.join(root, 'asset-filesystem');
			await mkdir(temporaryParentDir);
			const sourceRoot = path.join(root, 'source');
			const sourceBundleDir = path.join(
				sourceRoot,
				'wasm-of-js-of-ocaml/browser-native-bundle'
			);
			await seedBundle(sourceBundleDir);
			if (corrupt)
				await writeFile(
					path.join(sourceBundleDir, 'tools/wasm-opt.browser.js.gz'),
					gzipSync(Buffer.from('corrupt tool'))
				);
			const staticDir = path.join(root, 'static');
			const versionModulePath = path.join(root, 'version.ts');
			const sentinel = path.join(staticDir, 'wasm-of-js-of-ocaml/browser-native/sentinel');
			await mkdir(path.dirname(sentinel), { recursive: true });
			await writeFile(sentinel, 'previous adapter');
			await writeFile(versionModulePath, 'previous profile');
			const originalMkdtemp = fs.promises.mkdtemp;
			const stagedDirectories = [];
			const mock = t.mock.method(fs.promises, 'mkdtemp', async (prefix) => {
				const directory = await originalMkdtemp(prefix);
				stagedDirectories.push(directory);
				return directory;
			});
			syncBuiltinESMExports();
			try {
				const operation = prepareOcamlBrowserWrapper({
					sourceRoot,
					staticDir,
					versionModulePath,
					temporaryParentDir
				});
				if (corrupt) {
					await assert.rejects(
						operation,
						/compressed Binaryen tool failed receipt validation/u
					);
					assert.equal(await readFile(sentinel, 'utf8'), 'previous adapter');
					assert.equal(await readFile(versionModulePath, 'utf8'), 'previous profile');
				} else {
					await operation;
					assert.match(
						await readFile(
							path.join(staticDir, 'wasm-of-js-of-ocaml/browser-native/src/index.js'),
							'utf8'
						),
						/export/u
					);
				}
			} finally {
				mock.mock.restore();
				syncBuiltinESMExports();
			}
			assert.equal(stagedDirectories.length, 1);
			assert.equal(path.dirname(stagedDirectories[0]), temporaryParentDir);
			assert.deepEqual(await readdir(temporaryParentDir), []);
		});
	}
});

test('custom OCaml targets preserve the repository legacy cache while default migration still removes it', async (t) => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'ocaml-custom-target-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const isolatedRepo = path.join(root, 'isolated-repo');
	const script = path.join(isolatedRepo, 'scripts/sync-wasm-of-js-of-ocaml.mjs');
	await mkdir(path.dirname(script), { recursive: true });
	await writeFile(
		script,
		await readFile(new URL('./sync-wasm-of-js-of-ocaml.mjs', import.meta.url))
	);
	const legacySentinel = path.join(isolatedRepo, 'static/.cache/browser-native-bundle/sentinel');
	await mkdir(path.dirname(legacySentinel), { recursive: true });
	await writeFile(legacySentinel, 'preserve existing repository cache');
	const sourceBrowserDistDir = path.join(root, 'browser');
	await mkdir(path.join(sourceBrowserDistDir, 'src'), { recursive: true });
	await mkdir(path.join(sourceBrowserDistDir, 'browser-harness'));
	await writeFile(
		path.join(sourceBrowserDistDir, 'src/index.js'),
		'export const compiler = true;'
	);
	await writeFile(
		path.join(sourceBrowserDistDir, 'browser-harness/native-tool-worker.js'),
		'function runBinaryenTool() {}\nself.onmessage = ({ request }) => request.binaryenTools;'
	);
	const sourceBundleDir = path.join(root, 'bundle');
	await seedBundle(sourceBundleDir);
	const { syncWasmOfJsOfOcamlDist } = await import(pathToFileURL(script).href);
	const sources = {
		sourceBrowserDistDir,
		sourceBundleDir,
		versionModulePath: path.join(root, 'version.ts')
	};
	await syncWasmOfJsOfOcamlDist({
		...sources,
		targetBrowserDistDir: path.join(root, 'custom-static/browser'),
		targetBundleDir: path.join(root, 'custom-static/bundle')
	});
	assert.equal(await readFile(legacySentinel, 'utf8'), 'preserve existing repository cache');
	await syncWasmOfJsOfOcamlDist(sources);
	await assert.rejects(readFile(legacySentinel), { code: 'ENOENT' });
});
