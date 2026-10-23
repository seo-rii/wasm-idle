import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { phpantomLock, syncPhpantomLsp, verifyPhpantomAsset } from './sync-phpantom-lsp.mjs';

test('the SDK and asset preparer pin the same unmodified upstream reactor', async () => {
	const source = await readFile(
		new URL('../packages/lsp/src/php/assets.ts', import.meta.url),
		'utf8'
	);
	assert.ok(source.includes(phpantomLock.wasm.sha256));
	assert.ok(source.includes(phpantomLock.version));
	assert.ok(
		source.includes(String(phpantomLock.wasm.bytes).replace(/(\d)(?=(\d{3})+$)/g, '$1_'))
	);
});

test('rejects an incorrect archive before extracting or writing runtime assets', async () => {
	await assert.rejects(
		syncPhpantomLsp({
			archivePath: new URL('./phpantom-lsp-assets.lock.json', import.meta.url)
		}),
		/does not match the pinned/
	);
	assert.throws(
		() => verifyPhpantomAsset(Buffer.alloc(10), phpantomLock.wasm, 'WASM'),
		/does not match/
	);
});
