import { describe, expect, it } from 'vitest';
import {
	compilerArgumentConfig,
	defaultCompilerSettings,
	readCompilerOptions,
	resolveCompilerArguments,
	restoreCompilerOptions
} from './compilerOptions';
import { validateWorkspaceSnapshot } from './workspaceSnapshot';

describe('compiler option arguments', () => {
	it('retains runtime defaults when no settings have been changed', () => {
		expect(resolveCompilerArguments('CPP', defaultCompilerSettings)).toEqual([]);
		expect(resolveCompilerArguments('C', defaultCompilerSettings)).toEqual([]);
	});

	it('applies C selections before explicit overrides without splitting quoted tokens', () => {
		expect(
			resolveCompilerArguments('C', {
				...defaultCompilerSettings,
				cVersion: 'C23',
				gnuExtensions: false,
				optimization: '2',
				warnings: 'extra',
				warningsAsErrors: true,
				pedantic: true,
				arguments: `-I'headers with spaces' '-DMESSAGE="hello world"' -O0 -Wno-error`
			})
		).toEqual([
			'-std=c23',
			'-O2',
			'-Wall',
			'-Wextra',
			'-Werror',
			'-pedantic',
			'-Iheaders with spaces',
			'-DMESSAGE="hello world"',
			'-O0',
			'-Wno-error'
		]);
	});

	it.each(['CPP', 'OBJECTIVECXX'] as const)(
		'uses the selected ISO C++ dialect for %s',
		(language) => {
			expect(
				resolveCompilerArguments(
					language,
					{
						...defaultCompilerSettings,
						gnuExtensions: false,
						warnings: 'none',
						optimization: 'z'
					},
					'CPP98'
				)
			).toEqual(['-std=c++98', '-Oz', '-w']);
		}
	);
	it('passes GNU standard selections explicitly to Objective-C frontend adapters', () => {
		expect(
			resolveCompilerArguments('OBJC', {
				...defaultCompilerSettings,
				cVersion: 'C23'
			})
		).toEqual(['-std=gnu23']);
		expect(resolveCompilerArguments('OBJECTIVECXX', defaultCompilerSettings, 'CPP23')).toEqual([
			'-std=gnu++23'
		]);
	});

	it.each(['D', 'ZIG', 'COBOL', 'V', 'FORTRAN'] as const)(
		'forwards only native arguments for %s',
		(language) => {
			expect(
				resolveCompilerArguments(language, {
					...defaultCompilerSettings,
					optimization: '3',
					warningsAsErrors: true,
					arguments: '-O Debug "-Ipath with spaces"'
				})
			).toEqual(['-O', 'Debug', '-Ipath with spaces']);
		}
	);

	it('reports unfinished quoting before a run can start', () => {
		expect(() =>
			resolveCompilerArguments('C', {
				...defaultCompilerSettings,
				arguments: '-DNAME="unfinished'
			})
		).toThrow('Close the " quote');
	});
	it('accepts GHC flags and rejects tokens that its string-based runtime would split', () => {
		expect(
			resolveCompilerArguments('HASKELL', {
				...defaultCompilerSettings,
				arguments: '-O2 -Wall -XGHC2021'
			})
		).toEqual(['-O2', '-Wall', '-XGHC2021']);
		for (const argumentsInput of ['"-Ipath with spaces"', '""']) {
			expect(() =>
				resolveCompilerArguments('HASKELL', {
					...defaultCompilerSettings,
					arguments: argumentsInput
				})
			).toThrow('cannot accept empty arguments or arguments containing spaces');
		}
	});

	it('describes the actual Fortran backend and omits unsupported compiler interfaces', () => {
		expect(compilerArgumentConfig.FORTRAN?.help).toContain('generated C');
		for (const language of ['RUST', 'GO', 'TINYGO', 'JAVA', 'CSHARP', 'C3'] as const) {
			expect(compilerArgumentConfig[language]).toBeUndefined();
		}
	});
});

describe('saved compiler options', () => {
	const files = [{ path: 'main.c', content: 'int main(void) { return 0; }' }];
	it('round-trips independent language settings in the shared workspace snapshot', () => {
		const compilerOptions = {
			C: { ...defaultCompilerSettings, cVersion: 'C23' as const, arguments: '-DVALUE=1' },
			ZIG: { ...defaultCompilerSettings, arguments: '-O ReleaseFast' }
		};
		const snapshot = JSON.parse(JSON.stringify({ version: 6, files, compilerOptions }));
		expect(() => validateWorkspaceSnapshot(snapshot)).not.toThrow();
		expect(readCompilerOptions(snapshot.compilerOptions)).toEqual(compilerOptions);
	});

	it('fills omitted defaults and returns independent settings', () => {
		const original = { C: { arguments: '-DVALUE=1' } };
		const restored = readCompilerOptions(original);
		expect(restored.C).toEqual({ ...defaultCompilerSettings, arguments: '-DVALUE=1' });
		restored.C!.arguments = '-DVALUE=2';
		expect(original.C.arguments).toBe('-DVALUE=1');
	});

	it.each(['OBJC', 'OBJECTIVECXX', 'HASKELL'] as const)(
		'migrates legacy compiler arguments for %s without turning them into argv',
		(language) => {
			const restored = restoreCompilerOptions(undefined, language, '-Wall -O2');
			expect(restored.argsInput).toBe('');
			expect(restored.compilerOptions[language]?.arguments).toBe('-Wall -O2');
		}
	);

	it('preserves new program arguments separately from saved compiler arguments', () => {
		const options = { OBJC: { arguments: '-DVALUE=42' } };
		const restored = restoreCompilerOptions(options, 'OBJC', '"hello world"');
		expect(restored.argsInput).toBe('"hello world"');
		expect(restored.compilerOptions.OBJC?.arguments).toBe('-DVALUE=42');
	});

	it.each([
		null,
		[],
		'flags',
		{ UNKNOWN: {} },
		{ C: [] },
		{ C: { arguments: 3 } },
		{ C: { optimization: 'fastest' } },
		{ C: { warnings: 'everything' } },
		{ C: { cVersion: 'C42' } },
		{ C: { gnuExtensions: 'false' } },
		{ C: { unknownField: true } },
		{ JAVA: { arguments: '-g' } }
	])('rejects malformed options before modifying a workspace: %j', (compilerOptions) => {
		expect(() => validateWorkspaceSnapshot({ files, compilerOptions })).toThrow(
			'Invalid workspace snapshot: compilerOptions.'
		);
	});
});
