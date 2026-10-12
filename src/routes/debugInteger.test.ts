import { describe, expect, it } from 'vitest';
import { parseDebugInteger } from './debugInteger';

describe('memory inspector signed integer parsing', () => {
	it.each([
		['-0x10', -16],
		['-0XfF', -255],
		['0x10', 16],
		['-16', -16],
		['16', 16],
		['0', 0],
		['  -0x10  ', -16],
		['0x1fffffffffffff', Number.MAX_SAFE_INTEGER],
		['-0x1fffffffffffff', Number.MIN_SAFE_INTEGER]
	])('parses %s as %s', (text, expected) => {
		expect(parseDebugInteger(text as string)).toBe(expected);
	});

	it.each([
		'',
		'0x',
		'-0x',
		'0xgg',
		'1.5',
		'1e2',
		'+16',
		'01',
		'--1',
		'0x20000000000000',
		'-0x20000000000000',
		'9007199254740992'
	])('rejects invalid or unsafe offset %s', (text) => {
		expect(parseDebugInteger(text)).toBeNaN();
	});
});
