import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeRuntimeManifest } from '../src/runtime-manifest.js';
import type { BrowserGoCompileProgress } from '../src/types.js';
import { createCompileRequest, createRuntimeManifest } from './helpers.js';

const { executeGoToolInvocation } = vi.hoisted(() => ({
	executeGoToolInvocation: vi.fn()
}));

vi.mock('../src/tool-runtime.js', () => ({
	executeGoToolInvocation
}));

describe('compiler progress', () => {
	beforeEach(() => {
		executeGoToolInvocation.mockReset();
	});

	it('reports download-linked progress before compile and link complete', async () => {
		executeGoToolInvocation
			.mockImplementationOnce(
				async (
					invocation: { outputPath: string },
					_plan: unknown,
					_runtimeBaseUrl: unknown,
					_fetchImpl: unknown,
					reportAssetProgress?: (asset: string, loaded: number, total?: number) => void
				) => {
					reportAssetProgress?.('sysroot/wasip1.index.json.gz', 1, 1);
					reportAssetProgress?.('sysroot/wasip1.pack.gz', 64, 256);
					reportAssetProgress?.('sysroot/wasip1.pack.gz', 256, 256);
					reportAssetProgress?.('tools/compile.wasm.gz', 32, 128);
					reportAssetProgress?.('tools/compile.wasm.gz', 128, 128);
					return {
						exitCode: 0,
						outputs: {
							[invocation.outputPath]: new Uint8Array([1, 2, 3])
						}
					};
				}
			)
			.mockImplementationOnce(
				async (
					invocation: { outputPath: string },
					_plan: unknown,
					_runtimeBaseUrl: unknown,
					_fetchImpl: unknown,
					reportAssetProgress?: (asset: string, loaded: number, total?: number) => void
				) => {
					reportAssetProgress?.('tools/link.wasm.gz', 16, 64);
					reportAssetProgress?.('tools/link.wasm.gz', 64, 64);
					return {
						exitCode: 0,
						outputs: {
							[invocation.outputPath]: new Uint8Array([0, 97, 115, 109, 1])
						}
					};
				}
			);

		const { compileGo } = await import('../src/compiler.js');
		const progressEvents: BrowserGoCompileProgress[] = [];

		const result = await compileGo(
			createCompileRequest({
				onProgress(progress) {
					progressEvents.push(progress);
				}
			}),
			{
				runtimeManifestUrl: 'https://example.invalid/runtime/runtime-manifest.v1.json',
				runtimeBaseUrl: 'https://example.invalid/runtime/',
				dependencies: {
					loadManifest: async () => normalizeRuntimeManifest(createRuntimeManifest())
				}
			}
		);

		expect(result.success).toBe(true);
		expect(progressEvents.at(-1)?.stage).toBe('done');
		expect(progressEvents.at(-1)?.percent).toBe(100);
		for (let index = 1; index < progressEvents.length; index += 1) {
			expect(progressEvents[index]?.percent).toBeGreaterThanOrEqual(
				progressEvents[index - 1]?.percent || 0
			);
		}

		const compilePercents = progressEvents
			.filter((event) => event.stage === 'compile')
			.map((event) => event.percent);
		expect(compilePercents[0]).toBeLessThan(30);
		expect(compilePercents.at(-1)).toBeGreaterThan(80);
		expect(compilePercents.at(-1)).toBeLessThan(89);
		expect(
			compilePercents.some(
				(percent) =>
					percent > (compilePercents[0] || 0) && percent < (compilePercents.at(-1) || 100)
			)
		).toBe(true);
		expect(
			progressEvents.some(
				(event) => event.stage === 'compile' && event.message?.includes('loading')
			)
		).toBe(true);

		const linkPercents = progressEvents
			.filter((event) => event.stage === 'link')
			.map((event) => event.percent);
		expect(linkPercents).toContain(97);
		expect(linkPercents.some((percent) => percent > 88 && percent < 97)).toBe(true);
	});
});
