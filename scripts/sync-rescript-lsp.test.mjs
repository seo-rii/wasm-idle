import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
