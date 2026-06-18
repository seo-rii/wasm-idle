import { describe, expect, it } from 'vitest';

import {
	resolveCppLanguageServerBaseUrl,
	resolveCppLanguageServerRuntimeAssetConfig,
	resolveGoLanguageServerCompilerUrl,
	resolvePythonLanguageServerBaseUrl,
	resolveRustLanguageServerCompilerUrl
} from '../src/index.js';

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
		expect(
			resolveRustLanguageServerCompilerUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-rust/index.js');
		expect(
			resolveGoLanguageServerCompilerUrl(
				'https://static.example.com/repl_20240807',
				'https://app.example.com/editor'
			)
		).toBe('https://static.example.com/repl_20240807/wasm-go/index.js');
	});

	it('prefers explicit per-language overrides', () => {
		const options = {
			rootUrl: 'https://static.example.com/repl_20240807',
			cpp: {
				baseUrl: 'https://cpp.example.com/assets'
			},
			python: {
				baseUrl: 'https://python.example.com/assets/'
			},
			rust: {
				compilerUrl: 'https://rust.example.com/wasm-rust/index.js?v=20240807'
			},
			go: {
				compilerUrl: 'https://go.example.com/wasm-go/index.js?v=20240807'
			}
		};

		expect(resolveCppLanguageServerBaseUrl(options)).toBe('https://cpp.example.com/assets/');
		expect(resolvePythonLanguageServerBaseUrl(options)).toBe(
			'https://python.example.com/assets/'
		);
		expect(resolveRustLanguageServerCompilerUrl(options)).toBe(
			'https://rust.example.com/wasm-rust/index.js?v=20240807'
		);
		expect(resolveGoLanguageServerCompilerUrl(options)).toBe(
			'https://go.example.com/wasm-go/index.js?v=20240807'
		);
	});

	it('preserves cpp loader configuration for clangd worker assets', () => {
		const loader = async () => null;

		expect(
			resolveCppLanguageServerRuntimeAssetConfig({
				cpp: {
					baseUrl: 'https://cpp.example.com/assets',
					loader
				}
			})
		).toEqual({
			baseUrl: 'https://cpp.example.com/assets/',
			loader
		});
	});

	it('falls back to same-origin defaults when no runtime root is provided', () => {
		expect(resolveCppLanguageServerBaseUrl(undefined, 'https://app.example.com/editor')).toBe(
			'https://app.example.com/clangd/'
		);
		expect(
			resolvePythonLanguageServerBaseUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/pyodide/');
		expect(
			resolveRustLanguageServerCompilerUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-rust/index.js');
		expect(
			resolveGoLanguageServerCompilerUrl(undefined, 'https://app.example.com/editor')
		).toBe('https://app.example.com/wasm-go/index.js');
	});
});
