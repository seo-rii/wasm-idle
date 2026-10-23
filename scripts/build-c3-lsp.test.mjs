import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as producer from './build-c3-lsp.mjs';

const { c3LspLock, verifyC3LspAsset } = producer;

test('the producer reuses identical locks but invalidates every source and toolchain pin', () => {
	assert.equal(typeof producer.c3LspBuildCacheKey, 'function');
	const original = producer.c3LspBuildCacheKey(c3LspLock);
	assert.equal(producer.c3LspBuildCacheKey(structuredClone(c3LspLock)), original);
	for (const components of [
		['sources', 'server'],
		['sources', 'lexer'],
		['sources', 'argparse'],
		['compiler'],
		['emscripten']
	]) {
		for (const field of ['sha256', 'bytes', 'url']) {
			const changed = structuredClone(c3LspLock);
			const pin = components.reduce((value, component) => value[component], changed);
			pin[field] = field === 'bytes' ? pin[field] + 1 : `${pin[field]}-changed`;
			assert.notEqual(
				producer.c3LspBuildCacheKey(changed),
				original,
				`${components.join('.')}.${field} must invalidate extracted sources and tools`
			);
		}
	}
	const changedPatch = structuredClone(c3LspLock);
	changedPatch.patchSha256 = '0'.repeat(64);
	assert.notEqual(producer.c3LspBuildCacheKey(changedPatch), original);
});

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
