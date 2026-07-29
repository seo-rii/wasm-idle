import type { Sandbox, SandboxLoader, SandboxRuntimeAssets } from '@wasm-idle/core';
import { effectScope } from 'vue';
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
});
