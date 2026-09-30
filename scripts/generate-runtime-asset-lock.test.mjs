import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import {
	createRuntimeAssetLock,
	generateRuntimeAssetLock,
	renderRuntimeAssetLock
} from './generate-runtime-asset-lock.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'runtime-asset-lock-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const rootDir = path.join(directory, 'static');
	const packageFile = path.join(directory, 'package.json');
	const output = path.join(directory, 'runtime-asset-lock.generated.ts');
	await mkdir(rootDir);
	await writeFile(packageFile, JSON.stringify({ version: '1.2.3' }));
	const put = async (relativePath, bytes) => {
		const file = path.join(rootDir, relativePath);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(
			file,
			typeof bytes === 'string' || Buffer.isBuffer(bytes) ? bytes : JSON.stringify(bytes)
		);
	};
	const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
	const gzip = gzipSync(wasm);
	await put('clang/bin/clang.wasm.gz', gzip);
	await put('clang/bin/clang.js', 'export default {}');
	await put('compressed-runtime-assets.v1.json', {
		assets: ['clang/bin/clang.wasm'],
		sizes: { 'clang/bin/clang.wasm': wasm.length }
	});
	return { directory, rootDir, packageFile, output, put, wasm, gzip };
}

test('pins all runtime payload kinds and both compressed and logical bytes', async (t) => {
	const f = await fixture(t);
	for (const file of [
		'pyodide/example.whl',
		'pyodide/python_stdlib.zip',
		'clangd/clangd.js',
		'wasm-debug/debug/wamr.js',
		'lsp/typescript-libs.json',
		'shared/compiler-worker.js',
		'wasm-custom/sysroot.h',
		'robot-jungol/robot_jungol.zip'
	]) {
		await f.put(file, 'payload');
	}
	for (const file of [
		'_app/immutable/app.js',
		'favicon.png',
		'.cache/input.wasm',
		'clang/README.md',
		'clang/docs/manual.json',
		'clang/clang.js.map',
		'clang/LICENSE.txt'
	]) {
		await f.put(file, 'excluded');
	}
	const manifest = await createRuntimeAssetLock(f);
	assert.equal(manifest.version, '1.2.3');
	assert.equal(Object.keys(manifest.assets).length, 12);
	assert.deepEqual(manifest.assets['clang/bin/clang.wasm.gz'], {
		sha256: digest(f.gzip),
		bytes: f.gzip.length,
		encoding: 'gzip',
		mediaType: 'application/wasm',
		uncompressedSha256: digest(f.wasm),
		uncompressedBytes: f.wasm.length
	});
	assert.deepEqual(manifest.assets['clang/bin/clang.wasm'], {
		sha256: digest(f.wasm),
		bytes: f.wasm.length,
		mediaType: 'application/wasm',
		deliveryPath: 'clang/bin/clang.wasm.gz'
	});
	assert.deepEqual(await createRuntimeAssetLock(f), manifest);
});

test('deduplicatable hashes stay stable across package versions', async (t) => {
	const f = await fixture(t);
	const first = await createRuntimeAssetLock(f);
	await writeFile(f.packageFile, JSON.stringify({ version: '1.2.4' }));
	const second = await createRuntimeAssetLock(f);
	assert.equal(second.version, '1.2.4');
	assert.deepEqual(second.assets, first.assets);
});

test('generation and check are deterministic and reject stale release output', async (t) => {
	const f = await fixture(t);
	const manifest = await generateRuntimeAssetLock(f);
	assert.equal(await readFile(f.output, 'utf8'), renderRuntimeAssetLock(manifest));
	await generateRuntimeAssetLock({ ...f, check: true });
	await f.put('clang/bin/clang.js', 'changed');
	await assert.rejects(generateRuntimeAssetLock({ ...f, check: true }), /lock is stale/);
});

test('logical layer receipts verify the shared gzip payload and precise file range', async (t) => {
	const f = await fixture(t);
	const payload = Buffer.from('prefixFILEsuffix');
	const packed = gzipSync(payload);
	const layerPath = 'wasm-dotnet/runtime/layers/test.pack.gz';
	await f.put(layerPath, packed);
	const index = {
		schemaVersion: 1,
		layers: {
			[layerPath]: {
				sha256: digest(packed),
				compressedLength: packed.length,
				length: payload.length
			}
		},
		assets: { 'wasm-dotnet/runtime/file.wasm': { layer: layerPath, offset: 6, length: 4 } }
	};
	await f.put('layered-runtime-assets.v1.json', index);
	const manifest = await createRuntimeAssetLock(f);
	assert.deepEqual(manifest.assets['wasm-dotnet/runtime/file.wasm'], {
		sha256: digest(Buffer.from('FILE')),
		bytes: 4,
		mediaType: 'application/wasm',
		layer: { path: layerPath, offset: 6, bytes: 4 }
	});
	index.assets['wasm-dotnet/runtime/file.wasm'].length = 100;
	await f.put('layered-runtime-assets.v1.json', index);
	await assert.rejects(createRuntimeAssetLock(f), /Invalid runtime layer range/);
	index.assets['wasm-dotnet/runtime/file.wasm'].length = 4;
	index.layers[layerPath].sha256 = '0'.repeat(64);
	await f.put('layered-runtime-assets.v1.json', index);
	await assert.rejects(createRuntimeAssetLock(f), /Stale runtime layer receipt/);
});

test('rejects missing, duplicated, stale and unsafe compression aliases', async (t) => {
	for (const mutation of [
		'missing',
		'duplicate',
		'stale',
		'unsafe',
		'conflict',
		'invalid-gzip'
	]) {
		await t.test(mutation, async (t) => {
			const f = await fixture(t);
			const index = {
				assets: ['clang/bin/clang.wasm'],
				sizes: { 'clang/bin/clang.wasm': f.wasm.length }
			};
			if (mutation === 'missing') await rm(path.join(f.rootDir, 'clang/bin/clang.wasm.gz'));
			if (mutation === 'duplicate') index.assets.push(index.assets[0]);
			if (mutation === 'stale') index.sizes[index.assets[0]]++;
			if (mutation === 'unsafe') index.assets[0] = 'clang/../../../secret';
			if (mutation === 'conflict') await f.put('clang/bin/clang.wasm', 'different');
			if (mutation === 'invalid-gzip') await f.put('clang/bin/clang.wasm.gz', 'invalid');
			await f.put('compressed-runtime-assets.v1.json', index);
			await assert.rejects(createRuntimeAssetLock(f), /runtime asset|header check/);
		});
	}
});

test('does not follow symbolic links outside the release asset root', async (t) => {
	const f = await fixture(t);
	await symlink(f.packageFile, path.join(f.rootDir, 'clang/escaped.json'));
	await assert.rejects(createRuntimeAssetLock(f), /symbolic link/);
});

test('resolver requires exact origin/root scope and accepts explicit custom locks', async () => {
	const bundled = await build({
		entryPoints: [
			new URL('../packages/core/src/runtime-asset-lock.ts', import.meta.url).pathname
		],
		bundle: true,
		format: 'esm',
		platform: 'node',
		write: false
	});
	const { resolveRuntimeAssetLockEntry } = await import(
		`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
	);
	const entry = { sha256: '1'.repeat(64), bytes: 8 };
	const manifest = {
		schemaVersion: 1,
		version: 'custom-1',
		assets: { 'clang/bin/clang.wasm': entry }
	};
	const options = { assetRoot: 'https://assets.example.test/release', manifest };
	assert.equal(
		resolveRuntimeAssetLockEntry(
			'https://assets.example.test/release/clang/bin/clang.wasm',
			options
		),
		entry
	);
	assert.equal(
		resolveRuntimeAssetLockEntry('bin/clang.wasm', {
			...options,
			assetRoot: 'https://assets.example.test/release/clang/',
			assetPrefix: 'clang'
		}),
		entry
	);
	for (const input of [
		'https://other.test/release/clang/bin/clang.wasm',
		'https://assets.example.test/release-other/clang/bin/clang.wasm',
		'https://assets.example.test/release/clang/bin/clang.wasm?custom=1',
		'https://assets.example.test/release/clang/bin/clang.wasm#fragment',
		'https://user@assets.example.test/release/clang/bin/clang.wasm',
		'https://assets.example.test/release/clang%2fbin/clang.wasm',
		'https://assets.example.test/release/../clang/bin/clang.wasm',
		'https://assets.example.test/release/constructor'
	])
		assert.equal(resolveRuntimeAssetLockEntry(input, options), undefined, input);
	for (const prefix of ['../clang', '/clang', 'clang//bin', 'clang%2fbin']) {
		assert.equal(
			resolveRuntimeAssetLockEntry('bin/clang.wasm', { ...options, assetPrefix: prefix }),
			undefined
		);
	}
	assert.equal(
		resolveRuntimeAssetLockEntry('clang/bin/clang.wasm', {
			...options,
			assetRoot: 'file:///tmp/'
		}),
		undefined
	);
});
