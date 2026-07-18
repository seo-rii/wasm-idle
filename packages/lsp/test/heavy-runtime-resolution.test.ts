import { describe, expect, it } from 'vitest';

import {
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
			'https://static.example.com/repl_20240807/wasm-ruby/runtime.mjs'
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
				{ ruby: { moduleUrl: './ruby-runtime.mjs' } },
				currentUrl
			)
		).toBe('https://app.example.com/editor/ruby-runtime.mjs');
	});

	it('resolves root-relative defaults against the current application URL', () => {
		const currentUrl = 'https://app.example.com/editor';

		expect(resolveAssemblyScriptLanguageServerModuleUrl(undefined, currentUrl)).toBe(
			'https://app.example.com/wasm-assemblyscript/runtime.mjs'
		);
		expect(resolveSqliteLanguageServerModuleUrl(undefined, currentUrl)).toBe(
			'https://app.example.com/wasm-sqlite/runtime.mjs'
		);
		expect(resolveDuckDbLanguageServerModuleUrl(undefined, currentUrl)).toBe(
			'https://app.example.com/wasm-duckdb/runtime.mjs'
		);
		expect(resolveRubyLanguageServerModuleUrl(undefined, currentUrl)).toBe(
			'https://app.example.com/wasm-ruby/runtime.mjs'
		);
	});
});
