import type { ExecutionResult, Sandbox } from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

import { executeWasmIdleInNode, runWasmIdleInNode } from '../src/index.js';

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

describe('executeWasmIdleInNode', () => {
	it('returns a structured runtime result after normalizing the request', async () => {
		const result: ExecutionResult = {
			ok: true,
			exitCode: 0,
			stdout: 'hello\n',
			stderr: '',
			diagnostics: [],
			artifacts: [],
			timings: { assetMs: 1, startupMs: 2, compileMs: 3, executeMs: 4, totalMs: 10 },
			terminationReason: 'completed',
			runtime: {
				languageId: 'C',
				implementationId: 'clang',
				version: '22.1.8',
				profileId: 'clang-wasi-22',
				protocolVersion: 1
			}
		};
		const execute = vi.fn(async () => result);
		const dispose = vi.fn(async () => undefined);
		const sandbox = createSandbox(vi.fn(async () => true));
		sandbox.execute = execute;
		sandbox.dispose = dispose;
		const request = { code: 'int main() { return 0; }', args: ['one'] };

		const received = await executeWasmIdleInNode({
			language: 'C',
			request,
			loadSandbox: async () => sandbox,
			stdout: vi.fn(),
			stderr: vi.fn()
		});

		expect(received).toBe(result);
		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({
				code: request.code,
				args: request.args,
				limits: expect.objectContaining({
					runTimeoutMs: 30_000,
					maxOutputBytes: 1024 * 1024
				})
			})
		);
		expect(dispose).toHaveBeenCalledOnce();
	});

	it('rejects with the original typed error and still disposes the sandbox', async () => {
		class StructuredRuntimeFailure extends Error {
			readonly code = 'structured-runtime-failure';
		}

		const error = new StructuredRuntimeFailure('structured execution failed');
		const execute = vi.fn(async () => Promise.reject(error));
		const dispose = vi.fn(async () => undefined);
		const stderr = vi.fn();
		const sandbox = createSandbox(vi.fn(async () => true));
		sandbox.execute = execute;
		sandbox.dispose = dispose;

		await expect(
			executeWasmIdleInNode({
				language: 'RUST',
				request: { code: 'fn main() {}' },
				loadSandbox: async () => sandbox,
				stdout: vi.fn(),
				stderr
			})
		).rejects.toBe(error);
		expect(stderr).toHaveBeenCalledWith('structured execution failed\n');
		expect(dispose).toHaveBeenCalledOnce();
	});

	it('fails explicitly when a legacy runtime has no structured entry point', async () => {
		const dispose = vi.fn(async () => undefined);
		const sandbox = createSandbox(vi.fn(async () => true));
		sandbox.dispose = dispose;

		await expect(
			executeWasmIdleInNode({
				language: 'C',
				request: { code: 'int main() {}' },
				loadSandbox: async () => sandbox,
				stdout: vi.fn(),
				stderr: vi.fn()
			})
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			phase: 'configuration'
		});
		expect(dispose).toHaveBeenCalledOnce();
	});
});
