import {
	DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE,
	type Sandbox,
	type SandboxLoader
} from '@wasm-idle/core';
import { get } from 'svelte/store';
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

	it('passes binding options through both factories', () => {
		const loadSandbox = vi.fn() as SandboxLoader;
		const trustProfile = DEFAULT_RESTRICTED_RUNTIME_TRUST_PROFILE;

		const binding = createSveltePlaygroundBinding('/runtime', loadSandbox, { trustProfile });
		const host = createSvelteWasmIdleHost('/runtime', loadSandbox, {
			trustProfile,
			registerDispose: vi.fn()
		});

		expect(binding.trustProfile?.profileId).toBe(trustProfile.profileId);
		expect(host.binding.trustProfile?.profileId).toBe(trustProfile.profileId);
		expect(host.terminalProps.trustProfile).toBe(host.binding.trustProfile);
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

	it('still disposes the binding when terminal destruction fails', async () => {
		const terminalError = new Error('terminal destroy failed');
		const terminate = vi.fn();
		const destroy = vi.fn(async () => {
			throw terminalError;
		});
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

		await expect(host.dispose()).rejects.toBe(terminalError);

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(terminate).toHaveBeenCalledTimes(1);
		expect(get(host.terminal)).toBeUndefined();
		await expect(host.binding.load('C')).rejects.toThrow('disposed binding');
	});

	it('reports terminal and binding cleanup failures together', async () => {
		const terminalError = new Error('terminal destroy failed');
		const bindingError = new Error('binding cleanup failed');
		const sandbox = {
			constructor: Object,
			eof: vi.fn(),
			load: vi.fn(async () => undefined),
			run: vi.fn(async () => true),
			terminate: vi.fn(() => {
				throw bindingError;
			}),
			clear: vi.fn(async () => undefined)
		} satisfies Sandbox;
		const host = createSvelteWasmIdleHost('/runtime', async () => sandbox);
		host.setTerminal({
			destroy: async () => {
				throw terminalError;
			}
		} as never);
		await host.binding.load('C');

		const failure = await host.dispose().catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(AggregateError);
		expect((failure as AggregateError).errors).toEqual([terminalError, bindingError]);
	});
});
