import { describe, expect, it } from 'vitest';
import { RUBY_RUNTIME_PROFILE } from '@wasm-idle/core';

import {
	LanguageServerAssetConfigurationError,
	resolveAssemblyScriptLanguageServerModuleUrl,
	resolveDuckDbLanguageServerModuleUrl,
	resolveRubyLanguageServerModuleUrl,
	resolveSqliteLanguageServerModuleUrl
} from '../src/runtime.js';

describe('heavy LSP runtime module resolution', () => {
	it('resolves static module defaults from rootUrl and currentUrl', () => {
		const rootUrl = 'https://static.example.com/repl_20240807/';
		const currentUrl = 'https://app.example.com/editor';

		expect(resolveAssemblyScriptLanguageServerModuleUrl(rootUrl, currentUrl)).toBe(
			'https://static.example.com/repl_20240807/wasm-assemblyscript/runtime.mjs'
		);
		expect(resolveSqliteLanguageServerModuleUrl(rootUrl, currentUrl)).toBe(
			'https://static.example.com/repl_20240807/wasm-sqlite/runtime.mjs'
		);
		expect(resolveDuckDbLanguageServerModuleUrl(rootUrl, currentUrl)).toBe(
			'https://static.example.com/repl_20240807/wasm-duckdb/runtime.mjs'
		);
		expect(resolveRubyLanguageServerModuleUrl(rootUrl, currentUrl)).toBe(
			`https://static.example.com/repl_20240807/wasm-ruby/runtime.mjs.bin?v=${RUBY_RUNTIME_PROFILE.moduleJavaScriptReceipt.sha256}`
		);
	});

	it('prefers explicit module URLs and resolves them against currentUrl', () => {
		const currentUrl = 'https://app.example.com/editor/index.html';

		expect(
			resolveAssemblyScriptLanguageServerModuleUrl(
				{ assemblyscript: { moduleUrl: './assembly-runtime.mjs' } },
				currentUrl
			)
		).toBe('https://app.example.com/editor/assembly-runtime.mjs');
		expect(
			resolveSqliteLanguageServerModuleUrl(
				{ sql: { moduleUrl: './sqlite-runtime.mjs' } },
				currentUrl
			)
		).toBe('https://app.example.com/editor/sqlite-runtime.mjs');
		expect(
			resolveDuckDbLanguageServerModuleUrl(
				{ sql: { moduleUrl: './duckdb-runtime.mjs' } },
				currentUrl
			)
		).toBe('https://app.example.com/editor/duckdb-runtime.mjs');
		expect(
			resolveRubyLanguageServerModuleUrl(
				{
					ruby: {
						...RUBY_RUNTIME_PROFILE,
						baseUrl: 'https://app.example.com/editor/ruby/',
						moduleUrl: './ruby/runtime.mjs.bin'
					}
				},
				currentUrl
			)
		).toBe(
			`https://app.example.com/editor/ruby/runtime.mjs.bin?v=${RUBY_RUNTIME_PROFILE.moduleJavaScriptReceipt.sha256}`
		);
		expect(() =>
			resolveRubyLanguageServerModuleUrl(
				{ ruby: { moduleUrl: './untrusted-ruby-runtime.mjs.bin' } },
				currentUrl
			)
		).toThrow('complete runtime profile');
	});

	it('rejects document-relative runtime module fallbacks', () => {
		const currentUrl = 'https://app.example.com/wasm-idle/';

		for (const resolve of [
			resolveAssemblyScriptLanguageServerModuleUrl,
			resolveSqliteLanguageServerModuleUrl,
			resolveDuckDbLanguageServerModuleUrl,
			resolveRubyLanguageServerModuleUrl
		]) {
			expect(() => resolve(undefined, currentUrl)).toThrow(
				LanguageServerAssetConfigurationError
			);
		}
	});
});
