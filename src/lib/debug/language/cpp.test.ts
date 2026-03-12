import { describe, expect, it } from 'vitest';

import { cppDebugLanguageAdapter } from './cpp';

describe('cppDebugLanguageAdapter', () => {
	it('filters inline locals and evaluates expressions', () => {
		expect(
			cppDebugLanguageAdapter.selectInlineLocals('int sum = 0;', [
				{ name: 'sum', value: '0' },
				{ name: 'num', value: '1' }
			])
		).toEqual([{ name: 'sum', value: '0' }]);
		expect(
			cppDebugLanguageAdapter.evaluateExpression('value + 1', [{ name: 'value', value: '9' }])
		).toBe('10');
	});
});
