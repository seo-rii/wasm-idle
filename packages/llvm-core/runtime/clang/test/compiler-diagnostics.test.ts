import { describe, expect, it } from 'vitest';
import { extractCompilerDiagnostics } from '../src/compiler-diagnostics.js';

describe('structured cached compiler output', () => {
	it('parses colored warnings, errors, notes and paths containing colons', () => {
		const diagnostics = extractCompilerDiagnostics(
			[
				'\x1b[1msrc/main.c:2:3: \x1b[35mwarning: \x1b[0munused value',
				'C:\\src\\main.c:4:5: fatal error: missing header',
				'src/main.c:6: note: declared here',
				'compiler progress without a diagnostic'
			].join('\r\n')
		);
		expect(diagnostics).toEqual([
			{
				fileName: 'src/main.c',
				lineNumber: 2,
				columnNumber: 3,
				severity: 'warning',
				message: 'unused value'
			},
			{
				fileName: 'C:\\src\\main.c',
				lineNumber: 4,
				columnNumber: 5,
				severity: 'error',
				message: 'missing header'
			},
			{
				fileName: 'src/main.c',
				lineNumber: 6,
				columnNumber: undefined,
				severity: 'other',
				message: 'declared here'
			}
		]);
	});
});
