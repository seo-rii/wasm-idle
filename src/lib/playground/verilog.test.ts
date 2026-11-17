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
import Verilog from './verilog';

describe('Icarus Verilog adapter', () => {
	beforeEach(() => vi.clearAllMocks());
	it('uses a verified disposable streaming compiler worker', () => {
		new Verilog();
		expect(calls.constructor.mock.calls[0][0]).toMatchObject({
			languageId: 'VERILOG',
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
			baseUrl: 'https://example.test/assets/wasm-verilog/'
		});
	});
	it('forwards program plusargs and workspace options', async () => {
		const options = { programArgs: ['+value=42'], activePath: 'source/main.v', stdin: '1\n' };
		await new Verilog().run('module main; endmodule', false, false, undefined, [], options);
		expect(calls.run).toHaveBeenCalledWith(
			'module main; endmodule',
			false,
			false,
			undefined,
			['+value=42'],
			options
		);
	});
	it('rejects compiler argument overrides before worker execution', async () => {
		await expect(
			new Verilog().run('', false, false, undefined, [], { compileArgs: ['-mexternal'] })
		).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'VERILOG' });
		expect(calls.run).not.toHaveBeenCalled();
	});
});
