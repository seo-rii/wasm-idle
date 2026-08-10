import { describe, expect, it } from 'vitest';

import { rewriteRuntimeModuleAssetSpecifier } from '@wasm-idle/core';

const rewrite = (source: string, overrides: Record<string, unknown> = {}) =>
	rewriteRuntimeModuleAssetSpecifier({
		bytes: new TextEncoder().encode(source),
		assetPath: 'assets/runtime.wasm',
		assetUrl: 'https://runtime.example/assets/runtime.wasm?v=verified',
		label: 'Fixture module',
		...overrides
	});

describe('rewriteRuntimeModuleAssetSpecifier', () => {
	it('rewrites exactly one import.meta asset URL without touching other literals', () => {
		const source =
			'const note="assets/runtime.wasm";const wasm=new URL("assets/runtime.wasm", import.meta.url).href;';

		expect(rewrite(source)).toBe(
			'const note="assets/runtime.wasm";const wasm=new URL("https://runtime.example/assets/runtime.wasm?v=verified", import.meta.url).href;'
		);
	});

	it.each([
		['const other = 1;', 'exactly one'],
		[
			'new URL("assets/runtime.wasm",import.meta.url);new URL("assets/runtime.wasm",import.meta.url);',
			'exactly one'
		]
	])('fails closed when the module graph is ambiguous', (source, message) => {
		expect(() => rewrite(source)).toThrow(message);
	});

	it('rejects unsafe paths, urls, and invalid UTF-8 before rewriting', () => {
		expect(() => rewrite('const value = 1;', { assetPath: '../runtime.wasm' })).toThrow(
			'canonical relative path'
		);
		expect(() =>
			rewrite('const value = 1;', { assetUrl: 'https://user:secret@runtime.example/file' })
		).toThrow('replacement URL is unsafe');
		expect(() =>
			rewriteRuntimeModuleAssetSpecifier({
				bytes: Uint8Array.of(0xff),
				assetPath: 'assets/runtime.wasm',
				assetUrl: 'https://runtime.example/runtime.wasm',
				label: 'Fixture module'
			})
		).toThrow('not valid UTF-8');
	});
});
