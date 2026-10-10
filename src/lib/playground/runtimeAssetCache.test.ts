import { describe, expect, it, vi } from 'vitest';
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

	it('settles a cancelled consumer while keeping shared work and progress for the other', async () => {
		const cache = new RuntimeAssetCache();
		const first = new AbortController();
		const next = new AbortController();
		const firstProgress = vi.fn();
		const nextProgress = vi.fn();
		const firstRemove = vi.spyOn(first.signal, 'removeEventListener');
		const nextRemove = vi.spyOn(next.signal, 'removeEventListener');
		let finish!: (value: number) => void;
		let publish!: (progress: number, key?: string) => void;
		let operationSignal!: AbortSignal;
		const start = vi.fn((signal: AbortSignal, report: typeof publish) => {
			operationSignal = signal;
			publish = report;
			return new Promise<number>((resolve) => {
				finish = resolve;
			});
		});
		const cancelled = cache.share('asset', first.signal, start, firstProgress);
		const rejection = expect(cancelled).rejects.toThrow('obsolete');
		await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
		publish(1, 'download');
		const pending = cache.share('asset', next.signal, start, nextProgress);
		expect(nextProgress).toHaveBeenLastCalledWith(1);
		first.abort(new Error('obsolete'));
		await rejection;
		expect(operationSignal.aborted).toBe(false);
		publish(2, 'download');
		expect(firstProgress).toHaveBeenCalledTimes(1);
		expect(nextProgress).toHaveBeenLastCalledWith(2);
		finish(42);
		await expect(pending).resolves.toBe(42);
		expect(start).toHaveBeenCalledOnce();
		expect(firstRemove).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(nextRemove).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(cache.stats().inFlight).toBe(0);
	});

	it('aborts work only after the final consumer leaves and permits immediate retry', async () => {
		const cache = new RuntimeAssetCache();
		const first = new AbortController();
		const next = new AbortController();
		let finishOld!: (value: number) => void;
		let finishRetry!: (value: number) => void;
		let oldSignal!: AbortSignal;
		const oldStart = vi.fn((signal: AbortSignal) => {
			oldSignal = signal;
			return new Promise<number>((resolve) => {
				finishOld = resolve;
			});
		});
		const cancelled = cache.share('asset', first.signal, oldStart);
		const rejected = expect(cancelled).rejects.toThrow('obsolete');
		await vi.waitFor(() => expect(oldStart).toHaveBeenCalledOnce());
		first.abort(new Error('obsolete'));
		await rejected;
		expect(oldSignal.aborted).toBe(true);
		expect(cache.stats().inFlight).toBe(0);
		const retry = cache.share(
			'asset',
			next.signal,
			() =>
				new Promise<number>((resolve) => {
					finishRetry = resolve;
				})
		);
		await vi.waitFor(() => expect(finishRetry).toBeTypeOf('function'));
		finishOld(1);
		await Promise.resolve();
		await Promise.resolve();
		expect(cache.stats().inFlight).toBe(1);
		finishRetry(2);
		await expect(retry).resolves.toBe(2);
		expect(cache.stats().inFlight).toBe(0);
	});

	it('removes failed operations so subsequent consumers can retry', async () => {
		const cache = new RuntimeAssetCache();
		const first = new AbortController();
		const next = new AbortController();
		const start = vi.fn(async () => {
			throw new Error('network failure');
		});
		await Promise.all([
			expect(cache.share('asset', first.signal, start)).rejects.toThrow('network failure'),
			expect(cache.share('asset', next.signal, start)).rejects.toThrow('network failure')
		]);
		expect(start).toHaveBeenCalledOnce();
		expect(cache.stats().inFlight).toBe(0);
		await expect(cache.share('asset', first.signal, async () => 7)).resolves.toBe(7);
	});

	it('does not retain operations beyond disabled or saturated cache limits', async () => {
		const disabled = new RuntimeAssetCache(0, 0);
		const signal = new AbortController().signal;
		const start = vi.fn(async () => 1);
		await Promise.all([
			disabled.share('asset', signal, start),
			disabled.share('asset', signal, start)
		]);
		expect(start).toHaveBeenCalledTimes(2);
		expect(disabled.stats().inFlight).toBe(0);
		const bounded = new RuntimeAssetCache(1024, 1);
		let finish!: (value: number) => void;
		const first = bounded.share(
			'a',
			signal,
			() =>
				new Promise<number>((resolve) => {
					finish = resolve;
				})
		);
		await expect(bounded.share('b', signal, async () => 2)).resolves.toBe(2);
		expect(bounded.stats().inFlight).toBe(1);
		finish(1);
		await first;
		expect(bounded.stats().inFlight).toBe(0);
	});
});
