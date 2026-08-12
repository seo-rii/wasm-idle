import { gzipSync } from 'node:zlib';

import { beforeEach, describe, expect, it } from 'vitest';

import { buildRuntimePack } from '../scripts/runtime-pack.mjs';
import {
	clearRuntimeAssetPackCache,
	loadRuntimePackEntries,
	parseRuntimePackIndex
} from '../src/runtime-asset-store.js';
import type { RuntimeAssetPackReference } from '../src/runtime-manifest.js';

function encodeUint32LittleEndian(value: number) {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value, true);
	return bytes;
}

function concatBytes(...chunks: Uint8Array[]) {
	const bytes = new Uint8Array(
		chunks.reduce((totalBytes, chunk) => totalBytes + chunk.byteLength, 0)
	);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function encodeLiteralOperation(bytes: Uint8Array) {
	return concatBytes(Uint8Array.of(0), encodeUint32LittleEndian(bytes.byteLength), bytes);
}

function encodeCopyOperation(baseOffset: number, length: number) {
	return concatBytes(
		Uint8Array.of(1),
		encodeUint32LittleEndian(baseOffset),
		encodeUint32LittleEndian(length)
	);
}

function createRuntimePackFetch(
	assets: Record<string, Uint8Array | object>,
	requestedAssets?: string[]
): typeof fetch {
	return (async (input: string | URL | Request) => {
		const requestUrl = input instanceof Request ? input.url : input.toString();
		const pathname = new URL(requestUrl).pathname;
		const runtimeMarker = '/runtime/';
		const markerOffset = pathname.indexOf(runtimeMarker);
		const assetPath =
			markerOffset === -1 ? pathname.slice(1) : pathname.slice(markerOffset + 9);
		requestedAssets?.push(assetPath);
		const asset = assets[assetPath];
		if (asset === undefined) {
			return new Response('not found', { status: 404 });
		}
		if (asset instanceof Uint8Array) {
			return new Response(new Uint8Array(asset).buffer, { status: 200 });
		}
		return new Response(JSON.stringify(asset), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}) as typeof fetch;
}

describe('runtime pack', () => {
	beforeEach(() => {
		clearRuntimeAssetPackCache();
	});

	it('round-trips pack entries through the generated index and runtime loader', async () => {
		const { packBytes, index } = await buildRuntimePack([
			{
				runtimePath: '/lib/rustlib/wasm32-wasip1/lib/libstd.rlib',
				bytes: new Uint8Array([0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a, 0x01])
			},
			{
				runtimePath: '/work/alloc.o',
				bytes: new Uint8Array([0x00, 0x61, 0x73, 0x6d])
			}
		]);
		const parsedIndex = parseRuntimePackIndex(index);
		const progressEvents: Array<{ loaded: number; total?: number }> = [];
		const gzippedPackBytes = gzipSync(packBytes);

		expect(parsedIndex.fileCount).toBe(2);
		expect(parsedIndex.entries.map((entry) => entry.runtimePath)).toEqual([
			'/lib/rustlib/wasm32-wasip1/lib/libstd.rlib',
			'/work/alloc.o'
		]);

		const loadedEntries = await loadRuntimePackEntries(
			'https://example.test/runtime/',
			{
				asset: 'packs/sysroot/wasm32-wasip1.pack.gz',
				index: 'packs/sysroot/wasm32-wasip1.index.json.gz',
				fileCount: index.fileCount,
				totalBytes: index.totalBytes
			},
			async (url) => {
				if (String(url).endsWith('.index.json.gz')) {
					return new Response(gzipSync(JSON.stringify(index)), {
						status: 200,
						headers: {
							'content-type': 'application/gzip'
						}
					});
				}
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(gzippedPackBytes.slice(0, 3));
							controller.enqueue(gzippedPackBytes.slice(3));
							controller.close();
						}
					}),
					{
						status: 200,
						headers: {
							'content-length': String(gzippedPackBytes.byteLength),
							'content-type': 'application/gzip'
						}
					}
				);
			},
			(progress) => progressEvents.push(progress)
		);

		expect(
			loadedEntries.map((entry) => ({
				runtimePath: entry.runtimePath,
				bytes: [...entry.bytes]
			}))
		).toEqual([
			{
				runtimePath: '/lib/rustlib/wasm32-wasip1/lib/libstd.rlib',
				bytes: [0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a, 0x01]
			},
			{
				runtimePath: '/work/alloc.o',
				bytes: [0x00, 0x61, 0x73, 0x6d]
			}
		]);
		expect(progressEvents.map((event) => event.loaded)).toEqual([
			3,
			gzippedPackBytes.byteLength
		]);
		expect(progressEvents.at(-1)?.total).toBe(gzippedPackBytes.byteLength);
	});

	it('decodes recursively nested copy/literal delta packs', async () => {
		const baseBytes = Uint8Array.of(10, 20, 30, 40);
		const baseIndex = {
			format: 'wasm-rust-runtime-pack-index-v1',
			fileCount: 1,
			totalBytes: baseBytes.byteLength,
			entries: [{ runtimePath: '/base.bin', offset: 0, length: baseBytes.byteLength }]
		};
		const basePack: RuntimeAssetPackReference = {
			asset: 'base.pack',
			index: 'base.index.json',
			fileCount: baseIndex.fileCount,
			totalBytes: baseIndex.totalBytes
		};

		const changedEntryBytes = concatBytes(
			encodeCopyOperation(1, 2),
			encodeLiteralOperation(Uint8Array.of(99)),
			encodeCopyOperation(0, 1)
		);
		const newEntryBytes = encodeLiteralOperation(Uint8Array.of(7, 8));
		const middleBytes = concatBytes(changedEntryBytes, newEntryBytes);
		const middleIndex = {
			format: 'wasm-rust-runtime-delta-pack-index-v1',
			fileCount: 2,
			totalBytes: middleBytes.byteLength,
			decodedTotalBytes: 6,
			entries: [
				{
					runtimePath: '/middle.bin',
					offset: 0,
					length: changedEntryBytes.byteLength,
					decodedLength: 4,
					baseRuntimePath: '/base.bin'
				},
				{
					runtimePath: '/new.bin',
					offset: changedEntryBytes.byteLength,
					length: newEntryBytes.byteLength,
					decodedLength: 2
				}
			]
		};
		const middlePack: RuntimeAssetPackReference = {
			asset: 'middle.delta.pack',
			index: 'middle.delta.index.json',
			fileCount: middleIndex.fileCount,
			totalBytes: middleIndex.totalBytes,
			decodedTotalBytes: middleIndex.decodedTotalBytes,
			delta: { format: 'copy-literal-v1', base: basePack }
		};

		const finalEntryBytes = concatBytes(
			encodeCopyOperation(1, 3),
			encodeLiteralOperation(Uint8Array.of(42))
		);
		const finalIndex = {
			format: 'wasm-rust-runtime-delta-pack-index-v1',
			fileCount: 1,
			totalBytes: finalEntryBytes.byteLength,
			decodedTotalBytes: 4,
			entries: [
				{
					runtimePath: '/final.bin',
					offset: 0,
					length: finalEntryBytes.byteLength,
					decodedLength: 4,
					baseRuntimePath: '/middle.bin'
				}
			]
		};
		const finalPack: RuntimeAssetPackReference = {
			asset: 'final.delta.pack',
			index: 'final.delta.index.json',
			fileCount: finalIndex.fileCount,
			totalBytes: finalIndex.totalBytes,
			decodedTotalBytes: finalIndex.decodedTotalBytes,
			delta: { format: 'copy-literal-v1', base: middlePack }
		};
		const assets = {
			'base.pack': baseBytes,
			'base.index.json': baseIndex,
			'middle.delta.pack': middleBytes,
			'middle.delta.index.json': middleIndex,
			'final.delta.pack': finalEntryBytes,
			'final.delta.index.json': finalIndex
		};
		const requestedAssets: string[] = [];
		const progressEvents: Array<{ loaded: number; total?: number }> = [];

		expect(parseRuntimePackIndex(middleIndex)).toEqual(middleIndex);
		const entries = await loadRuntimePackEntries(
			'https://example.test/runtime/',
			finalPack,
			createRuntimePackFetch(assets, requestedAssets),
			(progress) => progressEvents.push(progress)
		);

		expect(
			entries.map((entry) => ({ runtimePath: entry.runtimePath, bytes: [...entry.bytes] }))
		).toEqual([{ runtimePath: '/final.bin', bytes: [30, 99, 10, 42] }]);
		expect(requestedAssets.sort()).toEqual(Object.keys(assets).sort());
		expect(progressEvents.length).toBeGreaterThan(1);
		expect(progressEvents.map(({ loaded }) => loaded)).toEqual(
			[...progressEvents.map(({ loaded }) => loaded)].sort((left, right) => left - right)
		);
		expect(progressEvents.at(-1)?.loaded).toBe(progressEvents.at(-1)?.total);
	});

	it('rejects malformed copy/literal delta operations', async () => {
		const baseBytes = Uint8Array.of(10, 20, 30, 40);
		const baseIndex = {
			format: 'wasm-rust-runtime-pack-index-v1',
			fileCount: 1,
			totalBytes: baseBytes.byteLength,
			entries: [{ runtimePath: '/base.bin', offset: 0, length: baseBytes.byteLength }]
		};
		const basePack: RuntimeAssetPackReference = {
			asset: 'base.pack',
			index: 'base.index.json',
			fileCount: baseIndex.fileCount,
			totalBytes: baseIndex.totalBytes
		};
		const cases: Array<{
			name: string;
			encodedBytes: Uint8Array;
			decodedLength: number;
			baseRuntimePath?: string;
			expectedError: RegExp;
		}> = [
			{
				name: 'unknown-opcode',
				encodedBytes: Uint8Array.of(2),
				decodedLength: 1,
				expectedError: /unknown operation 2/
			},
			{
				name: 'truncated-literal-header',
				encodedBytes: Uint8Array.of(0, 1, 0),
				decodedLength: 1,
				expectedError: /truncated literal operation/
			},
			{
				name: 'literal-input-overflow',
				encodedBytes: concatBytes(
					Uint8Array.of(0),
					encodeUint32LittleEndian(2),
					Uint8Array.of(1)
				),
				decodedLength: 2,
				expectedError: /literal operation .* exceeds the encoded entry/
			},
			{
				name: 'literal-output-overflow',
				encodedBytes: encodeLiteralOperation(Uint8Array.of(1, 2)),
				decodedLength: 1,
				expectedError: /literal operation .* exceeds decoded length 1/
			},
			{
				name: 'truncated-copy-header',
				encodedBytes: Uint8Array.of(1, 0, 0, 0),
				decodedLength: 1,
				baseRuntimePath: '/base.bin',
				expectedError: /truncated copy operation/
			},
			{
				name: 'missing-copy-base-path',
				encodedBytes: encodeCopyOperation(0, 1),
				decodedLength: 1,
				expectedError: /requires baseRuntimePath/
			},
			{
				name: 'missing-base-entry',
				encodedBytes: encodeLiteralOperation(Uint8Array.of(1)),
				decodedLength: 1,
				baseRuntimePath: '/missing.bin',
				expectedError: /base runtime path \/missing\.bin .* was not found/
			},
			{
				name: 'copy-input-overflow',
				encodedBytes: encodeCopyOperation(3, 2),
				decodedLength: 2,
				baseRuntimePath: '/base.bin',
				expectedError: /copy range 3\+2 exceeds 4 bytes/
			},
			{
				name: 'decoded-length-underflow',
				encodedBytes: encodeLiteralOperation(Uint8Array.of(1)),
				decodedLength: 2,
				expectedError: /decoded 1 bytes but expected 2/
			}
		];

		for (const testCase of cases) {
			clearRuntimeAssetPackCache();
			const deltaIndex = {
				format: 'wasm-rust-runtime-delta-pack-index-v1',
				fileCount: 1,
				totalBytes: testCase.encodedBytes.byteLength,
				decodedTotalBytes: testCase.decodedLength,
				entries: [
					{
						runtimePath: '/output.bin',
						offset: 0,
						length: testCase.encodedBytes.byteLength,
						decodedLength: testCase.decodedLength,
						...(testCase.baseRuntimePath
							? { baseRuntimePath: testCase.baseRuntimePath }
							: {})
					}
				]
			};
			const deltaPack: RuntimeAssetPackReference = {
				asset: `${testCase.name}.pack`,
				index: `${testCase.name}.index.json`,
				fileCount: 1,
				totalBytes: testCase.encodedBytes.byteLength,
				decodedTotalBytes: testCase.decodedLength,
				delta: { format: 'copy-literal-v1', base: basePack }
			};
			const fetchImpl = createRuntimePackFetch({
				'base.pack': baseBytes,
				'base.index.json': baseIndex,
				[deltaPack.asset]: testCase.encodedBytes,
				[deltaPack.index]: deltaIndex
			});

			await expect(
				loadRuntimePackEntries('https://example.test/runtime/', deltaPack, fetchImpl)
			).rejects.toThrow(testCase.expectedError);
		}
	});

	it('rejects malformed runtime pack indexes', () => {
		expect(() =>
			parseRuntimePackIndex({
				format: 'wasm-rust-runtime-pack-index-v1',
				fileCount: 2,
				totalBytes: 3,
				entries: [
					{
						runtimePath: '/work/alloc.o',
						offset: 0,
						length: 2
					},
					{
						runtimePath: '/work/alloc.o',
						offset: 2,
						length: 2
					}
				]
			})
		).toThrow(/runtimePath \/work\/alloc\.o/);

		expect(() =>
			parseRuntimePackIndex({
				format: 'wasm-rust-runtime-delta-pack-index-v1',
				fileCount: 1,
				totalBytes: 1,
				decodedTotalBytes: 2,
				entries: [
					{
						runtimePath: '/work/alloc.o',
						offset: 0,
						length: 1,
						decodedLength: 1
					}
				]
			})
		).toThrow(/invalid root\.decodedTotalBytes/);
	});
});
