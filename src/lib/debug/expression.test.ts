import { describe, expect, it } from 'vitest';

import { evaluateDebugExpression } from './expression';

describe('evaluateDebugExpression', () => {
	it('evaluates arithmetic and comparison expressions against debug locals', () => {
		expect(
			evaluateDebugExpression('a == b', [
				{ name: 'a', value: '1' },
				{ name: 'b', value: '1' }
			])
		).toBe('true');
		expect(
			evaluateDebugExpression('result1 + result2', [
				{ name: 'result1', value: '2' },
				{ name: 'result2', value: '3' }
			])
		).toBe('5');
		expect(
			evaluateDebugExpression('a[0]', [{ name: 'a', value: '[1, 2, 3]' }])
		).toBe('1');
		expect(
			evaluateDebugExpression('grid[1][2]', [{ name: 'grid', value: '[[1, 2, 3], [4, 5, 6]]' }])
		).toBe('6');
	});

	it('treats unavailable locals as unavailable', () => {
		expect(() =>
			evaluateDebugExpression('a + 1', [{ name: 'a', value: '?' }])
		).toThrowError('unavailable');
	});
});
