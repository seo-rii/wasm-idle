import type { Sandbox } from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

import { runWasmIdleInNode } from '../src/index.js';

function createSandbox(run: Sandbox['run']): Sandbox {
	return {
		constructor: Object,
		eof: vi.fn(),
		load: vi.fn(async () => undefined),
		run,
		terminate: vi.fn(),
		clear: vi.fn(async () => undefined),
		elapse: 17
	};
}

describe('runWasmIdleInNode', () => {
	it('treats fulfilled string runtime results as successful', async () => {
		const dispose = vi.fn(async () => undefined);
		const sandbox = createSandbox(vi.fn(async () => ':ok'));
		sandbox.dispose = dispose;

		const result = await runWasmIdleInNode({
			language: 'ELIXIR',
			code: 'IO.puts("hello")',
			loadSandbox: async () => sandbox,
			stdout: vi.fn(),
			stderr: vi.fn()
		});

		expect(result).toEqual({ ok: true, result: ':ok', elapsedMs: 17 });
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it('preserves the original rejected error for callers', async () => {
		class RuntimeFailure extends Error {
			readonly code = 'RUNTIME_FAILURE';
		}

		const error = new RuntimeFailure('runtime failed');
		const stderr = vi.fn();
		const sandbox = createSandbox(vi.fn(async () => Promise.reject(error)));

		const result = await runWasmIdleInNode({
			language: 'C',
			code: 'int main() {}',
			loadSandbox: async () => sandbox,
			stdout: vi.fn(),
			stderr
		});

		expect(result).toMatchObject({
			ok: false,
			result: 'runtime failed',
			elapsedMs: 17,
			error
		});
		expect(result.error).toBe(error);
		expect(stderr).toHaveBeenCalledWith('runtime failed\n');
	});

	it('can retain a sandbox when the caller owns its lifecycle', async () => {
		const dispose = vi.fn(async () => undefined);
		const sandbox = createSandbox(vi.fn(async () => true));
		sandbox.dispose = dispose;

		await runWasmIdleInNode({
			language: 'C',
			code: 'int main() {}',
			loadSandbox: async () => sandbox,
			stdout: vi.fn(),
			stderr: vi.fn(),
			disposeAfterRun: false
		});

		expect(dispose).not.toHaveBeenCalled();
	});
});
