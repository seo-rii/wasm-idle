import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
	createPhpEngineBootstrap,
	type PhpEngineAsset
} from '../../producers/wasm-php/src/startup-loader';

// Real core Wasm with exported memory and a no-op _start. No PHP binary is mocked as compiled.
const wasm = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 19, 2, 6, 109,
	101, 109, 111, 114, 121, 2, 0, 6, 95, 115, 116, 97, 114, 116, 0, 0, 10, 4, 1, 2, 0, 11
]);
void new Response();
function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function fixture(supported = true, timeout = 1000) {
	const asset = (mode: string): PhpEngineAsset => ({
		url: `https://example.test/${mode}.wasm`,
		bytes: wasm.length,
		sha256: createHash('sha256').update(wasm).digest('hex'),
		load: vi.fn(async () => ({
			dependencyFilename: `https://example.test/${mode}.wasm`,
			dependenciesTotalSize: wasm.length,
			init() {
				throw new Error('Startup tests must not initialize a PHP VM');
			}
		}))
	});
	const assets = { jspi: asset('jspi'), asyncify: asset('asyncify') };
	const detect = vi.fn(async () => supported);
	const fetch = vi.fn<typeof globalThis.fetch>(async (_url, _init) => new Response(wasm.slice()));
	vi.stubGlobal('fetch', fetch);
	return {
		assets,
		detect,
		fetch,
		prepare: createPhpEngineBootstrap(assets, detect, timeout)
	};
}
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
describe('PHP selected-engine startup', () => {
	it('starts Wasm fetching without waiting for the selected glue module', async () => {
		const f = fixture(),
			glue = deferred<any>();
		vi.mocked(f.assets.jspi.load).mockReturnValue(glue.promise);
		const operation = f.prepare();
		await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(1));
		expect(f.assets.asyncify.load).not.toHaveBeenCalled();
		expect(f.fetch.mock.calls[0]![0]).toContain('jspi.wasm');
		expect(f.fetch.mock.calls[0]![1]).toEqual(
			expect.objectContaining({ credentials: 'omit', redirect: 'error' })
		);
		glue.resolve({
			dependencyFilename: f.assets.jspi.url,
			dependenciesTotalSize: f.assets.jspi.bytes
		});
		expect((await operation).module).toBeInstanceOf(WebAssembly.Module);
	});
	it('selects only Asyncify when JSPI is unavailable', async () => {
		const f = fixture(false);
		expect((await f.prepare()).mode).toBe('asyncify');
		expect(f.assets.jspi.load).not.toHaveBeenCalled();
		expect(f.fetch).toHaveBeenCalledTimes(1);
	});
	it('explicit Asyncify does not require feature detection', async () => {
		const f = fixture();
		await f.prepare('asyncify');
		expect(f.detect).not.toHaveBeenCalled();
	});
	it('rejects invalid or unsupported modes without requesting engine assets', async () => {
		const f = fixture(false);
		await expect(f.prepare('invalid' as any)).rejects.toThrow('Invalid');
		await expect(f.prepare('jspi')).rejects.toThrow('not supported');
		expect(f.fetch).not.toHaveBeenCalled();
	});
	it('deduplicates concurrent and repeated loads of the selected immutable code', async () => {
		const f = fixture();
		const compile = vi.spyOn(WebAssembly, 'compileStreaming');
		const [a, b] = await Promise.all([f.prepare(), f.prepare()]);
		expect(a).toBe(b);
		expect(await f.prepare()).toBe(a);
		expect(compile).toHaveBeenCalledTimes(1);
		expect(f.fetch).toHaveBeenCalledTimes(1);
		expect(f.detect).toHaveBeenCalledTimes(1);
		const first = await WebAssembly.instantiate(a.module),
			second = await WebAssembly.instantiate(b.module);
		new Uint8Array((first.exports.memory as WebAssembly.Memory).buffer)[0] = 99;
		expect(new Uint8Array((second.exports.memory as WebAssembly.Memory).buffer)[0]).toBe(0);
	});
	it('retains separate code for the two explicit engine profiles', async () => {
		const f = fixture();
		expect((await f.prepare('jspi')).mode).toBe('jspi');
		expect((await f.prepare('asyncify')).mode).toBe('asyncify');
		expect(f.fetch).toHaveBeenCalledTimes(2);
	});
	it('does not publish a module before final bytes are checked', async () => {
		const f = fixture();
		let stream!: ReadableStreamDefaultController<Uint8Array>;
		f.fetch.mockResolvedValue(
			new Response(
				new ReadableStream({
					start(c) {
						stream = c;
						c.enqueue(wasm.slice(0, 8));
					}
				})
			)
		);
		let ready = false;
		const operation = f.prepare().then((value) => {
			ready = true;
			return value;
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(ready).toBe(false);
		stream.enqueue(wasm.slice(8));
		stream.close();
		expect((await operation).module).toBeInstanceOf(WebAssembly.Module);
	});
	it('rejects corrupt bytes despite a compilable WebAssembly module', async () => {
		const f = fixture();
		(f.assets.jspi as any).sha256 = '0'.repeat(64);
		await expect(f.prepare()).rejects.toThrow('integrity');
	});
	it.each(['short', 'long', 'status'])(
		'rejects a %s response and permits clean retry',
		async (kind) => {
			const f = fixture();
			f.fetch.mockResolvedValueOnce(
				kind === 'status'
					? new Response(null, { status: 500 })
					: new Response(
							kind === 'short' ? wasm.slice(0, -1) : new Uint8Array([...wasm, 0])
						)
			);
			await expect(f.prepare()).rejects.toThrow();
			expect((await f.prepare()).module).toBeInstanceOf(WebAssembly.Module);
			expect(f.fetch).toHaveBeenCalledTimes(2);
		}
	);
	it('checks receipt budgets before any Wasm fetch', async () => {
		const f = fixture();
		(f.assets.jspi as any).bytes = 1e9;
		await expect(f.prepare()).rejects.toThrow('receipt');
		expect(f.fetch).not.toHaveBeenCalled();
	});
	it('rejects loader metadata that disagrees with the pinned receipt', async () => {
		const f = fixture();
		vi.mocked(f.assets.jspi.load).mockResolvedValueOnce({
			dependencyFilename: 'https://example.test/other.wasm',
			dependenciesTotalSize: wasm.length
		} as any);
		await expect(f.prepare()).rejects.toThrow('pinned Wasm receipt');
	});
	it('rejects redirected responses and retries without retaining the failure', async () => {
		const f = fixture();
		const redirected = new Response(wasm.slice());
		Object.defineProperty(redirected, 'redirected', { value: true });
		f.fetch.mockResolvedValueOnce(redirected);
		await expect(f.prepare()).rejects.toThrow('request failed');
		expect((await f.prepare()).module).toBeInstanceOf(WebAssembly.Module);
	});
	it('requires Web Crypto before fetching the engine', async () => {
		const f = fixture();
		vi.stubGlobal('crypto', undefined);
		await expect(f.prepare()).rejects.toThrow('Web Crypto');
		expect(f.fetch).not.toHaveBeenCalled();
	});
	it('evicts a native compilation failure so the next attempt can retry', async () => {
		const f = fixture();
		vi.spyOn(WebAssembly, 'compileStreaming').mockRejectedValueOnce(
			new Error('native compile failure')
		);
		await expect(f.prepare()).rejects.toThrow('native compile failure');
		expect((await f.prepare()).module).toBeInstanceOf(WebAssembly.Module);
		expect(f.fetch).toHaveBeenCalledTimes(2);
	});
	it('falls back to verified native compile without compileStreaming', async () => {
		const f = fixture();
		// Remove the feature rather than emulate a rejected streaming compilation.
		vi.stubGlobal('WebAssembly', {
			...WebAssembly,
			Module: WebAssembly.Module,
			compile: WebAssembly.compile,
			compileStreaming: undefined
		});
		expect((await f.prepare()).module).toBeInstanceOf(WebAssembly.Module);
	});
	it('aborts a pending Wasm fetch if glue initialization fails', async () => {
		const f = fixture();
		let signal!: AbortSignal;
		f.fetch.mockImplementation(
			((_url: any, init: any) =>
				new Promise((_, reject) => {
					signal = init.signal;
					signal.addEventListener('abort', () => reject(signal.reason));
				})) as any
		);
		vi.mocked(f.assets.jspi.load).mockRejectedValueOnce(Error('glue failed'));
		await expect(f.prepare()).rejects.toThrow('glue failed');
		expect(signal.aborted).toBe(true);
	});
	it('bounds a stalled glue request even when the Wasm is ready', async () => {
		const f = fixture(true, 15);
		vi.mocked(f.assets.jspi.load).mockImplementationOnce(() => new Promise(() => {}));
		await expect(f.prepare()).rejects.toThrow('timed out');
		expect((await f.prepare()).module).toBeInstanceOf(WebAssembly.Module);
	});
	it('retries rejected feature detection without poisoning future loads', async () => {
		const f = fixture();
		f.detect.mockRejectedValueOnce(Error('detection failed'));
		await expect(f.prepare()).rejects.toThrow('detection failed');
		await f.prepare();
		expect(f.detect).toHaveBeenCalledTimes(2);
	});
});
