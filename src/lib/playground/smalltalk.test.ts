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
import Smalltalk from './smalltalk';

describe('Amber Smalltalk adapter', () => {
	beforeEach(() => vi.clearAllMocks());
	it('uses a verified disposable streaming compiler worker', () => {
		new Smalltalk();
		expect(calls.constructor.mock.calls[0][0]).toMatchObject({
			languageId: 'SMALLTALK',
			workerLifetime: { mode: 'per-run' },
			stdin: { mode: 'streaming' },
			moduleWorker: true,
			inlineVerifiedWorker: true,
			includeExecutionLimits: true
		});
		const config = calls.constructor.mock.calls[0][0];
		expect(
			config.resolveRuntimeAssets({ rootUrl: '/assets' }, 'https://example.test/app')
		).toMatchObject({
			baseUrl: 'https://example.test/assets/wasm-smalltalk/'
		});
	});
	it('forwards program arguments and workspace options', async () => {
		const options = { programArgs: ['value=42'], activePath: 'source/main.st', stdin: '1\n' };
		await new Smalltalk().run(
			'Stdout nextPutAll: 42 asString!',
			false,
			false,
			undefined,
			[],
			options
		);
		expect(calls.run).toHaveBeenCalledWith(
			'Stdout nextPutAll: 42 asString!',
			false,
			false,
			undefined,
			['value=42'],
			options
		);
	});
	it('rejects compiler argument overrides before worker execution', async () => {
		await expect(
			new Smalltalk().run('', false, false, undefined, [], { compileArgs: ['-mexternal'] })
		).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'SMALLTALK' });
		expect(calls.run).not.toHaveBeenCalled();
	});
});
