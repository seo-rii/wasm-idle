import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { compileVerifiedWasmAsset, type VerifiedWasmReceipt } from '../src/verified-wasm.js';

// (module (func (export "answer") (result i32) i32.const 42))
const wasm = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 10, 1, 6, 97, 110, 115, 119,
	101, 114, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11
]);
const gzip = Uint8Array.from(gzipSync(wasm));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const receipt: VerifiedWasmReceipt = {
	bytes: gzip.length,
	sha256: hash(gzip),
	uncompressedBytes: wasm.length,
	uncompressedSha256: hash(wasm)
};
const response = (bytes: Uint8Array) => new Response(Uint8Array.from(bytes).buffer);
const fetchMock = (body: Response) => vi.fn(async () => body) as unknown as typeof fetch;
const load = (body: Response, overrides: Partial<VerifiedWasmReceipt> = {}, options: object = {}) =>
	compileVerifiedWasmAsset(
		'https://example.test/clang.wasm.gz',
		{ ...receipt, ...overrides },
		{
			fetch: fetchMock(body),
			maxAssetBytes: 1024,
			...options
		}
	);
const answer = async (module: WebAssembly.Module) =>
	(await WebAssembly.instantiate(module)).exports.answer as () => number;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('verified native Wasm streaming', () => {
	it('compiles and runs raw gzip with storage and logical receipts', async () => {
		expect((await answer(await load(response(gzip))))()).toBe(42);
	});
	it('accepts already decoded HTTP bodies against the logical receipt', async () => {
		expect((await answer(await load(response(wasm))))()).toBe(42);
	});
	it('starts streaming compilation before the final network bytes arrive', async () => {
		let input!: ReadableStreamDefaultController<Uint8Array>;
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				input = c;
			}
		});
		const spy = vi.spyOn(WebAssembly, 'compileStreaming');
		const pending = load(new Response(body));
		input.enqueue(wasm.slice(0, 8));
		await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
		let settled = false;
		void pending.then(() => {
			settled = true;
		});
		await tick();
		expect(settled).toBe(false);
		input.enqueue(wasm.slice(8));
		input.close();
		expect((await answer(await pending))()).toBe(42);
	});
	it('handles split gzip magic and empty chunks', async () => {
		const body = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new Uint8Array());
				c.enqueue(gzip.slice(0, 1));
				c.enqueue(gzip.slice(1, 2));
				c.enqueue(gzip.slice(2));
				c.close();
			}
		});
		expect((await answer(await load(new Response(body))))()).toBe(42);
	});
	it('rejects a storage hash mismatch even when decoded Wasm is correct', async () => {
		await expect(load(response(gzip), { sha256: '0'.repeat(64) })).rejects.toThrow(/SHA-256/);
	});
	it('rejects a logical hash mismatch with otherwise valid gzip', async () => {
		await expect(load(response(gzip), { uncompressedSha256: '0'.repeat(64) })).rejects.toThrow(
			/SHA-256/
		);
	});
	it('rejects short, long and empty logical bodies', async () => {
		for (const bytes of [wasm.slice(0, -1), new Uint8Array([...wasm, 0]), new Uint8Array()]) {
			await expect(load(response(bytes))).rejects.toThrow();
		}
	});
	it('rejects a short or long compressed receipt', async () => {
		await expect(load(response(gzip), { bytes: gzip.length + 1 })).rejects.toThrow(/length/);
		await expect(load(response(gzip), { bytes: gzip.length - 1 })).rejects.toThrow(/limit/);
	});
	it('rejects gzip corruption without a buffered bypass', async () => {
		const bad = gzip.slice();
		bad[bad.length - 1] ^= 1;
		await expect(load(response(bad))).rejects.toThrow();
	});
	it('keeps full verification when native streaming is absent', async () => {
		vi.stubGlobal('WebAssembly', {
			...WebAssembly,
			compile: WebAssembly.compile,
			compileStreaming: undefined
		});
		// Namespace properties are not all enumerable; compilation is the only needed operation.
		const compiled = await load(response(gzip));
		expect(compiled).toBeDefined();
		await expect(load(response(gzip), { sha256: '0'.repeat(64) })).rejects.toThrow(/SHA-256/);
	});
	it('does not fetch invalid or over-budget receipts', async () => {
		const fetch = vi.fn();
		for (const update of [
			{ bytes: 0 },
			{ uncompressedBytes: Infinity },
			{ sha256: 'wrong' },
			{ bytes: 1025 }
		]) {
			await expect(
				compileVerifiedWasmAsset(
					'https://example.test/a',
					{ ...receipt, ...update },
					{ fetch, maxAssetBytes: 1024 }
				)
			).rejects.toThrow(/receipt/);
		}
		expect(fetch).not.toHaveBeenCalled();
	});
	it('does not fetch previously aborted requests or unsafe URLs', async () => {
		const fetch = vi.fn(),
			c = new AbortController();
		c.abort(new Error('cancelled'));
		await expect(
			compileVerifiedWasmAsset('https://example.test/a', receipt, {
				fetch,
				maxAssetBytes: 1024,
				signal: c.signal
			})
		).rejects.toThrow('cancelled');
		for (const url of ['file:///a', 'https://u:p@example.test/a', 'https://example.test/a#b'])
			await expect(
				compileVerifiedWasmAsset(url, receipt, { fetch, maxAssetBytes: 1024 })
			).rejects.toThrow();
		expect(fetch).not.toHaveBeenCalled();
	});
	it('cancels a stalled prefix read promptly', async () => {
		const c = new AbortController(),
			cancel = vi.fn();
		const stream = new ReadableStream<Uint8Array>({ cancel });
		const pending = load(new Response(stream), {}, { signal: c.signal });
		const reject = expect(pending).rejects.toThrow('stop');
		await tick();
		c.abort(new Error('stop'));
		await reject;
		await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
	});
	it('cancels a stalled body after streaming compilation starts', async () => {
		const c = new AbortController(),
			cancel = vi.fn(),
			spy = vi.spyOn(WebAssembly, 'compileStreaming');
		const stream = new ReadableStream<Uint8Array>({
			start(out) {
				out.enqueue(wasm.slice(0, 8));
			},
			cancel
		});
		const pending = load(new Response(stream), {}, { signal: c.signal });
		const reject = expect(pending).rejects.toThrow('stop');
		await vi.waitFor(() => expect(spy).toHaveBeenCalled());
		c.abort(new Error('stop'));
		await reject;
		await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
	});
	it('cancels late responses when a custom fetch ignores its signal', async () => {
		const c = new AbortController(),
			cancel = vi.fn();
		let resolve!: (response: Response) => void;
		const fetching = new Promise<Response>((yes) => {
			resolve = yes;
		});
		const pending = load(response(wasm), {}, { signal: c.signal, fetch: () => fetching });
		const reject = expect(pending).rejects.toThrow('stop');
		await tick();
		c.abort(new Error('stop'));
		await reject;
		resolve(new Response(new ReadableStream({ cancel })));
		await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
	});
	it('rejects HTTP errors and changed response URLs', async () => {
		await expect(load(new Response('missing', { status: 404 }))).rejects.toThrow('404');
		const r = response(wasm);
		Object.defineProperty(r, 'url', { value: 'https://other.test/a' });
		await expect(load(r)).rejects.toThrow(/URL mismatch/);
	});
	it('closes readers on native compiler failure and permits a later retry', async () => {
		const cancel = vi.fn();
		vi.spyOn(WebAssembly, 'compileStreaming').mockRejectedValueOnce(
			new Error('compiler failed')
		);
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(wasm.slice(0, 8));
			},
			cancel
		});
		await expect(load(new Response(stream))).rejects.toThrow('compiler failed');
		await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
		expect((await answer(await load(response(wasm))))()).toBe(42);
	});
	it('does not instantiate or export a module before the receipt passes', async () => {
		const instantiate = vi.spyOn(WebAssembly, 'instantiate');
		await expect(
			load(response(wasm), { uncompressedSha256: '0'.repeat(64) })
		).rejects.toThrow();
		expect(instantiate).not.toHaveBeenCalled();
	});
});
