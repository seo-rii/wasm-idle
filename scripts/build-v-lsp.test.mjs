import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeVEmbeddedFileIds, vLspLock, verifyVLspAsset } from './build-v-lsp.mjs';

test('embedded-file lookup keys reproduce across source paths without changing the file data', () => {
	const generated = (unsigned, signed) =>
		`v__embed_file__EmbedFileData _v_embed_file_metadata(u64 ef_hash) {\n\tswitch(ef_hash) {\n\t\tcase ${unsigned}U: {\n\t\t\tres.path = _S("stubs/arrays.v");\n\t\t\tres.len = 3181;\n\t\t} // case ${unsigned}\n\t}\n}\n_v_embed_file_metadata( ${signed}U )`;
	assert.equal(
		normalizeVEmbeddedFileIds(generated('18446744073709551615', '-1')),
		normalizeVEmbeddedFileIds(generated('123456789', '123456789'))
	);
	assert.throws(() => normalizeVEmbeddedFileIds(generated('3', '4')), /Unknown V/);
});

test('the V browser patch preserves original tree-sitter, semantic handlers and type inference', async () => {
	const patch = await readFile(new URL('./patches/v-lsp-reactor.patch', import.meta.url));
	assert.equal(createHash('sha256').update(patch).digest('hex'), vLspLock.patchSha256);
	assert.deepEqual(
		[...patch.toString().matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]).sort(),
		[
			'src/analyzer/index/IndexingRoot.v',
			'src/analyzer/parser/batch.v',
			'src/browser/gc-roots.c',
			'src/browser/main.v',
			'src/server/BackgroundThread.v',
			'src/server/diagnostics.v',
			'src/server/general.v',
			'src/server/language_server.v'
		].sort()
	);
});
test('SDK receipts identify the same qualified original V server and standard library', async () => {
	const source = await readFile(
		new URL('../packages/lsp/src/v/assets.ts', import.meta.url),
		'utf8'
	);
	for (const receipt of Object.values(vLspLock.assets))
		assert.ok(source.includes(receipt.sha256));
	assert.throws(
		() => verifyVLspAsset(Buffer.alloc(10), vLspLock.assets['v_analyzer.wasm'], 'WASM'),
		/differs from/
	);
});
