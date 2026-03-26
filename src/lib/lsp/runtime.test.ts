import { describe, expect, it } from 'vitest';

import { resolveCppLanguageServerBaseUrl, resolvePythonLanguageServerBaseUrl } from './runtime';

describe('lsp runtime asset resolution', () => {
	it('resolves root-based cpp and python asset URLs', () => {
		expect(
			resolveCppLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/clangd/');
		expect(
			resolvePythonLanguageServerBaseUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/pyodide/');
	});

	it('prefers explicit per-language overrides', () => {
		const options = {
			rootUrl: 'https://static.example.com/repl_20240807',
			cpp: {
				baseUrl: 'https://cpp.example.com/assets'
			},
			python: {
				baseUrl: 'https://python.example.com/assets/'
			}
		};

		expect(resolveCppLanguageServerBaseUrl(options)).toBe('https://cpp.example.com/assets/');
		expect(resolvePythonLanguageServerBaseUrl(options)).toBe(
			'https://python.example.com/assets/'
		);
	});

	it('falls back to same-origin defaults when no runtime root is provided', () => {
		expect(resolveCppLanguageServerBaseUrl(undefined, 'https://app.example.com/editor')).toBe(
			'https://app.example.com/clangd/'
		);
		expect(
			resolvePythonLanguageServerBaseUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/pyodide/');
	});
});
