import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCompileRequest, createRuntimeManifest } from './helpers.js';

const { executeGoToolInvocation } = vi.hoisted(() => ({
	executeGoToolInvocation: vi.fn()
}));

vi.mock('../src/tool-runtime.js', () => ({
	executeGoToolInvocation
}));

describe('compiler custom manifest execution', () => {
	beforeEach(() => {
		executeGoToolInvocation.mockReset();
	});

	it('executes custom manifests through the bundled runtime path when no runner is injected', async () => {
		executeGoToolInvocation
			.mockImplementationOnce(async (invocation: { outputPath: string }) => ({
				exitCode: 0,
				outputs: {
					[invocation.outputPath]: new Uint8Array([1, 2, 3])
				}
			}))
			.mockImplementationOnce(async (invocation: { outputPath: string }) => ({
				exitCode: 0,
				outputs: {
					[invocation.outputPath]: new Uint8Array([0, 97, 115, 109, 1])
				}
			}));

		const { compileGo } = await import('../src/compiler.js');
		const result = await compileGo(createCompileRequest(), {
			manifest: createRuntimeManifest(),
			runtimeBaseUrl: 'https://example.invalid/runtime/'
		});

		expect(result.success).toBe(true);
		expect(executeGoToolInvocation).toHaveBeenCalledTimes(2);
		expect(executeGoToolInvocation.mock.calls[0]?.[0].tool).toBe('compile');
		expect(executeGoToolInvocation.mock.calls[1]?.[0].tool).toBe('link');
	});

	it('converts bundled runtime execution exceptions into compiler failures', async () => {
		executeGoToolInvocation.mockRejectedValueOnce(new Error('failed to fetch compile.wasm'));

		const { compileGo } = await import('../src/compiler.js');
		const result = await compileGo(createCompileRequest(), {
			manifest: createRuntimeManifest(),
			runtimeBaseUrl: 'https://example.invalid/runtime/'
		});

		expect(result.success).toBe(false);
		expect(result.stderr).toContain('failed to fetch compile.wasm');
		expect(executeGoToolInvocation).toHaveBeenCalledTimes(1);
	});
});
