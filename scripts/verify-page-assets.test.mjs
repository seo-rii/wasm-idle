import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { compactRuntimeAliases } from './compact-runtime-aliases.mjs';
import { loadPinnedPageLspAssets, verifyPageAssets } from './verify-page-assets.mjs';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const receipt = (bytes) => ({
	bytes: Buffer.byteLength(bytes),
	sha256: createHash('sha256').update(bytes).digest('hex')
});

async function fixture(t, assets = {}) {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'page-assets-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const buildDir = path.join(directory, 'build');
	const staticDir = path.join(directory, 'static');
	await mkdir(buildDir);
	await mkdir(staticDir);
	const manifest = { schemaVersion: 1, version, assets };
	return {
		buildDir,
		staticDir,
		manifest,
		async write(name, bytes, target = buildDir) {
			await mkdir(path.dirname(path.join(target, name)), { recursive: true });
			await writeFile(path.join(target, name), bytes);
		},
		verify: () => verifyPageAssets({ buildDir, staticDir, manifest })
	};
}

test('verifies raw release bytes without executing them', async (t) => {
	const bytes = Buffer.from('throw new Error("must never execute the runtime");');
	const f = await fixture(t, { 'wasm-example/runner.js': receipt(bytes) });
	await f.write('wasm-example/runner.js', bytes);
	assert.deepEqual(await f.verify(), {
		version,
		assetCount: 1,
		lspAssetCount: 0,
		logicalBytes: bytes.length
	});
});

test('fails for missing release assets and same-sized corruption', async (t) => {
	const f = await fixture(t, { 'wasm-example/runtime.wasm': receipt('abcd') });
	await assert.rejects(f.verify(), /Missing page asset.*runtime.wasm/);
	await f.write('wasm-example/runtime.wasm', 'abce');
	await assert.rejects(f.verify(), /size\/SHA-256 mismatch.*runtime.wasm/);
});

test('rejects an asset lock from another package version', async (t) => {
	const f = await fixture(t);
	f.manifest.version = '0.0.0';
	await assert.rejects(f.verify(), /current package\/core release version/);
});

test('verifies indexed gzip logical bytes and requires the delivery mapping', async (t) => {
	const name = 'wasm-example/runtime.wasm';
	const bytes = Buffer.from('real runtime logical bytes');
	const f = await fixture(t, { [name]: { ...receipt(bytes), deliveryPath: `${name}.gz` } });
	await f.write(`${name}.gz`, gzipSync(bytes));
	await f.write(
		'compressed-runtime-assets.v1.json',
		JSON.stringify({ assets: [name], sizes: { [name]: bytes.length } })
	);
	assert.equal((await f.verify()).assetCount, 1);
	await f.write('compressed-runtime-assets.v1.json', JSON.stringify({ assets: [], sizes: {} }));
	// A raw copy must not hide a broken service worker delivery index.
	await f.write(name, bytes);
	await assert.rejects(f.verify(), /Missing compressed page asset mapping/);
});

test('detects gzip corruption and stale uncompressed sizes', async (t) => {
	const name = 'wasm-example/runtime.wasm';
	const bytes = Buffer.from('expected runtime');
	const f = await fixture(t, { [name]: receipt(bytes) });
	await f.write(`${name}.gz`, gzipSync(Buffer.from('unexpected bytes')));
	await f.write(
		'compressed-runtime-assets.v1.json',
		JSON.stringify({ assets: [name], sizes: { [name]: bytes.length } })
	);
	await assert.rejects(f.verify(), /pinned size|size\/SHA-256 mismatch/);
	await f.write(
		'compressed-runtime-assets.v1.json',
		JSON.stringify({ assets: [name], sizes: { [name]: bytes.length + 1 } })
	);
	await assert.rejects(f.verify(), /Stale compressed page asset size/);
});

test('permits app-only compression index additions while preserving pinned runtime entries', async (t) => {
	const name = 'wasm-example/runtime.wasm';
	const bytes = Buffer.from('release runtime');
	const original = JSON.stringify({ assets: [name], sizes: { [name]: bytes.length } });
	const f = await fixture(t, {
		[name]: { ...receipt(bytes), deliveryPath: `${name}.gz` },
		'compressed-runtime-assets.v1.json': receipt(original)
	});
	await f.write('compressed-runtime-assets.v1.json', original, f.staticDir);
	await f.write(`${name}.gz`, gzipSync(bytes));
	await f.write(
		'compressed-runtime-assets.v1.json',
		JSON.stringify({
			assets: ['_app/immutable/workers/editor.js', name],
			sizes: { '_app/immutable/workers/editor.js': 1234, [name]: bytes.length }
		})
	);
	assert.equal((await f.verify()).assetCount, 2);
	await f.write('compressed-runtime-assets.v1.json', `${original}\n`, f.staticDir);
	await assert.rejects(f.verify(), /pinned size|size\/SHA-256 mismatch/);
});

test('requires the built compression index even when the producer index matches', async (t) => {
	const original = JSON.stringify({ assets: [], sizes: {} });
	const f = await fixture(t, { 'compressed-runtime-assets.v1.json': receipt(original) });
	await f.write('compressed-runtime-assets.v1.json', original, f.staticDir);
	await assert.rejects(f.verify(), /Missing page asset.*compressed-runtime-assets/);
});

test('verifies logical slices and pinned storage bytes of a shared gzip layer', async (t) => {
	const first = Buffer.from('first runtime');
	const second = Buffer.from('second runtime');
	const decoded = Buffer.concat([first, second]);
	const stored = gzipSync(decoded);
	const layer = 'wasm-example/layers/shared.pack.gz';
	const a = 'wasm-example/a.bin';
	const b = 'wasm-example/b.bin';
	const f = await fixture(t, {
		[a]: { ...receipt(first), layer: { path: layer, offset: 0, bytes: first.length } },
		[b]: {
			...receipt(second),
			layer: { path: layer, offset: first.length, bytes: second.length }
		},
		[layer]: {
			...receipt(stored),
			encoding: 'gzip',
			uncompressedBytes: decoded.length,
			uncompressedSha256: receipt(decoded).sha256
		}
	});
	const index = {
		schemaVersion: 1,
		layers: {
			[layer]: {
				length: decoded.length,
				compressedLength: stored.length,
				sha256: receipt(stored).sha256
			}
		},
		assets: {
			[a]: { layer, offset: 0, length: first.length },
			[b]: { layer, offset: first.length, length: second.length }
		}
	};
	await f.write(layer, stored);
	await f.write('layered-runtime-assets.v1.json', JSON.stringify(index));
	assert.equal((await f.verify()).assetCount, 3);
	index.assets[b].offset = 0;
	await f.write('layered-runtime-assets.v1.json', JSON.stringify(index));
	await assert.rejects(f.verify(), /Stale layered page asset entry/);
});

test('checks each layer slice hash even if the layer descriptor is internally consistent', async (t) => {
	const name = 'wasm-example/a.bin';
	const layer = 'wasm-example/shared.pack.gz';
	const stored = gzipSync(Buffer.from('wrong'));
	const f = await fixture(t, {
		[name]: { ...receipt('right'), layer: { path: layer, offset: 0, bytes: 5 } }
	});
	await f.write(layer, stored);
	await f.write(
		'layered-runtime-assets.v1.json',
		JSON.stringify({
			schemaVersion: 1,
			layers: {
				[layer]: {
					length: 5,
					compressedLength: stored.length,
					sha256: receipt(stored).sha256
				}
			},
			assets: { [name]: { layer, offset: 0, length: 5 } }
		})
	);
	await assert.rejects(f.verify(), /size\/SHA-256 mismatch.*a.bin/);
});

test('accepts a removed gzip alias only with the official compactor worker receipt', async (t) => {
	const name = 'wasm-example/runtime.wasm.gz';
	const stored = gzipSync(Buffer.from('runtime'));
	const f = await fixture(t, { [name]: receipt(stored), [`${name}.bin`]: receipt(stored) });
	await mkdir(path.join(f.buildDir, '_app'));
	await f.write(name, stored);
	await f.write(`${name}.bin`, stored);
	await f.write(
		'worker.js',
		'async function worker() { return (await fetchDynamicModule(event.request, url)) || null; }\nasync function compressed() { const compressedResponse = await fetch(compressedUrl, { }); }'
	);
	await compactRuntimeAliases(f.buildDir, { dropLegacyAliases: true });
	assert.equal((await f.verify()).assetCount, 2);
	await f.write('worker.js', 'changed worker');
	await assert.rejects(f.verify(), /Compact page asset worker receipt mismatch/);
});

test('rejects unsafe paths and duplicate compression mappings', async (t) => {
	const f = await fixture(t, { '../outside': receipt('no') });
	await assert.rejects(f.verify(), /Unsafe page asset path/);
	delete f.manifest.assets['../outside'];
	await f.write(
		'compressed-runtime-assets.v1.json',
		JSON.stringify({
			assets: ['wasm-example/a', 'wasm-example/a'],
			sizes: { 'wasm-example/a': 1 }
		})
	);
	await assert.rejects(f.verify(), /duplicate compressed page asset/);
});

test('separate LSP locks cover Java and every standalone producer omitted by the core lock', async () => {
	const assets = await loadPinnedPageLspAssets();
	const java = JSON.parse(
		await readFile(new URL('./javacs-teavm-lsp-assets.lock.json', import.meta.url))
	);
	for (const item of java.assets)
		assert.deepEqual(assets[`wasm-java-lsp/${item.path}`], {
			bytes: item.bytes,
			sha256: item.sha256
		});
	for (const language of [
		'c3',
		'v',
		'nim',
		'grain',
		'fennel',
		'rescript',
		'cobol',
		'forth',
		'postgresql',
		'phpantom',
		'java',
		'bash'
	])
		assert.ok(
			Object.keys(assets).some((name) => name.startsWith(`wasm-${language}-lsp/`)),
			`${language} LSP must be required`
		);
});
