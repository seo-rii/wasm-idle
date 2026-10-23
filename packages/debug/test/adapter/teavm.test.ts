import { describe, expect, it } from 'vitest';
import { readTeaVmDebugLocations } from '../../src/adapter/teavm.js';

const leb = (value: number): number[] => {
	const bytes = [];
	do {
		const digit = value & 127;
		value >>>= 7;
		bytes.push(digit | (value ? 128 : 0));
	} while (value);
	return bytes;
};
const string = (value: string) => {
	const bytes = [...new TextEncoder().encode(value)];
	return [...leb(bytes.length), ...bytes];
};
const custom = (name: string, bytes: number[]) => {
	const body = [...string(name), ...bytes];
	return [0, ...leb(body.length), ...body];
};
function fixture(lines: number[]) {
	return new Uint8Array([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		10,
		40,
		...Array(40).fill(0), // Code section starts at absolute module offset 10.
		...custom('teavm_str', ['Main', 'java', 'main', 'helper'].flatMap(string)),
		...custom('teavm_file', [0, 1, 1]), // Main.java; string-index << 1 | extension bit.
		...custom('teavm_cls', [0, 0]),
		...custom('teavm_mtd', [0, 2, 0, 3]),
		...custom('teavm_line', lines)
	]);
}

describe('TeaVM embedded source locations', () => {
	it('decodes address deltas, signed lines, inlined methods, and closed ranges', () => {
		const bytes = fixture([
			4,
			11,
			0,
			0,
			3,
			1,
			2,
			4, // main at module offset 12, source line 5
			4,
			3,
			0,
			1,
			3,
			1,
			2,
			8, // inline helper at module offset 15, source line 9
			4,
			4,
			1, // leave helper at address 9; restore main line 5
			10 + 2 + 32 * 4, // address 11, line 6
			4,
			5,
			1 // end main at address 16
		]);
		expect(readTeaVmDebugLocations(bytes, ['src/Main.java'])).toEqual([
			{
				address: 12,
				endAddress: 15,
				sourcePath: 'src/Main.java',
				line: 5,
				functionName: 'Main.main'
			},
			{
				address: 15,
				endAddress: 19,
				sourcePath: 'src/Main.java',
				line: 9,
				functionName: 'Main.helper',
				inlineDepth: 1
			},
			{
				address: 19,
				endAddress: 21,
				sourcePath: 'src/Main.java',
				line: 5,
				functionName: 'Main.main'
			},
			{
				address: 21,
				endAddress: 26,
				sourcePath: 'src/Main.java',
				line: 6,
				functionName: 'Main.main'
			}
		]);
		expect(readTeaVmDebugLocations(bytes, ['a/Main.java', 'b/Main.java'])).toEqual([]);
	});
	it('rejects truncated, invalid, and out-of-code-range metadata', () => {
		expect(() => readTeaVmDebugLocations(new Uint8Array([0, 97]))).toThrow('Truncated');
		expect(() => readTeaVmDebugLocations(fixture([0, 99]))).toThrow('reference');
		expect(() => readTeaVmDebugLocations(fixture([4, 55, 0, 0]))).toThrow('code section');
		expect(() => readTeaVmDebugLocations(fixture([0, 0]))).toThrow('Unterminated');
	});
});
