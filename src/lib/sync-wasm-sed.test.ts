// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { checkSedRuntime, SED_WASM_RECEIPT, verifySedAsset } from '../../scripts/sync-wasm-sed.mjs';
import { SED_INTERPRETER } from './playground/sed';

describe('pinned sed distribution', () => {
	it('verifies the committed artifact, upstream license and source/config provenance offline', async () => {
		await expect(checkSedRuntime()).resolves.toBeUndefined();
		expect(SED_INTERPRETER.sha256).toBe(SED_WASM_RECEIPT.sha256);
		expect(SED_INTERPRETER.bytes).toBe(SED_WASM_RECEIPT.bytes);
	});
	it('rejects missing, truncated or modified interpreter bytes', async () => {
		const bytes = await readFile('static/wasm-sed/busybox.wasm');
		expect(() => verifySedAsset(bytes.subarray(1))).toThrow('pinned receipt');
		bytes[0] ^= 1;
		expect(() => verifySedAsset(bytes)).toThrow('pinned receipt');
	});
});
