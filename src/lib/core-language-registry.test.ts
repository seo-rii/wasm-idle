import {
	DEFAULT_DEFERRED_PROGRESS_LANGUAGES,
	getLanguageAliasInfo,
	isDeferredProgressLanguage,
	isSupportedLanguageId,
	languageAliasIds,
	languageAliases,
	normalizeLanguageId,
	supportedLanguageIds,
	type WasmIdleLanguageId
} from '@wasm-idle/core';
import { describe, expect, expectTypeOf, it } from 'vitest';

describe('core language registry', () => {
	it('derives every public alias from one typed registry', () => {
		expect(Object.isFrozen(supportedLanguageIds)).toBe(true);
		expect(languageAliasIds).toEqual(Object.keys(languageAliases));
		expect(new Set(languageAliasIds).size).toBe(languageAliasIds.length);
		for (const alias of languageAliasIds) {
			const info = getLanguageAliasInfo(alias);
			expect(info?.alias).toBe(alias);
			expect(isSupportedLanguageId(info?.canonicalId || '')).toBe(true);
		}
	});

	it('distinguishes canonical IDs from accepted aliases', () => {
		expect(isSupportedLanguageId('CPP')).toBe(true);
		expect(isSupportedLanguageId('PYPY3')).toBe(false);
		expect(normalizeLanguageId(' pypy3 ')).toBe('PYTHON3');
		expect(supportedLanguageIds).not.toContain('PYPY3');
	});

	it('keeps alias normalization typed as a canonical language ID', () => {
		const language: WasmIdleLanguageId = 'MATLAB';
		expectTypeOf(normalizeLanguageId(language)).toEqualTypeOf<
			(typeof supportedLanguageIds)[number]
		>();
	});

	it('derives deferred progress from the canonical language registry', () => {
		const eagerLanguages = new Set(['C', 'CPP', 'PYTHON3', 'JAVA']);
		expect([...DEFAULT_DEFERRED_PROGRESS_LANGUAGES]).toEqual(
			supportedLanguageIds.filter((language) => !eagerLanguages.has(language))
		);
		for (const language of supportedLanguageIds) {
			expect(isDeferredProgressLanguage(language)).toBe(!eagerLanguages.has(language));
		}
		expect(isDeferredProgressLanguage('python')).toBe(false);
		expect(isDeferredProgressLanguage('pypy3')).toBe(false);
	});
});
