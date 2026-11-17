import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ constructor: vi.fn(), run: vi.fn() }));
vi.mock('./staticWorkerRuntime', () => ({
	StaticWorkerRuntimeSandbox: class {
		constructor(config: unknown) {
			calls.constructor(config);
		}
		run(...args: unknown[]) {
			calls.run(...args);
			return Promise.resolve(true);
		}
	}
}));
import Coq, { COQ_RUNTIME_MANIFEST, resolveCoqRuntimeAssets } from './coq';

describe('Coq original-kernel adapter', () => {
	beforeEach(() => vi.clearAllMocks());
	it('isolates verified source and command-stream sessions in a classic Worker', () => {
		new Coq();
		expect(calls.constructor.mock.calls[0][0]).toMatchObject({
			languageId: 'COQ',
			workerLifetime: { mode: 'per-run' },
			stdin: { mode: 'streaming' },
			moduleWorker: false,
			inlineVerifiedWorker: true,
			runtimePreflightDelivery: 'transfer-owned',
			includeExecutionLimits: true,
			enforcePhaseTimeouts: true
		});
		expect(COQ_RUNTIME_MANIFEST.runtimes[0].requiredBrowserFeatures).not.toContain('wasm');
		expect(COQ_RUNTIME_MANIFEST.runtimes[0].assets).toHaveLength(4);
		expect(
			resolveCoqRuntimeAssets({ rootUrl: '/mirror' }, 'https://example.test/app')
		).toMatchObject({ baseUrl: 'https://example.test/mirror/wasm-coq/' });
		for (const rootUrl of ['file:///tmp', 'https://user:pass@example.test'])
			expect(() => resolveCoqRuntimeAssets({ rootUrl }, 'https://example.test')).toThrow();
	});
	it('preserves unchanged source, workspace and explicit input options', async () => {
		const options = {
			activePath: 'source/main.v',
			stdin: 'Check answer.',
			workspaceFiles: [{ path: 'helper.v', content: 'Definition answer := 42.' }]
		};
		await new Coq().run('Load "helper".', false, false, undefined, [], options);
		expect(calls.run).toHaveBeenCalledWith(
			'Load "helper".',
			false,
			false,
			undefined,
			[],
			options
		);
	});
	it('rejects unsupported command-line flags before starting the kernel', async () => {
		for (const options of [{ compileArgs: ['-R', '.'] }, { programArgs: ['-quiet'] }])
			await expect(
				new Coq().run('', false, false, undefined, [], options)
			).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'COQ' });
		expect(calls.run).not.toHaveBeenCalled();
	});
});
