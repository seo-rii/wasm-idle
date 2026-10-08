import { describe, expect, it } from 'vitest';
import { isSupportedLanguageId } from '../../../packages/core/src/languages.js';
import { readKotlinCompileFailure, readKotlinCompileRequest } from '../src/protocol.js';

const requestInput = () => ({
	protocolVersion: 1,
	requestId: 'compile-1',
	generation: 3,
	profileId: 'candidate',
	files: [{ path: 'Main.kt', text: 'fun main() { println("😀") }' }],
	entry: { file: 'Main.kt', qualifiedFunction: 'main' }
});
const limits = { maxDiagnostics: 2, maxDiagnosticBytes: 100 };

describe('Kotlin candidate compile request contract', () => {
	it('accepts explicit entry metadata without interpreting or rewriting source', () => {
		const input = requestInput();
		const request = readKotlinCompileRequest(input, 'candidate');
		expect(request).toEqual(input);
		input.entry.file = 'Changed.kt';
		expect(request.entry.file).toBe('Main.kt');
	});

	it.each([
		{ protocolVersion: 2 },
		{ requestId: '' },
		{ generation: -1 },
		{ generation: 1.5 },
		{ profileId: 'other' },
		{ compileArgs: ['-Xskip-metadata-version-check'] },
		{ options: { optimize: true } },
		{ entry: { file: 'Other.kt', qualifiedFunction: 'main' } },
		{ entry: { file: 'Main.kt', qualifiedFunction: '' } },
		{ entry: { file: 'Main.kt', qualifiedFunction: 'main', args: ['injected'] } }
	])('rejects unsupported request fields: %j', (change) => {
		expect(() =>
			readKotlinCompileRequest({ ...requestInput(), ...change }, 'candidate')
		).toThrow();
	});

	it('keeps public Kotlin support disabled while the official compiler is unbuilt', () => {
		expect(isSupportedLanguageId('KOTLIN')).toBe(false);
		expect(isSupportedLanguageId('KOTLIN_WASM')).toBe(false);
	});
});

describe('Kotlin compile failure contract', () => {
	const failure = () => ({
		requestId: 'compile-1',
		generation: 3,
		status: 'compile-error',
		diagnostics: [
			{
				severity: 'error',
				code: 'UNRESOLVED_REFERENCE',
				message: 'Unknown symbol',
				path: 'Main.kt',
				startUtf16: 4,
				endUtf16: 8
			}
		]
	});

	it('validates bounded diagnostics against the original file text', () => {
		const request = readKotlinCompileRequest(requestInput(), 'candidate');
		const output = readKotlinCompileFailure(failure(), request, limits);
		expect(output).toEqual(failure());
		expect(Object.isFrozen(output.diagnostics[0])).toBe(true);
		const internal = { ...failure(), status: 'internal-error', diagnostics: [] };
		expect(readKotlinCompileFailure(internal, request, limits).status).toBe('internal-error');
	});

	it.each([
		{ generation: 2 },
		{ requestId: 'old' },
		{ status: 'ok' },
		{ artifact: { bytes: new ArrayBuffer(8) } },
		{ diagnostics: [null] },
		{ diagnostics: [{ severity: 'success', code: 'X', message: 'invalid' }] },
		{ diagnostics: [{ severity: 'error', code: 'X', message: 'invalid', path: 'Other.kt' }] },
		{
			diagnostics: [
				{ severity: 'error', code: 'X', message: 'invalid', startUtf16: 0, endUtf16: 1 }
			]
		},
		{
			diagnostics: [
				{
					severity: 'error',
					code: 'X',
					message: 'invalid',
					path: 'Main.kt',
					startUtf16: 8,
					endUtf16: 4
				}
			]
		},
		{
			diagnostics: [
				{
					severity: 'error',
					code: 'X',
					message: 'invalid',
					path: 'Main.kt',
					startUtf16: 0,
					endUtf16: 999
				}
			]
		},
		{
			diagnostics: [
				{ severity: 'error', code: 'X', message: 'invalid', path: 'Main.kt', startUtf16: 0 }
			]
		}
	])('rejects stale messages, artifacts, or invalid diagnostic ranges: %j', (change) => {
		const request = readKotlinCompileRequest(requestInput(), 'candidate');
		expect(() =>
			readKotlinCompileFailure({ ...failure(), ...change }, request, limits)
		).toThrow();
	});

	it('enforces both diagnostic count and aggregate Unicode byte budgets', () => {
		const request = readKotlinCompileRequest(requestInput(), 'candidate');
		expect(() =>
			readKotlinCompileFailure(
				{ ...failure(), diagnostics: Array(3).fill(failure().diagnostics[0]) },
				request,
				limits
			)
		).toThrow();
		expect(() =>
			readKotlinCompileFailure(
				{
					...failure(),
					diagnostics: [{ severity: 'error', code: 'X', message: '한'.repeat(34) }]
				},
				request,
				limits
			)
		).toThrow(/byte limit/);
		expect(() =>
			readKotlinCompileFailure(failure(), request, { ...limits, maxDiagnostics: 0 })
		).toThrow(/limits/);
	});
});
