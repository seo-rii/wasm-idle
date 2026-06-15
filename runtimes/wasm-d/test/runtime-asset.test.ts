import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fetchRuntimeAssetBytes } from '../src/runtime-asset.js';

describe('runtime asset loader', () => {
	it('inflates gzip-compressed assets after fetch', async () => {
		const body = gzipSync(new TextEncoder().encode('compressed D runtime asset'));
		const bytes = await fetchRuntimeAssetBytes(
			'https://example.test/runtime/bin/ldc2.wasm.gz',
			'ldc2.wasm',
			async () => new Response(body),
			undefined,
			'gzip'
		);

		expect(new TextDecoder().decode(bytes)).toBe('compressed D runtime asset');
	});

	it('does not inflate again when fetch already decoded gzip content encoding', async () => {
		const body = new TextEncoder().encode('decoded D runtime asset');
		const bytes = await fetchRuntimeAssetBytes(
			'https://example.test/runtime/bin/ldc2.wasm.gz',
			'ldc2.wasm',
			async () =>
				new Response(body, {
					headers: {
						'Content-Encoding': 'gzip'
					}
				}),
			undefined,
			'gzip'
		);

		expect(new TextDecoder().decode(bytes)).toBe('decoded D runtime asset');
	});
});
