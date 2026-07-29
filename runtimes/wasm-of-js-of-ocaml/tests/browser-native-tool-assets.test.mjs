import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	accountBrowserToolInputBytes,
	createBrowserToolInputBudget,
	decodeBrowserToolSource,
	fetchBrowserToolAsset
} from '../runtime/browser-native-tool-assets.ts';

const BASE_URL = 'https://assets.example.test/runtime/';

function responseWithUrl(body, url, headers = {}) {
	const response = new Response(body, { headers });
	Object.defineProperty(response, 'url', { value: url });
	return response;
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

test('loads browser-native tool inputs through a bounded exact-URL request', async () => {
	const expectedUrl = new URL('tools/ocamlc.js', BASE_URL).href;
	const source = new TextEncoder().encode('tool');
	const calls = [];
	const budget = createBrowserToolInputBudget({ maxAssetBytes: 8, maxTotalBytes: 16 });
	const loaded = await fetchBrowserToolAsset('tools/ocamlc.js', 'OCaml tool', budget, {
		baseUrl: BASE_URL,
		cache: 'force-cache',
		receipt: { bytes: source.byteLength, sha256: sha256(source) },
		fetch: async (input, init) => {
			calls.push({ input: String(input), init });
			return responseWithUrl(source, expectedUrl, {
				'content-length': String(source.byteLength)
			});
		}
	});

	assert.deepEqual([...loaded], [...source]);
	assert.equal(budget.usedBytes, source.byteLength);
	assert.deepEqual(calls, [
		{
			input: expectedUrl,
			init: {
				cache: 'force-cache',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			}
		}
	]);
});

test('rejects browser-native tool receipt size mismatches before reading', async () => {
	let readerRequested = false;
	let cancelled = false;
	const assetUrl = new URL('tools/substituted.js', BASE_URL).href;
	const response = {
		url: assetUrl,
		ok: true,
		status: 200,
		headers: new Headers({ 'content-length': '5' }),
		body: {
			async cancel() {
				cancelled = true;
			},
			getReader() {
				readerRequested = true;
				throw new Error('mismatched body should not be read');
			}
		}
	};

	await assert.rejects(
		fetchBrowserToolAsset(assetUrl, 'OCaml tool', createBrowserToolInputBudget(), {
			fetch: async () => response,
			receipt: { bytes: 4, sha256: sha256(new Uint8Array(4)) }
		}),
		/size mismatch: expected 4 bytes, received 5/
	);
	assert.equal(readerRequested, false);
	assert.equal(cancelled, true);
});

test('rejects truncated and hash-mismatched browser-native tool assets', async () => {
	const assetUrl = new URL('tools/ocamlc.js', BASE_URL).href;
	const expected = new TextEncoder().encode('tool');

	await assert.rejects(
		fetchBrowserToolAsset(assetUrl, 'OCaml tool', createBrowserToolInputBudget(), {
			fetch: async () => responseWithUrl(expected.subarray(0, 3), assetUrl),
			receipt: { bytes: expected.byteLength, sha256: sha256(expected) }
		}),
		/size mismatch: expected 4 bytes, received 3/
	);

	await assert.rejects(
		fetchBrowserToolAsset(assetUrl, 'OCaml tool', createBrowserToolInputBudget(), {
			fetch: async () => responseWithUrl(new TextEncoder().encode('evil'), assetUrl),
			receipt: { bytes: expected.byteLength, sha256: sha256(expected) }
		}),
		/SHA-256 mismatch/
	);
});

test('rejects unsafe browser-native tool asset URLs before fetching', async () => {
	let fetchCount = 0;
	const fetcher = async () => {
		fetchCount += 1;
		throw new Error('unexpected fetch');
	};

	for (const value of [
		'data:text/javascript,alert(1)',
		'https://user:secret@assets.example.test/tool.js',
		'https://assets.example.test/tool.js#fragment'
	]) {
		await assert.rejects(
			fetchBrowserToolAsset(value, 'OCaml tool', createBrowserToolInputBudget(), {
				baseUrl: BASE_URL,
				fetch: fetcher
			}),
			/browser-native tool asset URL/
		);
	}
	assert.equal(fetchCount, 0);
});

test('rejects a declared per-asset overflow before reading the response body', async () => {
	let readerRequested = false;
	let cancelled = false;
	const assetUrl = new URL('tools/oversized.js', BASE_URL).href;
	const response = {
		url: assetUrl,
		ok: true,
		status: 200,
		headers: new Headers({ 'content-length': '9' }),
		body: {
			async cancel() {
				cancelled = true;
			},
			getReader() {
				readerRequested = true;
				throw new Error('oversized body should not be read');
			}
		}
	};

	await assert.rejects(
		fetchBrowserToolAsset(
			assetUrl,
			'OCaml tool',
			createBrowserToolInputBudget({ maxAssetBytes: 8, maxTotalBytes: 16 }),
			{ fetch: async () => response }
		),
		/exceeds the 8 byte asset limit/
	);
	assert.equal(readerRequested, false);
	assert.equal(cancelled, true);
});

test('cancels an unknown-length stream that crosses the aggregate input budget', async () => {
	let pullCount = 0;
	let cancelled = false;
	const assetUrl = new URL('preload.cma', BASE_URL).href;
	const budget = createBrowserToolInputBudget({ maxAssetBytes: 5, maxTotalBytes: 5 });
	accountBrowserToolInputBytes(budget, 'inline preload', 3);
	const response = responseWithUrl(
		new ReadableStream({
			pull(controller) {
				pullCount += 1;
				controller.enqueue(new Uint8Array(pullCount === 1 ? [1, 2] : [3]));
			},
			cancel() {
				cancelled = true;
			}
		}),
		assetUrl
	);

	await assert.rejects(
		fetchBrowserToolAsset(assetUrl, 'OCaml preload', budget, {
			fetch: async () => response
		}),
		/exceed the 5 byte aggregate limit/
	);
	assert.equal(cancelled, true);
});

test('rejects substituted final URLs and invalid UTF-8 tool sources', async () => {
	let cancelled = false;
	const requestedUrl = new URL('tool.js', BASE_URL).href;
	const response = responseWithUrl(
		new ReadableStream({
			cancel() {
				cancelled = true;
			}
		}),
		new URL('other.js', BASE_URL).href
	);

	await assert.rejects(
		fetchBrowserToolAsset(
			requestedUrl,
			'OCaml tool',
			createBrowserToolInputBudget({ maxAssetBytes: 8, maxTotalBytes: 16 }),
			{ fetch: async () => response }
		),
		/final URL mismatch/
	);
	assert.equal(cancelled, true);

	let invalidUrlCancelled = false;
	await assert.rejects(
		fetchBrowserToolAsset(
			requestedUrl,
			'OCaml tool',
			createBrowserToolInputBudget({ maxAssetBytes: 8, maxTotalBytes: 16 }),
			{
				fetch: async () => ({
					url: 'http://[',
					ok: true,
					status: 200,
					headers: new Headers(),
					body: {
						async cancel() {
							invalidUrlCancelled = true;
						}
					}
				})
			}
		),
		/invalid final URL/
	);
	assert.equal(invalidUrlCancelled, true);
	assert.throws(
		() => decodeBrowserToolSource(new Uint8Array([0xc3, 0x28]), 'OCaml tool'),
		/not valid UTF-8/
	);
});

test('rejects relative browser-native tool response URLs before reading', async () => {
	let readerRequested = false;
	let cancelled = false;
	const requestedUrl = new URL('tool.js', BASE_URL).href;

	await assert.rejects(
		fetchBrowserToolAsset(
			requestedUrl,
			'OCaml tool',
			createBrowserToolInputBudget({ maxAssetBytes: 8, maxTotalBytes: 16 }),
			{
				fetch: async () => ({
					url: 'tool.js',
					ok: true,
					status: 200,
					headers: new Headers(),
					body: {
						async cancel() {
							cancelled = true;
						},
						getReader() {
							readerRequested = true;
							throw new Error('relative response body should not be read');
						}
					}
				})
			}
		),
		/invalid final URL/
	);
	assert.equal(readerRequested, false);
	assert.equal(cancelled, true);
});
