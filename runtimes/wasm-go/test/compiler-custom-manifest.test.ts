import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCompileRequest, createRuntimeManifest } from './helpers.js';
import { normalizeRuntimeManifest } from '../src/runtime-manifest.js';

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

	afterEach(() => {
		vi.useRealTimers();
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

	it('loads the caller manifest URL and forwards resource boundaries to both tools', async () => {
		executeGoToolInvocation.mockImplementation(
			async (invocation: { tool: string; outputPath: string }) => ({
				exitCode: 0,
				outputs: {
					[invocation.outputPath]:
						invocation.tool === 'compile'
							? new Uint8Array([1, 2, 3])
							: new Uint8Array([0, 97, 115, 109, 1])
				}
			})
		);
		const loadManifest = vi.fn(async () => normalizeRuntimeManifest(createRuntimeManifest()));
		const controller = new AbortController();
		const { compileGo } = await import('../src/compiler.js');

		const result = await compileGo(
			createCompileRequest({
				signal: controller.signal,
				assetTimeoutMs: 47,
				maxAssetBytes: 4_096,
				maxWasmMemoryBytes: 8 * 65_536
			}),
			{
				runtimeManifestUrl: 'https://example.invalid/custom/manifest.json?v=9',
				dependencies: { loadManifest }
			}
		);

		expect(result.success).toBe(true);
		expect(loadManifest).toHaveBeenCalledWith(
			'https://example.invalid/custom/manifest.json?v=9',
			expect.any(Function),
			expect.any(Function),
			expect.objectContaining({
				signal: controller.signal,
				assetTimeoutMs: 47,
				maxAssetBytes: 4_096,
				maxWasmMemoryBytes: 8 * 65_536
			})
		);
		expect(executeGoToolInvocation).toHaveBeenCalledTimes(2);
		for (const call of executeGoToolInvocation.mock.calls) {
			expect(String(call[2])).toBe('https://example.invalid/custom/?v=9');
			expect(call[5]).toEqual(
				expect.objectContaining({
					signal: expect.any(AbortSignal),
					assetTimeoutMs: 47,
					maxAssetBytes: 4_096,
					maxWasmMemoryBytes: 8 * 65_536
				})
			);
		}
	});

	it('fails a tool invocation at the stricter caller deadline', async () => {
		vi.useFakeTimers();
		const { compileGo } = await import('../src/compiler.js');
		let toolSignal: AbortSignal | undefined;
		const resultPromise = compileGo(createCompileRequest({ compileTimeoutMs: 5 }), {
			manifest: createRuntimeManifest(),
			dependencies: {
				runTool: (_invocation, context) => {
					toolSignal = context?.signal;
					return new Promise(() => undefined);
				}
			}
		});

		await vi.advanceTimersByTimeAsync(5);

		await expect(resultPromise).resolves.toMatchObject({
			success: false,
			stderr: expect.stringContaining('Go compile tool timed out after 5 ms')
		});
		expect(toolSignal).toMatchObject({
			aborted: true,
			reason: expect.objectContaining({ name: 'TimeoutError' })
		});
	});
});
