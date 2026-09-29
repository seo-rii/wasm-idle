import { describe, expect, it } from 'vitest';
import { RuntimeAssetCache } from './runtimeAssetCache';

describe('owner runtime asset cache', () => {
	it('retains immutable modules independently of execution objects and counts hits', async () => {
		const cache = new RuntimeAssetCache();
		const module = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
		cache.set('module', module, 8);
		expect(cache.get('module')).toBe(module);
		expect(cache.stats()).toMatchObject({ hits: 1, entries: 1, disposed: false });
	});

	it('bounds retained entries and bytes using least recently used eviction', () => {
		const cache = new RuntimeAssetCache(20, 2);
		cache.set('a', 1, 4);
		cache.set('b', 2, 4);
		expect(cache.get('a')).toBe(1);
		cache.set('c', 3, 4);
		expect(cache.get('b')).toBeUndefined();
		cache.set('huge', 4, 30);
		expect(cache.get('huge')).toBeUndefined();
		expect(cache.stats().bytes).toBeLessThanOrEqual(20);
	});

	it('keeps loader identities distinct and disposal cannot be revived by late loads', () => {
		const cache = new RuntimeAssetCache();
		const first = () => {};
		expect(cache.identity(first)).toBe(cache.identity(first));
		expect(cache.identity(() => {})).not.toBe(cache.identity(first));
		cache.set('asset', new Uint8Array([1]), 1);
		cache.dispose();
		cache.dispose();
		cache.set('late', new Uint8Array([2]), 1);
		expect(cache.get('late')).toBeUndefined();
		expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0, disposed: true });
	});
});
