import { RuntimeConfigurationError, createPlaygroundBinding, type Sandbox } from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

function sandboxWithLifecycle(overrides: Partial<Sandbox> = {}): Sandbox {
	return {
		constructor: Object,
		eof: vi.fn(),
		load: vi.fn(async () => undefined),
		run: vi.fn(async () => true),
		terminate: vi.fn(),
		clear: vi.fn(async () => undefined),
		...overrides
	};
}

describe('playground binding lifecycle', () => {
	it('disposes every owned sandbox exactly once', async () => {
		const firstDispose = vi.fn(async () => undefined);
		const secondTerminate = vi.fn();
		const sandboxes = [
			sandboxWithLifecycle({ dispose: firstDispose }),
			sandboxWithLifecycle({ terminate: secondTerminate })
		];
		const binding = createPlaygroundBinding('/runtime', async () => sandboxes.shift()!);
		const first = await binding.load('C');
		await binding.load('CPP');

		await first.dispose?.();
		await binding.dispose();
		await binding.dispose();

		expect(firstDispose).toHaveBeenCalledTimes(1);
		expect(secondTerminate).toHaveBeenCalledTimes(1);
	});

	it('rejects new sandboxes after disposal', async () => {
		const loadSandbox = vi.fn(async () => sandboxWithLifecycle());
		const binding = createPlaygroundBinding('/runtime', loadSandbox);

		await binding.dispose();

		await expect(binding.load('C')).rejects.toEqual(
			expect.objectContaining<Partial<RuntimeConfigurationError>>({
				code: 'runtime-configuration',
				phase: 'dispose'
			})
		);
		expect(loadSandbox).not.toHaveBeenCalled();
	});

	it('normalizes aliases and prototype-shaped public language IDs before loading', async () => {
		const loadSandbox = vi.fn(async () => sandboxWithLifecycle());
		const binding = createPlaygroundBinding('/runtime', loadSandbox);

		await binding.load(' pypy3 ');
		await binding.load('toString');
		await binding.load('constructor');
		await binding.load('__proto__');

		expect(loadSandbox.mock.calls.map(([language]) => language)).toEqual([
			'PYTHON3',
			'TOSTRING',
			'CONSTRUCTOR',
			'__PROTO__'
		]);
		await expect(binding.load('   ')).rejects.toMatchObject({
			code: 'unsupported-language',
			languageId: '   '
		});
		expect(loadSandbox).toHaveBeenCalledTimes(4);
	});

	it('settles an active operation and rejects reuse when its sandbox is disposed', async () => {
		let finishRun: ((result: boolean | string) => void) | undefined;
		const run = vi.fn(
			() =>
				new Promise<boolean | string>((resolve) => {
					finishRun = resolve;
				})
		);
		const load = vi.fn(async () => undefined);
		const execute = vi.fn(async () => ({
			ok: true,
			exitCode: 0,
			stdout: '',
			stderr: '',
			diagnostics: [],
			artifacts: [],
			timings: { assetMs: 0, startupMs: 0, compileMs: 0, executeMs: 0, totalMs: 0 },
			terminationReason: 'completed' as const,
			runtime: {
				languageId: 'C',
				implementationId: 'test',
				version: '1',
				protocolVersion: 1
			}
		}));
		const dispose = vi.fn(async () => undefined);
		const binding = createPlaygroundBinding('/runtime', async () =>
			sandboxWithLifecycle({ load, run, execute, dispose })
		);
		const sandbox = await binding.load('C');

		const operation = sandbox.run('int main() {}', false);
		const rejection = expect(operation).rejects.toMatchObject({
			code: 'cancelled',
			phase: 'dispose'
		});
		await Promise.resolve();
		await sandbox.dispose?.();
		await rejection;

		await expect(sandbox.load()).rejects.toMatchObject({
			code: 'runtime-configuration',
			phase: 'dispose'
		});
		await expect(sandbox.run('', false)).rejects.toMatchObject({
			code: 'runtime-configuration',
			phase: 'dispose'
		});
		await expect(sandbox.execute?.({ code: '' })).rejects.toMatchObject({
			code: 'runtime-configuration',
			phase: 'dispose'
		});
		expect(dispose).toHaveBeenCalledOnce();
		expect(load).not.toHaveBeenCalled();
		expect(run).toHaveBeenCalledOnce();
		expect(execute).not.toHaveBeenCalled();
		finishRun?.(true);
	});

	it('disposes a sandbox whose load races with binding disposal', async () => {
		let resolveSandbox!: (sandbox: Sandbox) => void;
		const sandboxPromise = new Promise<Sandbox>((resolve) => {
			resolveSandbox = resolve;
		});
		const dispose = vi.fn(async () => undefined);
		const binding = createPlaygroundBinding('/runtime', async () => sandboxPromise);
		const pendingLoad = binding.load('C');

		await binding.dispose();
		resolveSandbox(sandboxWithLifecycle({ dispose }));

		await expect(pendingLoad).rejects.toMatchObject({
			code: 'runtime-configuration',
			phase: 'dispose'
		});
		expect(dispose).toHaveBeenCalledTimes(1);
	});
});
