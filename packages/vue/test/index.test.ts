import type { Sandbox, SandboxLoader, SandboxRuntimeAssets } from '@wasm-idle/core';
import { effectScope, shallowRef } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { useWasmIdleHost, useWasmIdlePlayground } from '../src/index.js';

describe('useWasmIdlePlayground', () => {
	it('does not unwrap ordinary runtime asset objects that contain a value field', () => {
		const runtimeAssets = {
			rootUrl: '/runtime',
			value: 'runtime-profile-v1'
		} as unknown as SandboxRuntimeAssets;
		const loadSandbox = vi.fn() as SandboxLoader;

		const binding = useWasmIdlePlayground(runtimeAssets, loadSandbox);

		expect(binding.value.runtimeAssets).toBe(runtimeAssets);
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
		const host = useWasmIdleHost('/runtime', async () => sandbox);
		host.setTerminal({ destroy } as never);
		await host.binding.value.load('C');

		await host.dispose();

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(terminate).toHaveBeenCalledTimes(1);
		expect(host.terminal.value).toBeUndefined();
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
		const host = useWasmIdleHost('/runtime', async () => sandbox);
		host.setTerminal({ destroy } as never);
		await host.binding.value.load('C');

		await expect(host.dispose()).rejects.toBe(terminalError);

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(terminate).toHaveBeenCalledTimes(1);
		expect(host.terminal.value).toBeUndefined();

		await host.dispose();
		expect(destroy).toHaveBeenCalledTimes(1);
		expect(terminate).toHaveBeenCalledTimes(1);
	});

	it('disposes the terminal and binding when the owning effect scope ends', async () => {
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
		const scope = effectScope();
		const host = scope.run(() => useWasmIdleHost('/runtime', async () => sandbox))!;
		host.setTerminal({ destroy } as never);
		await host.binding.value.load('C');

		scope.stop();
		await vi.waitFor(() => {
			expect(destroy).toHaveBeenCalledTimes(1);
			expect(terminate).toHaveBeenCalledTimes(1);
		});
		await host.dispose();

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(terminate).toHaveBeenCalledTimes(1);
		expect(host.terminal.value).toBeUndefined();
	});

	it('consumes host cleanup failures when the owning effect scope ends', async () => {
		const terminate = vi.fn();
		const destroy = vi.fn(async () => {
			throw new Error('terminal destroy failed');
		});
		const sandbox = {
			constructor: Object,
			eof: vi.fn(),
			load: vi.fn(async () => undefined),
			run: vi.fn(async () => true),
			terminate,
			clear: vi.fn(async () => undefined)
		} satisfies Sandbox;
		const scope = effectScope();
		const host = scope.run(() => useWasmIdleHost('/runtime', async () => sandbox))!;
		host.setTerminal({ destroy } as never);
		await host.binding.value.load('C');
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', onUnhandled);

		try {
			scope.stop();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(destroy).toHaveBeenCalledTimes(1);
			expect(terminate).toHaveBeenCalledTimes(1);
			expect(unhandled).toEqual([]);
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});

	it('consumes binding cleanup failures during reactive replacement', async () => {
		const cleanupError = new Error('binding cleanup failed');
		const terminate = vi.fn(() => {
			throw cleanupError;
		});
		const sandbox = {
			constructor: Object,
			eof: vi.fn(),
			load: vi.fn(async () => undefined),
			run: vi.fn(async () => true),
			terminate,
			clear: vi.fn(async () => undefined)
		} satisfies Sandbox;
		const runtimeAssets = shallowRef<SandboxRuntimeAssets>('/runtime-a');
		const binding = useWasmIdlePlayground(runtimeAssets, async () => sandbox);
		await binding.value.load('C');
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on('unhandledRejection', onUnhandled);

		try {
			runtimeAssets.value = '/runtime-b';
			void binding.value;
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(terminate).toHaveBeenCalledTimes(1);
			expect(unhandled).toEqual([]);
		} finally {
			process.off('unhandledRejection', onUnhandled);
			await binding.value.dispose();
		}
	});
});
