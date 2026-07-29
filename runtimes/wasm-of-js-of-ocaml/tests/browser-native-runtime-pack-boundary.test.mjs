import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
	fetchBrowserNativeManifest,
	loadBrowserNativeRuntimePack
} from '../runtime/system-dispatch-browser-worker.ts';

const BASE_URL = 'https://assets.example.test/runtime/';
const INDEX_URL = new URL('pack.index.json', BASE_URL).href;
const ASSET_URL = new URL('pack.bin.gz', BASE_URL).href;
const PLACEHOLDER_SHA256 = '0'.repeat(64);
const SAFE_REQUEST_INIT = {
	cache: 'no-store',
	credentials: 'omit',
	redirect: 'error',
	referrerPolicy: 'no-referrer'
};

function createManifest(files, runtimePackOverrides = {}) {
	return {
		version: 1,
		generatedAt: '2026-07-29T00:00:00.000Z',
		switchPrefix: '/switch',
		findlibConf: '/static/toolchain/findlib.conf',
		tools: {
			ocamlc: '/tools/ocamlc.js',
			js_of_ocaml: '/tools/js_of_ocaml.js',
			wasm_of_ocaml: '/tools/wasm_of_ocaml.js'
		},
		runtimePack: {
			format: 'wasm-of-js-of-ocaml-browser-native-runtime-pack-v1',
			asset: 'pack.bin.gz',
			index: 'pack.index.json',
			indexBytes: 1,
			indexSha256: PLACEHOLDER_SHA256,
			compressedBytes: 1,
			compressedSha256: PLACEHOLDER_SHA256,
			fileCount: files.length,
			totalBytes: files.reduce((total, file) => total + file.size, 0),
			uncompressedSha256: PLACEHOLDER_SHA256,
			...runtimePackOverrides
		},
		ocamlLibFiles: files,
		packages: []
	};
}

function createIndex(files) {
	let offset = 0;
	const entries = files.map((file) => {
		const entry = {
			runtimePath: file.path,
			offset,
			length: file.size
		};
		offset += file.size;
		return entry;
	});
	return {
		format: 'wasm-of-js-of-ocaml-browser-native-runtime-pack-index-v1',
		fileCount: entries.length,
		totalBytes: offset,
		entries
	};
}

function createResponse(body, url, contentLength = body.byteLength) {
	const response = new Response(body, {
		headers: { 'content-length': String(contentLength) }
	});
	Object.defineProperty(response, 'url', { value: url });
	return response;
}

function createFetch(responses, calls) {
	return async (input, init) => {
		const url = String(input);
		calls.push({ url, init });
		const response = responses.get(url);
		assert.ok(response, `unexpected fetch: ${url}`);
		return typeof response === 'function' ? response() : response;
	};
}

function encodeJson(value) {
	return new TextEncoder().encode(JSON.stringify(value));
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
}

function createRuntimePackReceipts(indexBytes, compressedBytes, uncompressedBytes) {
	return {
		indexBytes: indexBytes.byteLength,
		indexSha256: sha256(indexBytes),
		compressedBytes: compressedBytes.byteLength,
		compressedSha256: sha256(compressedBytes),
		uncompressedSha256: sha256(uncompressedBytes)
	};
}

test('loads a gzip runtime pack through bounded exact-URL requests', async () => {
	const files = [
		{ path: '/static/toolchain/lib/ocaml/a.cmi', size: 2 },
		{ path: '/static/toolchain/lib/ocaml/b.cma', size: 3 }
	];
	const indexBytes = encodeJson(createIndex(files));
	const payload = new Uint8Array([1, 2, 3, 4, 5]);
	const compressed = gzipSync(payload);
	const manifest = createManifest(
		files,
		createRuntimePackReceipts(indexBytes, compressed, payload)
	);
	const calls = [];
	const fetcher = createFetch(
		new Map([
			[INDEX_URL, createResponse(indexBytes, INDEX_URL)],
			[ASSET_URL, createResponse(compressed, ASSET_URL)]
		]),
		calls
	);

	const loaded = await loadBrowserNativeRuntimePack(manifest, {
		baseUrl: BASE_URL,
		fetch: fetcher,
		limits: {
			maxAssetBytes: 64,
			maxMetadataBytes: 1024,
			maxEntries: 4,
			maxEntryBytes: 16,
			maxPathBytes: 128
		}
	});

	assert.ok(loaded);
	assert.deepEqual([...loaded.bytes], [...payload]);
	assert.deepEqual(
		[...loaded.entries],
		[
			['/static/toolchain/lib/ocaml/a.cmi', { offset: 0, length: 2 }],
			['/static/toolchain/lib/ocaml/b.cma', { offset: 2, length: 3 }]
		]
	);
	assert.deepEqual(
		calls.map(({ url }) => url),
		[INDEX_URL, ASSET_URL]
	);
	for (const { init } of calls) assert.deepEqual(init, SAFE_REQUEST_INIT);
});

test('rejects invalid runtime-pack metadata before issuing a request', async () => {
	const files = [{ path: '/static/toolchain/lib/ocaml/a.cmi', size: 9 }];
	let fetchCount = 0;
	const fetcher = async () => {
		fetchCount += 1;
		throw new Error('unexpected fetch');
	};

	await assert.rejects(
		loadBrowserNativeRuntimePack(createManifest(files), {
			baseUrl: BASE_URL,
			fetch: fetcher,
			limits: { maxAssetBytes: 8 }
		}),
		/invalid or oversized expanded size/
	);
	await assert.rejects(
		loadBrowserNativeRuntimePack(createManifest(files), {
			baseUrl: BASE_URL,
			fetch: fetcher,
			limits: { maxAssetBytes: 16, maxEntryBytes: 8 }
		}),
		/entry .* exceeds the 8 byte limit/
	);
	const missingReceipt = createManifest(files);
	delete missingReceipt.runtimePack.indexSha256;
	await assert.rejects(
		loadBrowserNativeRuntimePack(missingReceipt, {
			baseUrl: BASE_URL,
			fetch: fetcher
		}),
		/invalid browser-native runtime pack metadata/
	);
	assert.equal(fetchCount, 0);
});

test('rejects corrupt runtime-pack integrity stages', async (t) => {
	const files = [{ path: '/static/toolchain/lib/ocaml/a.cmi', size: 4 }];
	const indexBytes = encodeJson(createIndex(files));
	const payload = new Uint8Array([1, 2, 3, 4]);
	const compressed = gzipSync(payload);
	const receipts = createRuntimePackReceipts(indexBytes, compressed, payload);

	await t.test('index', async () => {
		const fetcher = createFetch(
			new Map([[INDEX_URL, createResponse(indexBytes, INDEX_URL)]]),
			[]
		);
		await assert.rejects(
			loadBrowserNativeRuntimePack(
				createManifest(files, { ...receipts, indexSha256: PLACEHOLDER_SHA256 }),
				{ baseUrl: BASE_URL, fetch: fetcher }
			),
			/browser-native runtime pack index SHA-256 mismatch/
		);
	});

	await t.test('compressed asset', async () => {
		const fetcher = createFetch(
			new Map([
				[INDEX_URL, createResponse(indexBytes, INDEX_URL)],
				[ASSET_URL, createResponse(compressed, ASSET_URL)]
			]),
			[]
		);
		await assert.rejects(
			loadBrowserNativeRuntimePack(
				createManifest(files, { ...receipts, compressedSha256: PLACEHOLDER_SHA256 }),
				{ baseUrl: BASE_URL, fetch: fetcher }
			),
			/browser-native runtime pack compressed asset SHA-256 mismatch/
		);
	});

	await t.test('expanded payload', async () => {
		const fetcher = createFetch(
			new Map([
				[INDEX_URL, createResponse(indexBytes, INDEX_URL)],
				[ASSET_URL, createResponse(compressed, ASSET_URL)]
			]),
			[]
		);
		await assert.rejects(
			loadBrowserNativeRuntimePack(
				createManifest(files, { ...receipts, uncompressedSha256: PLACEHOLDER_SHA256 }),
				{ baseUrl: BASE_URL, fetch: fetcher }
			),
			/browser-native runtime pack expanded payload SHA-256 mismatch/
		);
	});
});

test('rejects malformed or manifest-inconsistent runtime-pack indexes', async (t) => {
	const files = [
		{ path: '/static/toolchain/lib/ocaml/a.cmi', size: 2 },
		{ path: '/static/toolchain/lib/ocaml/b.cma', size: 3 }
	];
	const cases = [
		{
			name: 'unsafe path',
			mutate(index) {
				index.entries[0].runtimePath = '/static/toolchain/../escape';
			},
			pattern: /unsafe browser-native runtime pack path/
		},
		{
			name: 'duplicate path',
			mutate(index) {
				index.entries[1].runtimePath = index.entries[0].runtimePath;
				index.entries[1].length = index.entries[0].length;
			},
			pattern: /duplicate browser-native runtime pack path/
		},
		{
			name: 'fractional offset',
			mutate(index) {
				index.entries[0].offset = 0.5;
			},
			pattern: /invalid browser-native runtime pack entry/
		},
		{
			name: 'unknown manifest path',
			mutate(index) {
				index.entries[0].runtimePath = '/static/toolchain/lib/ocaml/other.cmi';
			},
			pattern: /entry does not match the manifest/
		},
		{
			name: 'manifest size mismatch',
			mutate(index) {
				index.entries[0].length -= 1;
			},
			pattern: /entry does not match the manifest/
		},
		{
			name: 'gap',
			mutate(index) {
				index.entries[1].offset += 1;
			},
			pattern: /entry is not contiguous/
		},
		{
			name: 'overlap',
			mutate(index) {
				index.entries[1].offset -= 1;
			},
			pattern: /entry is not contiguous/
		}
	];

	for (const testCase of cases) {
		await t.test(testCase.name, async () => {
			const index = createIndex(files);
			testCase.mutate(index);
			const indexBytes = encodeJson(index);
			let fetchCount = 0;
			const fetcher = async (input) => {
				fetchCount += 1;
				assert.equal(String(input), INDEX_URL);
				return createResponse(indexBytes, INDEX_URL);
			};

			await assert.rejects(
				loadBrowserNativeRuntimePack(
					createManifest(files, {
						indexBytes: indexBytes.byteLength,
						indexSha256: sha256(indexBytes)
					}),
					{
						baseUrl: BASE_URL,
						fetch: fetcher,
						limits: { maxAssetBytes: 64, maxMetadataBytes: 1024 }
					}
				),
				testCase.pattern
			);
			assert.equal(fetchCount, 1);
		});
	}
});

test('stops gzip expansion at the exact manifest size', async () => {
	const files = [{ path: '/static/toolchain/lib/ocaml/a.cmi', size: 4 }];
	const indexBytes = encodeJson(createIndex(files));
	const expectedPayload = new Uint8Array([1, 2, 3, 4]);
	const compressed = gzipSync(new Uint8Array([...expectedPayload, 5]));
	const fetcher = createFetch(
		new Map([
			[INDEX_URL, createResponse(indexBytes, INDEX_URL)],
			[ASSET_URL, createResponse(compressed, ASSET_URL)]
		]),
		[]
	);

	await assert.rejects(
		loadBrowserNativeRuntimePack(
			createManifest(
				files,
				createRuntimePackReceipts(indexBytes, compressed, expectedPayload)
			),
			{
				baseUrl: BASE_URL,
				fetch: fetcher,
				limits: { maxAssetBytes: 64, maxMetadataBytes: 1024 }
			}
		),
		/browser-native runtime pack expanded payload exceeds the 4 byte limit/
	);
});

test('cancels a streamed runtime-pack download that exceeds its delivery limit', async () => {
	const files = [{ path: '/static/toolchain/lib/ocaml/a.cmi', size: 4 }];
	const indexBytes = encodeJson(createIndex(files));
	let cancelled = false;
	const oversizedStream = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(5));
			controller.enqueue(new Uint8Array(4));
		},
		cancel() {
			cancelled = true;
		}
	});
	const oversizedResponse = new Response(oversizedStream);
	Object.defineProperty(oversizedResponse, 'url', { value: ASSET_URL });
	const fetcher = createFetch(
		new Map([
			[INDEX_URL, createResponse(indexBytes, INDEX_URL)],
			[ASSET_URL, oversizedResponse]
		]),
		[]
	);

	await assert.rejects(
		loadBrowserNativeRuntimePack(
			createManifest(files, {
				indexBytes: indexBytes.byteLength,
				indexSha256: sha256(indexBytes),
				compressedBytes: 8,
				uncompressedSha256: sha256(new Uint8Array([1, 2, 3, 4]))
			}),
			{
				baseUrl: BASE_URL,
				fetch: fetcher,
				limits: { maxAssetBytes: 8, maxMetadataBytes: 1024 }
			}
		),
		/browser-native runtime pack asset exceeds the 8 byte limit/
	);
	assert.equal(cancelled, true);
});

test('bounds manifest metadata and rejects substituted final URLs', async () => {
	const oversizedBody = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(5));
		}
	});
	const oversizedResponse = new Response(oversizedBody);
	const manifestUrl = new URL(
		'/.cache/browser-native-bundle/browser-native-manifest.v1.json',
		BASE_URL
	).href;
	Object.defineProperty(oversizedResponse, 'url', { value: manifestUrl });

	await assert.rejects(
		fetchBrowserNativeManifest({
			baseUrl: BASE_URL,
			fetch: async () => oversizedResponse,
			limits: { maxMetadataBytes: 4 }
		}),
		/browser-native runtime manifest exceeds the 4 byte limit/
	);

	const substituted = createResponse(encodeJson({}), 'https://other.example.test/manifest.json');
	await assert.rejects(
		fetchBrowserNativeManifest({
			baseUrl: BASE_URL,
			fetch: async () => substituted
		}),
		/final URL mismatch/
	);
});

test('does not fetch a runtime pack when the caller is already aborted', async () => {
	const controller = new AbortController();
	const reason = new Error('stop loading');
	controller.abort(reason);
	let fetchCount = 0;

	await assert.rejects(
		loadBrowserNativeRuntimePack(
			createManifest([{ path: '/static/toolchain/lib/ocaml/a.cmi', size: 1 }]),
			{
				baseUrl: BASE_URL,
				fetch: async () => {
					fetchCount += 1;
					throw new Error('unexpected fetch');
				},
				signal: controller.signal
			}
		),
		reason
	);
	assert.equal(fetchCount, 0);
});
