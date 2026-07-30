import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { gzipSync } from 'node:zlib';

import {
	clearTinyGoRuntimePackCache,
	loadRuntimeAssetBytes,
	MAX_TINYGO_RUNTIME_PACK_FILES,
	parseTinyGoRuntimePackIndex,
	resolveRuntimeAssetUrl
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

test('TinyGo asset entry points reject promptly when a custom loader ignores abort', async () => {
	for (const entryPoint of ['load bytes', 'resolve URL']) {
		const controller = new AbortController();
		const reason = new Error(`cancelled ${entryPoint}`);
		let markLoaderStarted;
		const loaderStarted = new Promise((resolve) => {
			markLoaderStarted = resolve;
		});
		let releaseLoader;
		const loaderResult = new Promise((resolve) => {
			releaseLoader = resolve;
		});
		let fetchCalled = false;
		const loader = () => {
			markLoaderStarted();
			return loaderResult;
		};
		const loading =
			entryPoint === 'load bytes'
				? loadRuntimeAssetBytes({
						assetPath: 'tools/go-probe.wasm',
						assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
						label: 'go-probe.wasm',
						loader,
						signal: controller.signal,
						fetchImpl: async () => {
							fetchCalled = true;
							return new Response(new Uint8Array());
						}
					})
				: resolveRuntimeAssetUrl({
						assetPath: 'tools/go-probe.wasm',
						assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
						label: 'go-probe.wasm',
						loader,
						signal: controller.signal
					});

		await loaderStarted;
		controller.abort(reason);
		try {
			const outcome = await Promise.race([
				loading.then(
					(value) => ({ status: 'resolved', value }),
					(error) => ({ status: 'rejected', reason: error })
				),
				new Promise((resolve) => {
					setImmediate(() => resolve({ status: 'pending' }));
				})
			]);

			assert.equal(outcome.status, 'rejected', `${entryPoint} remained pending after abort`);
			assert.equal(outcome.reason, reason);
			assert.equal(fetchCalled, false);
			assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
		} finally {
			releaseLoader(null);
			await loading.catch(() => {});
		}
	}
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

test('loadRuntimeAssetBytes ignores a response chunk settled synchronously by cancellation', async () => {
	const controller = new AbortController();
	const reason = new Error('cancelled before the late TinyGo response chunk');
	let markReadStarted;
	const readStarted = new Promise((resolve) => {
		markReadStarted = resolve;
	});
	let resolveRead;
	const pendingRead = new Promise((resolve) => {
		resolveRead = resolve;
	});
	const cancelReasons = [];
	let releaseCount = 0;
	const progress = [];
	const reader = {
		read() {
			markReadStarted();
			return pendingRead;
		},
		async cancel(cancelReason) {
			cancelReasons.push(cancelReason);
			resolveRead({ done: false, value: Uint8Array.of(9) });
		},
		releaseLock() {
			releaseCount += 1;
		}
	};
	const response = {
		url: '',
		ok: true,
		status: 200,
		headers: new Headers(),
		body: { getReader: () => reader }
	};
	const loading = loadRuntimeAssetBytes({
		assetPath: 'tools/go-probe.wasm',
		assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
		label: 'go-probe.wasm',
		fetchImpl: async () => response,
		onProgress(value) {
			progress.push(value);
		},
		signal: controller.signal
	});

	await readStarted;
	controller.abort(reason);

	await assert.rejects(loading, (error) => error === reason);
	assert.deepEqual(cancelReasons, [reason]);
	assert.equal(releaseCount, 1);
	assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
	assert.deepEqual(progress, []);
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
	for (const contentLength of [
		'',
		'-1',
		'1.5',
		'1e2',
		'3, content-length-secret',
		'9007199254740992'
	]) {
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
			(error) => {
				assert.equal(
					error.message,
					'wasm-tinygo runtime asset go-probe.wasm has an invalid Content-Length'
				);
				if (contentLength) assert.equal(error.message.includes(contentLength), false);
				return true;
			}
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

test('loadRuntimeAssetBytes rejects invalid response metadata without awaiting body cancellation', async () => {
	const assetUrl = 'https://assets.invalid/tools/go-probe.wasm';
	const scenarios = [
		{
			name: 'malformed final URL',
			finalUrl: '://invalid-final-url',
			headers: {},
			cancelMode: 'pending',
			expected: /returned an invalid final URL/
		},
		{
			name: 'substituted final URL',
			finalUrl: 'https://mirror.invalid/tools/go-probe.wasm',
			headers: {},
			cancelMode: 'throw',
			expected: /returned an unexpected final URL/
		},
		{
			name: 'invalid Content-Length',
			finalUrl: assetUrl,
			headers: { 'content-length': '1, 2' },
			cancelMode: 'reject',
			expected: /has an invalid Content-Length/
		},
		{
			name: 'oversized Content-Length',
			finalUrl: assetUrl,
			headers: { 'content-length': '9' },
			cancelMode: 'pending',
			expected: /download size exceeds the 8 byte limit/
		}
	];

	for (const scenario of scenarios) {
		let resolveCancellation;
		const pendingCancellation = new Promise((resolve) => {
			resolveCancellation = resolve;
		});
		const cancelReasons = [];
		let getReaderCount = 0;
		const response = {
			url: scenario.finalUrl,
			ok: true,
			status: 200,
			headers: new Headers(scenario.headers),
			body: {
				cancel(reason) {
					cancelReasons.push(reason);
					if (scenario.cancelMode === 'throw') {
						throw new Error('TinyGo body cancellation threw');
					}
					if (scenario.cancelMode === 'reject') {
						return Promise.reject(new Error('TinyGo body cancellation rejected'));
					}
					return pendingCancellation;
				},
				getReader() {
					getReaderCount += 1;
					throw new Error('response body should not be read');
				}
			}
		};
		const loading = loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl,
			label: 'go-probe.wasm',
			maxAssetBytes: 8,
			fetchImpl: async () => response
		});

		try {
			const outcome = await Promise.race([
				loading.then(
					(value) => ({ status: 'resolved', value }),
					(error) => ({ status: 'rejected', reason: error })
				),
				new Promise((resolve) => {
					setImmediate(() => resolve({ status: 'pending' }));
				})
			]);

			assert.equal(outcome.status, 'rejected', `${scenario.name} awaited body cancellation`);
			assert.match(outcome.reason.message, scenario.expected);
			assert.deepEqual(cancelReasons, [undefined]);
			assert.equal(getReaderCount, 0);
		} finally {
			resolveCancellation();
			await loading.catch(() => {});
		}
	}
});

test('loadRuntimeAssetBytes cleans up its reader when initial stream allocation fails', async () => {
	const controller = new AbortController();
	const cancelReasons = [];
	let releaseCount = 0;
	let readCount = 0;
	const reader = {
		async read() {
			readCount += 1;
			return { done: true, value: undefined };
		},
		async cancel(reason) {
			cancelReasons.push(reason);
		},
		releaseLock() {
			releaseCount += 1;
		}
	};
	const response = {
		url: '',
		ok: true,
		status: 200,
		headers: new Headers({
			'content-length': String(Number.MAX_SAFE_INTEGER)
		}),
		body: { getReader: () => reader }
	};
	let failure;

	await assert.rejects(
		loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
			label: 'go-probe.wasm',
			maxAssetBytes: Number.MAX_SAFE_INTEGER,
			fetchImpl: async () => response,
			signal: controller.signal
		}),
		(error) => {
			failure = error;
			return error instanceof RangeError;
		}
	);

	assert.equal(readCount, 0);
	assert.deepEqual(cancelReasons, [failure]);
	assert.equal(releaseCount, 1);
	assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
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

test('loadRuntimeAssetBytes cancels and releases loader-owned Blob streams', async () => {
	for (const resultShape of ['bare Blob', 'wrapped Blob']) {
		const controller = new AbortController();
		const reason = new Error(`cancelled ${resultShape}`);
		let markMaterializationStarted;
		const materializationStarted = new Promise((resolve) => {
			markMaterializationStarted = resolve;
		});
		let resolveArrayBuffer;
		const arrayBufferPromise = new Promise((resolve) => {
			resolveArrayBuffer = resolve;
		});
		let resolveRead;
		const readPromise = new Promise((resolve) => {
			resolveRead = resolve;
		});
		const cancelReasons = [];
		let releaseCount = 0;
		let streamCount = 0;
		let arrayBufferCount = 0;
		const reader = {
			read() {
				markMaterializationStarted();
				return readPromise;
			},
			async cancel(cancelReason) {
				cancelReasons.push(cancelReason);
				resolveRead({ done: true, value: undefined });
			},
			releaseLock() {
				releaseCount += 1;
			}
		};
		const blob = new Blob([Uint8Array.of(1, 2, 3)]);
		Object.defineProperty(blob, 'arrayBuffer', {
			value: () => {
				arrayBufferCount += 1;
				markMaterializationStarted();
				return arrayBufferPromise;
			}
		});
		Object.defineProperty(blob, 'stream', {
			value: () => {
				streamCount += 1;
				return { getReader: () => reader };
			}
		});
		let fetchCalled = false;
		const loading = loadRuntimeAssetBytes({
			assetPath: 'tools/go-probe.wasm',
			assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
			label: 'go-probe.wasm',
			loader: async () =>
				resultShape === 'bare Blob' ? blob : { data: blob, mimeType: 'application/wasm' },
			signal: controller.signal,
			maxAssetBytes: 8,
			fetchImpl: async () => {
				fetchCalled = true;
				return new Response(new Uint8Array());
			}
		});

		await materializationStarted;
		controller.abort(reason);
		try {
			const outcome = await Promise.race([
				loading.then(
					(value) => ({ status: 'resolved', value }),
					(error) => ({ status: 'rejected', reason: error })
				),
				new Promise((resolve) => {
					setImmediate(() => resolve({ status: 'pending' }));
				})
			]);

			assert.equal(outcome.status, 'rejected', `${resultShape} remained pending after abort`);
			assert.equal(outcome.reason, reason);
			assert.deepEqual(cancelReasons, [reason]);
			assert.equal(releaseCount, 1);
			assert.equal(streamCount, 1);
			assert.equal(arrayBufferCount, 0);
			assert.equal(fetchCalled, false);
			assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
		} finally {
			resolveArrayBuffer(Uint8Array.of(1, 2, 3).buffer);
			resolveRead({ done: true, value: undefined });
			await loading.catch(() => {});
		}
	}
});

test('loadRuntimeAssetBytes aborts a stalled Blob read when cancellation does not settle it', async () => {
	const controller = new AbortController();
	const reason = new DOMException('TinyGo asset deadline exceeded', 'TimeoutError');
	let markReadStarted;
	const readStarted = new Promise((resolve) => {
		markReadStarted = resolve;
	});
	let resolveRead;
	const pendingRead = new Promise((resolve) => {
		resolveRead = resolve;
	});
	let resolveCancellation;
	const pendingCancellation = new Promise((resolve) => {
		resolveCancellation = resolve;
	});
	const cancelReasons = [];
	let releaseCount = 0;
	let streamCount = 0;
	let arrayBufferCount = 0;
	const progress = [];
	const reader = {
		read() {
			markReadStarted();
			return pendingRead;
		},
		cancel(cancelReason) {
			cancelReasons.push(cancelReason);
			return pendingCancellation;
		},
		releaseLock() {
			releaseCount += 1;
			throw new Error('TinyGo reader release failed during abort');
		}
	};
	const blob = new Blob([Uint8Array.of(1, 2, 3)]);
	Object.defineProperty(blob, 'arrayBuffer', {
		value: () => {
			arrayBufferCount += 1;
			return Promise.resolve(Uint8Array.of(1, 2, 3).buffer);
		}
	});
	Object.defineProperty(blob, 'stream', {
		value: () => {
			streamCount += 1;
			return { getReader: () => reader };
		}
	});
	let fetchCalled = false;
	const loading = loadRuntimeAssetBytes({
		assetPath: 'tools/go-probe.wasm',
		assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
		label: 'go-probe.wasm',
		loader: async () => blob,
		onProgress(value) {
			progress.push(value);
		},
		signal: controller.signal,
		maxAssetBytes: 8,
		fetchImpl: async () => {
			fetchCalled = true;
			return new Response(new Uint8Array());
		}
	});

	try {
		await readStarted;
		controller.abort(reason);
		const outcome = await Promise.race([
			loading.then(
				(value) => ({ status: 'resolved', value }),
				(error) => ({ status: 'rejected', reason: error })
			),
			new Promise((resolve) => {
				setImmediate(() => resolve({ status: 'pending' }));
			})
		]);

		assert.equal(outcome.status, 'rejected', 'stalled Blob read remained pending after abort');
		assert.equal(outcome.reason, reason);
		assert.deepEqual(cancelReasons, [reason]);
		assert.equal(releaseCount, 1);
		assert.equal(streamCount, 1);
		assert.equal(arrayBufferCount, 0);
		assert.equal(fetchCalled, false);
		assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
		assert.deepEqual(progress, []);

		resolveRead({ done: false, value: Uint8Array.of(9) });
		await Promise.resolve();
		await Promise.resolve();
		assert.deepEqual(progress, []);
	} finally {
		resolveCancellation();
		resolveRead({ done: true, value: undefined });
		await loading.catch(() => {});
	}
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

test('loadRuntimeAssetBytes rejects promptly and cleans a late custom fetch response', async () => {
	const controller = new AbortController();
	const reason = new Error('cancelled stalled TinyGo fetch');
	let markFetchStarted;
	const fetchStarted = new Promise((resolve) => {
		markFetchStarted = resolve;
	});
	let releaseResponse;
	const responsePromise = new Promise((resolve) => {
		releaseResponse = resolve;
	});
	let markCancelled;
	const cancelled = new Promise((resolve) => {
		markCancelled = resolve;
	});
	let cancelReason;
	let requestSignal;
	const response = new Response(
		new ReadableStream({
			cancel(value) {
				cancelReason = value;
				markCancelled();
			}
		})
	);
	const progress = [];
	const loading = loadRuntimeAssetBytes({
		assetPath: 'tools/go-probe.wasm',
		assetUrl: 'https://assets.invalid/tools/go-probe.wasm',
		label: 'go-probe.wasm',
		signal: controller.signal,
		onProgress: (event) => progress.push(event),
		fetchImpl: async (_url, init) => {
			requestSignal = init.signal;
			markFetchStarted();
			return await responsePromise;
		}
	});

	await fetchStarted;
	assert.equal(requestSignal, controller.signal);
	controller.abort(reason);
	try {
		const outcome = await Promise.race([
			loading.then(
				(value) => ({ status: 'resolved', value }),
				(error) => ({ status: 'rejected', reason: error })
			),
			new Promise((resolve) => {
				setImmediate(() => resolve({ status: 'pending' }));
			})
		]);

		assert.equal(outcome.status, 'rejected', 'custom fetch remained pending after abort');
		assert.equal(outcome.reason, reason);
		assert.deepEqual(progress, []);
		assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
		releaseResponse(response);
		await cancelled;
		assert.equal(cancelReason, reason);
	} finally {
		releaseResponse(response);
		await loading.catch(() => {});
	}
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
