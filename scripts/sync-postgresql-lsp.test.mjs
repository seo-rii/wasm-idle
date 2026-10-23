import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncPostgresqlLsp } from './sync-postgresql-lsp.mjs';

test('pins the original upstream LSP module graph and WASM separately from the SDK', async () => {
	const lock = JSON.parse(
		await readFile(new URL('./postgresql-lsp-assets.lock.json', import.meta.url), 'utf8')
	);
	assert.equal(lock.version, '0.28.2');
	assert.deepEqual(
		lock.assets.map((asset) => asset.targetPath),
		['dist/lsp.js', 'dist/common.js', 'wasm/pgls.js', 'dist/pgls.wasm', 'package.json']
	);
	for (const asset of lock.assets) {
		assert.equal(asset.sourcePath, asset.targetPath);
		assert.match(asset.sha256, /^[0-9a-f]{64}$/);
		assert.ok(asset.size > 0);
	}
	assert.ok(lock.license.url.includes(lock.revision));
});

test('rejects mismatched CDN bytes before writing an executable module', async () => {
	const targetDir = await mkdtemp(path.join(tmpdir(), 'postgresql-lsp-receipt-test-'));
	try {
		await assert.rejects(
			syncPostgresqlLsp({
				targetDir,
				fetchImpl: async () => new Response('wrong release bytes')
			}),
			/(?:size|SHA-256|integrity)/i
		);
		assert.deepEqual(await readdir(targetDir), []);
	} finally {
		await rm(targetDir, { recursive: true, force: true });
	}
});
