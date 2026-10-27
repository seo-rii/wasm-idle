import { describe, expect, it } from 'vitest';
import { zigDebugLanguageAdapter } from '../../src/language/zig.js';

describe('Zig captured values', () => {
	const locals = [
		{ name: 'result', value: '12' },
		{ name: 'input', value: '7' }
	];

	it('looks up captured locals without executing expressions', () => {
		expect(zigDebugLanguageAdapter.evaluateExpression(' result ', locals)).toBe('12');
		expect(zigDebugLanguageAdapter.evaluateExpression('result + input', locals)).toBe('?');
		expect(zigDebugLanguageAdapter.evaluateExpression('@import("std")', locals)).toBe('?');
	});

	it('ignores names appearing only in strings, comments or longer identifiers', () => {
		expect(zigDebugLanguageAdapter.selectInlineLocals('result += input;', locals)).toEqual(
			locals
		);
		expect(
			zigDebugLanguageAdapter.selectInlineLocals(
				'const input_count = "result"; // input',
				locals
			)
		).toEqual([]);
	});
});
