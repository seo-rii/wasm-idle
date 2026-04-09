import { beforeEach, describe, expect, it, vi } from 'vitest';

const { initOptionsState, mockInit, mockPopcorn } = vi.hoisted(() => {
	const initOptionsState: {
		current:
			| {
					bundlePath: string;
					onStderr?: (message: string) => void;
					onStdout?: (message: string) => void;
			  }
			| null;
	} = {
		current: null
	};
	const mockPopcorn = {
		call: vi.fn(),
		deinit: vi.fn()
	};
	const mockInit = vi.fn(async (options) => {
		initOptionsState.current = options;
		return mockPopcorn;
	});
	return {
		initOptionsState,
		mockInit,
		mockPopcorn
	};
});

vi.mock('$env/dynamic/public', () => ({
	env: {
		PUBLIC_WASM_ELIXIR_BUNDLE_URL: ''
	}
}));

vi.mock('@swmansion/popcorn', () => ({
	Popcorn: {
		init: mockInit
	}
}));

import Elixir from './elixir';

describe('Elixir sandbox', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		initOptionsState.current = null;
		mockPopcorn.call.mockReset();
		mockPopcorn.deinit.mockReset();
		history.replaceState({}, '', '/editor');
	});

	it('loads the Popcorn evaluator once, preserves it across prepare, and prints the evaluated result', async () => {
		const sandbox = new Elixir();
		const output = vi.fn();
		const progress = { set: vi.fn() };
		sandbox.output = output;
		mockPopcorn.call.mockImplementation(async () => {
			initOptionsState.current?.onStdout?.('factorial_plus_bonus=27\n');
			return {
				ok: true,
				data: ':ok',
				durationMs: 12
			};
		});

		await sandbox.load(
			{
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			},
			'IO.puts("hello")',
			true,
			[],
			{},
			progress
		);

		expect(mockInit).toHaveBeenCalledTimes(1);
		expect(initOptionsState.current?.bundlePath).toMatch(/\/runtime\/elixir\/bundle\.avm$/);
		expect(progress.set).toHaveBeenCalledWith(1);
		await expect(sandbox.run('IO.puts("hello")', true, true, progress)).resolves.toBe(true);

		await sandbox.clear();
		expect(mockPopcorn.deinit).not.toHaveBeenCalled();

		await sandbox.load(
			{
				elixir: {
					bundleUrl: '/runtime/elixir/bundle.avm'
				}
			},
			'IO.puts("hello")'
		);
		expect(mockInit).toHaveBeenCalledTimes(1);

		await expect(sandbox.run('IO.puts("hello")', false)).resolves.toBe(':ok');
		expect(mockPopcorn.call).toHaveBeenCalledWith(['eval_elixir', 'IO.puts("hello")'], {
			timeoutMs: 30_000
		});
		expect(output).toHaveBeenCalledWith('factorial_plus_bonus=27\n');
		expect(output).toHaveBeenCalledWith('=> :ok\n');

		await sandbox.clear();
		expect(mockPopcorn.deinit).toHaveBeenCalledTimes(1);
	});

	it('rejects load when no Elixir bundle is configured', async () => {
		const sandbox = new Elixir();

		await expect(sandbox.load({})).rejects.toBe(
			'Elixir runtime is not configured. Set PUBLIC_WASM_ELIXIR_BUNDLE_URL or runtimeAssets.elixir.bundleUrl.'
		);
		expect(mockInit).not.toHaveBeenCalled();
	});
});
