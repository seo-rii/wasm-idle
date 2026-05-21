import { describe, expect, it } from 'vitest';

import { resolveVersionedAssetUrl } from '../src/asset-url.js';

describe('resolveVersionedAssetUrl', () => {
	it('preserves the parent module query string for sibling workers', () => {
		const resolved = resolveVersionedAssetUrl(
			'http://127.0.0.1:4173/wasm-rust/index.js?v=worker-cache-bust',
			'./compiler-worker.js'
		);

		expect(resolved.toString()).toBe(
			'http://127.0.0.1:4173/wasm-rust/compiler-worker.js?v=worker-cache-bust'
		);
	});

	it('preserves the parent runtime query string for fetched assets', () => {
		const resolved = resolveVersionedAssetUrl(
			'http://127.0.0.1:4173/wasm-rust/runtime/?v=runtime-cache-bust',
			'llvm/llc.js'
		);

		expect(resolved.toString()).toBe(
			'http://127.0.0.1:4173/wasm-rust/runtime/llvm/llc.js?v=runtime-cache-bust'
		);
	});
});
