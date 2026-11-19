import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { forthLspLock, forthLspRustupArgs, verifyForthLspAsset } from './build-forth-lsp.mjs';

test('cold builds install the standard library sources used by the qualified WASI reactor', () => {
	assert.deepEqual(forthLspRustupArgs, [
		'toolchain',
		'install',
		forthLspLock.rustVersion,
		'--profile',
		'minimal',
		'--target',
		forthLspLock.target,
		'--component',
		'rust-src'
	]);
});

test('the transport patch cannot silently change upstream language handlers or lexer', async () => {
	const patch = await readFile(new URL('./patches/forth-lsp-reactor.patch', import.meta.url));
	assert.equal(createHash('sha256').update(patch).digest('hex'), forthLspLock.patchSha256);
	const paths = [...patch.toString().matchAll(/^\+\+\+ b\/(.+)$/gm)]
		.map((match) => match[1])
		.sort();
	assert.deepEqual(paths, ['Cargo.toml', 'src/main.rs', 'src/wasm_reactor.rs']);
});

test('the SDK pins the same qualified reactor as the source producer', async () => {
	const source = await readFile(
		new URL('../packages/lsp/src/forth/assets.ts', import.meta.url),
		'utf8'
	);
	assert.ok(source.includes(forthLspLock.wasm.sha256));
	assert.ok(source.includes(forthLspLock.version));
	assert.ok(
		source.includes(String(forthLspLock.wasm.bytes).replace(/(\d)(?=(\d{3})+$)/g, '$1_'))
	);
	const different = Buffer.alloc(10);
	const digest = createHash('sha256').update(different).digest('hex');
	assert.throws(() => verifyForthLspAsset(different, forthLspLock.wasm, 'WASM'), {
		message:
			'Forth LSP WASM differs from the pinned producer receipt. ' +
			`Expected ${forthLspLock.wasm.bytes} bytes with SHA-256 ${forthLspLock.wasm.sha256}, ` +
			`received 10 bytes with SHA-256 ${digest}.`
	});
});
