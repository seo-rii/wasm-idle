import type { SandboxLoader } from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

import { createSveltePlaygroundBinding, createSvelteWasmIdleHost } from '../src/index.js';

describe('Svelte playground factories', () => {
	it('returns a PlaygroundBinding from createSveltePlaygroundBinding', () => {
		const loadSandbox = vi.fn() as SandboxLoader;

		const binding = createSveltePlaygroundBinding('/runtime', loadSandbox);

		expect(binding.runtimeAssets).toBe('/runtime');
		expect(binding.load).toEqual(expect.any(Function));
		expect(binding).not.toHaveProperty('binding');
	});

	it('keeps terminal host state in createSvelteWasmIdleHost', () => {
		const loadSandbox = vi.fn() as SandboxLoader;

		const host = createSvelteWasmIdleHost('/runtime', loadSandbox);

		expect(host.binding.runtimeAssets).toBe('/runtime');
		expect(host.terminal).toEqual(expect.objectContaining({ subscribe: expect.any(Function) }));
	});
});
