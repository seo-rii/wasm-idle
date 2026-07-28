import { runInNewContext } from 'node:vm';
import { validateWorkspaceFiles } from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

describe('cross-realm workspace content', () => {
	it('accepts Uint8Array content created by another JavaScript realm', () => {
		const content = runInNewContext('new Uint8Array([1, 2, 3])') as Uint8Array;

		expect(content instanceof Uint8Array).toBe(false);
		expect(validateWorkspaceFiles([{ path: 'data.bin', content }])).toEqual([
			{ path: 'data.bin', content }
		]);
	});

	it('continues to reject non-byte typed-array views', () => {
		const content = runInNewContext('new Uint16Array([1, 2, 3])') as unknown as Uint8Array;

		expect(() => validateWorkspaceFiles([{ path: 'data.bin', content }])).toThrow(
			'must contain a string or Uint8Array'
		);
	});
});
