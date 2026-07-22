import { describe, expect, it } from 'vitest';

import { evaluateDebugExpression } from '../src/debug/expression.js';

describe('evaluateDebugExpression', () => {
	it('consumes but does not evaluate short-circuited operands', () => {
		expect(evaluateDebugExpression('false && missing.value', [])).toBe('false');
		expect(evaluateDebugExpression('true || missing[0]', [])).toBe('true');
		expect(evaluateDebugExpression('true && ready', [{ name: 'ready', value: 'true' }])).toBe(
			'true'
		);
	});
});
