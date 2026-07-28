import type { SandboxLoader, SandboxRuntimeAssets } from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

import { useWasmIdlePlayground } from '../src/index.js';

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
});
