import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const nativeCompile = WebAssembly.compile.bind(WebAssembly);
const nativeDigest = webcrypto.subtle.digest.bind(webcrypto.subtle);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

function wasm(answer = 42, maximum = 1) {
	return new Uint8Array([
		0, 97, 115, 109, 1, 0, 0, 0,
		1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0,
		5, 4, 1, 1, 1, maximum,
		7, 19, 2, 6, 109, 101, 109, 111, 114, 121, 2, 0,
		6, 97, 110, 115, 119, 101, 114, 0, 0,
		10, 6, 1, 4, 0, 65, answer, 11
	]);
}

async function loader() {
	return (await import('../src/tool-module-cache.js')).compileCappedGoToolModule;
}

beforeEach(() => {
	vi.resetModules();
	vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('reuses identical content and actually executes the compiled module', async () => {
	const compile = vi.spyOn(WebAssembly, 'compile').mockImplementation(nativeCompile);
	const load = await loader();
	const first = await load(wasm(), 65536);
	const second = await load(wasm(), 65536);
	expect(second).toBe(first);
	expect(compile).toHaveBeenCalledTimes(1);
	const instance = await WebAssembly.instantiate(first);
	expect((instance.exports.answer as () => number)()).toBe(42);
});

it('does not share same-length assets with changed content', async () => {
	const load = await loader();
	const first = await load(wasm(42), 65536);
	const second = await load(wasm(13), 65536);
	expect(second).not.toBe(first);
	expect(((await WebAssembly.instantiate(second)).exports.answer as () => number)()).toBe(13);
});

it('separates memory policies and preserves real engine-enforced maxima', async () => {
	const load = await loader();
	const small = await load(wasm(42, 1), 65536);
	const large = await load(wasm(42, 2), 131072);
	const smallMemory = (await WebAssembly.instantiate(small)).exports.memory as WebAssembly.Memory;
	const largeMemory = (await WebAssembly.instantiate(large)).exports.memory as WebAssembly.Memory;
	expect(() => smallMemory.grow(1)).toThrow();
	expect(largeMemory.grow(1)).toBe(1);
	expect(await load(wasm(42, 1), 131072)).not.toBe(small);
});

it('shares code but never instance memory', async () => {
	const load = await loader();
	const module = await load(wasm(), 65536);
	const first = await WebAssembly.instantiate(module);
	const second = await WebAssembly.instantiate(module);
	const a = new Uint8Array((first.exports.memory as WebAssembly.Memory).buffer);
	const b = new Uint8Array((second.exports.memory as WebAssembly.Memory).buffer);
	a[0] = 99;
	expect(b[0]).toBe(0);
});

it('snapshots exact subviews before asynchronous hashing and tolerates caller detachment', async () => {
	const entered = deferred<void>();
	const gate = deferred<void>();
	vi.stubGlobal('crypto', { subtle: { digest: async (algorithm: string, data: ArrayBuffer) => {
		entered.resolve(); await gate.promise; return await nativeDigest(algorithm, data);
	} } });
	const load = await loader();
	const storage = new Uint8Array(wasm().length + 20);
	storage.fill(255); storage.set(wasm(), 10);
	const operation = load(storage.subarray(10, storage.length - 10), 65536);
	await entered.promise;
	storage.fill(0);
	structuredClone(storage.buffer, { transfer: [storage.buffer] });
	gate.resolve();
	const instance = await WebAssembly.instantiate(await operation);
	expect((instance.exports.answer as () => number)()).toBe(42);
});

it('deduplicates in-flight native compilation', async () => {
	const ready = deferred<WebAssembly.Module>();
	const entered = deferred<void>();
	const compile = vi.spyOn(WebAssembly, 'compile').mockImplementation(() => { entered.resolve(); return ready.promise; });
	const load = await loader();
	const operations = Array.from({ length: 10 }, () => load(wasm(), 65536));
	await entered.promise;
	await tick();
	ready.resolve(await nativeCompile(wasm()));
	const results = await Promise.all(operations);
	expect(new Set(results).size).toBe(1);
	expect(compile).toHaveBeenCalledTimes(1);
});

it('evicts rejected compiler promises for retry', async () => {
	const failure = new Error('temporary compilation failure');
	const compile = vi.spyOn(WebAssembly, 'compile').mockRejectedValueOnce(failure).mockImplementation(nativeCompile);
	const load = await loader();
	await expect(load(wasm(), 65536)).rejects.toBe(failure);
	await expect(load(wasm(), 65536)).resolves.toBeInstanceOf(WebAssembly.Module);
	expect(compile).toHaveBeenCalledTimes(2);
});

it('does not cache actual malformed Wasm failures', async () => {
	const compile = vi.spyOn(WebAssembly, 'compile').mockImplementation(nativeCompile);
	const load = await loader();
	for (let i = 0; i < 2; i++) await expect(load(new Uint8Array([1, 2, 3]), 65536)).rejects.toThrow();
	expect(compile).toHaveBeenCalledTimes(2);
});

it('bounds the LRU to two modules and refreshes cache hits', async () => {
	const compile = vi.spyOn(WebAssembly, 'compile').mockImplementation(nativeCompile);
	const load = await loader();
	const a = await load(wasm(1), 65536);
	await load(wasm(2), 65536);
	expect(await load(wasm(1), 65536)).toBe(a);
	await load(wasm(3), 65536);
	expect(await load(wasm(1), 65536)).toBe(a);
	await load(wasm(2), 65536);
	expect(compile).toHaveBeenCalledTimes(4);
});

it('does not begin work for an already cancelled waiter', async () => {
	const compile = vi.spyOn(WebAssembly, 'compile').mockImplementation(nativeCompile);
	const load = await loader();
	const controller = new AbortController(); const error = new Error('cancel'); controller.abort(error);
	await expect(load(wasm(), 65536, controller.signal)).rejects.toBe(error);
	expect(compile).not.toHaveBeenCalled();
});

it('does not compile after cancellation while hashing', async () => {
	const entered = deferred<void>(); const gate = deferred<ArrayBuffer>();
	vi.stubGlobal('crypto', { subtle: { digest: () => { entered.resolve(); return gate.promise; } } });
	const compile = vi.spyOn(WebAssembly, 'compile').mockImplementation(nativeCompile);
	const load = await loader(); const controller = new AbortController();
	const operation = load(wasm(), 65536, controller.signal);
	const rejected = expect(operation).rejects.toThrow('cancel');
	await entered.promise; controller.abort(new Error('cancel')); await rejected;
	gate.resolve(new ArrayBuffer(32)); await tick();
	expect(compile).not.toHaveBeenCalled();
});

it('cancels one waiter without poisoning another or the successful cache entry', async () => {
	const gate = deferred<WebAssembly.Module>(); const entered = deferred<void>();
	const compile = vi.spyOn(WebAssembly, 'compile').mockImplementation(() => { entered.resolve(); return gate.promise; });
	const load = await loader(); const controller = new AbortController();
	const cancelled = load(wasm(), 65536, controller.signal);
	const rejected = expect(cancelled).rejects.toThrow('cancel');
	await entered.promise;
	const survivor = load(wasm(), 65536);
	controller.abort(new Error('cancel')); await rejected;
	gate.resolve(await nativeCompile(wasm()));
	const module = await survivor;
	expect(await load(wasm(), 65536)).toBe(module);
	expect(compile).toHaveBeenCalledTimes(1);
});

for (const mode of ['absent', 'rejects'] as const) {
	it(`falls back to uncached compilation when WebCrypto ${mode}`, async () => {
		vi.stubGlobal('crypto', mode === 'absent' ? undefined : { subtle: { digest: () => Promise.reject(new Error('unavailable')) } });
		const compile = vi.spyOn(WebAssembly, 'compile').mockImplementation(nativeCompile);
		const load = await loader();
		await expect(load(wasm(), 65536)).resolves.toBeInstanceOf(WebAssembly.Module);
		await expect(load(wasm(), 65536)).resolves.toBeInstanceOf(WebAssembly.Module);
		expect(compile).toHaveBeenCalledTimes(2);
	});
}
