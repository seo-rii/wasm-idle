import { describe, expect, it } from 'vitest';

import {
	AssetIntegrityError,
	BusyError,
	CancelledError,
	CompileError,
	ProtocolError,
	RuntimeConfigurationError,
	RuntimeExecutionError,
	TimeoutError,
	UnsupportedLanguageError,
	WasmIdleError,
	isWasmIdleError
} from '@wasm-idle/core';

describe('core runtime errors', () => {
	it('preserves stable metadata and the original cause', () => {
		const cause = new TypeError('digest failed');
		const error = new AssetIntegrityError('clang.wasm.gz failed verification', {
			runtimeId: 'clang',
			profileId: 'clang-wasi-22',
			cause
		});

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(WasmIdleError);
		expect(error).toMatchObject({
			name: 'AssetIntegrityError',
			code: 'asset-integrity',
			phase: 'asset',
			runtimeId: 'clang',
			profileId: 'clang-wasi-22',
			recoverable: false,
			cause
		});
		expect(isWasmIdleError(error)).toBe(true);
		expect(isWasmIdleError(new Error('plain'))).toBe(false);
	});

	it('provides typed defaults for caller-action and execution failures', () => {
		expect(new UnsupportedLanguageError('PYPY3')).toMatchObject({
			code: 'unsupported-language',
			phase: 'configuration',
			recoverable: false,
			languageId: 'PYPY3'
		});
		expect(new BusyError()).toMatchObject({
			code: 'busy',
			phase: 'execute',
			recoverable: true
		});
		expect(new RuntimeConfigurationError('missing runtime')).toMatchObject({
			code: 'runtime-configuration',
			phase: 'configuration',
			recoverable: false
		});
		expect(new CompileError('syntax error')).toMatchObject({
			code: 'compile',
			phase: 'compile',
			recoverable: true
		});
		expect(new RuntimeExecutionError('trap')).toMatchObject({
			code: 'runtime',
			phase: 'execute',
			recoverable: true
		});
		expect(new ProtocolError('unexpected message')).toMatchObject({
			code: 'protocol',
			phase: 'protocol',
			recoverable: false
		});
	});

	it('records timeout and cancellation phases without losing reasons', () => {
		const timeout = new TimeoutError('Compiler startup timed out', {
			phase: 'startup',
			timeoutMs: 30_000,
			runtimeId: 'swift'
		});
		expect(timeout).toMatchObject({
			code: 'timeout',
			phase: 'startup',
			timeoutMs: 30_000,
			runtimeId: 'swift',
			recoverable: true
		});

		const reason = new DOMException('cancelled by user', 'AbortError');
		const cancelled = new CancelledError('Execution cancelled', {
			phase: 'execute',
			cause: reason
		});
		expect(cancelled).toMatchObject({
			code: 'cancelled',
			phase: 'execute',
			cause: reason,
			recoverable: true
		});
	});
});
