import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncBashLsp } from './sync-bash-lsp.mjs';

test(
	'builds reproducible external assets from the pinned original server and grammar',
	{
		skip: process.env.WASM_IDLE_RUN_BASH_LSP_ASSET_BUILD !== '1'
	},
	async () => {
		const targetDir = await mkdtemp(path.join(tmpdir(), 'wasm-idle-bash-lsp-build-'));
		try {
			const first = await syncBashLsp({ targetDir, install: false });
			const second = await syncBashLsp({ targetDir, install: false });
			assert.deepEqual(first, second);
			assert.equal(first.upstreamVersion, '5.8.1');
			for (const [name, receipt] of Object.entries(first.assets)) {
				const bytes = await readFile(path.join(targetDir, name));
				assert.equal(bytes.length, receipt.bytes);
				assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.sha256);
			}
			const manifest = JSON.parse(
				await readFile(path.join(targetDir, 'runtime-manifest.json'), 'utf8')
			);
			assert.equal(manifest.upstreamRevision, 'dd90f3d2c10ddce889b456a9ac4a1d0f079a9558');
			assert.equal(
				first.assets['tree-sitter-bash.wasm'].sha256,
				'1c14dc240687e25a1cd8a11ae5135a6c780986d724c488d74d3dd83c20954511'
			);
			assert.match(
				await readFile(path.join(targetDir, 'THIRD_PARTY_NOTICES.txt'), 'utf8'),
				/tree-sitter-bash a06c2e4415e9bc0346c6b86d401879ffb44058f7/
			);
		} finally {
			await rm(targetDir, { recursive: true, force: true });
		}
	}
);
