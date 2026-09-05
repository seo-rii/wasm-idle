import { describe, expect, it } from 'vitest';
import { parseArgs } from './parseArgs';

describe('argument input', () => {
	it.each([
		['', []],
		[' \t \n ', []],
		['  3 4\t5\n', ['3', '4', '5']],
		['--name "Hong Gil" ""', ['--name', 'Hong Gil', '']],
		["'한글 😀' ''", ['한글 😀', '']],
		['a" b"c', ['a bc']],
		['one\\ two "say \\"hello\\""', ['one two', 'say "hello"']],
		["'C:\\tmp\\file'", ['C:\\tmp\\file']],
		['$USER *.txt $(whoami) ;', ['$USER', '*.txt', '$(whoami)', ';']]
	])('parses %j without shell expansion', (input, expected) => {
		expect(parseArgs(input)).toEqual(expected);
	});

	it.each(['"unfinished', "'unfinished", 'trailing\\'])(
		'rejects incomplete input %j',
		(input) => {
			expect(() => parseArgs(input)).toThrow();
		}
	);
});
