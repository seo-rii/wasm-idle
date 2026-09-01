import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { WASM_TINYGO_EXECUTABLE_GRAPH_PROFILE } from './playground/wasmTinyGoVersion';

const serviceWorkerPath = path.resolve('static/worker.js');
const scope = 'https://example.com/wasm-idle/';

type LayeredAsset = {
	layer: string;
	offset: number;
	length: number;
};

type LayerFixture = {
	bytes: Uint8Array;
	contentDecoded?: boolean;
};

type LayeredFixtures = {
	assets: Record<string, LayeredAsset>;
	layers: Record<string, LayerFixture>;
};

async function createServiceWorkerHarness(
	payloads: Record<string, Uint8Array>,
	layeredFixtures?: LayeredFixtures,
	networkPayloads: Record<string, Uint8Array> = {}
) {
	const source = await readFile(serviceWorkerPath, 'utf8');
	const listeners = new Map<string, Array<(event: any) => void>>();
	let compressedPayloads = payloads;
	let currentLayeredFixtures = layeredFixtures;
	const layeredManifest = () => ({
		schemaVersion: 1,
		assets: currentLayeredFixtures?.assets ?? {},
		layers: Object.fromEntries(
			Object.entries(currentLayeredFixtures?.layers ?? {}).map(([layer, fixture]) => {
				const compressed = gzipSync(fixture.bytes);
				return [
					layer,
					{
						length: fixture.bytes.byteLength,
						compressedLength: compressed.byteLength,
						sha256: createHash('sha256').update(compressed).digest('hex')
					}
				];
			})
		)
	});
	const fetchMock = vi.fn(async (input: unknown) => {
		const url =
			input instanceof Request
				? new URL(input.url)
				: input instanceof URL
					? input
					: new URL(String(input));
		if (url.href === `${scope}compressed-runtime-assets.v1.json`) {
			const manifest = {
				assets: Object.keys(compressedPayloads),
				sizes: Object.fromEntries(
					Object.entries(compressedPayloads).map(([assetPath, bytes]) => [
						assetPath,
						bytes.byteLength
					])
				)
			};
			return new Response(JSON.stringify(manifest), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		if (url.href === `${scope}layered-runtime-assets.v1.json`) {
			return new Response(JSON.stringify(layeredManifest()), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		const relativePath = url.pathname.slice(new URL(scope).pathname.length);
		const networkPayload = networkPayloads[relativePath];
		if (networkPayload) {
			const response = new Response(Uint8Array.from(networkPayload), { status: 200 });
			Object.defineProperty(response, 'url', { value: url.href });
			return response;
		}
		for (const [layerPath, fixture] of Object.entries(currentLayeredFixtures?.layers ?? {})) {
			const gzipPath = layerPath.endsWith('.gz') ? layerPath : `${layerPath}.gz`;
			if (relativePath !== gzipPath) continue;
			if (fixture.contentDecoded) {
				return new Response(fixture.bytes.slice().buffer, {
					status: 200,
					headers: { 'content-encoding': 'gzip' }
				});
			}
			const compressed = gzipSync(fixture.bytes);
			return new Response(new Uint8Array(compressed), {
				status: 200,
				headers: {
					'content-length': String(compressed.byteLength),
					'content-type': 'application/gzip'
				}
			});
		}
		if (relativePath.endsWith('.gz')) {
			const payload = compressedPayloads[relativePath.slice(0, -'.gz'.length)];
			if (payload) {
				const compressed = gzipSync(payload);
				return new Response(new Uint8Array(compressed), {
					status: 200,
					headers: {
						'content-length': String(compressed.byteLength),
						'content-type': 'application/gzip'
					}
				});
			}
		}
		return new Response('not found', { status: 404 });
	});
	const workerSelf = {
		addEventListener(type: string, listener: (event: any) => void) {
			const registered = listeners.get(type) ?? [];
			registered.push(listener);
			listeners.set(type, registered);
		},
		clients: { claim: vi.fn() },
		registration: { scope },
		skipWaiting: vi.fn()
	};
	runInNewContext(source, {
		Date,
		DecompressionStream,
		Headers,
		Request,
		Response,
		URL,
		caches: { open: vi.fn() },
		console,
		fetch: fetchMock,
		self: workerSelf
	});

	const fetchListener = listeners.get('fetch')?.[0];
	if (!fetchListener) throw new Error('service worker did not register a fetch listener');
	return {
		fetchMock,
		setCompressedPayloads(nextPayloads: Record<string, Uint8Array>) {
			compressedPayloads = nextPayloads;
		},
		setLayeredFixtures(nextFixtures: LayeredFixtures) {
			currentLayeredFixtures = nextFixtures;
		},
		async request(relativePath: string, init?: RequestInit) {
			let responsePromise: Promise<Response> | undefined;
			fetchListener({
				request: new Request(new URL(relativePath, scope), {
					credentials: 'omit',
					...init
				}),
				respondWith(response: Promise<Response>) {
					responsePromise = Promise.resolve(response);
				}
			});
			if (!responsePromise) throw new Error('service worker did not respond to the request');
			return await responsePromise;
		}
	};
}

describe('compressed runtime service worker', () => {
	it('preserves exact final URLs for pinned AWK v2 network responses', async () => {
		const receipt = 'a'.repeat(64);
		for (const assetName of [
			'goawk.wasm.gz.bin',
			'runner-worker.v2.js',
			'runtime-manifest.v2.json',
			'wasm_exec.js'
		]) {
			const assetPath = `wasm-awk/${assetName}`;
			const harness = await createServiceWorkerHarness({}, undefined, {
				[assetPath]: new TextEncoder().encode(assetName)
			});

			const response = await harness.request(`${assetPath}?v=${receipt}`);

			expect(response.status).toBe(200);
			expect(response.url).toBe(`${scope}${assetPath}?v=${receipt}`);
		}
	});

	it('does not widen AWK exact-URL preservation to matching basenames or extra queries', async () => {
		const receipt = 'a'.repeat(64);
		const harness = await createServiceWorkerHarness({}, undefined, {
			'other/wasm_exec.js': new TextEncoder().encode('other'),
			'wasm-awk/wasm_exec.js': new TextEncoder().encode('awk')
		});

		expect((await harness.request(`other/wasm_exec.js?v=${receipt}`)).url).toBe('');
		expect((await harness.request(`wasm-awk/wasm_exec.js?v=${receipt}&extra=1`)).url).toBe('');
	});

	it('preserves exact final URLs for every pinned TinyGo executable graph module', async () => {
		const receipt = 'b'.repeat(64);
		for (const modulePath of Object.keys(WASM_TINYGO_EXECUTABLE_GRAPH_PROFILE.modules)) {
			const assetPath = `wasm-tinygo/${modulePath}`;
			const harness = await createServiceWorkerHarness({}, undefined, {
				[assetPath]: new TextEncoder().encode(assetPath)
			});

			const response = await harness.request(`${assetPath}?v=${receipt}`);

			expect(response.status).toBe(200);
			expect(response.url).toBe(`${scope}${assetPath}?v=${receipt}`);
		}
	});

	it('does not widen TinyGo exact-URL preservation beyond canonical paths and pins', async () => {
		const receipt = 'b'.repeat(64);
		const assetPath = 'wasm-tinygo/upstream.js';
		const harness = await createServiceWorkerHarness({}, undefined, {
			[assetPath]: new TextEncoder().encode('entry'),
			'other/upstream.js': new TextEncoder().encode('other')
		});

		expect((await harness.request(`other/upstream.js?v=${receipt}`)).url).toBe('');
		expect((await harness.request(`${assetPath}?v=${receipt}&extra=1`)).url).toBe('');
		expect((await harness.request(`${assetPath}?v=${receipt.toUpperCase()}`)).url).toBe('');
	});

	it('bypasses compressed synthesis for a pinned TinyGo graph module', async () => {
		const receipt = 'b'.repeat(64);
		const assetPath = 'wasm-tinygo/assets/upstream-compile-worker-Dat9LBTc.js';
		const compressedBytes = new TextEncoder().encode('stale compressed module');
		const networkBytes = new TextEncoder().encode('receipt-matched network module');
		const harness = await createServiceWorkerHarness(
			{ [assetPath]: compressedBytes },
			undefined,
			{ [assetPath]: networkBytes }
		);

		const response = await harness.request(`${assetPath}?v=${receipt}`);

		expect(response.url).toBe(`${scope}${assetPath}?v=${receipt}`);
		expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
			Array.from(networkBytes)
		);
		expect(harness.fetchMock).toHaveBeenCalledTimes(1);
		const fetchedInput = harness.fetchMock.mock.calls[0]?.[0] as { url?: string } | undefined;
		expect(fetchedInput?.url).toBe(`${scope}${assetPath}?v=${receipt}`);
	});

	it('refreshes a stale manifest when a newly deployed logical asset is requested', async () => {
		const originalPath = 'wasm-php/assets/php-old.wasm';
		const nextPath = 'wasm-php/assets/php-next.wasm';
		const originalBytes = new TextEncoder().encode('old PHP payload');
		const nextBytes = new TextEncoder().encode('new PHP payload');
		const harness = await createServiceWorkerHarness({ [originalPath]: originalBytes });

		expect((await harness.request(originalPath)).status).toBe(200);
		harness.setCompressedPayloads({
			[originalPath]: originalBytes,
			[nextPath]: nextBytes
		});

		const response = await harness.request(nextPath);
		expect(response.status).toBe(200);
		expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
			Array.from(nextBytes)
		);
		expect(
			harness.fetchMock.mock.calls.filter(
				([input]) => String(input) === `${scope}compressed-runtime-assets.v1.json`
			)
		).toHaveLength(2);
	});

	it('resolves manifest-listed logical assets regardless of their extension', async () => {
		const payloads = {
			'wasm-bash/bash.webc': new TextEncoder().encode('webc payload'),
			'wasm-nim/sysroot.tar': new TextEncoder().encode('tar payload'),
			'wasm-octave/octave_interpreter.qch': new TextEncoder().encode('qch payload'),
			'wasm-octave/doc-cache': new TextEncoder().encode('extensionless payload'),
			'_app/immutable/assets/runtime.1234.wasm': new TextEncoder().encode('wasm payload')
		};
		const harness = await createServiceWorkerHarness(payloads);

		for (const [assetPath, expectedBytes] of Object.entries(payloads)) {
			const response = await harness.request(assetPath);
			expect(response.status).toBe(200);
			expect(response.headers.get('content-length')).toBe(String(expectedBytes.byteLength));
			expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
				Array.from(expectedBytes)
			);
		}
		const requestedUrls = harness.fetchMock.mock.calls.map(([input]) => String(input));
		for (const assetPath of Object.keys(payloads)) {
			expect(requestedUrls).toContain(`${scope}${assetPath}.gz`);
		}
	});

	it('answers HEAD with the original content length without downloading the gzip body', async () => {
		const assetPath = 'wasm-octave/doc-cache';
		const payload = new TextEncoder().encode('octave documentation cache');
		const harness = await createServiceWorkerHarness({ [assetPath]: payload });

		const response = await harness.request(assetPath, { method: 'HEAD' });

		expect(response.status).toBe(200);
		expect(response.headers.get('content-length')).toBe(String(payload.byteLength));
		expect(await response.text()).toBe('');
		expect(
			harness.fetchMock.mock.calls
				.map(([input]) => String(input))
				.filter((url) => url.endsWith('.gz'))
		).toEqual([]);
	});

	it('serves multiple logical assets from one decompressed layer fetch', async () => {
		const firstBytes = new TextEncoder().encode('first object');
		const separator = new TextEncoder().encode('unused');
		const secondBytes = new TextEncoder().encode('second wasm');
		const layerBytes = new Uint8Array(
			firstBytes.byteLength + separator.byteLength + secondBytes.byteLength
		);
		layerBytes.set(firstBytes, 0);
		layerBytes.set(separator, firstBytes.byteLength);
		layerBytes.set(secondBytes, firstBytes.byteLength + separator.byteLength);
		const layerPath = '_runtime-layers/shared.bin.gz';
		const harness = await createServiceWorkerHarness(
			{},
			{
				assets: {
					'wasm-rust/runtime/first.a': {
						layer: layerPath,
						offset: 0,
						length: firstBytes.byteLength
					},
					'wasm-rust/runtime/second.wasm': {
						layer: layerPath,
						offset: firstBytes.byteLength + separator.byteLength,
						length: secondBytes.byteLength
					}
				},
				layers: { [layerPath]: { bytes: layerBytes } }
			}
		);

		const firstResponse = await harness.request('wasm-rust/runtime/first.a');
		const secondResponse = await harness.request('wasm-rust/runtime/second.wasm');

		expect(firstResponse.status).toBe(200);
		expect(firstResponse.headers.get('content-type')).toBe('application/octet-stream');
		expect(firstResponse.headers.get('content-length')).toBe(String(firstBytes.byteLength));
		expect(Array.from(new Uint8Array(await firstResponse.arrayBuffer()))).toEqual(
			Array.from(firstBytes)
		);
		expect(secondResponse.status).toBe(200);
		expect(secondResponse.headers.get('content-type')).toBe('application/wasm');
		expect(secondResponse.headers.get('content-length')).toBe(String(secondBytes.byteLength));
		expect(Array.from(new Uint8Array(await secondResponse.arrayBuffer()))).toEqual(
			Array.from(secondBytes)
		);
		expect(
			harness.fetchMock.mock.calls
				.map(([input]) => new URL(String(input)).pathname)
				.filter((pathname) => pathname === new URL(layerPath, scope).pathname)
		).toHaveLength(1);
	});

	it('answers layered HEAD requests from manifest metadata', async () => {
		const assetPath = 'wasm-runtime/runtime.js';
		const bytes = new TextEncoder().encode('runtime body');
		const layerPath = '_runtime-layers/head.bin.gz';
		const harness = await createServiceWorkerHarness(
			{},
			{
				assets: {
					[assetPath]: { layer: layerPath, offset: 4, length: bytes.byteLength }
				},
				layers: { [layerPath]: { bytes: new Uint8Array(4 + bytes.byteLength) } }
			}
		);

		const response = await harness.request(assetPath, { method: 'HEAD' });

		expect(response.status).toBe(200);
		expect(response.headers.get('accept-ranges')).toBe('bytes');
		expect(response.headers.get('content-type')).toBe('application/javascript');
		expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
		expect(await response.text()).toBe('');
		expect(
			harness.fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)
		).not.toContain(new URL(layerPath, scope).pathname);
	});

	it('serves a single byte range relative to the logical layered asset', async () => {
		const prefix = new TextEncoder().encode('layer-prefix');
		const bytes = new TextEncoder().encode('0123456789');
		const layerBytes = new Uint8Array(prefix.byteLength + bytes.byteLength);
		layerBytes.set(prefix);
		layerBytes.set(bytes, prefix.byteLength);
		const assetPath = 'wasm-runtime/data.bin';
		const layerPath = '_runtime-layers/range.bin.gz';
		const harness = await createServiceWorkerHarness(
			{},
			{
				assets: {
					[assetPath]: {
						layer: layerPath,
						offset: prefix.byteLength,
						length: bytes.byteLength
					}
				},
				layers: { [layerPath]: { bytes: layerBytes } }
			}
		);

		const response = await harness.request(assetPath, {
			headers: { range: 'bytes=2-5' }
		});

		expect(response.status).toBe(206);
		expect(response.headers.get('accept-ranges')).toBe('bytes');
		expect(response.headers.get('content-range')).toBe(`bytes 2-5/${bytes.byteLength}`);
		expect(response.headers.get('content-length')).toBe('4');
		expect(await response.text()).toBe('2345');
	});

	it('rejects invalid or multiple layered byte ranges without fetching the layer', async () => {
		const assetPath = 'wasm-runtime/data.bin';
		const layerPath = '_runtime-layers/invalid-range.bin.gz';
		const bytes = new TextEncoder().encode('0123456789');
		const harness = await createServiceWorkerHarness(
			{},
			{
				assets: {
					[assetPath]: { layer: layerPath, offset: 0, length: bytes.byteLength }
				},
				layers: { [layerPath]: { bytes } }
			}
		);

		for (const range of ['bytes=12-20', 'bytes=0-1,4-5']) {
			const response = await harness.request(assetPath, { headers: { range } });
			expect(response.status).toBe(416);
			expect(response.headers.get('content-range')).toBe(`bytes */${bytes.byteLength}`);
			expect(await response.text()).toBe('');
		}
		expect(
			harness.fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)
		).not.toContain(new URL(layerPath, scope).pathname);
	});

	it('refreshes layered manifests and cache-busts changed layer bytes', async () => {
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10_000);
		try {
			const assetPath = 'wasm-runtime/redeployed.wasm';
			const layerPath = '_runtime-layers/redeployed.bin.gz';
			const originalBytes = new TextEncoder().encode('old layer bytes');
			const nextBytes = new TextEncoder().encode('new layer bytes after deploy');
			const harness = await createServiceWorkerHarness(
				{},
				{
					assets: {
						[assetPath]: {
							layer: layerPath,
							offset: 0,
							length: originalBytes.byteLength
						}
					},
					layers: { [layerPath]: { bytes: originalBytes } }
				}
			);

			expect(await (await harness.request(assetPath)).text()).toBe('old layer bytes');
			harness.setLayeredFixtures({
				assets: {
					[assetPath]: { layer: layerPath, offset: 0, length: nextBytes.byteLength }
				},
				layers: { [layerPath]: { bytes: nextBytes } }
			});
			nowSpy.mockReturnValue(16_000);

			expect(await (await harness.request(assetPath)).text()).toBe(
				'new layer bytes after deploy'
			);
			const layerRequests = harness.fetchMock.mock.calls
				.map(([input]) => new URL(String(input)))
				.filter((url) => url.pathname === new URL(layerPath, scope).pathname);
			expect(layerRequests).toHaveLength(2);
			expect(layerRequests[0]?.searchParams.get('__wasm_idle_layer')).not.toBe(
				layerRequests[1]?.searchParams.get('__wasm_idle_layer')
			);
		} finally {
			nowSpy.mockRestore();
		}
	});

	it('uses layer bodies that fetch has already content-decoded', async () => {
		const assetPath = 'wasm-runtime/decoded.json';
		const bytes = new TextEncoder().encode('{"decoded":true}');
		const layerPath = '_runtime-layers/decoded.bin.gz';
		const harness = await createServiceWorkerHarness(
			{},
			{
				assets: {
					[assetPath]: { layer: layerPath, offset: 0, length: bytes.byteLength }
				},
				layers: {
					[layerPath]: {
						bytes,
						contentDecoded: true
					}
				}
			}
		);

		const response = await harness.request(assetPath);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/json');
		expect(await response.text()).toBe('{"decoded":true}');
	});
});
