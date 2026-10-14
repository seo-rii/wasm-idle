import { describe, expect, it } from 'vitest';
import { normalizeWorkspacePath, resolveCompilerDiagnosticPath } from './workspacePath';

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
