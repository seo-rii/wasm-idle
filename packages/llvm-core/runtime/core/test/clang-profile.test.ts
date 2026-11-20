import { describe, expect, it } from 'vitest';
import { clangWorkspaceBuildSources, resolveClangLanguageArgs } from '../src/clang-profile.js';

describe('Clang language standards', () => {
	it.each([
		[['89', '90', 'C89', 'C90', 'GNU89', 'GNU90', 'GNUC89', 'GNUC90'], '-std=gnu89'],
		[['99', 'C99', 'GNU99', 'GNUC99'], '-std=gnu99'],
		[['11', 'C11', 'GNU11', 'GNUC11'], '-std=gnu11'],
		[['17', '18', 'C17', 'C18', 'GNU17', 'GNU18', 'GNUC17', 'GNUC18'], '-std=gnu17'],
		[['23', '2X', 'C23', 'C2X', 'GNU23', 'GNU2X', 'GNUC23', 'GNUC2X'], '-std=gnu23'],
		[['2Y', 'C2Y', 'GNU2Y', 'GNUC2Y'], '-std=gnu2y']
	])('selects %s as %s for C and Objective-C', (aliases, standardArg) => {
		for (const version of aliases) {
			expect(resolveClangLanguageArgs('C', { cVersion: version })).toEqual({
				languageArg: 'c',
				standardArg
			});
			expect(resolveClangLanguageArgs('OBJC', { cVersion: version })).toEqual({
				languageArg: 'objective-c',
				standardArg
			});
		}
	});

	it.each(['98', '03', '11', '14', '17', '20', '23', '26'])(
		'preserves GNU C++%s aliases',
		(version) => {
			for (const alias of [
				version,
				`CPP${version}`,
				`C++${version}`,
				`GNU++${version}`,
				`GNUC++${version}`
			]) {
				expect(resolveClangLanguageArgs('CPP', { cppVersion: alias })).toEqual({
					languageArg: 'c++',
					standardArg: `-std=gnu++${version}`
				});
			}
		}
	);

	it('normalizes case and whitespace in selected standards', () => {
		expect(resolveClangLanguageArgs('C', { cVersion: ' c 2x ' }).standardArg).toBe(
			'-std=gnu23'
		);
		expect(resolveClangLanguageArgs('CPP', { cppVersion: ' c++ 98 ' }).standardArg).toBe(
			'-std=gnu++98'
		);
	});

	it.each([undefined, '', 'unknown', 'GNUCPP14', '17extra'])(
		'keeps existing GNU defaults for the standard %s',
		(version) => {
			expect(resolveClangLanguageArgs('C', { cVersion: version }).standardArg).toBe(
				'-std=gnu11'
			);
			expect(resolveClangLanguageArgs('OBJC', { cVersion: version }).standardArg).toBe(
				'-std=gnu11'
			);
			expect(resolveClangLanguageArgs('CPP', { cppVersion: version }).standardArg).toBe(
				'-std=gnu++20'
			);
		}
	);
});

describe('SDK workspace source modes', () => {
	const files = [
		{ path: 'main.cpp', content: '' },
		{ path: 'helper.c', content: '' }
	];
	it.each([
		{ args: [], languages: ['CPP', 'C'] },
		{ args: ['-xc++'], languages: ['CPP', 'CPP'] },
		{ args: ['-x', 'c-header'], languages: ['C', 'C'] },
		{ args: ['-x', 'c++-header'], languages: ['CPP', 'CPP'] },
		{ args: ['-xcpp-output'], languages: ['C', 'C'] },
		{ args: ['-xc++-cpp-output'], languages: ['CPP', 'CPP'] },
		{ args: ['-xc++', '-x', 'c'], languages: ['C', 'C'] },
		{ args: ['-I', '-xc++'], languages: ['CPP', 'C'] },
		{ args: ['-include-pch', '@includes.pch'], languages: ['CPP', 'C'] },
		{ args: ['@flags.rsp'], languages: ['CPP', 'CPP'] },
		{ args: ['-std=c++17'], languages: ['CPP', 'CPP'] },
		{ args: ['-x', 'c', '-std=c11'], languages: ['C', 'C'] }
	])('selects language defaults consistently for $args', ({ args, languages }) => {
		const { units } = clangWorkspaceBuildSources(files, 'helper.c', 'CPP', args);
		expect(units.map((unit) => unit.language)).toEqual(languages);
	});
});
