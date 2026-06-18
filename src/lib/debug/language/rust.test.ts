import { describe, expect, it } from 'vitest';

import { rustDebugLanguageAdapter } from './rust';

describe('rustDebugLanguageAdapter', () => {
	it('uses the shared expression evaluator and inline local selector', () => {
		expect(
			rustDebugLanguageAdapter.evaluateExpression('left + right', [
				{ name: 'left', value: '2' },
				{ name: 'right', value: '3' }
			])
		).toBe('5');
		expect(
			rustDebugLanguageAdapter.selectInlineLocals('let total = left + right;', [
				{ name: 'left', value: '2' },
				{ name: 'right', value: '3' },
				{ name: 'unused', value: '0' }
			])
		).toEqual([
			{ name: 'left', value: '2' },
			{ name: 'right', value: '3' }
		]);
	});
});
