import { describe, expect, it } from 'vitest';

import { goDebugLanguageAdapter } from '../../src/language/go.js';

describe('goDebugLanguageAdapter', () => {
	it('filters inline locals and evaluates simple expressions', () => {
		expect(
			goDebugLanguageAdapter.selectInlineLocals('total := left + right // ignore hidden', [
				{ name: 'total', value: '0' },
				{ name: 'left', value: '2' },
				{ name: 'hidden', value: '9' }
			])
		).toEqual([
			{ name: 'total', value: '0' },
			{ name: 'left', value: '2' }
		]);
		expect(
			goDebugLanguageAdapter.evaluateExpression('left + values[1]', [
				{ name: 'left', value: '2' },
				{ name: 'values', value: '[1, 4, 9]' }
			])
		).toBe('6');
	});
});
