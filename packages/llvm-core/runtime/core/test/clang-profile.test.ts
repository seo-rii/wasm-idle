import { describe, expect, it } from 'vitest';
import { resolveClangLanguageArgs } from '../src/clang-profile.js';

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

	it.each([undefined, '', 'unknown'])(
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
