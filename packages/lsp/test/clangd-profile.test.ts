import { describe, expect, it } from 'vitest';
import { createClangdCompileFlags, createClangdConfiguration } from '../src/clangd/config.js';
import {
	OBJECTIVE_C_LSP_DEFINES,
	resolveClangLanguageArgs,
	OBJECTIVE_C_RUNTIME_FLAGS
} from '@wasm-idle/llvm-core/core/clang-profile';

const systemIncludePaths = (flags: string[]) =>
	flags.flatMap((flag, index) =>
		flag === '-isystem'
			? [flags[index + 1]]
			: flag.startsWith('-isystem')
				? [flag.slice('-isystem'.length)]
				: []
	);

describe('clangd compile profiles', () => {
	it.each([
		['C', 'main.c', 'c'],
		['CPP', 'main.cpp', 'c++'],
		['OBJC', 'main.m', 'objective-c']
	] as const)('uses the execution profile for %s', (language, path, mode) => {
		const configurations = createClangdConfiguration()
			.split('\n---\n')
			.map((entry) => JSON.parse(entry));
		const matching = configurations.filter((entry) =>
			new RegExp(`^(?:${entry.If.PathMatch})$`).test(path)
		);
		expect(matching).toHaveLength(1);
		expect(matching[0].CompileFlags.Add).toContain(
			resolveClangLanguageArgs(language, {}).standardArg
		);
		expect(matching[0].CompileFlags.Add).toContain(mode);
		expect(matching[0].CompileFlags.Add).toContain('--target=wasm32-wasip1');
		if (language !== 'CPP')
			expect(matching[0].CompileFlags.Add.join(' ')).not.toContain('c++/v1');
	});
	it('preserves chosen standards and Objective-C runtime flags', () => {
		expect(createClangdCompileFlags('CPP', { cppVersion: 'CPP17' })).toContain('-std=gnu++17');
		expect(createClangdCompileFlags('C', { cVersion: 'C99' })).toContain('-std=gnu99');
		expect(createClangdCompileFlags('OBJC')).toEqual(
			expect.arrayContaining([...OBJECTIVE_C_RUNTIME_FLAGS, '-I/objc'])
		);
	});
	it.each([
		['C', { cVersion: 'C90' }, '-std=gnu89'],
		['C', { cVersion: 'C23' }, '-std=gnu23'],
		['OBJC', { cVersion: 'C2X' }, '-std=gnu23'],
		['C', { cVersion: 'C2Y' }, '-std=gnu2y'],
		['CPP', { cppVersion: 'CPP98' }, '-std=gnu++98'],
		['OBJCXX', { cppVersion: 'CPP98' }, '-std=gnu++98']
	] as const)('uses the selected %s standard %j', (language, options, standard) => {
		expect(createClangdCompileFlags(language, options)).toContain(standard);
	});
	it.each(['C', 'CPP', 'OBJC', 'OBJCXX'] as const)(
		'appends user arguments after generated %s flags without splitting or quoting them',
		(language) => {
			const compileArgs = [
				'-DNAME="hello world"',
				'-I',
				'/workspace/include path',
				'-Wall',
				'-Wextra',
				language === 'C' || language === 'OBJC' ? '-std=c11' : '-std=c++20'
			];
			const defaults = createClangdCompileFlags(language);
			const flags = createClangdCompileFlags(language, { compileArgs });
			expect(flags).toEqual([...defaults, ...compileArgs]);
			expect(flags.at(-1)).toBe(compileArgs.at(-1));
		}
	);
	it.each(['C', 'CPP', 'OBJC', 'OBJCXX'] as const)(
		'keeps user SIMD feature and macro overrides after the generated %s defaults',
		(language) => {
			const compileArgs = ['-mno-simd128', '-U__AVX2__', '-D__SSE2__=0'];
			const flags = createClangdCompileFlags(language, { compileArgs });
			expect(flags).toContain('-msimd128');
			expect(flags).toContain('-D__AVX2__=1');
			expect(flags.slice(-compileArgs.length)).toEqual(compileArgs);
			expect(flags.indexOf('-msimd128')).toBeLessThan(flags.indexOf('-mno-simd128'));
			expect(flags.indexOf('-D__AVX2__=1')).toBeLessThan(flags.indexOf('-U__AVX2__'));
		}
	);
	it('preserves argument tokens through configuration serialization for every source language', () => {
		const compileArgs = ['-DMESSAGE="a b"', '-I/workspace/header path', '-Werror'];
		const configurations = createClangdConfiguration({ compileArgs })
			.split('\n---\n')
			.map((entry) => JSON.parse(entry));
		expect(configurations).toHaveLength(4);
		for (const entry of configurations) {
			expect(entry.CompileFlags.Add.slice(-compileArgs.length)).toEqual(compileArgs);
		}
	});
	it.each([
		['C', 'c', '-std=c23'],
		['CPP', 'c++', '-std=c++23'],
		['OBJC', 'objective-c', '-std=c23'],
		['OBJCXX', 'objective-c++', '-std=c++23']
	] as const)(
		'analyzes .h files as the active %s source language',
		(sourceLanguage, mode, standard) => {
			const configurations = createClangdConfiguration({
				sourceLanguage,
				compileArgs: ['-DVALUE=42', standard]
			})
				.split('\n---\n')
				.map((entry) => JSON.parse(entry));
			const matching = configurations.filter((entry) =>
				new RegExp(`^(?:${entry.If.PathMatch})$`).test('include/header.h')
			);
			expect(matching).toHaveLength(1);
			const flags: string[] = matching[0].CompileFlags.Add;
			expect(flags[flags.indexOf('-x') + 1]).toBe(mode);
			expect(flags.slice(-2)).toEqual(['-DVALUE=42', standard]);
			for (const extension of ['hh', 'hpp', 'hxx']) {
				const cppHeaders = configurations.filter((entry) =>
					new RegExp(`^(?:${entry.If.PathMatch})$`).test(`include/header.${extension}`)
				);
				expect(cppHeaders).toHaveLength(1);
				const cppFlags: string[] = cppHeaders[0].CompileFlags.Add;
				expect(cppFlags[cppFlags.indexOf('-x') + 1]).toBe('c++');
				if (sourceLanguage === 'C' || sourceLanguage === 'OBJC') {
					expect(cppFlags).not.toContain(standard);
					expect(cppFlags).toContain('-std=gnu++20');
				} else expect(cppFlags).toContain(standard);
			}
		}
	);
	it.each(['C', 'CPP', 'OBJC', 'OBJCXX'] as const)(
		'keeps all %s arguments and removes opposite-family standards only from sibling profiles',
		(sourceLanguage) => {
			const common = ['-DNAME="hello world"', '-I', '/workspace/include path', '-Wall'];
			const cStandards = ['-std=c11', '-std=gnu23', '-std=iso9899:1999'];
			const cppStandards = ['-std=c++20', '-std=gnu++23'];
			const compileArgs = [...common, ...cStandards, ...cppStandards, '-std=invalid'];
			for (const language of ['C', 'CPP', 'OBJC', 'OBJCXX'] as const) {
				const sameFamily =
					['CPP', 'OBJCXX'].includes(language) ===
					['CPP', 'OBJCXX'].includes(sourceLanguage);
				const expected = sameFamily
					? compileArgs
					: [
							...common,
							...(language === 'CPP' || language === 'OBJCXX'
								? cppStandards
								: cStandards),
							'-std=invalid'
						];
				expect(createClangdCompileFlags(language, { sourceLanguage, compileArgs })).toEqual(
					[...createClangdCompileFlags(language), ...expected]
				);
			}
		}
	);
	it('preserves legacy .h selection and all argument tokens without source context', () => {
		const compileArgs = ['-std=c11', '-std=c++20'];
		const configurations = createClangdConfiguration({ compileArgs })
			.split('\n---\n')
			.map((entry) => JSON.parse(entry));
		const matching = configurations.filter((entry) =>
			new RegExp(`^(?:${entry.If.PathMatch})$`).test('header.h')
		);
		expect(matching).toHaveLength(1);
		const flags: string[] = matching[0].CompileFlags.Add;
		expect(flags[flags.indexOf('-x') + 1]).toBe('c++');
		for (const entry of configurations) {
			expect(entry.CompileFlags.Add.slice(-2)).toEqual(compileArgs);
		}
	});
	it('finds the target-specific bundled libc++ headers', () => {
		expect(createClangdCompileFlags('CPP')).toContain(
			'-isystem/usr/include/wasm32-wasi/c++/v1'
		);
		expect(createClangdCompileFlags('C').join(' ')).not.toContain('c++/v1');
	});
	it('uses the same compiler resource directory ahead of WASI headers', () => {
		const flags = createClangdCompileFlags('OBJC', { resourceDir: '/lib/clang/22' });
		expect(flags[flags.indexOf('-resource-dir') + 1]).toBe('/lib/clang/22');
		expect(flags.indexOf('-isystem/lib/clang/22/include')).toBeLessThan(
			flags.indexOf('-isystem/usr/include/wasm32-wasi')
		);
	});
	it.each(['C', 'CPP', 'OBJC', 'OBJCXX'] as const)(
		'finds Wasm SIMD intrinsic implementations ahead of native headers for %s',
		(language) => {
			const flags = createClangdCompileFlags(language, { resourceDir: '/lib/clang/22' });
			expect(flags).toContain('-msimd128');
			expect(flags.join(' ')).toContain('-D__SSE__');
			expect(flags.join(' ')).toContain('-D__AVX2__');
			const compatibilityPath = flags.findIndex((flag) =>
				flag.endsWith('/usr/include/wasm-idle/simd')
			);
			expect(compatibilityPath).toBeGreaterThanOrEqual(0);
			expect(compatibilityPath).toBeLessThan(flags.indexOf('-isystem/lib/clang/22/include'));
		}
	);
	it('retains the original target profile for custom clangd builds without compatible headers', () => {
		const flags = createClangdCompileFlags('CPP', {
			resourceDir: '/lib/clang/17',
			simd: false
		});
		expect(flags).toContain('--target=wasm32-wasip1');
		expect(flags).toContain('-isystem/lib/clang/17/include');
		expect(flags).not.toContain('-msimd128');
		expect(flags.join(' ')).not.toContain('/wasm-idle/simd');
		expect(flags.join(' ')).not.toContain('-D__AVX2__');
	});
	it.each([
		['-nostdinc', []],
		[
			'-nostdinc++',
			[
				'/usr/include/wasm-idle/simd',
				'/lib/clang/22/include',
				'/usr/include/wasm32-wasi',
				'/usr/include'
			]
		],
		[
			'-nobuiltininc',
			[
				'/usr/include/c++/v1',
				'/usr/include/wasm32-wasi/c++/v1',
				'/usr/include/wasm32-wasi',
				'/usr/include'
			]
		],
		['-nostdlibinc', ['/usr/include/wasm-idle/simd', '/lib/clang/22/include']]
	] as const)('honors %s without removing explicit user include paths', (suppression, paths) => {
		const compileArgs = [
			suppression,
			'-I',
			'/workspace/header path',
			'-isystem',
			'/custom system'
		];
		const flags = createClangdCompileFlags('CPP', {
			resourceDir: '/lib/clang/22',
			compileArgs
		});
		expect(systemIncludePaths(flags.slice(0, -compileArgs.length))).toEqual(paths);
		expect(flags.slice(-compileArgs.length)).toEqual(compileArgs);
	});
	it.each([
		['--sysroot=/custom root'],
		['--sysroot', '/custom root'],
		['-isysroot', '/custom root'],
		['-isysroot/custom root'],
		['-isysroot=/custom root']
	])(
		'uses user sysroot arguments %j while retaining compatible compiler headers',
		(...sysrootArgs) => {
			const compileArgs = [...sysrootArgs, '-I/custom header path'];
			const flags = createClangdCompileFlags('CPP', {
				resourceDir: '/lib/clang/22/',
				compileArgs
			});
			expect(systemIncludePaths(flags)).toEqual([
				'/usr/include/wasm-idle/simd',
				'/lib/clang/22/include'
			]);
			expect(flags.slice(-compileArgs.length)).toEqual(compileArgs);
		}
	);
	it.each(['C', 'CPP', 'OBJC', 'OBJCXX'] as const)(
		'keeps standard include suppression effective for every %s profile',
		(language) => {
			for (const compileArgs of [
				['-nostdinc'],
				['-nostdlibinc', '-nobuiltininc'],
				['--sysroot=/custom', '-nobuiltininc']
			]) {
				const flags = createClangdCompileFlags(language, {
					resourceDir: '/lib/clang/22',
					compileArgs
				});
				expect(flags.some((flag) => flag.startsWith('-isystem'))).toBe(false);
				expect(flags).toContain('-msimd128');
				expect(flags).toContain('-D__AVX2__=1');
				expect(flags[flags.indexOf('-include') + 1]).toBe(
					'/usr/include/wasm-idle/simd/__wasm_idle_simd_target.h'
				);
				expect(flags.slice(-compileArgs.length)).toEqual(compileArgs);
			}
		}
	);
	it('maps .mm sources to an Objective-C++ profile with libc++ and the libobjc2 ABI', () => {
		const configurations = createClangdConfiguration()
			.split('\n---\n')
			.map((entry) => JSON.parse(entry));
		const matching = configurations.filter((entry) =>
			new RegExp(`^(?:${entry.If.PathMatch})$`).test('main.mm')
		);
		expect(matching).toHaveLength(1);
		const flags: string[] = matching[0].CompileFlags.Add;
		expect(flags[flags.indexOf('-x') + 1]).toBe('objective-c++');
		expect(flags).toContain(resolveClangLanguageArgs('CPP', {}).standardArg);
		expect(flags).toContain('-isystem/usr/include/wasm32-wasi/c++/v1');
		expect(flags).toEqual(
			expect.arrayContaining([...OBJECTIVE_C_LSP_DEFINES, '-I/objc', '-fblocks'])
		);
		expect(flags[flags.indexOf('-fobjc-runtime=gnustep-2.0') - 1]).toBe('-Xclang');
		expect(createClangdCompileFlags('OBJCXX', { cppVersion: 'CPP17' })).toContain(
			'-std=gnu++17'
		);
	});
	it('passes the execution frontend ABI through the driver and selects libobjc2 headers', () => {
		const flags = createClangdCompileFlags('OBJC');
		expect(flags[flags.indexOf('-fobjc-runtime=gnustep-2.0') - 1]).toBe('-Xclang');
		expect(flags).toEqual(expect.arrayContaining([...OBJECTIVE_C_LSP_DEFINES]));
		expect(OBJECTIVE_C_LSP_DEFINES).toContain('-DOBJC2RUNTIME=1');
		expect(OBJECTIVE_C_RUNTIME_FLAGS).not.toContain('-DOBJC2RUNTIME=1');
	});
});
