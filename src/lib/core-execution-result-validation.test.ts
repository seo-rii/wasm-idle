import { runInNewContext } from 'node:vm';
import { validateExecutionResult, type ExecutionResult } from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

function createResult(): ExecutionResult {
	return {
		ok: true,
		exitCode: 0,
		stdout: 'ok\n',
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
			languageId: 'C',
			implementationId: 'clang',
			version: '22.1.8',
			profileId: 'clang-wasi-22',
			protocolVersion: 1,
			manifestSchemaVersion: 2
		}
	};
}

describe('structured execution result validation', () => {
	it('accepts a complete result without replacing the runtime-owned object', () => {
		const result = createResult();

		expect(validateExecutionResult(result)).toBe(result);
	});

	it('enforces UTF-8 output and diagnostic budgets', () => {
		expect(() =>
			validateExecutionResult({ ...createResult(), stdout: 'ééé' }, { maxOutputBytes: 5 })
		).toThrow('Runtime output exceeded 5 bytes');
		expect(() =>
			validateExecutionResult(
				{
					...createResult(),
					diagnostics: [
						{ message: 'one', severity: 'warning' },
						{ message: 'two', severity: 'warning' }
					]
				},
				{ maxDiagnostics: 1 }
			)
		).toThrow('Runtime diagnostics exceeded 1 entries');
	});

	it('validates artifact paths, kinds, byte views, and aggregate size', () => {
		const crossRealmBytes = runInNewContext('new Uint8Array([1, 2, 3])') as Uint8Array;
		const result = {
			...createResult(),
			artifacts: [
				{
					path: 'out/module.wasm',
					kind: 'wasm-module' as const,
					mediaType: 'application/wasm',
					data: crossRealmBytes
				}
			]
		};

		expect(validateExecutionResult(result)).toBe(result);
		expect(() => validateExecutionResult(result, { maxWorkspaceBytes: 2 })).toThrow(
			'Execution artifacts are 3 bytes; limit is 2'
		);
		expect(() =>
			validateExecutionResult({
				...createResult(),
				artifacts: [{ ...result.artifacts[0], path: '../module.wasm' }]
			})
		).toThrow('Invalid workspace path');
		expect(() =>
			validateExecutionResult({
				...createResult(),
				artifacts: [result.artifacts[0], { ...result.artifacts[0] }]
			})
		).toThrow('Duplicate execution artifact path');
	});

	it('rejects malformed diagnostics, timings, termination, and runtime identity', () => {
		expect(() =>
			validateExecutionResult({
				...createResult(),
				diagnostics: [{ message: 'bad', severity: 'fatal' }]
			})
		).toThrow('Execution diagnostic severity is invalid');
		expect(() =>
			validateExecutionResult({
				...createResult(),
				timings: { ...createResult().timings, executeMs: Number.NaN }
			})
		).toThrow('Execution timing executeMs is invalid');
		expect(() =>
			validateExecutionResult({ ...createResult(), terminationReason: 'unknown' })
		).toThrow('Execution result termination reason is invalid');
		expect(() =>
			validateExecutionResult({
				...createResult(),
				runtime: { ...createResult().runtime, protocolVersion: 0 }
			})
		).toThrow('Execution runtime protocolVersion is invalid');
	});

	it('enforces canonical typed error summaries', () => {
		const result = {
			...createResult(),
			ok: false,
			terminationReason: 'runtime-error' as const,
			error: {
				code: 'unknown' as const,
				message: 'Runtime returned an unclassified failure',
				phase: 'execute' as const,
				recoverable: true
			}
		};
		expect(validateExecutionResult(result)).toBe(result);

		for (const [error, message] of [
			[{ code: 'invented', message: 'bad' }, 'error summary is malformed'],
			[{ code: 'runtime', message: '   ' }, 'error summary is malformed'],
			[{ code: 'runtime', message: 'bad', phase: 'unknown' }, 'error phase is invalid'],
			[{ code: 'runtime', message: 'bad', recoverable: 'yes' }, 'recoverable must be boolean']
		] as const) {
			expect(() => validateExecutionResult({ ...result, error })).toThrow(message);
		}
	});

	it('rejects a non-object result before reading fields', () => {
		expect(() => validateExecutionResult('success')).toThrow(
			'Runtime returned a malformed execution result'
		);
	});
});
