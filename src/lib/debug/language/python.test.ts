import { describe, expect, it } from 'vitest';

import { pythonDebugLanguageAdapter } from './python';

describe('pythonDebugLanguageAdapter', () => {
	it('filters inline locals and evaluates Python-style expressions', () => {
		expect(
			pythonDebugLanguageAdapter.selectInlineLocals('total = left + right  # ignore hidden', [
				{ name: 'total', value: '0' },
				{ name: 'left', value: '2' },
				{ name: 'hidden', value: '9' }
			])
		).toEqual([
			{ name: 'total', value: '0' },
			{ name: 'left', value: '2' }
		]);
		expect(
			pythonDebugLanguageAdapter.evaluateExpression('left + values[1]', [
				{ name: 'left', value: '2' },
				{ name: 'values', value: '[1, 4, 9]' }
			])
		).toBe('6');
		expect(
			pythonDebugLanguageAdapter.evaluateExpression('ready and not done', [
				{ name: 'ready', value: 'True' },
				{ name: 'done', value: 'False' }
			])
		).toBe('true');
		expect(
			pythonDebugLanguageAdapter.evaluateExpression('name == "Ada"', [
				{ name: 'name', value: "'Ada'" }
			])
		).toBe('true');
	});
});
