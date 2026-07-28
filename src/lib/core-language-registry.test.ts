import {
	getLanguageAliasInfo,
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
});
