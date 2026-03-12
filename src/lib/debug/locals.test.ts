import { describe, expect, it } from 'vitest';

import { selectInlineDebugLocals } from './locals';

describe('selectInlineDebugLocals', () => {
	it('keeps only locals referenced on the current line', () => {
		expect(
			selectInlineDebugLocals('int sum = 0;', [
				{ name: 'sum', value: '0' },
				{ name: 'num', value: '1' }
			])
		).toEqual([{ name: 'sum', value: '0' }]);
	});

	it('ignores identifiers inside string literals', () => {
		expect(
			selectInlineDebugLocals('printf("sum=%d", sum);', [
				{ name: 'sum', value: '10' },
				{ name: 'd', value: '0' }
			])
		).toEqual([{ name: 'sum', value: '10' }]);
	});
});
