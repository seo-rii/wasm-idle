import { describe, expect, it } from 'vitest';
import { normalizeWorkspacePath } from './workspacePath';

describe('workspace path normalization', () => {
	it.each([
		['', ''],
		['.', ''],
		['././', ''],
		['./src//./main.py/', 'src/main.py'],
		['src\\.\\nested\\main.py', 'src/nested/main.py'],
		['자료//./실행.py', '자료/실행.py'],
		['.gitignore', '.gitignore'],
		[' a / b .py ', ' a / b .py ']
	])('normalizes %j to %j', (path, expected) => {
		expect(normalizeWorkspacePath(path)).toBe(expected);
	});

	it.each([
		'..',
		'../b.py',
		'a/../b.py',
		'a/..',
		'a\\..\\b.py',
		'a//../b.py',
		'/absolute.py',
		'\\absolute.py',
		'//server/share/file.py',
		'\\\\server\\share\\file.py',
		'C:/file.py',
		'c:\\file.py',
		'C:file.py',
		'a\0b.py'
	])('rejects unsafe path %j', (path) => {
		expect(() => normalizeWorkspacePath(path)).toThrow();
	});

	it('preserves distinct Unicode spellings and filenames containing multiple dots', () => {
		expect(normalizeWorkspacePath('é.py')).toBe('é.py');
		expect(normalizeWorkspacePath('e\u0301.py')).toBe('e\u0301.py');
		expect(normalizeWorkspacePath('.../a..b.py')).toBe('.../a..b.py');
	});
});
