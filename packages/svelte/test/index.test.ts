import type { Sandbox, SandboxLoader } from '@wasm-idle/core';
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

	it('disposes the current binding and terminal through the host lifecycle', async () => {
		const terminate = vi.fn();
		const destroy = vi.fn(async () => undefined);
		const sandbox = {
			constructor: Object,
			eof: vi.fn(),
			load: vi.fn(async () => undefined),
			run: vi.fn(async () => true),
			terminate,
			clear: vi.fn(async () => undefined)
		} satisfies Sandbox;
		const host = createSvelteWasmIdleHost('/runtime', async () => sandbox);
		host.setTerminal({ destroy } as never);
		await host.binding.load('C');

		await host.dispose();

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(terminate).toHaveBeenCalledTimes(1);
	});

	it('registers idempotent component teardown when a lifecycle registrar is provided', async () => {
		const terminate = vi.fn();
		const destroy = vi.fn(async () => undefined);
		const sandbox = {
			constructor: Object,
			eof: vi.fn(),
			load: vi.fn(async () => undefined),
			run: vi.fn(async () => true),
			terminate,
			clear: vi.fn(async () => undefined)
		} satisfies Sandbox;
		let cleanup: (() => void) | undefined;
		const host = createSvelteWasmIdleHost('/runtime', async () => sandbox, {
			registerDispose(dispose) {
				cleanup = dispose;
			}
		});
		host.setTerminal({ destroy } as never);
		await host.binding.load('C');

		cleanup!();
		await vi.waitFor(() => {
			expect(destroy).toHaveBeenCalledTimes(1);
			expect(terminate).toHaveBeenCalledTimes(1);
		});
		await host.dispose();

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(terminate).toHaveBeenCalledTimes(1);
	});
});
