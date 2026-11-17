// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const verified = vi.hoisted(() => ({ create: vi.fn(() => vi.fn()) }));
vi.mock('./lockVerifiedFetch', () => ({ createLockVerifiedFetch: verified.create }));
import { createModuleAssetFetch } from './moduleAssetCache';

describe('runtime module asset cache', () => {
	it('verifies files under the module directory against its release lock prefix', () => {
		const network = vi.fn() as unknown as typeof fetch;
		const cache = { enabled: true };
		const fetch = createModuleAssetFetch(
			'https://app.test/wasm-idle/wasm-go/index.js?v=e63d378d588d2b64',
			'wasm-go',
			cache,
			network
		);
		expect(fetch).toBe(verified.create.mock.results[0]!.value);
		expect(verified.create).toHaveBeenCalledWith({
			assetRoot: 'https://app.test/wasm-idle/wasm-go/',
			assetPrefix: 'wasm-go',
			validationKey: 'wasm-go-worker-v1',
			persistentCache: cache,
			fetch: network
		});
	});

	it('keeps the network fetch for module URLs without an HTTP directory', () => {
		verified.create.mockClear();
		const network = vi.fn() as unknown as typeof fetch;
		for (const url of ['data:text/javascript;base64,AA==', 'file:///opt/wasm-go/index.js', ''])
			expect(createModuleAssetFetch(url, 'wasm-go', { enabled: true }, network)).toBe(
				network
			);
		expect(verified.create).not.toHaveBeenCalled();
	});
});
