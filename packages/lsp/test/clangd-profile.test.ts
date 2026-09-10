import { describe, expect, it } from 'vitest';
import { createClangdCompileFlags, createClangdConfiguration } from '../src/clangd/config.js';
import {
	resolveClangLanguageArgs,
	OBJECTIVE_C_RUNTIME_FLAGS
} from '@wasm-idle/llvm-core/core/clang-profile';

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
		expect(matching[0].CompileFlags.Add).toContain('--target=wasm32-wasi');
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
	it('passes the execution frontend ABI through the driver and selects libobjc2 headers', () => {
		const flags = createClangdCompileFlags('OBJC');
		expect(flags[flags.indexOf('-fobjc-runtime=gnustep-2.0') - 1]).toBe('-Xclang');
		expect(flags).toContain('-DOBJC2RUNTIME=1');
		expect(OBJECTIVE_C_RUNTIME_FLAGS).toContain('-DOBJC2RUNTIME=1');
	});
});
