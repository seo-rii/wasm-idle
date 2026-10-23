import { describe, expect, it } from 'vitest';
import { createClangdConfiguration } from '../../packages/lsp/src/clangd/config';
import {
	compilerArgumentConfig,
	defaultCompilerSettings,
	readCompilerOptions,
	resolveClangdCompilerArguments,
	resolveCompilerArguments,
	resolveCompilerSourceLanguage,
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

	it.each(['CPP'] as const)('uses the selected ISO C++ dialect for %s', (language) => {
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
	});
	it.each(['OBJC', 'OBJECTIVECXX'] as const)(
		'keeps %s standards separate from flags shared by mixed source units',
		(language) => {
			expect(
				resolveCompilerArguments(
					language,
					{
						...defaultCompilerSettings,
						cVersion: 'C23',
						gnuExtensions: false,
						warnings: 'extra',
						arguments: '-DVALUE=42'
					},
					'CPP17'
				)
			).toEqual(['-Wall', '-Wextra', '-DVALUE=42']);
		}
	);

	it('uses the active Objective-C file extension for standard controls and clangd', () => {
		expect(resolveCompilerSourceLanguage('OBJC', 'src/main.mm')).toBe('OBJECTIVECXX');
		expect(resolveCompilerSourceLanguage('OBJC', 'src/MAIN.MM')).toBe('OBJECTIVECXX');
		expect(resolveCompilerSourceLanguage('OBJECTIVECXX', 'src/helper.m')).toBe('OBJC');
		expect(resolveCompilerSourceLanguage('OBJECTIVECXX', 'src/helper.c')).toBe('OBJC');
		expect(resolveCompilerSourceLanguage('OBJECTIVECXX', 'header.h')).toBe('OBJECTIVECXX');
		expect(resolveCompilerSourceLanguage('C', 'src/main.mm')).toBe('C');
	});

	it.each(['main.cc', 'src/main.cpp', 'main.cxx', 'main.C'])(
		'uses the C++ dialect for C-selected %s while retaining explicit overrides',
		(activePath) => {
			const settings = {
				...defaultCompilerSettings,
				cVersion: 'C99' as const,
				gnuExtensions: false,
				arguments: '-std=c++23'
			};
			expect(resolveCompilerSourceLanguage('C', activePath)).toBe('CPP');
			expect(resolveCompilerArguments('C', settings, 'CPP17', activePath)).toEqual([
				'-std=c++17',
				'-std=c++23'
			]);
			expect(resolveClangdCompilerArguments('C', settings, 'CPP17', activePath)).toEqual([
				'-std=c++17',
				'-std=c++23'
			]);
		}
	);

	it('preserves the C dialect for C-selected .c and the C++ driver dialect for CPP-selected .c', () => {
		const settings = {
			...defaultCompilerSettings,
			cVersion: 'C99' as const,
			gnuExtensions: false
		};
		expect(resolveCompilerSourceLanguage('C', 'main.c')).toBe('C');
		expect(resolveCompilerArguments('C', settings, 'CPP17', 'main.c')).toEqual(['-std=c99']);
		expect(resolveCompilerSourceLanguage('CPP', 'main.c')).toBe('CPP');
		expect(resolveCompilerArguments('CPP', settings, 'CPP17', 'main.c')).toEqual([
			'-std=c++17'
		]);
	});

	it('configures C-selected C++ and C sibling clangd profiles with their own versions', () => {
		const settings = {
			...defaultCompilerSettings,
			cVersion: 'C99' as const,
			gnuExtensions: false
		};
		const compileArgs = resolveClangdCompilerArguments('C', settings, 'CPP17', 'main.cpp');
		const profiles = createClangdConfiguration({
			cVersion: settings.cVersion,
			cppVersion: 'CPP17',
			sourceLanguage: 'CPP',
			compileArgs
		})
			.split('\n---\n')
			.map((profile) => JSON.parse(profile));
		const cppFlags: string[] = profiles[1].CompileFlags.Add;
		const cFlags: string[] = profiles[0].CompileFlags.Add;
		expect(cppFlags.filter((flag) => flag.startsWith('-std=')).at(-1)).toBe('-std=c++17');
		expect(cFlags.filter((flag) => flag.startsWith('-std=')).at(-1)).toBe('-std=gnu99');
	});

	it.each([
		{ activePath: 'main.m', gnuExtensions: true },
		{ activePath: 'main.mm', gnuExtensions: true },
		{ activePath: 'main.m', gnuExtensions: false },
		{ activePath: 'main.mm', gnuExtensions: false }
	])(
		'configures clangd standards for mixed Objective-C sources: %j',
		({ activePath, gnuExtensions }) => {
			const settings = {
				...defaultCompilerSettings,
				cVersion: 'C99' as const,
				gnuExtensions
			};
			const compileArgs = resolveClangdCompilerArguments(
				'OBJC',
				settings,
				'CPP17',
				activePath
			);
			const sourceLanguage = activePath.endsWith('.mm') ? 'OBJCXX' : 'OBJC';
			const profiles = createClangdConfiguration({
				cVersion: 'C99',
				cppVersion: 'CPP17',
				sourceLanguage,
				compileArgs
			})
				.split('\n---\n')
				.map((profile) => JSON.parse(profile));
			for (const profile of profiles) {
				const flags: string[] = profile.CompileFlags.Add;
				const cpp = ['c++', 'objective-c++'].includes(flags[flags.indexOf('-x') + 1]);
				expect(flags.filter((flag) => flag.startsWith('-std=')).at(-1)).toBe(
					`-std=${gnuExtensions ? 'gnu' : 'c'}${cpp ? '++17' : '99'}`
				);
			}
		}
	);

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

	it.each(['C', 'CPP', 'OBJC', 'OBJECTIVECXX', 'HASKELL'] as const)(
		'migrates legacy compiler arguments for %s without turning them into argv',
		(language) => {
			const restored = restoreCompilerOptions(undefined, language, '-Wall -O2');
			expect(restored.argsInput).toBe('');
			expect(restored.compilerOptions[language]?.arguments).toBe('-Wall -O2');
		}
	);

	it.each(['C', 'CPP'] as const)(
		'restores legacy %s response files as compiler flags',
		(language) => {
			const snapshot = { version: 6, language, argsInput: '@flags.rsp', files };
			expect(() => validateWorkspaceSnapshot(snapshot)).not.toThrow();
			const restored = restoreCompilerOptions(undefined, language, snapshot.argsInput);
			expect(restored.argsInput).toBe('');
			expect(resolveCompilerArguments(language, restored.compilerOptions[language]!)).toEqual(
				['@flags.rsp']
			);
		}
	);

	it.each(['C', 'CPP', 'OBJC', 'OBJECTIVECXX'] as const)(
		'preserves %s argv when a new snapshot has compiler settings',
		(language) => {
			const restored = restoreCompilerOptions({}, language, '"two words" ""');
			expect(restored.argsInput).toBe('"two words" ""');
			expect(restored.compilerOptions).toEqual({});
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
