import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSharedSafeRandomGet } from '../src/rustc-runtime.js';

describe('shared-memory random shim', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('fills shared wasm memory without passing a shared view to crypto.getRandomValues', () => {
		const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
		const randomSpy = vi
			.spyOn(globalThis.crypto, 'getRandomValues')
			.mockImplementation((typedArray) => {
				expect(typedArray.buffer instanceof SharedArrayBuffer).toBe(false);
				typedArray.fill(0x5a);
				return typedArray;
			});

		const randomGet = createSharedSafeRandomGet(memory);
		const result = randomGet(8, 4);
		const bytes = new Uint8Array(memory.buffer, 8, 4);

		expect(result).toBe(0);
		expect(randomSpy).toHaveBeenCalledTimes(1);
		expect(Array.from(bytes)).toEqual([0x5a, 0x5a, 0x5a, 0x5a]);
	});
});
