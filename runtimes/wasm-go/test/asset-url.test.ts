import { describe, expect, it } from 'vitest';

import { resolveVersionedAssetUrl } from '../src/asset-url.js';

describe('resolveVersionedAssetUrl', () => {
	it('preserves the parent module query string for sibling assets', () => {
		const resolved = resolveVersionedAssetUrl(
			'https://example.invalid/wasm-go/index.js?v=cache-bust',
			'./compiler-worker.js'
		);

		expect(resolved.toString()).toBe(
			'https://example.invalid/wasm-go/compiler-worker.js?v=cache-bust'
		);
	});

	it('preserves the runtime query string for nested assets', () => {
		const resolved = resolveVersionedAssetUrl(
			'https://example.invalid/wasm-go/runtime/?v=runtime-bust',
			'sysroot/wasip1.pack.gz'
		);

		expect(resolved.toString()).toBe(
			'https://example.invalid/wasm-go/runtime/sysroot/wasip1.pack.gz?v=runtime-bust'
		);
	});
});
