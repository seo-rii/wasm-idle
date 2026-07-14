import { describe, expect, it } from 'vitest';

import { parseRuntimePrecompressionScopes } from '../scripts/prepare-runtime.mjs';

describe('runtime compression config', () => {
	it('expands all into every supported runtime compression scope', () => {
		expect([
			...parseRuntimePrecompressionScopes('all', 'WASM_RUST_PRECOMPRESS_SCOPES')
		]).toEqual(['rustc', 'llvm', 'packs', 'vendor']);
	});

	it('allows disabling runtime precompression entirely', () => {
		expect([
			...parseRuntimePrecompressionScopes('none', 'WASM_RUST_PRECOMPRESS_SCOPES')
		]).toEqual([]);
		expect([
			...parseRuntimePrecompressionScopes('rustc,llvm,vendor', 'WASM_RUST_PRECOMPRESS_SCOPES')
		]).toEqual(['rustc', 'llvm', 'vendor']);
	});

	it('rejects invalid runtime compression scope combinations', () => {
		expect(() =>
			parseRuntimePrecompressionScopes('none,rustc', 'WASM_RUST_PRECOMPRESS_SCOPES')
		).toThrow(/cannot be combined/);
		expect(() =>
			parseRuntimePrecompressionScopes('rustc,unknown', 'WASM_RUST_PRECOMPRESS_SCOPES')
		).toThrow(/invalid WASM_RUST_PRECOMPRESS_SCOPES: unknown/);
	});
});
