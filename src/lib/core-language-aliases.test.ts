import { describe, expect, it } from 'vitest';
import {
	getLanguageAliasInfo,
	languageAliases,
	normalizeLanguageId,
	supportedLanguageIds
} from '@wasm-idle/core';

describe('language alias metadata', () => {
	it('keeps PyPy out of the supported implementation list while preserving input compatibility', () => {
		expect(supportedLanguageIds).not.toContain('PYPY3');
		expect(normalizeLanguageId(' pypy3 ')).toBe('PYTHON3');
		expect(getLanguageAliasInfo('pypy3')).toMatchObject({
			alias: 'PYPY3',
			canonicalId: 'PYTHON3',
			kind: 'implementation',
			deprecated: true
		});
	});

	it('distinguishes compatibility names and SQL dialect selection from spelling aliases', () => {
		expect(languageAliases.MATLAB).toMatchObject({
			canonicalId: 'OCTAVE',
			kind: 'compatibility',
			deprecated: false
		});
		expect(languageAliases.SCHEME).toMatchObject({
			canonicalId: 'LISP',
			kind: 'compatibility'
		});
		expect(languageAliases.SQL).toMatchObject({
			canonicalId: 'SQLITE',
			kind: 'dialect'
		});
		expect(languageAliases.JS).toMatchObject({
			canonicalId: 'JAVASCRIPT',
			kind: 'spelling'
		});
	});

	it('does not expose mutable alias metadata', () => {
		expect(Object.isFrozen(languageAliases)).toBe(true);
		expect(Object.isFrozen(languageAliases.PYPY3)).toBe(true);
	});
});
