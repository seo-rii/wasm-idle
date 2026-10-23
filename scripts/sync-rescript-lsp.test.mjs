import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncReScriptLsp, verifyReScriptAsset } from './sync-rescript-lsp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('ReScript pinned receipts reject modified or truncated assets', () => {
	const bytes = Buffer.from('original language server');
	const receipt = {
		bytes: bytes.length,
		sha256: createHash('sha256').update(bytes).digest('hex')
	};
	verifyReScriptAsset(bytes, receipt);
	assert.throws(() => verifyReScriptAsset(bytes.subarray(1), receipt), /pinned receipt/);
	const changed = Buffer.from(bytes);
	changed[0] ^= 1;
	assert.throws(() => verifyReScriptAsset(changed, receipt), /pinned receipt/);
});

async function cachedFixture(t) {
	const root = await mkdtemp(path.join(tmpdir(), 'rescript-lsp-cached-test-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const scripts = path.join(root, 'scripts');
	const targetDir = path.join(root, 'assets');
	await mkdir(scripts);
	await mkdir(targetDir);
	// Run the exact sync implementation with small valid receipts in an isolated checkout.
	// This exercises its cached path without a compiler build or production asset download.
	await copyFile(
		new URL('./sync-rescript-lsp.mjs', import.meta.url),
		path.join(scripts, 'sync-rescript-lsp.mjs')
	);
	const lock = JSON.parse(
		await readFile(new URL('./rescript-lsp-assets.lock.json', import.meta.url), 'utf8')
	);
	const assets = new Map();
	for (const name of Object.keys(lock.assets)) {
		const bytes = Buffer.from(`verified cached asset: ${name}`);
		assets.set(name, bytes);
		lock.assets[name] = {
			bytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex')
		};
		await writeFile(path.join(targetDir, name), bytes);
	}
	await writeFile(path.join(scripts, 'rescript-lsp-assets.lock.json'), JSON.stringify(lock));
	const fetch = t.mock.method(globalThis, 'fetch', () => {
		throw Error('Cached metadata repair must not download or rebuild assets');
	});
	const { syncReScriptLsp: sync } = await import(
		pathToFileURL(path.join(scripts, 'sync-rescript-lsp.mjs')).href
	);
	return { targetDir, lock, assets, fetch, sync };
}

for (const state of ['missing', 'stale']) {
	test(`cached ReScript assets regenerate ${state} deployment metadata`, async (t) => {
		const { targetDir, lock, assets, fetch, sync } = await cachedFixture(t);
		if (state === 'stale') {
			await writeFile(path.join(targetDir, 'runtime-manifest.json'), '{"version":"old"}');
			await writeFile(path.join(targetDir, 'SOURCE.txt'), 'stale source revision\n');
		}
		assert.deepEqual(await sync({ targetDir }), { targetDir, cached: true });
		assert.deepEqual(
			JSON.parse(await readFile(path.join(targetDir, 'runtime-manifest.json'), 'utf8')),
			{
				format: 'wasm-idle-rescript-lsp-v1',
				version: lock.version,
				compilerVersion: lock.compilerVersion,
				sources: lock.sources,
				assets: lock.assets,
				decoded: lock.decoded,
				sourceFiles: lock.sourceFiles
			}
		);
		const source = await readFile(path.join(targetDir, 'SOURCE.txt'), 'utf8');
		for (const entry of Object.values(lock.sources))
			assert.ok(source.includes(`${entry.repository}/tree/${entry.revision}\n`));
		assert.match(source, /pnpm run sync:rescript-lsp/);
		assert.doesNotMatch(source, /stale source revision/);
		for (const [name, bytes] of assets)
			assert.deepEqual(await readFile(path.join(targetDir, name)), bytes);
		assert.equal(fetch.mock.callCount(), 0);
	});
}

test('cached ReScript metadata write failures propagate without a producer fallback', async (t) => {
	const { targetDir, fetch, sync } = await cachedFixture(t);
	await mkdir(path.join(targetDir, 'runtime-manifest.json'));
	await assert.rejects(sync({ targetDir }), { code: 'EISDIR' });
	assert.equal(fetch.mock.callCount(), 0);
});

test(
	'ReScript assets reproduce from a separate original source tree',
	{ skip: process.env.WASM_IDLE_RUN_RESCRIPT_LSP_PRODUCER !== '1', timeout: 600000 },
	async () => {
		const original = path.join(ROOT, '.cache/rescript-lsp-producer');
		const cacheDir = await mkdtemp(path.join(ROOT, '.cache/rescript-reproduction-'));
		const targetDir = path.join(cacheDir, 'assets');
		const result = await syncReScriptLsp({
			cacheDir,
			targetDir,
			rebuild: true,
			opamRoot: process.env.WASM_IDLE_RESCRIPT_LSP_OPAM_ROOT || path.join(original, 'opam'),
			switchName: process.env.WASM_IDLE_RESCRIPT_LSP_OPAM_SWITCH || 'rescript-lsp'
		});
		const lock = JSON.parse(
			await readFile(path.join(ROOT, 'scripts/rescript-lsp-assets.lock.json'), 'utf8')
		);
		assert.deepEqual(result.assets, lock.assets);
		assert.deepEqual(result.decoded, lock.decoded);
	}
);
