// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@wasm-idle/core', async (original) => ({
	...(await original<typeof import('@wasm-idle/core')>()),
	readPersistentRuntimeAsset: storage.read,
	writePersistentRuntimeAsset: storage.write
}));
import { createLockVerifiedFetch } from './lockVerifiedFetch';

const root = 'https://app.test/wasm-idle/wasm-go/';
const bytes = new TextEncoder().encode('compile tool bytes');
const receipt = {
	sha256: createHash('sha256').update(bytes).digest('hex'),
	bytes: bytes.byteLength,
	mediaType: 'application/octet-stream'
};

function fixture(persistentCache: object = { enabled: true }) {
	const network = vi.fn(
		async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(bytes.slice(), { headers: { 'content-length': String(bytes.byteLength) } })
	);
	const lookup = vi.fn(async (input: string | URL) =>
		String(input).endsWith('/runtime/tools/compile.wasm.gz') ? receipt : undefined
	);
	const fetch = createLockVerifiedFetch({
		assetRoot: root,
		assetPrefix: 'wasm-go',
		validationKey: 'wasm-go-worker-v1',
		persistentCache,
		fetch: network as unknown as typeof globalThis.fetch,
		lookup: lookup as never
	});
	return { fetch, network, lookup };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	vi.clearAllMocks();
});

describe('lock-verified runtime fetch', () => {
	it('stores a pinned network body for its exact URL and serves the next request from it', async () => {
		storage.read.mockResolvedValueOnce(undefined);
		storage.write.mockResolvedValue(true);
		const f = fixture();
		const url = `${root}runtime/tools/compile.wasm.gz?v=abc`;
		const response = await f.fetch(url, { signal: new AbortController().signal });
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
		await flush();
		expect(f.lookup).toHaveBeenCalledWith(new URL(`${root}runtime/tools/compile.wasm.gz`), {
			assetRoot: root,
			assetPrefix: 'wasm-go',
			signal: expect.any(AbortSignal)
		});
		const identity = {
			url,
			sha256: receipt.sha256,
			bytes: receipt.bytes,
			validationKey: 'wasm-go-worker-v1'
		};
		expect(storage.write).toHaveBeenCalledWith(expect.objectContaining({ identity, bytes }));
		storage.read.mockResolvedValueOnce(bytes.slice());
		const cached = await f.fetch(url);
		expect(new Uint8Array(await cached.arrayBuffer())).toEqual(bytes);
		expect(cached.headers.get('content-length')).toBe(String(bytes.byteLength));
		expect(storage.read).toHaveBeenLastCalledWith(expect.objectContaining({ identity }));
		expect(f.network).toHaveBeenCalledOnce();
	});

	it('passes unpinned, non-GET, ranged, extra-query and decoded requests straight through', async () => {
		storage.read.mockResolvedValue(undefined);
		const f = fixture();
		const pinned = `${root}runtime/tools/compile.wasm.gz`;
		await f.fetch(`${root}runtime/runtime-manifest.v1.json`);
		await f.fetch(pinned, { method: 'POST' });
		await f.fetch(pinned, { headers: { range: 'bytes=0-1' } });
		await f.fetch(`${pinned}?v=1&debug=1`);
		await f.fetch(new Request(pinned));
		f.network.mockResolvedValueOnce(new Response('missing', { status: 404 }));
		expect((await f.fetch(pinned)).status).toBe(404);
		await flush();
		expect(f.network).toHaveBeenCalledTimes(6);
		expect(storage.write).not.toHaveBeenCalled();
	});

	it('returns the network bytes unchanged when they do not match the lock', async () => {
		storage.read.mockResolvedValue(undefined);
		storage.write.mockRejectedValue(new Error('integrity mismatch'));
		const f = fixture();
		const other = new TextEncoder().encode('a different deployment');
		f.network.mockResolvedValueOnce(new Response(other.slice()));
		const response = await f.fetch(`${root}runtime/tools/compile.wasm.gz`);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(other);
		await flush();
		expect(storage.write).not.toHaveBeenCalled();
	});

	it('uses the plain network fetch when persistent caching is disabled or storage fails', async () => {
		const disabled = fixture({ enabled: false });
		expect(disabled.fetch).toBe(disabled.network);
		storage.read.mockRejectedValueOnce(new Error('storage unavailable'));
		storage.write.mockRejectedValueOnce(new Error('quota'));
		const f = fixture();
		const response = await f.fetch(`${root}runtime/tools/compile.wasm.gz`);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
		await flush();
		const aborted = new AbortController();
		aborted.abort(new DOMException('stop', 'AbortError'));
		await expect(
			f.fetch(`${root}runtime/tools/compile.wasm.gz`, { signal: aborted.signal })
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(f.network).toHaveBeenCalledOnce();
	});

	it('stores a browser-decoded .gz body under the logical receipt and serves it again', async () => {
		const logical = new TextEncoder().encode('decoded compile tool');
		const gz = {
			...receipt,
			uncompressedSha256: createHash('sha256').update(logical).digest('hex'),
			uncompressedBytes: logical.byteLength
		};
		storage.read.mockResolvedValue(undefined);
		storage.write.mockResolvedValue(true);
		const f = fixture();
		f.lookup.mockResolvedValue(gz as never);
		f.network.mockResolvedValueOnce(
			new Response(logical.slice(), { headers: { 'content-encoding': 'gzip' } })
		);
		const url = `${root}runtime/tools/compile.wasm.gz`;
		expect(new Uint8Array(await (await f.fetch(url)).arrayBuffer())).toEqual(logical);
		await flush();
		const decodedIdentity = {
			url,
			sha256: gz.uncompressedSha256,
			bytes: gz.uncompressedBytes,
			validationKey: 'wasm-go-worker-v1'
		};
		expect(storage.write).toHaveBeenCalledWith(
			expect.objectContaining({ identity: decodedIdentity, bytes: logical })
		);
		// The stored-byte identity is tried first, then the logical one.
		storage.read.mockReset();
		storage.read.mockResolvedValue(undefined);
		storage.read.mockResolvedValueOnce(undefined).mockResolvedValueOnce(logical.slice());
		expect(new Uint8Array(await (await f.fetch(url)).arrayBuffer())).toEqual(logical);
		expect(storage.read.mock.calls.map(([request]) => request.identity.sha256)).toEqual([
			gz.sha256,
			gz.uncompressedSha256
		]);
		expect(f.network).toHaveBeenCalledOnce();
		// Without a logical receipt a decoded body is passed through uncached.
		storage.write.mockClear();
		const plain = fixture();
		plain.network.mockResolvedValueOnce(
			new Response(bytes.slice(), { headers: { 'content-encoding': 'gzip' } })
		);
		await plain.fetch(url);
		await flush();
		expect(storage.write).not.toHaveBeenCalled();
	});

	it('makes a request for a file that is still being stored wait for that write', async () => {
		const stored: Uint8Array[] = [];
		let finishWrite = () => {};
		storage.write.mockImplementationOnce(async ({ bytes: written }) => {
			await new Promise<void>((resolve) => (finishWrite = resolve));
			stored.push(written);
			return true;
		});
		storage.read.mockImplementation(async () => stored[0]?.slice());
		const f = fixture();
		const url = `${root}runtime/tools/compile.wasm.gz`;
		// A preload reads the whole body; the compile asks for the same file before the
		// background write has finished.
		expect(new Uint8Array(await (await f.fetch(url)).arrayBuffer())).toEqual(bytes);
		await flush();
		const again = f.fetch(url);
		await flush();
		expect(f.network).toHaveBeenCalledOnce();
		finishWrite();
		expect(new Uint8Array(await (await again).arrayBuffer())).toEqual(bytes);
		expect(f.network).toHaveBeenCalledOnce();
		// A request made before the first response arrives waits as well, and an abort
		// releases the waiting request without a download.
		storage.read.mockReset();
		storage.read.mockResolvedValue(undefined);
		let respond = (_response: Response) => {};
		f.network.mockImplementationOnce(
			() => new Promise<Response>((resolve) => (respond = resolve))
		);
		const other = `${root}runtime/tools/compile.wasm.gz?v=2`;
		const first = f.fetch(other);
		await flush();
		const aborted = new AbortController();
		const second = f.fetch(other, { signal: aborted.signal });
		await flush();
		aborted.abort(new DOMException('stop', 'AbortError'));
		await expect(second).rejects.toMatchObject({ name: 'AbortError' });
		respond(new Response('missing', { status: 404 }));
		expect((await first).status).toBe(404);
		expect(f.network).toHaveBeenCalledTimes(2);
		storage.read.mockReset();
	});
});
