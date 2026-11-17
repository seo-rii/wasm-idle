import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ configurations: [] as any[], run: vi.fn(), load: vi.fn() }));
vi.mock('./staticWorkerRuntime', () => ({
	StaticWorkerRuntimeSandbox: class {
		constructor(configuration: unknown) {
			state.configurations.push(configuration);
		}
		load(...args: unknown[]) {
			state.load(...args);
			return Promise.resolve();
		}
		run(...args: unknown[]) {
			state.run(...args);
			return Promise.resolve(true);
		}
	}
}));

import Moonbit from './moonbit';
import { assertMoonbitLocalResearch, MOONBIT_SERVICE_POLICY } from './moonbitServicePolicy';

describe('Moonbit browser compiler host', () => {
	beforeEach(() => {
		state.configurations.length = 0;
		state.run.mockClear();
		state.load.mockClear();
	});
	afterEach(() => vi.unstubAllGlobals());
	it('retains the pinned experimental host configuration', () => {
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
	it('rejects default SDK load and run, including prepare-only calls, before shared runtime work', async () => {
		vi.stubGlobal('location', { href: 'http://127.0.0.1/editor/' });
		const runtime = new Moonbit();
		await expect(runtime.load({ rootUrl: 'https://mirror.example' })).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'MOONBIT',
			message: expect.stringContaining(MOONBIT_SERVICE_POLICY.message)
		});
		for (const prepare of [false, true])
			await expect(runtime.run('fn main {}', prepare)).rejects.toMatchObject({
				code: 'runtime-configuration',
				runtimeId: 'MOONBIT'
			});
		expect(state.load).not.toHaveBeenCalled();
		expect(state.run).not.toHaveBeenCalled();
	});
	it.each(['https://example.test/', 'http://localhost.example/', 'file:///tmp/editor.html', ''])(
		'rejects research execution outside a loopback HTTP(S) origin: %s',
		async (href) => {
			vi.stubGlobal('location', { href });
			const runtime = new Moonbit({ localResearchOnly: true });
			await expect(runtime.load()).rejects.toThrow('loopback');
			await expect(runtime.run('fn main {}', false)).rejects.toThrow('loopback');
			expect(state.load).not.toHaveBeenCalled();
			expect(state.run).not.toHaveBeenCalled();
		}
	);
	it.each(['http://127.0.0.1:4998/', 'http://localhost:4998/', 'https://[::1]/'])(
		'requires an explicit local-research option even on %s',
		(href) => {
			expect(() => assertMoonbitLocalResearch({}, href)).toThrow('unavailable');
			expect(() =>
				assertMoonbitLocalResearch({ localResearchOnly: true }, href)
			).not.toThrow();
		}
	);
	it('delegates an explicit local compiler research load and run without changing original source', async () => {
		vi.stubGlobal('location', { href: 'http://localhost:4998/' });
		const runtime = new Moonbit({ localResearchOnly: true });
		await runtime.load('/assets');
		await runtime.run('fn main { println(42) }', false);
		expect(state.load).toHaveBeenCalledOnce();
		expect(state.run.mock.calls[0][0]).toBe('fn main { println(42) }');
	});
	it('rejects unsupported compiler flags before starting the shared runtime', async () => {
		vi.stubGlobal('location', { href: 'http://localhost:4998/' });
		const runtime = new Moonbit({ localResearchOnly: true });
		await expect(
			runtime.run('fn main {}', false, false, undefined, [], {
				compileArgs: ['--native']
			})
		).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'MOONBIT' });
		expect(state.run).not.toHaveBeenCalled();
	});
});
