import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import assemblyScriptServiceSource from '../src/assemblyscript/service.ts?raw';
import rubyServiceSource from '../src/ruby/service.ts?raw';
import sqlServiceSource from '../src/sql/service.ts?raw';
import typesSource from '../src/types.ts?raw';

describe('heavy LSP static runtime loaders', () => {
	it('uses Vite-ignored dynamic imports for configured runtime modules', () => {
		for (const source of [assemblyScriptServiceSource, sqlServiceSource, rubyServiceSource]) {
			expect(source).toContain('/* @vite-ignore */ options.moduleUrl');
		}
	});

	it('does not import heavy runtime packages from LSP source', () => {
		const source = [
			assemblyScriptServiceSource,
			sqlServiceSource,
			rubyServiceSource,
			typesSource
		].join('\n');

		for (const packageName of [
			'assemblyscript/asc',
			'sql.js',
			'@duckdb/duckdb-wasm',
			'@ruby/wasm-wasi',
			'@bjorn3/browser_wasi_shim'
		]) {
			expect(source).not.toContain(packageName);
		}
	});

	it('keeps heavy runtime packages out of package dependencies', async () => {
		const packageJson = JSON.parse(
			await readFile(new URL('../package.json', import.meta.url), 'utf8')
		) as { dependencies?: Record<string, string> };

		for (const packageName of [
			'assemblyscript',
			'sql.js',
			'@duckdb/duckdb-wasm',
			'@ruby/wasm-wasi'
		]) {
			expect(packageJson.dependencies).not.toHaveProperty(packageName);
		}
	});
});
