// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	RUBY_SPLIT_BUNDLE,
	RUBY_SPLIT_PROTOCOL,
	preflightRubySplitRuntimeAssets,
	parseRubyStdlibPack,
	requireRubySplitPayload,
	verifyRubySplitPayload,
	createRubyStdlibPreopens,
	createRuntimeAssetsKey
} from '@wasm-idle/core';
const root = new URL('../../static/wasm-ruby/split/', import.meta.url);
const encoder = new TextEncoder();
const asBytes = (bytes: Uint8Array) => Uint8Array.from(bytes);
const fetchAssets: typeof fetch = async (input) => {
	const url = new URL(String(input));
	const bytes = await readFile(new URL(url.pathname.split('/').at(-1)!, root));
	return new Response(asBytes(bytes));
};
const load = () =>
	preflightRubySplitRuntimeAssets({ baseUrl: 'https://runtime.test/ruby/', fetch: fetchAssets });
function pack(index: any[], body = new Uint8Array()) {
	const encoded = encoder.encode(JSON.stringify(index));
	const bytes = new Uint8Array(16 + encoded.length + body.length);
	bytes.set(encoder.encode('RUBYFS1\0'));
	const view = new DataView(bytes.buffer);
	view.setUint32(8, encoded.length, true);
	view.setUint32(12, index.length, true);
	bytes.set(encoded, 16);
	bytes.set(body, 16 + encoded.length);
	return bytes;
}
const mounts = () =>
	[
		'/bundle',
		'/usr',
		'/usr/local',
		'/usr/local/lib',
		'/usr/local/lib/ruby',
		'/usr/local/lib/ruby/3.4.0',
		'/usr/local/lib/ruby/gems',
		'/usr/local/lib/ruby/gems/3.4.0'
	].map((path) => ({ path, kind: 'directory' }));
afterEach(() => vi.restoreAllMocks());
describe('Ruby split stdlib', () => {
	it('loads all four independently verified assets concurrently', async () => {
		const pending: Array<() => void> = [];
		const progress = vi.fn();
		const fetcher = vi.fn(
			(input: any) =>
				new Promise<Response>((resolve) =>
					pending.push(() => void fetchAssets(input).then(resolve))
				)
		);
		const promise = preflightRubySplitRuntimeAssets({
			baseUrl: 'https://runtime.test/ruby/',
			fetch: fetcher,
			reportProgress: progress
		});
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
		for (const resolve of pending.reverse()) resolve();
		const payload = await promise;
		expect(payload.protocol).toBe(RUBY_SPLIT_PROTOCOL);
		expect(Object.isFrozen(payload)).toBe(true);
		expect(payload.wasmBytes.length).toBe(16_626_499);
		expect(progress.mock.lastCall?.[0]).toMatchObject({ runtimeId: 'RUBY' });
		expect(progress.mock.lastCall?.[0].loadedBytes).toBe(
			progress.mock.lastCall?.[0].totalBytes
		);
		expect(await verifyRubySplitPayload(payload)).toBe(payload);
		const entries = parseRubyStdlibPack(payload.stdlibBytes);
		expect(entries.filter((x) => x.kind === 'file')).toHaveLength(1918);
		expect(entries.some((x) => x.path.endsWith('/json.rb'))).toBe(true);
	});
	it('rejects a changed decoded Wasm before any compilation', async () => {
		const payload = await load();
		const bad = { ...payload, wasmBytes: payload.wasmBytes.slice() };
		bad.wasmBytes[100] ^= 1;
		const compile = vi.spyOn(WebAssembly, 'compile');
		await expect(verifyRubySplitPayload(bad)).rejects.toThrow(/SHA-256/);
		expect(compile).not.toHaveBeenCalled();
	});
	it('rejects corrupted compressed bytes', async () => {
		const fetcher: typeof fetch = async (input) => {
			const r = await fetchAssets(input);
			const b = new Uint8Array(await r.arrayBuffer());
			if (String(input).includes('stdlib')) b[100] ^= 1;
			return new Response(b);
		};
		await expect(
			preflightRubySplitRuntimeAssets({
				baseUrl: 'https://runtime.test/ruby/',
				fetch: fetcher
			})
		).rejects.toThrow(/SHA-256/);
	});
	it('rejects size policies before fetching anything', async () => {
		const fetcher = vi.fn();
		await expect(
			preflightRubySplitRuntimeAssets({
				baseUrl: 'https://runtime.test/ruby/',
				fetch: fetcher,
				limits: { maxAssetBytes: 1024 }
			})
		).rejects.toMatchObject({ code: 'asset-too-large' });
		expect(fetcher).not.toHaveBeenCalled();
	});
	it('rejects status errors, missing and extra bytes', async () => {
		for (const response of [
			new Response(null, { status: 404 }),
			new Response('x'),
			new Response(new Uint8Array(RUBY_SPLIT_BUNDLE.manifest.bytes + 1))
		]) {
			await expect(
				preflightRubySplitRuntimeAssets({
					baseUrl: 'https://runtime.test/ruby/',
					fetch: async () => response.clone()
				})
			).rejects.toThrow();
		}
	});
	it('cancels fetches which ignore AbortSignal, and disposes late bodies', async () => {
		const controller = new AbortController();
		const cancel = vi.fn();
		let deliver!: (r: Response) => void;
		const fetcher = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					deliver = resolve;
				})
		);
		const loading = preflightRubySplitRuntimeAssets({
			baseUrl: 'https://runtime.test/ruby/',
			fetch: fetcher,
			signal: controller.signal
		});
		const assertion = expect(loading).rejects.toThrow('cancelled');
		await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
		controller.abort(new Error('cancelled'));
		await assertion;
		deliver(new Response(new ReadableStream({ cancel })));
		await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
	});
	it('does not evaluate accessor payloads', () => {
		const getter = vi.fn(() => RUBY_SPLIT_PROTOCOL);
		const object = Object.create(null);
		Object.defineProperty(object, 'protocol', { get: getter });
		expect(() => requireRubySplitPayload(object)).toThrow();
		expect(getter).not.toHaveBeenCalled();
	});
	it('requires independent owned buffers and a pinned profile', async () => {
		const payload = await load();
		expect(() => requireRubySplitPayload({ ...payload, version: '0'.repeat(64) })).toThrow();
		expect(() =>
			requireRubySplitPayload({ ...payload, stdlibBytes: payload.wasmBytes })
		).toThrow();
		expect(() => requireRubySplitPayload({ ...payload, extra: true })).toThrow();
		expect(() =>
			requireRubySplitPayload({
				...payload,
				wasmBytes: new Uint8Array(new SharedArrayBuffer(payload.wasmBytes.length))
			})
		).toThrow();
	});
	it('includes profile selection in binding identity', () => {
		expect(createRuntimeAssetsKey({ ruby: { splitStdlib: true } })).not.toBe(
			createRuntimeAssetsKey({ ruby: { splitStdlib: false } })
		);
	});
	it('accepts complete mount roots and rejects malformed ranges and paths', () => {
		expect(parseRubyStdlibPack(pack(mounts()))).toHaveLength(8);
		const entry = { kind: 'file', path: '/usr/file', offset: 0, length: 1 };
		for (const item of [
			{ ...entry, path: '/usr/../escape' },
			{ ...entry, path: '/other' },
			{ ...entry, path: '/usr/a\\b' },
			{ ...entry, offset: 1 },
			{ ...entry, length: -1 },
			{ ...entry, length: 10 },
			{ ...entry, kind: 'symlink' },
			{ ...entry, extra: true }
		])
			expect(() =>
				parseRubyStdlibPack(pack([...mounts(), item], new Uint8Array(1)))
			).toThrow();
		expect(() =>
			parseRubyStdlibPack(pack([...mounts(), entry, entry], new Uint8Array(2)))
		).toThrow();
		expect(() => parseRubyStdlibPack(pack(mounts(), new Uint8Array(1)))).toThrow(/trailing/);
		expect(() => parseRubyStdlibPack(pack(mounts().slice(1)))).toThrow(/mount/);
		expect(() =>
			parseRubyStdlibPack(pack([{ path: '/usr/missing/child', kind: 'directory' }]))
		).toThrow(/parent/);
	});
	it('does not expose storage outside a sliced view', () => {
		const good = pack(mounts());
		const outer = new Uint8Array(good.length + 19);
		outer.set(good, 7);
		expect(parseRubyStdlibPack(outer.subarray(7, 7 + good.length))).toHaveLength(8);
	});
	it('recreates mutable directory state for every program', async () => {
		const shim = await import('@bjorn3/browser_wasi_shim');
		const entries = parseRubyStdlibPack(
			pack(
				[...mounts(), { path: '/usr/file', kind: 'file', offset: 0, length: 1 }],
				Uint8Array.of(42)
			)
		);
		const a = createRubyStdlibPreopens(entries, shim);
		const b = createRubyStdlibPreopens(entries, shim);
		expect(a[0]).not.toBe(b[0]);
		expect(a[0].dir).not.toBe(b[0].dir);
	});
});
