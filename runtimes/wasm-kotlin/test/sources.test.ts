import { describe, expect, it } from 'vitest';
import { createKotlinLineMap, KOTLIN_SOURCE_LIMITS, prepareKotlinSources } from '../src/sources.js';

describe('Kotlin source boundary', () => {
	it('snapshots multiple files without rewriting Unicode, BOM, or line endings', () => {
		const input = [
			{ path: '한글/Main.kt', text: '\ufefffun main() { println("😀e\u0301") }\r\n' },
			{ path: 'Helper.kt', text: 'val 마지막 = 1' }
		];
		const sources = prepareKotlinSources(input);
		expect(sources).toEqual(input);
		input[0]!.text = 'modified';
		expect(sources[0]!.text).toContain('\ufefffun main()');
		expect(Object.isFrozen(sources)).toBe(true);
		expect(Object.isFrozen(sources[0])).toBe(true);
	});

	it.each([
		'/Main.kt',
		'../Main.kt',
		'dir/../Main.kt',
		'dir/./Main.kt',
		'dir//Main.kt',
		'dir\\Main.kt',
		'C:/Main.kt',
		'https://host/Main.kt',
		'bad\0.kt',
		'Main.kts',
		'Main.java',
		'Main.kt\n'
	])('rejects an invalid path without normalizing it: %j', (path) => {
		expect(() => prepareKotlinSources([{ path, text: '' }])).toThrow(/path/);
	});

	it('rejects duplicate and file/directory conflicts in either order', () => {
		for (const paths of [
			['Main.kt', 'Main.kt'],
			['parent.kt', 'parent.kt/Main.kt'],
			['parent.kt/Main.kt', 'parent.kt']
		]) {
			expect(() => prepareKotlinSources(paths.map((path) => ({ path, text: '' })))).toThrow(
				/conflicting|Conflicting/
			);
		}
	});

	it('checks individual and aggregate UTF-8 bytes, file count, and path bytes', () => {
		const files = [
			{ path: 'A.kt', text: '한' },
			{ path: 'B.kt', text: '글' }
		];
		expect(() =>
			prepareKotlinSources(files, { ...KOTLIN_SOURCE_LIMITS, maxFileBytes: 2 })
		).toThrow(/byte limit/);
		expect(() =>
			prepareKotlinSources(files, { ...KOTLIN_SOURCE_LIMITS, maxTotalBytes: 5 })
		).toThrow(/byte limit/);
		expect(() => prepareKotlinSources(files, { ...KOTLIN_SOURCE_LIMITS, maxFiles: 1 })).toThrow(
			/count/
		);
		expect(() =>
			prepareKotlinSources(files, { ...KOTLIN_SOURCE_LIMITS, maxPathBytes: 3 })
		).toThrow(/path/);
		expect(
			prepareKotlinSources(files, { ...KOTLIN_SOURCE_LIMITS, maxTotalBytes: 6 })
		).toHaveLength(2);
	});

	it('rejects malformed files and incomplete or invalid limits', () => {
		for (const input of [null, {}, [], [null], [{ path: 'A.kt', text: new Uint8Array() }]]) {
			expect(() => prepareKotlinSources(input)).toThrow();
		}
		for (const maxTotalBytes of [0, -1, Infinity, 0.5]) {
			expect(() =>
				prepareKotlinSources([{ path: 'A.kt', text: '' }], {
					...KOTLIN_SOURCE_LIMITS,
					maxTotalBytes
				})
			).toThrow(/limits/);
		}
		expect(() =>
			prepareKotlinSources([{ path: 'A.kt', text: '' }], {} as typeof KOTLIN_SOURCE_LIMITS)
		).toThrow(/limits/);
	});
});

describe('Kotlin UTF-16 diagnostic positions', () => {
	it('counts surrogate pairs and preserves CRLF offsets', () => {
		const map = createKotlinLineMap('\ufeff한😀e\u0301\r\nnext\rlast\n');
		expect(map.position(0)).toEqual({ line: 1, column: 1 });
		expect(map.position(4)).toEqual({ line: 1, column: 5 });
		expect(map.position(7)).toEqual({ line: 1, column: 8 });
		expect(map.position(8)).toEqual({ line: 2, column: 1 });
		expect(map.position(13)).toEqual({ line: 3, column: 1 });
		expect(map.position(18)).toEqual({ line: 4, column: 1 });
	});

	it('handles empty text, missing final newline, and rejects invalid offsets', () => {
		expect(createKotlinLineMap('').position(0)).toEqual({ line: 1, column: 1 });
		expect(createKotlinLineMap('a\nb').position(3)).toEqual({ line: 2, column: 2 });
		for (const offset of [-1, 4, 0.5, NaN, Infinity]) {
			expect(() => createKotlinLineMap('a\nb').position(offset)).toThrow(/offset/);
		}
	});
});
