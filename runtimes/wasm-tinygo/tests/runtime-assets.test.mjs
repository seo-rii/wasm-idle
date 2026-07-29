import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

import {
	clearTinyGoRuntimePackCache,
	loadRuntimeAssetBytes,
	MAX_TINYGO_RUNTIME_PACK_FILES,
	parseTinyGoRuntimePackIndex
} from '../src/runtime-assets.ts';

function streamedResponse(chunks, headers = {}) {
	const stream = new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		}
	});
	return new Response(stream, { headers });
}

test('parseTinyGoRuntimePackIndex validates the index payload', () => {
	const index = parseTinyGoRuntimePackIndex({
		format: 'wasm-tinygo-runtime-pack-index-v1',
		fileCount: 1,
		totalBytes: 3,
		entries: [
			{
				runtimePath: 'tools/go-probe.wasm',
				offset: 0,
				length: 3
			}
		]
	});

	assert.equal(index.fileCount, 1);
	assert.equal(index.entries[0].runtimePath, 'tools/go-probe.wasm');
});

test('parseTinyGoRuntimePackIndex rejects unsafe and ambiguous runtime paths', () => {
	const unsafePaths = [
		'../escape.wasm',
		'/absolute.wasm',
		'tools//probe.wasm',
		'tools/./probe.wasm',
		'tools/../probe.wasm',
		'tools\\probe.wasm',
		'tools/%2e%2e/probe.wasm',
		'https://assets.invalid/probe.wasm',
		'tools/probe.wasm?download=1',
		'tools/probe.wasm#fragment',
		'tools/probe.wasm\0suffix'
	];

	for (const runtimePath of unsafePaths) {
		assert.throws(
			() =>
				parseTinyGoRuntimePackIndex({
					format: 'wasm-tinygo-runtime-pack-index-v1',
					fileCount: 1,
					totalBytes: 1,
					entries: [{ runtimePath, offset: 0, length: 1 }]
				}),
			/runtimePath/
		);
	}

	const rustIndex = parseTinyGoRuntimePackIndex({
		format: 'wasm-rust-runtime-pack-index-v1',
		fileCount: 1,
		totalBytes: 1,
		entries: [{ runtimePath: '/lib/rustlib/libstd.rlib', offset: 0, length: 1 }]
	});
	assert.equal(rustIndex.entries[0].runtimePath, '/lib/rustlib/libstd.rlib');
});

test('parseTinyGoRuntimePackIndex rejects unsafe counts and byte ranges', () => {
	assert.throws(
		() =>
			parseTinyGoRuntimePackIndex({
				format: 'wasm-tinygo-runtime-pack-index-v1',
				fileCount: MAX_TINYGO_RUNTIME_PACK_FILES + 1,
				totalBytes: 0,
				entries: new Array(MAX_TINYGO_RUNTIME_PACK_FILES + 1).fill(null)
			}),
		/exceeds/
	);
	assert.throws(
		() =>
			parseTinyGoRuntimePackIndex({
				format: 'wasm-tinygo-runtime-pack-index-v1',
				fileCount: 1,
				totalBytes: Number.MAX_SAFE_INTEGER + 1,
				entries: [{ runtimePath: 'tools/probe.wasm', offset: 0, length: 1 }]
			}),
		/root\.totalBytes/
	);
	assert.throws(
		() =>
			parseTinyGoRuntimePackIndex({
				format: 'wasm-tinygo-runtime-pack-index-v1',
				fileCount: 1,
				totalBytes: 1,
				entries: [
					{
						runtimePath: 'tools/probe.wasm',
						offset: Number.MAX_SAFE_INTEGER + 1,
						length: 0
					}
				]
			}),
		/root\.entries\[0\]\.offset/
	);

	const invalidLayouts = [
		{
			totalBytes: 3,
			entries: [{ runtimePath: 'tools/gap.wasm', offset: 1, length: 2 }]
		},
		{
			totalBytes: 3,
			entries: [
				{ runtimePath: 'tools/first.wasm', offset: 0, length: 2 },
				{ runtimePath: 'tools/overlap.wasm', offset: 1, length: 2 }
			]
		},
		{
			totalBytes: 3,
			entries: [{ runtimePath: 'tools/trailing.wasm', offset: 0, length: 2 }]
		},
		{
			totalBytes: 3,
			entries: [{ runtimePath: 'tools/overflow.wasm', offset: 0, length: 4 }]
		}
	];
	for (const layout of invalidLayouts) {
		assert.throws(
			() =>
				parseTinyGoRuntimePackIndex({
					format: 'wasm-tinygo-runtime-pack-index-v1',
					fileCount: layout.entries.length,
					totalBytes: layout.totalBytes,
					entries: layout.entries
				}),
			/invalid (runtime pack range|root\.totalBytes)/
		);
	}
});

test('loadRuntimeAssetBytes returns packed runtime assets before hitting the network', async () => {
	clearTinyGoRuntimePackCache();
	const packBytes = new Uint8Array([1, 2, 3, 4]);
	const packIndex = {
		format: 'wasm-tinygo-runtime-pack-index-v1',
		fileCount: 1,
		totalBytes: 4,
		entries: [
			{
				runtimePath: 'tools/go-probe.wasm',
				offset: 0,
				length: 4
			}
		]
	};
	const requests = [];
	const progressEvents = [];
	const fetchImpl = async (url) => {
		requests.push(String(url));
		if (String(url).endsWith('pack.index.json')) {
			const text = JSON.stringify(packIndex);
			const encoded = new TextEncoder().encode(text);
			return streamedResponse([encoded.slice(0, 12), encoded.slice(12)], {
				'content-length': String(encoded.byteLength)
			});
		}
		if (String(url).endsWith('pack.bin')) {
			return streamedResponse([packBytes.slice(0, 2), packBytes.slice(2)], {
				'content-length': String(packBytes.byteLength)
			});
		}
		throw new Error(`unexpected fetch ${url}`);
	};

	const bytes = await loadRuntimeAssetBytes({
		assetPath: 'tools/go-probe.wasm',
		assetUrl: 'http://assets.invalid/tools/go-probe.wasm',
		assetBaseUrl: 'http://assets.invalid/',
		label: 'go-probe.wasm',
		packs: [
			{
				index: 'pack.index.json',
				asset: 'pack.bin',
				fileCount: 1,
				totalBytes: 4
			}
		],
		fetchImpl,
		onProgress: (progress) => {
			progressEvents.push(progress);
		}
	});

	assert.deepEqual([...bytes], [1, 2, 3, 4]);
	assert.deepEqual(requests, [
		'http://assets.invalid/pack.index.json',
		'http://assets.invalid/pack.bin'
	]);
	assert.equal(progressEvents.length >= 2, true);
	assert.equal(
		progressEvents.some((progress) => progress.loaded === 4 && progress.total === 4),
		true
	);
	assert.equal(
		progressEvents.some((progress) => progress.label.includes('runtime pack index')),
		true
	);
	assert.equal(
		progressEvents.some((progress) => progress.label.includes('runtime pack pack.bin')),
		true
	);
	clearTinyGoRuntimePackCache();
});

test('loadRuntimeAssetBytes requires exact runtime pack payload length', async () => {
	clearTinyGoRuntimePackCache();
	const packIndex = new TextEncoder().encode(
		JSON.stringify({
			format: 'wasm-tinygo-runtime-pack-index-v1',
			fileCount: 1,
			totalBytes: 1,
			entries: [{ runtimePath: 'tools/go-probe.wasm', offset: 0, length: 1 }]
		})
	);
	const fetchImpl = async (url) =>
		new Response(String(url).endsWith('pack.index.json') ? packIndex : new Uint8Array([1, 2]));

	await assert.rejects(
		loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
			assetBaseUrl: 'https://assets.invalid/',
			label: 'go-probe.wasm',
			packs: [
				{
					index: 'pack.index.json',
					asset: 'pack.bin',
					fileCount: 1,
					totalBytes: 1
				}
			],
			fetchImpl
		}),
		/expected exactly 1 bytes but got 2/
	);
	clearTinyGoRuntimePackCache();
});

test('loadRuntimeAssetBytes rejects invalid runtime pack references before fetching', async () => {
	let fetchCount = 0;

	await assert.rejects(
		loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
			assetBaseUrl: 'https://assets.invalid/',
			label: 'go-probe.wasm',
			packs: [
				{
					index: 'pack.index.json',
					asset: 'pack.bin',
					fileCount: 1.5,
					totalBytes: 1
				}
			],
			fetchImpl: async () => {
				fetchCount += 1;
				return new Response(new Uint8Array());
			}
		}),
		/invalid wasm-tinygo runtime pack fileCount/
	);
	await assert.rejects(
		loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
			assetBaseUrl: 'https://assets.invalid/',
			label: 'go-probe.wasm',
			packs: [{ index: '', asset: 'pack.bin', fileCount: 1, totalBytes: 1 }],
			fetchImpl: async () => {
				fetchCount += 1;
				return new Response(new Uint8Array());
			}
		}),
		/invalid wasm-tinygo runtime pack index reference/
	);
	assert.equal(fetchCount, 0);
});

test('loadRuntimeAssetBytes respects loader overrides', async () => {
	let fetchedUrl = null;
	let fetchOptions = null;
	const controller = new AbortController();
	const fetchImpl = async (url, options) => {
		fetchedUrl = String(url);
		fetchOptions = options;
		return new Response(new Uint8Array([9, 9]));
	};

	const bytes = await loadRuntimeAssetBytes({
		assetPath: 'tools/go-probe.wasm',
		assetUrl: 'http://assets.invalid/tools/go-probe.wasm',
		assetBaseUrl: 'http://assets.invalid/',
		label: 'go-probe.wasm',
		loader: async ({ signal }) => {
			assert.equal(signal, controller.signal);
			return 'http://assets.invalid/override/go-probe.wasm';
		},
		signal: controller.signal,
		fetchImpl
	});

	assert.deepEqual([...bytes], [9, 9]);
	assert.equal(fetchedUrl, 'http://assets.invalid/override/go-probe.wasm');
	assert.deepEqual(fetchOptions, {
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer',
		signal: controller.signal
	});
});

test('loadRuntimeAssetBytes accepts loader-provided bytes without fetching', async () => {
	let fetched = false;
	const fetchImpl = async () => {
		fetched = true;
		return new Response(new Uint8Array([1]));
	};

	const bytes = await loadRuntimeAssetBytes({
		assetPath: 'tools/go-probe.wasm',
		assetUrl: 'http://assets.invalid/tools/go-probe.wasm',
		assetBaseUrl: 'http://assets.invalid/',
		label: 'go-probe.wasm',
		loader: async () => new Uint8Array([7, 8, 9]),
		fetchImpl
	});

	assert.deepEqual([...bytes], [7, 8, 9]);
	assert.equal(fetched, false);
});

test('loadRuntimeAssetBytes reports byte progress for streamed direct fetches', async () => {
	const progressEvents = [];
	const fetchImpl = async () =>
		streamedResponse([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])], {
			'content-length': '5'
		});

	const bytes = await loadRuntimeAssetBytes({
		assetPath: 'tools/go-probe.wasm',
		assetUrl: 'http://assets.invalid/tools/go-probe.wasm',
		assetBaseUrl: 'http://assets.invalid/',
		label: 'go-probe.wasm',
		fetchImpl,
		onProgress: (progress) => {
			progressEvents.push(progress);
		}
	});

	assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
	assert.equal(progressEvents.length >= 2, true);
	assert.equal(progressEvents[0].loaded, 2);
	assert.equal(progressEvents.at(-1).loaded, 5);
	assert.equal(progressEvents.at(-1).total, 5);
});

test('loadRuntimeAssetBytes rejects unsafe URLs before fetching', async () => {
	let fetchCount = 0;
	const fetchImpl = async () => {
		fetchCount += 1;
		return new Response(new Uint8Array([1]));
	};
	const baseOptions = {
		assetPath: 'tools/go-probe.wasm',
		label: 'go-probe.wasm',
		fetchImpl
	};

	await assert.rejects(
		loadRuntimeAssetBytes({
			...baseOptions,
			assetUrl: 'https://user:password@assets.invalid/tools/go-probe.wasm'
		}),
		/URLs must not include credentials/
	);
	await assert.rejects(
		loadRuntimeAssetBytes({
			...baseOptions,
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm#subresource'
		}),
		/URLs must not include fragments/
	);
	assert.equal(fetchCount, 0);
});

test('loadRuntimeAssetBytes rejects substituted final URLs and cancels the body', async () => {
	let cancelled = false;
	const secret = 'signed-query-secret';
	const body = new ReadableStream({
		pull(controller) {
			controller.enqueue(new Uint8Array([1]));
		},
		cancel() {
			cancelled = true;
		}
	});
	const response = new Response(body);
	Object.defineProperty(response, 'url', {
		value: `https://runtime-user:password@mirror.invalid/tools/go-probe.wasm?signature=${secret}#access-token`
	});

	await assert.rejects(
		loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
			label: 'go-probe.wasm',
			fetchImpl: async () => response
		}),
		(error) => {
			assert.equal(
				error.message,
				'wasm-tinygo runtime asset go-probe.wasm returned an unexpected final URL'
			);
			assert.equal(error.message.includes(secret), false);
			assert.equal(error.message.includes('access-token'), false);
			return true;
		}
	);
	assert.equal(cancelled, true);
});

test('loadRuntimeAssetBytes redacts malformed final URLs and cancels the body', async () => {
	let cancelled = false;
	const invalidFinalUrl = '://invalid-final-url-secret';
	const body = new ReadableStream({
		cancel() {
			cancelled = true;
		}
	});
	const response = new Response(body);
	Object.defineProperty(response, 'url', { value: invalidFinalUrl });

	await assert.rejects(
		loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
			label: 'go-probe.wasm',
			fetchImpl: async () => response
		}),
		(error) => {
			assert.equal(
				error.message,
				'wasm-tinygo runtime asset go-probe.wasm returned an invalid final URL'
			);
			assert.equal(error.message.includes(invalidFinalUrl), false);
			return true;
		}
	);
	assert.equal(cancelled, true);
});

test('loadRuntimeAssetBytes rejects invalid Content-Length values and cancels the body', async () => {
	for (const contentLength of ['-1', '1.5', '1e2', '3, 3', '9007199254740992']) {
		let cancelled = false;
		let sent = false;
		const body = new ReadableStream({
			pull(controller) {
				if (sent) {
					controller.close();
					return;
				}
				sent = true;
				controller.enqueue(new Uint8Array([1]));
			},
			cancel() {
				cancelled = true;
			}
		});

		await assert.rejects(
			loadRuntimeAssetBytes({
				assetPath: 'tools/go-probe.wasm',
				assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
				label: 'go-probe.wasm',
				fetchImpl: async () =>
					new Response(body, { headers: { 'content-length': contentLength } })
			}),
			/invalid Content-Length/
		);
		assert.equal(cancelled, true, `expected ${contentLength} response body to be cancelled`);
	}
});

test('loadRuntimeAssetBytes rejects oversized Content-Length before reading', async () => {
	let cancelled = false;
	const body = new ReadableStream({
		pull(controller) {
			controller.enqueue(new Uint8Array([1]));
		},
		cancel() {
			cancelled = true;
		}
	});

	await assert.rejects(
		loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
			label: 'go-probe.wasm',
			maxAssetBytes: 4,
			fetchImpl: async () => new Response(body, { headers: { 'content-length': '5' } })
		}),
		/download size exceeds the 4 byte limit/
	);
	assert.equal(cancelled, true);
});

test('loadRuntimeAssetBytes bounds unknown-length response streams', async () => {
	let cancelled = false;
	let chunkIndex = 0;
	const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
	const body = new ReadableStream(
		{
			pull(controller) {
				if (chunkIndex < chunks.length) {
					controller.enqueue(chunks[chunkIndex++]);
				} else {
					controller.close();
				}
			},
			cancel() {
				cancelled = true;
			}
		},
		{ highWaterMark: 0 }
	);

	await assert.rejects(
		loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
			label: 'go-probe.wasm',
			maxAssetBytes: 4,
			fetchImpl: async () => new Response(body)
		}),
		/download size exceeds the 4 byte limit/
	);
	assert.equal(cancelled, true);
});

test('loadRuntimeAssetBytes bounds decompressed gzip output', async () => {
	const compressed = gzipSync(Buffer.alloc(100, 1));
	assert.equal(compressed.byteLength < 32, true);

	await assert.rejects(
		loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm.gz',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm.gz',
			label: 'go-probe.wasm.gz',
			maxAssetBytes: 32,
			fetchImpl: async () => new Response(compressed)
		}),
		/decompressed size exceeds the 32 byte limit/
	);
});

test('loadRuntimeAssetBytes rejects oversized loader Blobs before materializing them', async () => {
	const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);
	let materialized = false;
	blob.arrayBuffer = async () => {
		materialized = true;
		return new ArrayBuffer(0);
	};

	await assert.rejects(
		loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
			label: 'go-probe.wasm',
			loader: async () => blob,
			maxAssetBytes: 4,
			fetchImpl: async () => new Response(new Uint8Array())
		}),
		/exceeds the 4 byte limit/
	);
	assert.equal(materialized, false);
});

test('loadRuntimeAssetBytes separates runtime pack caches by fetch identity', async () => {
	clearTinyGoRuntimePackCache();
	const packIndex = new TextEncoder().encode(
		JSON.stringify({
			format: 'wasm-tinygo-runtime-pack-index-v1',
			fileCount: 1,
			totalBytes: 1,
			entries: [{ runtimePath: 'tools/go-probe.wasm', offset: 0, length: 1 }]
		})
	);
	const createFetch = (packByte, requests) => async (url) => {
		requests.push(String(url));
		return new Response(
			String(url).endsWith('pack.index.json') ? packIndex : new Uint8Array([packByte])
		);
	};
	const packs = [
		{
			index: 'pack.index.json',
			asset: 'pack.bin',
			fileCount: 1,
			totalBytes: 1
		}
	];
	const firstRequests = [];
	const secondRequests = [];
	const commonOptions = {
		assetPath: 'tools/go-probe.wasm',
		assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
		assetBaseUrl: 'https://assets.invalid/',
		label: 'go-probe.wasm',
		packs
	};

	const first = await loadRuntimeAssetBytes({
		...commonOptions,
		fetchImpl: createFetch(1, firstRequests)
	});
	const second = await loadRuntimeAssetBytes({
		...commonOptions,
		fetchImpl: createFetch(2, secondRequests)
	});

	assert.deepEqual([...first], [1]);
	assert.deepEqual([...second], [2]);
	assert.equal(firstRequests.length, 2);
	assert.equal(secondRequests.length, 2);
	clearTinyGoRuntimePackCache();
});

test('loadRuntimeAssetBytes rejects pre-aborted loads before invoking hooks', async () => {
	const controller = new AbortController();
	const reason = new Error('cancelled by test');
	controller.abort(reason);
	let loaderCalled = false;
	let fetchCalled = false;

	await assert.rejects(
		loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
			label: 'go-probe.wasm',
			signal: controller.signal,
			loader: async () => {
				loaderCalled = true;
				return null;
			},
			fetchImpl: async () => {
				fetchCalled = true;
				return new Response(new Uint8Array());
			}
		}),
		reason
	);
	assert.equal(loaderCalled, false);
	assert.equal(fetchCalled, false);
});
