// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimePrewarmer, browserPrewarmEnvironment } from '../../packages/core/src/prewarm.js';
import { createPlaygroundBinding } from '../../packages/core/src/sandbox.js';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const resource = () => ({ dispose: vi.fn(async () => {}), terminate: vi.fn() });
function fixture(enabled = true) {
	let callback: (() => void) | undefined;
	const item = resource();
	const create = vi.fn(async (_key: string, _signal: AbortSignal) => item);
	const cancelIdle = vi.fn(() => { callback = undefined; });
	const canStart = vi.fn(() => true);
	const scheduler = { canStart, schedule: vi.fn((fn: () => void) => { callback = fn; return cancelIdle; }) };
	const warmer = createRuntimePrewarmer(create, { enabled, environment: scheduler });
	return { warmer, item, create, canStart, scheduler, cancelIdle, idle() { callback?.(); } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('opt-in runtime prewarming', () => {
	it('does not schedule or load by default', async () => {
		const create = vi.fn();
		const schedule = vi.fn();
		const warmer = createRuntimePrewarmer(create, { environment: { canStart: () => true, schedule } });
		expect(await warmer.warm('JAVA')).toBe(false);
		expect(create).not.toHaveBeenCalled();
		expect(schedule).not.toHaveBeenCalled();
	});
	it('waits for idle and hands out exactly that resource once', async () => {
		const f = fixture();
		const warm = f.warmer.warm('JAVA');
		expect(f.create).not.toHaveBeenCalled();
		f.idle();
		expect(await warm).toBe(true);
		expect(await f.warmer.take('JAVA')).toBe(f.item);
		expect(await f.warmer.take('JAVA')).toBeUndefined();
		await f.warmer.dispose();
		expect(f.item.dispose).not.toHaveBeenCalled();
	});
	it('deduplicates repeated selections', async () => {
		const f = fixture();
		const a = f.warmer.warm('JAVA'); const b = f.warmer.warm('JAVA');
		f.idle(); await Promise.all([a,b]);
		expect(f.create).toHaveBeenCalledTimes(1);
		await f.warmer.dispose();
		expect(f.item.dispose).toHaveBeenCalledTimes(1);
	});
	it('foreground load starts immediately without waiting for idle', async () => {
		const f = fixture(); const warm = f.warmer.warm('JAVA');
		expect(await f.warmer.take('JAVA')).toBe(f.item);
		expect(await warm).toBe(true);
		expect(f.cancelIdle).toHaveBeenCalledTimes(1);
	});
	it('disable cancels a queued callback without I/O', async () => {
		const f = fixture(); const warm = f.warmer.warm('JAVA');
		await f.warmer.setEnabled(false); f.idle();
		expect(await warm).toBe(false); expect(f.create).not.toHaveBeenCalled();
	});
	it('disposes a late result after disabling during startup', async () => {
		const f = fixture(); const ready = deferred<typeof f.item>();
		f.create.mockReturnValue(ready.promise);
		const warm = f.warmer.warm('JAVA'); f.idle(); await tick();
		const disabled = f.warmer.setEnabled(false);
		expect(f.create.mock.calls[0]![1].aborted).toBe(true);
		ready.resolve(f.item); await disabled; await warm;
		expect(f.item.dispose).toHaveBeenCalledTimes(1);
	});
	it('does not cancel a claimed startup when prewarm is disabled', async () => {
		const f = fixture(); const ready = deferred<typeof f.item>(); f.create.mockReturnValue(ready.promise);
		void f.warmer.warm('JAVA'); const take = f.warmer.take('JAVA'); await tick();
		await f.warmer.setEnabled(false);
		expect(f.create.mock.calls[0]![1].aborted).toBe(false);
		ready.resolve(f.item); expect(await take).toBe(f.item);
	});
	it('replaces a language without starting the cancelled one', async () => {
		const f = fixture(); const a = f.warmer.warm('JAVA'); const b = f.warmer.warm('RUBY');
		f.idle(); expect(await a).toBe(false); expect(await b).toBe(true);
		expect(f.create).toHaveBeenCalledTimes(1); expect(f.create.mock.calls[0]![0]).toBe('RUBY');
	});
	it('waits for a cancelled startup to release before starting its replacement', async () => {
		const f = fixture();
		const first = deferred<typeof f.item>();
		const second = resource();
		f.create.mockImplementation((key) => key === 'JAVA' ? first.promise : Promise.resolve(second));
		const java = f.warmer.warm('JAVA');
		const duplicateJava = f.warmer.warm('JAVA');
		f.idle(); await tick();
		const ruby = f.warmer.warm('RUBY'); f.idle(); await tick();
		expect(f.create.mock.calls.map(([key]) => key)).toEqual(['JAVA']);
		first.resolve(f.item);
		expect(await Promise.all([java, duplicateJava])).toEqual([false, false]);
		expect(await ruby).toBe(true);
		expect(f.create.mock.calls.map(([key]) => key)).toEqual(['JAVA', 'RUBY']);
		expect(f.item.dispose).toHaveBeenCalledTimes(1);
		await f.warmer.dispose();
		expect(second.dispose).toHaveBeenCalledTimes(1);
	});
	it('a mismatched foreground request cancels the speculative runtime', async () => {
		const f = fixture(); const warm = f.warmer.warm('JAVA'); f.idle(); await warm;
		expect(await f.warmer.take('RUBY')).toBeUndefined(); await tick();
		expect(f.item.dispose).toHaveBeenCalledTimes(1);
	});
	it('discards a failed warm-up so the next speculative request can retry', async () => {
		const f = fixture(); f.create.mockRejectedValueOnce(new Error('network'));
		const warm = f.warmer.warm('JAVA'); f.idle(); expect(await warm).toBe(false);
		const again = f.warmer.warm('JAVA'); f.idle(); expect(await again).toBe(true);
		expect(f.create).toHaveBeenCalledTimes(2);
	});
	it('rechecks hidden/save-data policy at idle time', async () => {
		const f = fixture(); const warm = f.warmer.warm('JAVA'); f.canStart.mockReturnValue(false); f.idle();
		expect(await warm).toBe(false); expect(f.create).not.toHaveBeenCalled();
	});
	it('refuses speculative work after disposal', async () => {
		const f = fixture(); await f.warmer.dispose(); await f.warmer.setEnabled(true);
		expect(await f.warmer.warm('JAVA')).toBe(false);
	});
	it('does not schedule when policy disallows it', async () => {
		const f = fixture(); f.canStart.mockReturnValue(false);
		expect(await f.warmer.warm('JAVA')).toBe(false); expect(f.scheduler.schedule).not.toHaveBeenCalled();
	});
	it('requires boolean toggles', async () => {
		await expect(fixture().warmer.setEnabled('false' as never)).rejects.toThrow('boolean');
	});
	it('browser policy skips SSR, hidden pages, slow connections and save-data', () => {
		expect(browserPrewarmEnvironment().canStart()).toBe(false);
		vi.stubGlobal('window', {}); vi.stubGlobal('document', { visibilityState: 'visible' });
		vi.stubGlobal('navigator', { connection: { saveData: true } });
		expect(browserPrewarmEnvironment().canStart()).toBe(false);
		vi.stubGlobal('navigator', { connection: { effectiveType: '2g' } });
		expect(browserPrewarmEnvironment().canStart()).toBe(false);
		vi.stubGlobal('navigator', { connection: { effectiveType: '4g' } });
		expect(browserPrewarmEnvironment().canStart()).toBe(true);
		vi.stubGlobal('document', { visibilityState: 'hidden' });
		expect(browserPrewarmEnvironment().canStart()).toBe(false);
	});
});

describe('binding prewarm ownership', () => {
	function bindingFixture() {
		let idle!: () => void;
		vi.stubGlobal('window', { requestIdleCallback: (fn: () => void) => { idle=fn; return 1; }, cancelIdleCallback: vi.fn() });
		vi.stubGlobal('document', { visibilityState: 'visible' }); vi.stubGlobal('navigator', {});
		const sandbox = { ...resource(), load: vi.fn(async (..._args: unknown[]) => {}), run: vi.fn(async () => true), clear: vi.fn(async () => {}), eof: vi.fn() };
		const loader = vi.fn(async () => sandbox);
		const binding = createPlaygroundBinding('/assets/', loader, { prewarm: true });
		return { binding, sandbox, loader, idle: () => idle() };
	}
	it('loads only runtime with empty code and reuses it without executing', async () => {
		const f = bindingFixture(); const warm = f.binding.prewarm!('java'); f.idle(); expect(await warm).toBe(true);
		const sandbox = await f.binding.load('JAVA'); expect(f.loader).toHaveBeenCalledTimes(1);
		expect(f.sandbox.load.mock.calls[0]!.slice(0,4)).toEqual(['/assets/', '', false, []]);
		expect(f.sandbox.run).not.toHaveBeenCalled();
		await f.binding.setPrewarmEnabled!(false); expect(f.sandbox.dispose).not.toHaveBeenCalled();
		await sandbox.load('class Main {}'); expect(f.sandbox.load).toHaveBeenCalledTimes(2);
		await f.binding.dispose(); expect(f.sandbox.dispose).toHaveBeenCalledTimes(1);
	});
	it('does not prepare an extra copy after a consumer claimed one', async () => {
		const f = bindingFixture(); await f.binding.load('JAVA');
		expect(await f.binding.prewarm!('JAVA')).toBe(false); expect(f.loader).toHaveBeenCalledTimes(1);
	});
	it('blocks a second prewarm while a foreground load is claiming the first one', async () => {
		const f = bindingFixture();
		const ready = deferred<void>();
		f.sandbox.load.mockReturnValueOnce(ready.promise);
		const warm = f.binding.prewarm!('JAVA');
		const foreground = f.binding.load('JAVA');
		await tick();
		const duplicate = f.binding.prewarm!('JAVA');
		f.idle();
		ready.resolve();
		expect(await duplicate).toBe(false);
		expect(await warm).toBe(true);
		await foreground;
		expect(f.loader).toHaveBeenCalledTimes(1);
		await f.binding.dispose();
	});
	it('factory failure disposes the partial worker and normal load retries', async () => {
		const f = bindingFixture(); f.sandbox.load.mockRejectedValueOnce(new Error('offline'));
		const warm = f.binding.prewarm!('JAVA'); f.idle(); expect(await warm).toBe(false);
		expect(f.sandbox.dispose).toHaveBeenCalledTimes(1);
		await f.binding.load('JAVA'); expect(f.loader).toHaveBeenCalledTimes(2);
	});
	it('cleans an unclaimed runtime exactly once on binding dispose', async () => {
		const f = bindingFixture(); const warm = f.binding.prewarm!('JAVA'); f.idle(); await warm;
		await f.binding.dispose(); expect(f.sandbox.dispose).toHaveBeenCalledTimes(1);
		await expect(f.binding.load('JAVA')).rejects.toThrow('disposed');
	});
	it('keeps the legacy cold load behavior when the option is omitted', async () => {
		const f = bindingFixture(); const binding = createPlaygroundBinding('/assets/', f.loader);
		expect(await binding.prewarm!('JAVA')).toBe(false); expect(f.loader).not.toHaveBeenCalled();
		await binding.load('JAVA'); expect(f.sandbox.load).not.toHaveBeenCalled(); await binding.dispose();
	});
});
