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
