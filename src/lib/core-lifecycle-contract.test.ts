import { RuntimeConfigurationError, createPlaygroundBinding, type Sandbox } from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

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
	it('bounds disposal even if the adapter never completes cleanup', async () => {
		vi.useFakeTimers();
		const dispose = vi.fn(() => new Promise<void>(() => undefined));
		const binding = createPlaygroundBinding('/runtime', async () =>
			sandboxWithLifecycle({ dispose })
		);
		const sandbox = await binding.load('C');
		const pending = sandbox.dispose!();
		const rejection = expect(pending).rejects.toMatchObject({
			code: 'timeout',
			phase: 'dispose',
			timeoutMs: 1_000
		});
		await vi.advanceTimersByTimeAsync(1_000);
		await rejection;
		expect(sandbox.dispose!()).toBe(pending);
		await expect(sandbox.run('', false)).rejects.toMatchObject({
			code: 'runtime-configuration',
			phase: 'dispose'
		});
		await expect(binding.dispose()).resolves.toBeUndefined();
		expect(dispose).toHaveBeenCalledOnce();
	});

	it('does not retain failed individual disposals in binding ownership', async () => {
		const failure = new Error('dispose failed');
		const dispose = vi.fn(async () => {
			throw failure;
		});
		const binding = createPlaygroundBinding('/runtime', async () =>
			sandboxWithLifecycle({ dispose })
		);
		for (let index = 0; index < 100; index += 1) {
			const sandbox = await binding.load('C');
			await expect(sandbox.dispose?.()).rejects.toBe(failure);
		}
		// A retained failed disposal promise would make this reject again.
		await expect(binding.dispose()).resolves.toBeUndefined();
		expect(dispose).toHaveBeenCalledTimes(100);
	});

	it('allows prewarming again after the final consumer releases its language', async () => {
		let idle!: () => void;
		vi.stubGlobal('window', {
			requestIdleCallback: (fn: () => void) => {
				idle = fn;
				return 1;
			},
			cancelIdleCallback: vi.fn()
		});
		vi.stubGlobal('document', { visibilityState: 'visible' });
		vi.stubGlobal('navigator', {});
		const loader = vi.fn(async () => sandboxWithLifecycle());
		const binding = createPlaygroundBinding('/runtime', loader, { prewarm: true });
		const first = await binding.load('C');
		const second = await binding.load('C');
		await first.dispose?.();
		expect(await binding.prewarm?.('C')).toBe(false);
		await second.dispose?.();
		const warm = binding.prewarm!('C');
		idle();
		expect(await warm).toBe(true);
		expect(loader).toHaveBeenCalledTimes(3);
		await binding.dispose();
	});

	it('waits for all owned cleanup attempts before reporting their failures', async () => {
		let finishSecond!: () => void;
		const firstError = new Error('first dispose');
		const secondError = new Error('second dispose');
		const entries = [
			sandboxWithLifecycle({
				dispose: () => {
					throw firstError;
				}
			}),
			sandboxWithLifecycle({
				dispose: async () => {
					await new Promise<void>((resolve) => {
						finishSecond = resolve;
					});
					throw secondError;
				}
			})
		];
		const binding = createPlaygroundBinding('/runtime', async () => entries.shift()!);
		await binding.load('C');
		await binding.load('CPP');
		let settled = false;
		const disposed = binding.dispose();
		void disposed.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			}
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);
		finishSecond();
		await expect(disposed).rejects.toMatchObject({ errors: [firstError, secondError] });
	});

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

	it('restarts through the runtime hook and falls back to clearing legacy sandboxes', async () => {
		const restart = vi.fn(async () => undefined);
		const hookedClear = vi.fn(async () => undefined);
		const fallbackClear = vi.fn(async () => undefined);
		const sandboxes = [
			sandboxWithLifecycle({ restart, clear: hookedClear }),
			sandboxWithLifecycle({ clear: fallbackClear })
		];
		const binding = createPlaygroundBinding('/runtime', async () => sandboxes.shift()!);
		const hooked = await binding.load('C');
		const fallback = await binding.load('CPP');

		await hooked.restart!();
		await fallback.restart!();

		expect(restart).toHaveBeenCalledOnce();
		expect(hookedClear).not.toHaveBeenCalled();
		expect(fallbackClear).toHaveBeenCalledOnce();
	});

	it('rejects restart while an operation is active or after disposal', async () => {
		const restart = vi.fn(async () => undefined);
		const binding = createPlaygroundBinding('/runtime', async () =>
			sandboxWithLifecycle({
				restart,
				run: vi.fn(() => new Promise<boolean | string>(() => undefined))
			})
		);
		const sandbox = await binding.load('C');
		const operation = sandbox.run('int main() {}', false);
		const operationRejection = expect(operation).rejects.toMatchObject({
			code: 'cancelled',
			phase: 'dispose'
		});
		await Promise.resolve();

		await expect(sandbox.restart!()).rejects.toMatchObject({
			code: 'busy',
			phase: 'execute'
		});
		expect(restart).not.toHaveBeenCalled();

		await sandbox.dispose?.();
		await operationRejection;
		await expect(sandbox.restart!()).rejects.toMatchObject({
			code: 'runtime-configuration',
			phase: 'dispose'
		});
	});

	it('normalizes aliases and prototype-shaped public language IDs before loading', async () => {
		const loadSandbox = vi.fn(async (_language: string) => sandboxWithLifecycle());
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
