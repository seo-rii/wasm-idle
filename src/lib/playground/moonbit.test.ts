import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ configurations: [] as any[], run: vi.fn() }));
vi.mock('./staticWorkerRuntime', () => ({
	StaticWorkerRuntimeSandbox: class {
		constructor(configuration: unknown) {
			state.configurations.push(configuration);
		}
		run(...args: unknown[]) {
			state.run(...args);
			return Promise.resolve(true);
		}
	}
}));

import Moonbit from './moonbit';

describe('Moonbit browser compiler host', () => {
	beforeEach(() => {
		state.configurations.length = 0;
		state.run.mockClear();
	});
	it('resolves the pinned host beneath a consumer asset root and starts a fresh streaming worker', () => {
		new Moonbit();
		const configuration = state.configurations[0];
		expect(configuration).toMatchObject({
			languageId: 'MOONBIT',
			moduleWorker: true,
			inlineVerifiedWorker: true,
			enforcePhaseTimeouts: true,
			workerLifetime: { mode: 'per-run' },
			stdin: { mode: 'streaming' }
		});
		expect(
			configuration.resolveRuntimeAssets(
				{ rootUrl: '/mirror/' },
				'https://example.test/editor/'
			)
		).toMatchObject({
			baseUrl: 'https://example.test/mirror/wasm-moonbit/',
			workerUrl: 'https://example.test/mirror/wasm-moonbit/runner-worker.js',
			workerReceipt: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) }
		});
	});
	it('rejects unsupported compiler flags before starting the shared runtime', async () => {
		const runtime = new Moonbit();
		await expect(
			runtime.run('fn main {}', false, false, undefined, [], {
				compileArgs: ['--native']
			})
		).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'MOONBIT' });
		expect(state.run).not.toHaveBeenCalled();
	});
});
