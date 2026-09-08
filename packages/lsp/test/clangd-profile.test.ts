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
});
