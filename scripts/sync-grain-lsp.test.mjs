import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { verifyGrainLspAsset } from './sync-grain-lsp.mjs';

test('source admission rejects altered original Grain LSP bytes', () => {
	const bytes = Buffer.from('original upstream bytes');
	const receipt = {
		bytes: bytes.length,
		sha256: createHash('sha256').update(bytes).digest('hex')
	};
	assert.equal(verifyGrainLspAsset(bytes, receipt, 'Grain'), bytes);
	assert.throws(() => verifyGrainLspAsset(Buffer.from('altered'), receipt, 'Grain'), /SHA-256/);
});
