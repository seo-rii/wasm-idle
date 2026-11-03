import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { createCoreSourceAliasMap } from './core-source-aliases.mjs';
import { loadBundledProfile } from './verify-pinned-runtime-assets.mjs';
import {
	renderRuntimeAssetLock,
	renderRuntimeAssetVersion
} from './generate-runtime-asset-lock.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const buildOptions = {
	absWorkingDir: root,
	bundle: true,
	write: false,
	format: 'esm',
	platform: 'browser',
	logLevel: 'silent',
	tsconfigRaw: { compilerOptions: { target: 'ES2022' } },
	alias: {
		$lib: path.join(root, 'src/lib'),
		...createCoreSourceAliasMap(root),
		'@wasm-idle/llvm-core': path.join(root, 'packages/llvm-core/runtime/core/src/index.ts'),
		'@wasm-idle/llvm-core/core/verified-wasm': path.join(
			root,
			'packages/llvm-core/runtime/core/src/verified-wasm.ts'
		)
	}
};

async function importSource(contents) {
	const result = await build({
		...buildOptions,
		stdin: { contents, resolveDir: root }
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
	);
}

test('default sync and lazy lookups retain identical frozen release receipts', async () => {
	const api = await importSource(`
		export { resolveRuntimeAssetLockEntry, loadRuntimeAssetLockEntry, WASM_IDLE_ASSET_VERSION } from '@wasm-idle/core';
		export { RUNTIME_ASSET_LOCK } from './packages/core/src/runtime-asset-lock.generated.ts';
		export { WASM_LISP_MANIFEST_RECEIPT } from './src/lib/playground/wasmLispVersion.ts';
	`);
	assert.equal(api.RUNTIME_ASSET_LOCK.version, api.WASM_IDLE_ASSET_VERSION);
	const standalone = await loadBundledProfile(
		new URL('../packages/core/src/runtime-asset-lock.generated.ts', import.meta.url)
	);
	assert.deepEqual(standalone.RUNTIME_ASSET_LOCK, api.RUNTIME_ASSET_LOCK);
	assert.ok(Object.isFrozen(api.RUNTIME_ASSET_LOCK));
	assert.ok(Object.isFrozen(api.RUNTIME_ASSET_LOCK.assets));
	const options = { assetRoot: 'https://assets.example.test/release/' };
	for (const [asset, expected] of Object.entries(api.RUNTIME_ASSET_LOCK.assets)) {
		const sync = api.resolveRuntimeAssetLockEntry(asset, options);
		assert.equal(sync, expected, asset);
		assert.ok(!(sync instanceof Promise), 'the existing API stays synchronous');
		assert.equal(await api.loadRuntimeAssetLockEntry(asset, options), expected, asset);
		assert.ok(Object.isFrozen(expected));
		if (expected.layer) assert.ok(Object.isFrozen(expected.layer));
	}
	assert.deepEqual(
		api.WASM_LISP_MANIFEST_RECEIPT,
		api.RUNTIME_ASSET_LOCK.assets['wasm-lisp/runtime-manifest.v2.json']
	);
	assert.equal(
		api.resolveRuntimeAssetLockEntry(
			'wasm-lisp/runtime-manifest.v2.json',
			Object.create(options)
		),
		api.RUNTIME_ASSET_LOCK.assets['wasm-lisp/runtime-manifest.v2.json'],
		'the synchronous API also accepts inherited option properties'
	);
	assert.equal(
		await readFile(
			path.join(root, 'packages/core/src/runtime-asset-lock.generated.ts'),
			'utf8'
		),
		renderRuntimeAssetLock(api.RUNTIME_ASSET_LOCK)
	);
	assert.equal(
		await readFile(
			path.join(root, 'packages/core/src/runtime-asset-version.generated.ts'),
			'utf8'
		),
		renderRuntimeAssetVersion(api.RUNTIME_ASSET_LOCK)
	);
});

test('concurrent lazy lookups share pending work, propagate failure and retry', async () => {
	const { createRuntimeAssetLockLoader } = await importSource(`
		export { createRuntimeAssetLockLoader } from './packages/core/src/runtime-asset-lock-loader.ts';
	`);
	const receipt = { sha256: 'a'.repeat(64), bytes: 8 };
	const manifest = { schemaVersion: 1, version: 'fixture', assets: { 'runtime.wasm': receipt } };
	const options = { assetRoot: 'https://assets.example.test/release/' };
	const failure = new Error('temporary module download failure');
	let attempts = 0;
	const lookup = createRuntimeAssetLockLoader(async () => {
		attempts++;
		if (attempts === 1) throw failure;
		return manifest;
	});
	assert.equal(attempts, 0, 'constructing a loader does not start the import');
	for (const url of [
		'https://other.example.test/runtime.wasm',
		'runtime.wasm?custom=1',
		'runtime.wasm#fragment',
		'https://user@assets.example.test/release/runtime.wasm'
	])
		assert.equal(await lookup(url, options), undefined);
	assert.equal(attempts, 0, 'ineligible custom URLs do not depend on the bundled import');
	assert.equal(await lookup('runtime.wasm', { ...options, manifest }), receipt);
	assert.equal(attempts, 0, 'an explicit custom manifest needs no bundled inventory');
	const failed = await Promise.allSettled([
		lookup('runtime.wasm', options),
		lookup('runtime.wasm', options)
	]);
	assert.equal(attempts, 1);
	for (const result of failed) {
		assert.equal(result.status, 'rejected');
		assert.equal(result.reason, failure);
	}
	assert.deepEqual(
		await Promise.all([lookup('runtime.wasm', options), lookup('runtime.wasm', options)]),
		[receipt, receipt]
	);
	assert.equal(attempts, 2);
	assert.equal(await lookup('runtime.wasm', options), receipt);
	assert.equal(attempts, 2);
	assert.equal(await lookup('https://other.example.test/runtime.wasm', options), undefined);
});

test('cancelling a caller leaves shared inventory loading available to another caller', async () => {
	const { createRuntimeAssetLockLoader } = await importSource(`
		export { createRuntimeAssetLockLoader } from './packages/core/src/runtime-asset-lock-loader.ts';
	`);
	let release;
	let attempts = 0;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const lookup = createRuntimeAssetLockLoader(() => {
		attempts++;
		return pending;
	});
	const options = { assetRoot: 'https://assets.example.test/release/' };
	const controller = new AbortController();
	const stopped = lookup('runtime.wasm', { ...options, signal: controller.signal });
	const active = lookup('runtime.wasm', options);
	controller.abort(new Error('cancel lookup'));
	await assert.rejects(stopped, /cancel lookup/);
	assert.equal(attempts, 1);
	const receipt = { sha256: 'a'.repeat(64), bytes: 8 };
	release({ schemaVersion: 1, version: 'fixture', assets: { 'runtime.wasm': receipt } });
	assert.equal(await active, receipt);
	assert.equal(await lookup('runtime.wasm', options), receipt);
	assert.equal(attempts, 1);
	await assert.rejects(
		lookup('runtime.wasm', { ...options, signal: controller.signal }),
		/cancel lookup/
	);
});

test('initial cache, asset helper and loading consumers exclude the inventory chunk', async (t) => {
	const entries = {
		cache: `export { configureRuntimeAssetCache, WASM_IDLE_ASSET_VERSION } from '@wasm-idle/core';`,
		helpers: `export * from './src/lib/playground/assets.ts';`,
		bridge: `export * from './src/lib/playground/assetBridge.ts';`,
		lsp: `export * from './packages/lsp/src/persistent-assets.ts';`,
		lazy: `export { loadRuntimeAssetLockEntry } from '@wasm-idle/core';`,
		sync: `export { resolveRuntimeAssetLockEntry } from '@wasm-idle/core';`
	};
	for (const [name, contents] of Object.entries(entries)) {
		await t.test(name, async () => {
			const result = await build({
				...buildOptions,
				stdin: { contents, resolveDir: root, sourcefile: `${name}.js` },
				splitting: true,
				minify: true,
				metafile: true,
				outdir: path.join(root, '.test-in-memory-output')
			});
			const outputs = result.metafile.outputs;
			const entry = Object.keys(outputs).find(
				(file) => outputs[file].entryPoint === `${name}.js`
			);
			assert.ok(entry);
			const initial = new Set();
			function visit(file) {
				if (initial.has(file)) return;
				initial.add(file);
				for (const imported of outputs[file].imports) {
					if (imported.kind === 'import-statement' && !imported.external)
						visit(imported.path);
				}
			}
			visit(entry);
			const includesInventory = [...initial].some((file) =>
				Object.entries(outputs[file].inputs).some(
					([input, value]) =>
						input.endsWith('/runtime-asset-lock.generated.ts') &&
						value.bytesInOutput > 0
				)
			);
			assert.equal(includesInventory, name === 'sync', `${name} initial dependency closure`);
			if (name === 'cache' || name === 'lazy') {
				assert.ok(
					[...initial].reduce((bytes, file) => bytes + outputs[file].bytes, 0) < 8192
				);
			}
			if (name === 'lazy') {
				assert.ok(
					Object.entries(outputs).some(
						([file, output]) =>
							!initial.has(file) &&
							Object.entries(output.inputs).some(
								([input, value]) =>
									input.endsWith('/runtime-asset-lock.generated.ts') &&
									value.bytesInOutput > 0
							)
					),
					'the complete bundled receipt inventory remains available on demand'
				);
			}
		});
	}
});
