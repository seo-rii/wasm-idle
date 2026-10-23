import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyBytes, sourceFiles } from './sync-fennel-lsp.mjs';

test('source verification rejects a changed upstream archive', () => {
	const bytes = Buffer.from('original');
	const expected = {
		bytes: bytes.length,
		sha256: createHash('sha256').update(bytes).digest('hex')
	};
	assert.equal(verifyBytes(bytes, expected, 'source'), bytes);
	assert.throws(() => verifyBytes(Buffer.from('modified'), expected, 'source'), /verification/);
});

test('archive reader rejects corrupt input before mounting source files', () => {
	assert.throws(() => sourceFiles(Buffer.from('not gzip')));
});
