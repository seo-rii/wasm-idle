import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { c3LspLock, verifyC3LspAsset } from './build-c3-lsp.mjs';

test('the C3 reactor patch keeps semantic handlers and lexer sources upstream', async () => {
	const patch = await readFile(new URL('./patches/c3-lsp-reactor.patch', import.meta.url));
	assert.equal(createHash('sha256').update(patch).digest('hex'), c3LspLock.patchSha256);
	assert.deepEqual(
		[...patch.toString().matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]).sort(),
		[
			'lib/argparse.c3l/manifest.json',
			'lib/lexer.c3l/manifest.json',
			'project.json',
			'src/analysis/compiler_diagnostics.c3',
			'src/main.c3',
			'src/server/stdlib_detect.c3',
			'src/server/transport.c3',
			'src/wasm_reactor.c3'
		]
	);
});
test('SDK receipts identify the same qualified original C3 server and standard library', async () => {
	const source = await readFile(
		new URL('../packages/lsp/src/c3/assets.ts', import.meta.url),
		'utf8'
	);
	for (const receipt of Object.values(c3LspLock.assets))
		assert.ok(source.includes(receipt.sha256));
	assert.throws(
		() => verifyC3LspAsset(Buffer.alloc(10), c3LspLock.assets['c3_lsp.wasm'], 'WASM'),
		/differs from/
	);
});
