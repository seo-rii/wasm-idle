import { describe, expect, it } from 'vitest';
import {
	assertWorkspaceFileHierarchy,
	normalizeWorkspacePath,
	recoverWorkspaceFilePaths,
	resolveCompilerDiagnosticPath,
	workspaceFilePath
} from './workspacePath';

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

describe('editor file and directory names', () => {
	it('checks either insertion order and preserves same-name files in other directories', () => {
		expect(() => workspaceFilePath('include', ['include/number.h'])).toThrow(
			'it is a directory'
		);
		expect(() => workspaceFilePath('include/number.h', ['include'])).toThrow(
			'include is a file'
		);
		expect(() =>
			assertWorkspaceFileHierarchy(new Set(['include/number.h', 'include']))
		).toThrow('directory');
		expect(workspaceFilePath('other/include', ['include/number.h'])).toBe('other/include');
	});

	it('protects named directories and chooses a free sibling for copies', () => {
		const reserved = ['build', 'include/deep', 'source-2.cpp'];
		expect(() => workspaceFilePath('build', [], true, reserved)).toThrow('directory');
		expect(() => workspaceFilePath('include', [], false, reserved)).toThrow('directory');
		expect(workspaceFilePath('source.cpp', ['source.cpp'], true, reserved)).toBe(
			'source-3.cpp'
		);
		expect(workspaceFilePath('build/file.cpp', [], true, reserved)).toBe('build/file.cpp');
	});
	it('keeps generated copies out of existing files and directories', () => {
		expect(workspaceFilePath('test.h', ['test.h', 'test-2.h/other', 'test-3.h'], true)).toBe(
			'test-4.h'
		);
	});

	it('recovers nested older collisions independently of input order, preserving every descendant', () => {
		const paths = ['include/nested/test.h', 'include/nested', 'include', 'include-2/another.h'];
		for (const ordered of [paths, [...paths].reverse()]) {
			const renamed = recoverWorkspaceFilePaths(ordered);
			expect(Object.fromEntries(renamed)).toEqual({
				include: 'include-3',
				'include/nested': 'include/nested-2'
			});
			expect(() =>
				assertWorkspaceFileHierarchy(
					new Set(ordered.map((path) => renamed.get(path) ?? path))
				)
			).not.toThrow();
		}
	});
});

describe('compiler diagnostic path resolution', () => {
	const workspacePaths = ['main.rs', 'src/lib.rs', 'src/util/Helper.java', 'Program.cs'];

	it.each([
		[undefined, 'main.rs'],
		[null, 'main.rs'],
		['', 'main.rs'],
		['  ', 'main.rs'],
		['main.rs', 'main.rs'],
		['src/lib.rs', 'src/lib.rs'],
		['./src/lib.rs', 'src/lib.rs'],
		['/workspace/src/lib.rs', 'src/lib.rs'],
		['src\\lib.rs', 'src/lib.rs'],
		['/work/src/lib.rs', 'src/lib.rs'],
		['lib.rs', 'src/lib.rs'],
		['Helper.java', 'src/util/Helper.java'],
		['/tmp/Program.cs', 'Program.cs']
	])('resolves %j to %j', (fileName, expected) => {
		expect(resolveCompilerDiagnosticPath(fileName, 'main.rs', workspacePaths)).toBe(expected);
	});

	it.each(['/tmp/Program.fs', '/rustc/library/core/src/fmt/mod.rs', '../outside.rs', '/'])(
		'keeps unmatched path %j on the run entry file',
		(fileName) => {
			expect(resolveCompilerDiagnosticPath(fileName, 'main.rs', workspacePaths)).toBe(
				'main.rs'
			);
		}
	);

	it('prefers the entry file among same-named files and keeps ambiguous names on it', () => {
		const paths = ['src/main.go', 'cmd/main.go', 'lib/main.go'];
		expect(resolveCompilerDiagnosticPath('/tmp/main.go', 'cmd/main.go', paths)).toBe(
			'cmd/main.go'
		);
		expect(resolveCompilerDiagnosticPath('main.go', 'cmd/main.go', paths)).toBe('cmd/main.go');
		expect(resolveCompilerDiagnosticPath('/build/lib/main.go', 'cmd/main.go', paths)).toBe(
			'lib/main.go'
		);
		expect(resolveCompilerDiagnosticPath('main.go', 'README.md', paths)).toBe('README.md');
	});

	it('ranks scratch paths by the number of matching trailing components', () => {
		// A runtime that compiles nested/main.d as /work/main.d must not move markers to main.d.
		expect(
			resolveCompilerDiagnosticPath('/work/main.d', 'nested/main.d', [
				'main.d',
				'nested/main.d'
			])
		).toBe('nested/main.d');
		// A more specific suffix outranks an entry that only shares the basename.
		expect(
			resolveCompilerDiagnosticPath('/build/lib/main.go', 'main.go', [
				'main.go',
				'lib/main.go'
			])
		).toBe('lib/main.go');
	});
});
