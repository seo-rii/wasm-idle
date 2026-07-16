import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

const serviceWorkerPath = path.resolve('static/worker.js');
const scope = 'https://example.com/wasm-idle/';

async function createServiceWorkerHarness(payloads: Record<string, Uint8Array>) {
	const source = await readFile(serviceWorkerPath, 'utf8');
	const listeners = new Map<string, Array<(event: any) => void>>();
	const manifest = {
		assets: Object.keys(payloads),
		sizes: Object.fromEntries(
			Object.entries(payloads).map(([assetPath, bytes]) => [assetPath, bytes.byteLength])
		)
	};
	const fetchMock = vi.fn(async (input: unknown) => {
		const url =
			input instanceof Request
				? new URL(input.url)
				: input instanceof URL
					? input
					: new URL(String(input));
		if (url.href === `${scope}compressed-runtime-assets.v1.json`) {
			return new Response(JSON.stringify(manifest), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		const relativePath = url.pathname.slice(new URL(scope).pathname.length);
		if (relativePath.endsWith('.gz')) {
			const payload = payloads[relativePath.slice(0, -'.gz'.length)];
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
		async request(relativePath: string, init?: RequestInit) {
			let responsePromise: Promise<Response> | undefined;
			fetchListener({
				request: new Request(new URL(relativePath, scope), init),
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
		expect(harness.fetchMock).toHaveBeenCalledTimes(1);
	});
});
