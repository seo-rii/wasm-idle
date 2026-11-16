import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';

import { renderRuntimeAssetLock } from './generate-runtime-asset-lock.mjs';
import {
	auditRuntimeAssetLockInputs,
	parseRuntimeAssetLockSource,
	prepareRuntimeAssetLockInputs
} from './runtime-asset-lock-inputs.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const receipt = (bytes) => ({
	sha256: sha256(bytes),
	bytes: bytes.length,
	mediaType: 'application/octet-stream'
});
const gzipReceipt = (raw, encoded = gzipSync(raw, { level: 9 })) => ({
	...receipt(encoded),
	encoding: 'gzip',
	uncompressedSha256: sha256(raw),
	uncompressedBytes: raw.length
});
const manifestFor = (assets) => ({
	schemaVersion: 1,
	version: '1.2.3',
	assets: Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b)))
});

async function fixture(t) {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'runtime-asset-lock-inputs-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const rootDir = path.join(directory, 'static');
	await mkdir(rootDir);
	const put = async (relativePath, bytes) => {
		const file = path.join(rootDir, relativePath);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, bytes);
	};
	return { directory, rootDir, put };
}

function assertClean(audit, verifiedCount) {
	assert.deepEqual(audit.missing, []);
	assert.deepEqual(audit.invalid, []);
	assert.equal(audit.missingBytes, 0);
	assert.equal(audit.verifiedCount, verifiedCount);
}

test('reads canonical generated lock data without executing TypeScript or injected expressions', () => {
	const raw = Buffer.from('original compiler');
	const manifest = manifestFor({
		'clang/bin/clang.wasm': {
			...receipt(raw),
			deliveryPath: 'clang/bin/clang.wasm.gz'
		},
		'clang/bin/clang.wasm.gz': gzipReceipt(raw)
	});
	const source = renderRuntimeAssetLock(manifest);
	assert.deepEqual(JSON.parse(JSON.stringify(parseRuntimeAssetLockSource(source))), manifest);
	const injected = source
		.replace('freezeLock({', 'freezeLock((globalThis.__assetInputParserExecuted = true, {')
		.replace('\n});\n\nfunction', '\n}));\n\nfunction');
	const entryLine = source.split('\n').find((line) => line.includes('"clang/bin/clang.wasm":'));
	const sources = [
		source + '\nglobalThis.__assetInputParserExecuted = true;\n',
		injected,
		source.replace(entryLine, entryLine + '\n' + entryLine),
		source.replace(
			'schemaVersion: 1,',
			'schemaVersion: (globalThis.__assetInputParserExecuted = true, 1),'
		),
		source.replace("'1.2.3'", '(globalThis.__assetInputParserExecuted = true)'),
		source.replace('// prettier-ignore', '// unexpected generated source')
	];
	try {
		for (const input of sources) {
			assert.throws(() => parseRuntimeAssetLockSource(input));
			assert.equal(globalThis.__assetInputParserExecuted, undefined);
		}
	} finally {
		delete globalThis.__assetInputParserExecuted;
	}
});

test('reports every missing physical dependency, including an unindexed file and a shared layer', async (t) => {
	const f = await fixture(t);
	const wasm = Buffer.from('compiler');
	const encoded = gzipSync(wasm, { level: 9 });
	const layer = Buffer.from('prefixLIBsuffix');
	const layerEncoded = gzipSync(layer, { level: 9 });
	const loader = Buffer.from('original language server loader');
	const data = Buffer.from('unindexed runtime data');
	const metadata = Buffer.from('{}\n');
	const manifest = manifestFor({
		'clang/bin/clang.wasm': {
			...receipt(wasm),
			deliveryPath: 'clang/bin/clang.wasm.gz'
		},
		'clang/bin/clang.wasm.gz': gzipReceipt(wasm, encoded),
		'clang/runtime-manifest.v1.json': receipt(metadata),
		'clangd/clangd.js': receipt(loader),
		'wasm-c3/unindexed.data': receipt(data),
		'wasm-commonlisp/runtime.pack.gz.bin': gzipReceipt(layer, layerEncoded),
		'wasm-commonlisp/stdlib.bin': {
			...receipt(Buffer.from('LIB')),
			layer: { path: 'wasm-commonlisp/runtime.pack.gz.bin', offset: 6, bytes: 3 }
		}
	});
	await f.put('clang/runtime-manifest.v1.json', metadata);
	const audit = await auditRuntimeAssetLockInputs({ rootDir: f.rootDir, manifest });
	const byPath = new Map(audit.missing.map((entry) => [entry.path, entry]));
	assert.deepEqual([...byPath.keys()].sort(), [
		'clang/bin/clang.wasm.gz',
		'clangd/clangd.js',
		'wasm-c3/unindexed.data',
		'wasm-commonlisp/runtime.pack.gz.bin'
	]);
	for (const [name, group] of [
		['clang/bin/clang.wasm.gz', 'clang'],
		['wasm-c3/unindexed.data', 'c3'],
		['wasm-commonlisp/runtime.pack.gz.bin', 'commonlisp']
	]) {
		assert.deepEqual(byPath.get(name), {
			path: name,
			bytes: manifest.assets[name].bytes,
			sha256: manifest.assets[name].sha256,
			group
		});
	}
	assert.ok(['clang', 'clangd'].includes(byPath.get('clangd/clangd.js').group));
	assert.equal(byPath.get('clangd/clangd.js').bytes, loader.length);
	assert.equal(byPath.get('clangd/clangd.js').sha256, sha256(loader));
	assert.equal(
		audit.missingBytes,
		encoded.length + loader.length + data.length + layerEncoded.length
	);
	assert.equal(audit.verifiedCount, 1);
	assert.deepEqual(audit.invalid, []);
});

test('an identity file never substitutes for its missing declared gzip delivery', async (t) => {
	const f = await fixture(t);
	const raw = Buffer.from('source compiler bytes');
	const manifest = manifestFor({
		'clang/bin/clang.wasm': {
			...receipt(raw),
			deliveryPath: 'clang/bin/clang.wasm.gz'
		},
		'clang/bin/clang.wasm.gz': gzipReceipt(raw)
	});
	await f.put('clang/bin/clang.wasm', raw);
	const audit = await auditRuntimeAssetLockInputs({ rootDir: f.rootDir, manifest });
	assert.deepEqual(
		audit.missing.map((entry) => entry.path),
		['clang/bin/clang.wasm.gz']
	);
	assert.equal(audit.missingBytes, manifest.assets['clang/bin/clang.wasm.gz'].bytes);
	assert.equal(audit.verifiedCount, 0);
	assert.deepEqual(audit.invalid, []);
});

test('rejects same-size corruption before preparing any other group and preserves the invalid file', async (t) => {
	const f = await fixture(t);
	const expected = Buffer.from('good loader');
	const corrupt = Buffer.from('evil loader');
	assert.equal(corrupt.length, expected.length);
	const manifest = manifestFor({
		'clangd/clangd.js': receipt(expected),
		'wasm-c3/runtime.data': receipt(Buffer.from('missing data'))
	});
	await f.put('clangd/clangd.js', corrupt);
	const audit = await auditRuntimeAssetLockInputs({ rootDir: f.rootDir, manifest });
	assert.equal(audit.invalid.length, 1);
	assert.equal(audit.invalid[0].path, 'clangd/clangd.js');
	assert.ok(audit.invalid[0].reason.length > 0);
	assert.deepEqual(
		audit.missing.map((entry) => entry.path),
		['wasm-c3/runtime.data']
	);
	let calls = 0;
	await assert.rejects(
		prepareRuntimeAssetLockInputs({
			rootDir: f.rootDir,
			manifest,
			prepareGroup: async () => {
				calls += 1;
				await f.put('clangd/clangd.js', expected);
			}
		})
	);
	assert.equal(calls, 0);
	assert.deepEqual(await readFile(path.join(f.rootDir, 'clangd/clangd.js')), corrupt);
});

test('prepares each missing group once, coalesces clangd into clang, and reuses verified inputs', async (t) => {
	const f = await fixture(t);
	const raw = Buffer.from('compiler');
	const encoded = gzipSync(raw, { level: 9 });
	const files = {
		'clang/bin/clang.wasm.gz': encoded,
		'clangd/clangd.js': Buffer.from('language server loader'),
		'wasm-c3/producer-receipt.json': Buffer.from('{"producer":"fixture"}\n')
	};
	const manifest = manifestFor({
		...Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, receipt(bytes)])),
		'clang/bin/clang.wasm.gz': gzipReceipt(raw, encoded)
	});
	const calls = [];
	const prepareGroup = async (group, { rootDir }) => {
		assert.equal(rootDir, f.rootDir);
		calls.push(group);
		assert.ok(['clang', 'c3'].includes(group));
		for (const [name, bytes] of Object.entries(files)) {
			if (
				(group === 'clang' && /^clang(?:d)?\//u.test(name)) ||
				(group === 'c3' && name.startsWith('wasm-c3/'))
			)
				await f.put(name, bytes);
		}
	};
	const source = renderRuntimeAssetLock(manifest);
	assertClean(
		await prepareRuntimeAssetLockInputs({ rootDir: f.rootDir, manifest, prepareGroup }),
		3
	);
	assert.deepEqual(calls.sort(), ['c3', 'clang']);
	assertClean(
		await prepareRuntimeAssetLockInputs({
			rootDir: f.rootDir,
			manifest,
			prepareGroup: async () => assert.fail('verified inputs must not be prepared again')
		}),
		3
	);
	assert.equal(renderRuntimeAssetLock(manifest), source);
});

test('budgets the full selected group and decoded staging when only a tiny input is missing', async (t) => {
	const f = await fixture(t);
	const compiler = Buffer.alloc(4096, 65);
	const encoded = gzipSync(compiler, { level: 9 });
	const otherRuntime = Buffer.alloc(20 * 1024, 66);
	const otherEncoded = gzipSync(otherRuntime, { level: 9 });
	const loader = Buffer.from('loader');
	const manifest = manifestFor({
		'clang/bin/clang.wasm': {
			...receipt(compiler),
			deliveryPath: 'clang/bin/clang.wasm.gz'
		},
		'clang/bin/clang.wasm.gz': gzipReceipt(compiler, encoded),
		'clangd/clangd.js': receipt(loader),
		'wasm-c3/c3c.wasm.gz': gzipReceipt(otherRuntime, otherEncoded)
	});
	await f.put('clang/bin/clang.wasm.gz', encoded);
	await f.put('wasm-c3/c3c.wasm.gz', otherEncoded);
	const required =
		loader.length + 2 * (encoded.length + compiler.length + loader.length) + 32 * 1024 * 1024;
	let available = required - 1;
	const statfsMock = t.mock.method(fs.promises, 'statfs', async () => ({
		bavail: available,
		bsize: 1
	}));
	syncBuiltinESMExports();
	const calls = [];
	const prepareGroup = async (group) => {
		calls.push(group);
		await f.put('clangd/clangd.js', loader);
	};
	try {
		await assert.rejects(
			prepareRuntimeAssetLockInputs({ rootDir: f.rootDir, manifest, prepareGroup }),
			new RegExp('requires at least ' + required + ' free bytes')
		);
		assert.deepEqual(calls, []);
		await assert.rejects(stat(path.join(f.rootDir, 'clangd/clangd.js')), { code: 'ENOENT' });
		available = required;
		assertClean(
			await prepareRuntimeAssetLockInputs({ rootDir: f.rootDir, manifest, prepareGroup }),
			3
		);
		assert.deepEqual(calls, ['clang']);
		assert.deepEqual(await readFile(path.join(f.rootDir, 'clang/bin/clang.wasm.gz')), encoded);
		assert.deepEqual(await readFile(path.join(f.rootDir, 'wasm-c3/c3c.wasm.gz')), otherEncoded);
	} finally {
		statfsMock.mock.restore();
		syncBuiltinESMExports();
	}
});

test('normalizes only declared delivery aliases and retains direct files and index metadata byte-for-byte', async (t) => {
	const f = await fixture(t);
	const raw = Buffer.from(JSON.stringify({ modules: 'x'.repeat(300 * 1024) }));
	const encoded = gzipSync(raw, { level: 9 });
	const direct = Buffer.alloc(300 * 1024, 65);
	const extra = Buffer.alloc(300 * 1024, 66);
	const logical = 'wasm-lean4/lean-init.index.json';
	const delivery = logical + '.gz';
	const index = Buffer.from(
		JSON.stringify({ assets: [logical], sizes: { [logical]: raw.length } }) + '\n'
	);
	const manifest = manifestFor({
		'compressed-runtime-assets.v1.json': receipt(index),
		[logical]: { ...receipt(raw), deliveryPath: delivery },
		[delivery]: gzipReceipt(raw, encoded),
		'wasm-parigp/gp.mjs': receipt(direct)
	});
	await f.put('compressed-runtime-assets.v1.json', index);
	await f.put('wasm-parigp/gp.mjs', direct);
	await f.put('wasm-parigp/unlisted.mjs', extra);
	const calls = [];
	const source = renderRuntimeAssetLock(manifest);
	const audit = await prepareRuntimeAssetLockInputs({
		rootDir: f.rootDir,
		manifest,
		prepareGroup: async (group, { rootDir }) => {
			assert.equal(rootDir, f.rootDir);
			calls.push(group);
			await f.put(logical, raw);
		}
	});
	assertClean(audit, 3);
	assert.deepEqual(calls, ['lean4']);
	assert.deepEqual(await readFile(path.join(f.rootDir, delivery)), encoded);
	assert.deepEqual(gunzipSync(await readFile(path.join(f.rootDir, delivery))), raw);
	assert.deepEqual(
		await readFile(path.join(f.rootDir, 'compressed-runtime-assets.v1.json')),
		index
	);
	assert.deepEqual(await readFile(path.join(f.rootDir, 'wasm-parigp/gp.mjs')), direct);
	assert.deepEqual(await readFile(path.join(f.rootDir, 'wasm-parigp/unlisted.mjs')), extra);
	await assert.rejects(stat(path.join(f.rootDir, 'wasm-parigp/gp.mjs.gz')), { code: 'ENOENT' });
	await assert.rejects(stat(path.join(f.rootDir, 'wasm-parigp/unlisted.mjs.gz')), {
		code: 'ENOENT'
	});
	assert.equal(renderRuntimeAssetLock(manifest), source);
});

test('does not publish gzip bytes that disagree with the pinned decoded or compressed receipt', async (t) => {
	for (const mutation of ['decoded', 'compressed']) {
		await t.test(mutation, async (t) => {
			const f = await fixture(t);
			const raw = Buffer.from('correct source bytes');
			const rawPath = 'wasm-lean4/lean-init.index.json';
			const gzipPath = rawPath + '.gz';
			const manifest = manifestFor({
				[rawPath]: { ...receipt(raw), deliveryPath: gzipPath },
				[gzipPath]: gzipReceipt(raw)
			});
			if (mutation === 'compressed') manifest.assets[gzipPath].sha256 = '0'.repeat(64);
			const source = renderRuntimeAssetLock(manifest);
			await assert.rejects(
				prepareRuntimeAssetLockInputs({
					rootDir: f.rootDir,
					manifest,
					prepareGroup: async () =>
						f.put(
							rawPath,
							mutation === 'decoded' ? Buffer.from('corrupt source bytes') : raw
						)
				})
			);
			await assert.rejects(stat(path.join(f.rootDir, gzipPath)), { code: 'ENOENT' });
			assert.equal(renderRuntimeAssetLock(manifest), source);
		});
	}
});

test('rechecks previously verified files after a successful preparation callback', async (t) => {
	const f = await fixture(t);
	const expected = Buffer.from('correct data');
	const loader = Buffer.from('good loader');
	const manifest = manifestFor({
		'clangd/clangd.js': receipt(loader),
		'wasm-c3/data.bin': receipt(expected)
	});
	await f.put('clangd/clangd.js', loader);
	await assert.rejects(
		prepareRuntimeAssetLockInputs({
			rootDir: f.rootDir,
			manifest,
			prepareGroup: async () => {
				await f.put('wasm-c3/data.bin', expected);
				await f.put('clangd/clangd.js', Buffer.from('evil loader'));
			}
		})
	);
	const audit = await auditRuntimeAssetLockInputs({ rootDir: f.rootDir, manifest });
	assert.equal(audit.invalid.length, 1);
	assert.equal(audit.invalid[0].path, 'clangd/clangd.js');
	assert.deepEqual(audit.missing, []);
	assert.equal(audit.verifiedCount, 1);
});

test('normalization refuses a logical identity symlink outside the asset root', async (t) => {
	const f = await fixture(t);
	const raw = Buffer.from('preserve the original bytes');
	const outside = path.join(f.directory, 'outside.json');
	const logical = 'wasm-lean4/lean-init.index.json';
	const delivery = logical + '.gz';
	await writeFile(outside, raw);
	await mkdir(path.dirname(path.join(f.rootDir, logical)), { recursive: true });
	await symlink(outside, path.join(f.rootDir, logical));
	const manifest = manifestFor({
		[logical]: { ...receipt(raw), deliveryPath: delivery },
		[delivery]: gzipReceipt(raw)
	});
	await assert.rejects(
		prepareRuntimeAssetLockInputs({
			rootDir: f.rootDir,
			manifest,
			prepareGroup: async () => {}
		})
	);
	assert.deepEqual(await readFile(outside), raw);
	await assert.rejects(stat(path.join(f.rootDir, delivery)), { code: 'ENOENT' });
});

test('an unknown missing group requires manual preparation without invoking a preparer', async (t) => {
	const f = await fixture(t);
	const manifest = manifestFor({
		'wasm-unknown/engine.wasm': receipt(Buffer.from('original engine'))
	});
	let calls = 0;
	await assert.rejects(
		prepareRuntimeAssetLockInputs({
			rootDir: f.rootDir,
			manifest,
			prepareGroup: async () => {
				calls += 1;
			}
		}),
		/manual|unsupported|unknown/iu
	);
	assert.equal(calls, 0);
});

test('rejects escaping paths and symbolic links without reading or replacing outside files', async (t) => {
	for (const kind of [
		'relative escape',
		'absolute',
		'backslash',
		'encoded path',
		'file link',
		'directory link'
	]) {
		await t.test(kind, async (t) => {
			const f = await fixture(t);
			const outside = path.join(f.directory, 'outside');
			await mkdir(outside);
			const bytes = Buffer.from('preserve outside bytes');
			const sentinel = path.join(outside, 'engine.wasm');
			await writeFile(sentinel, bytes);
			let name;
			if (kind === 'relative escape') name = '../outside/engine.wasm';
			if (kind === 'absolute') name = sentinel;
			if (kind === 'backslash') name = 'clang\\engine.wasm';
			if (kind === 'encoded path') name = 'clang/%2e%2e/engine.wasm';
			if (kind === 'file link') {
				await mkdir(path.join(f.rootDir, 'clang'));
				name = 'clang/engine.wasm';
				await symlink(sentinel, path.join(f.rootDir, name));
			}
			if (kind === 'directory link') {
				name = 'clang/engine.wasm';
				await symlink(outside, path.join(f.rootDir, 'clang'));
			}
			const manifest = manifestFor({ [name]: receipt(bytes) });
			let audit;
			try {
				audit = await auditRuntimeAssetLockInputs({ rootDir: f.rootDir, manifest });
			} catch (error) {
				assert.match(
					String(error),
					/invalid|receipt|path|unsafe|escape|symlink|symbolic|relative/iu
				);
			}
			if (audit) {
				assert.ok(
					audit.invalid.some((entry) => entry.path === name && entry.reason.length > 0)
				);
				assert.equal(audit.verifiedCount, 0);
			}
			let calls = 0;
			await assert.rejects(
				prepareRuntimeAssetLockInputs({
					rootDir: f.rootDir,
					manifest,
					prepareGroup: async () => {
						calls += 1;
					}
				})
			);
			assert.equal(calls, 0);
			assert.deepEqual(await readFile(sentinel), bytes);
		});
	}
});
