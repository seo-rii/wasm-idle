import { describe, expect, it } from 'vitest';
import { parseScalaDiagnostics } from './scalaDiagnostics';

describe('Scala real reporter diagnostic headings', () => {
	it('preserves workspace paths and one-based positions from ANSI reporter output', () => {
		const diagnostics = parseScalaDiagnostics([
			'\x1b[31m-- [E007] Type Mismatch Error: /workspace/example/Helper.scala:3:21 ----------\x1b[0m',
			'3 | val value: Int = "bad"',
			'  | Found: String',
			'  | Required: Int',
			'-- Warning: /workspace/Main.scala:7:5 ---------------------------------',
			'deprecated API',
			'1 error found'
		]);
		expect(diagnostics).toMatchObject([
			{
				fileName: 'example/Helper.scala',
				lineNumber: 3,
				columnNumber: 21,
				severity: 'error'
			},
			{ fileName: 'Main.scala', lineNumber: 7, columnNumber: 5, severity: 'warning' }
		]);
		expect(diagnostics[0].message).toContain('Required: Int');
		expect(diagnostics[0].message).not.toContain('deprecated API');
	});
	it('rejects more diagnostics than allowed', () => {
		expect(() =>
			parseScalaDiagnostics(
				[
					'-- Error: /workspace/Main.scala:1:1 ---',
					'first',
					'-- Error: /workspace/Main.scala:2:1 ---',
					'second'
				],
				1
			)
		).toThrow('Scala diagnostic limit exceeded');
	});
});
