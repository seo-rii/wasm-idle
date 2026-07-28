import { describe, expect, it } from 'vitest';

import {
	DEFAULT_EXECUTION_LIMITS,
	TERMINATION_REASONS,
	RuntimeConfigurationError,
	resolveExecutionLimits,
	type ExecutionRequest,
	type ExecutionResult
} from '@wasm-idle/core';

describe('core execution contract', () => {
	it('publishes deterministic phase and resource defaults', () => {
		expect(DEFAULT_EXECUTION_LIMITS).toEqual({
			assetTimeoutMs: 60_000,
			startupTimeoutMs: 60_000,
			compileTimeoutMs: 120_000,
			runTimeoutMs: 30_000,
			maxOutputBytes: 1024 * 1024,
			maxDiagnostics: 1000,
			maxWorkspaceBytes: 8 * 1024 * 1024,
			maxAssetBytes: 128 * 1024 * 1024,
			maxWasmMemoryBytes: 512 * 1024 * 1024,
			maxWorkers: 1,
			maxThreads: 1
		});
		expect(TERMINATION_REASONS).toEqual([
			'completed',
			'compile-error',
			'runtime-error',
			'cancelled',
			'timeout',
			'output-limit',
			'memory-limit',
			'workspace-limit',
			'worker-crash',
			'asset-error'
		]);
	});

	it('merges explicit limits without mutating the defaults', () => {
		const limits = resolveExecutionLimits({
			runTimeoutMs: 5_000,
			maxOutputBytes: 64 * 1024,
			maxWorkers: 2
		});

		expect(limits).toEqual({
			...DEFAULT_EXECUTION_LIMITS,
			runTimeoutMs: 5_000,
			maxOutputBytes: 64 * 1024,
			maxWorkers: 2
		});
		expect(DEFAULT_EXECUTION_LIMITS.runTimeoutMs).toBe(30_000);
	});

	it.each([
		['runTimeoutMs', 0],
		['maxOutputBytes', -1],
		['maxWorkers', 1.5],
		['maxAssetBytes', Number.POSITIVE_INFINITY]
	] as const)('rejects invalid %s limits', (key, value) => {
		expect(() => resolveExecutionLimits({ [key]: value })).toThrowError(
			expect.objectContaining<Partial<RuntimeConfigurationError>>({
				code: 'runtime-configuration',
				phase: 'configuration'
			})
		);
	});

	it('models one request and result without boolean-or-string ambiguity', () => {
		const request = {
			code: 'print("hello")',
			activePath: 'main.py',
			args: ['one'],
			stdin: 'input\n',
			env: { MODE: 'test' },
			limits: { runTimeoutMs: 1_000 },
			signal: new AbortController().signal
		} satisfies ExecutionRequest;
		const result = {
			ok: true,
			exitCode: 0,
			stdout: 'hello\n',
			stderr: '',
			diagnostics: [],
			artifacts: [],
			timings: {
				assetMs: 1,
				startupMs: 2,
				compileMs: 3,
				executeMs: 4,
				totalMs: 10
			},
			terminationReason: 'completed',
			runtime: {
				languageId: 'PYTHON',
				implementationId: 'pyodide',
				profileId: 'pyodide-0.29.3',
				version: '0.29.3',
				protocolVersion: 1
			}
		} satisfies ExecutionResult;

		expect(request.signal.aborted).toBe(false);
		expect(result).toMatchObject({
			ok: true,
			exitCode: 0,
			terminationReason: 'completed',
			runtime: { implementationId: 'pyodide' }
		});
	});
});
