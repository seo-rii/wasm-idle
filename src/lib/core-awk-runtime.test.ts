// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
	AWK_MAX_ASSET_BYTES,
	AWK_MAX_DELIVERY_BYTES,
	AWK_MAX_LOGICAL_BYTES,
	AWK_MAX_MANIFEST_BYTES,
	AWK_PREFLIGHT_PROTOCOL,
	AWK_PREFLIGHT_PROTOCOL_VERSION,
	AWK_RUNTIME_GO_SHIM_PATH,
	AWK_RUNTIME_MANIFEST_PATH,
	AWK_RUNTIME_WASM_STORAGE_PATH,
	AWK_RUNTIME_WORKER_PATH,
	AssetIntegrityError,
	CancelledError,
	ProtocolError,
	RuntimeConfigurationError,
	TimeoutError,
	awkRuntimePreflightTransferables,
	canonicalizeAwkRuntimeManifestFingerprint,
	cloneAwkRuntimePreflightPayload,
	createRuntimeAssetsKey,
	preflightAwkRuntimeAssets,
	requireAwkRuntimePreflightPayload,
	snapshotAwkRuntimePreflightProfile,
	verifyAwkRuntimePreflightPayload,
	type AwkRuntimePreflightProfile
} from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeAwkRuntimeFingerprint } from '../../scripts/sync-wasm-awk.mjs';
import { WASM_AWK_RUNTIME_PROFILE } from './playground/wasmAwkVersion';

const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

type Fixture = ReturnType<typeof createFixture>;

function createFixture(
	logicalWasmBytes = 8,
	transformWasmStorage?: (bytes: Uint8Array) => Uint8Array
) {
	const baseUrl = 'https://cdn.example.com/wasm-awk/';
	const workerBytes = encoder.encode('self.onmessage = () => {}\n');
	const goShimBytes = encoder.encode('globalThis.Go = class Go {};\n');
	const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
	const generatedWasmStorage = Uint8Array.from(gzipSync(wasmBytes));
	const compressedWasmBytes = transformWasmStorage
		? transformWasmStorage(generatedWasmStorage)
		: generatedWasmStorage;
	const manifestBase = {
		format: 'wasm-awk-runtime-manifest-v2' as const,
		runtime: 'GoAWK' as const,
		profileId: 'wasm-awk-runtime-v2',
		goVersion: 'go1.25.3',
		goawkVersion: 'v1.31.0',
		assets: {
			worker: {
				path: AWK_RUNTIME_WORKER_PATH,
				bytes: workerBytes.byteLength,
				sha256: sha256(workerBytes)
			},
			goShim: {
				path: AWK_RUNTIME_GO_SHIM_PATH,
				bytes: goShimBytes.byteLength,
				sha256: sha256(goShimBytes)
			},
			wasm: {
				path: AWK_RUNTIME_WASM_STORAGE_PATH,
				bytes: compressedWasmBytes.byteLength,
				sha256: sha256(compressedWasmBytes),
				uncompressedBytes: logicalWasmBytes,
				uncompressedSha256: sha256(wasmBytes)
			}
		}
	};
	const manifestFingerprint = sha256(
		encoder.encode(canonicalizeAwkRuntimeManifestFingerprint(manifestBase))
	);
	const manifest = { ...manifestBase, fingerprint: manifestFingerprint };
	const manifestBytes = encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
	const profile: AwkRuntimePreflightProfile = {
		profileId: manifest.profileId,
		goVersion: manifest.goVersion,
		goawkVersion: manifest.goawkVersion,
		manifestFingerprint,
		manifestReceipt: { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
		workerReceipt: { bytes: workerBytes.byteLength, sha256: sha256(workerBytes) },
		goShimReceipt: { bytes: goShimBytes.byteLength, sha256: sha256(goShimBytes) },
		wasmReceipt: {
			bytes: compressedWasmBytes.byteLength,
			sha256: sha256(compressedWasmBytes),
			uncompressedBytes: logicalWasmBytes,
			uncompressedSha256: sha256(wasmBytes)
		}
	};
	const manifestUrl = `${baseUrl}${AWK_RUNTIME_MANIFEST_PATH}?v=${manifestFingerprint}`;
	const responses = new Map<string, { bytes: Uint8Array; mediaType: string }>([
		[manifestUrl, { bytes: manifestBytes, mediaType: 'application/json' }],
		[
			`${baseUrl}${AWK_RUNTIME_GO_SHIM_PATH}?v=${profile.goShimReceipt.sha256}`,
			{ bytes: goShimBytes, mediaType: 'text/javascript' }
		],
		[
			`${baseUrl}${AWK_RUNTIME_WASM_STORAGE_PATH}?v=${profile.wasmReceipt.sha256}`,
			{ bytes: compressedWasmBytes, mediaType: 'application/octet-stream' }
		]
	]);
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		requests.push({ url, init });
		const entry = responses.get(url);
		const response = entry
			? new Response(Uint8Array.from(entry.bytes), {
					status: 200,
					headers: {
						'content-length': String(entry.bytes.byteLength),
						'content-type': entry.mediaType
					}
				})
			: new Response('missing', { status: 404 });
		Object.defineProperty(response, 'url', { value: url });
		return response;
	}) as typeof globalThis.fetch;
	return {
		baseUrl,
		workerBytes,
		goShimBytes,
		wasmBytes,
		compressedWasmBytes,
		manifest,
		manifestBytes,
		manifestUrl,
		profile,
		responses,
		requests,
		fetch
	};
}

function replaceManifestBytes(fixture: Fixture, manifestBytes: Uint8Array) {
	fixture.profile = {
		...fixture.profile,
		manifestReceipt: { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) }
	};
	fixture.responses.set(fixture.manifestUrl, {
		bytes: manifestBytes,
		mediaType: 'application/json'
	});
}

async function expectPromptRejection(
	pending: Promise<unknown>,
	errorType: new (...args: never[]) => Error
) {
	const didNotSettle = new Promise<never>((_resolve, reject) => {
		setTimeout(() => reject(new Error('AWK preflight did not settle promptly')), 500);
	});
	await expect(Promise.race([pending, didNotSettle])).rejects.toBeInstanceOf(errorType);
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('AWK verified runtime contract', () => {
	it('validates the published producer bundle against the same Core trust contract', async () => {
		const staticRoot = path.resolve('static/wasm-awk');
		const manifestBytes = Uint8Array.from(
			readFileSync(path.join(staticRoot, AWK_RUNTIME_MANIFEST_PATH))
		);
		const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
		expect(sha256(manifestBytes)).toBe(WASM_AWK_RUNTIME_PROFILE.manifestReceipt.sha256);
		expect(manifestBytes.byteLength).toBe(WASM_AWK_RUNTIME_PROFILE.manifestReceipt.bytes);
		expect(computeAwkRuntimeFingerprint(manifest)).toBe(
			WASM_AWK_RUNTIME_PROFILE.manifestFingerprint
		);
		expect(sha256(encoder.encode(canonicalizeAwkRuntimeManifestFingerprint(manifest)))).toBe(
			WASM_AWK_RUNTIME_PROFILE.manifestFingerprint
		);

		const baseUrl = 'https://published.example.com/wasm-awk/';
		const fetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = new URL(String(input));
			const relativePath = url.pathname.slice('/wasm-awk/'.length);
			const bytes = Uint8Array.from(readFileSync(path.join(staticRoot, relativePath)));
			const response = new Response(bytes, {
				status: 200,
				headers: {
					'content-length': String(bytes.byteLength),
					'content-type': relativePath.endsWith('.json')
						? 'application/json'
						: relativePath.endsWith('.js')
							? 'text/javascript'
							: 'application/octet-stream'
				}
			});
			Object.defineProperty(response, 'url', { value: url.href });
			return response;
		}) as typeof globalThis.fetch;
		const payload = await preflightAwkRuntimeAssets({
			baseUrl,
			manifestUrl: `${baseUrl}${AWK_RUNTIME_MANIFEST_PATH}?v=${WASM_AWK_RUNTIME_PROFILE.manifestFingerprint}`,
			profile: WASM_AWK_RUNTIME_PROFILE,
			fetch
		});
		expect(payload.wasmBytes.byteLength).toBe(
			WASM_AWK_RUNTIME_PROFILE.wasmReceipt.uncompressedBytes
		);
		expect(sha256(payload.wasmBytes)).toBe(
			WASM_AWK_RUNTIME_PROFILE.wasmReceipt.uncompressedSha256
		);
	});

	it('preflights only the pinned v2 graph into a minimal owned payload', async () => {
		const fixture = createFixture();
		const progress: string[] = [];
		const payload = await preflightAwkRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch,
			reportProgress: ({ assetKey }) => progress.push(assetKey)
		});

		expect(AWK_PREFLIGHT_PROTOCOL).toBe('wasm-idle-awk-runtime-v2');
		expect(AWK_PREFLIGHT_PROTOCOL_VERSION).toBe(2);
		expect(AWK_MAX_MANIFEST_BYTES).toBe(32 * 1024);
		expect(AWK_MAX_ASSET_BYTES).toBe(16 * 1024 * 1024);
		expect(AWK_MAX_DELIVERY_BYTES).toBe(8 * 1024 * 1024);
		expect(AWK_MAX_LOGICAL_BYTES).toBe(16 * 1024 * 1024);
		expect(AWK_RUNTIME_WORKER_PATH).toBe('runner-worker.v2.js');
		expect(Object.keys(payload).sort()).toEqual(['goShimBytes', 'protocol', 'wasmBytes']);
		expect(Object.isFrozen(payload)).toBe(true);
		expect(payload.goShimBytes).toEqual(fixture.goShimBytes);
		expect(payload.wasmBytes).toEqual(fixture.wasmBytes);
		expect(payload.goShimBytes.buffer).not.toBe(payload.wasmBytes.buffer);
		expect(payload.goShimBytes.byteLength).toBe(payload.goShimBytes.buffer.byteLength);
		expect(payload.wasmBytes.byteLength).toBe(payload.wasmBytes.buffer.byteLength);
		expect(new Set(progress)).toEqual(new Set(['manifest', 'goShim', 'wasm']));
		expect(fixture.requests.map(({ url }) => url).sort()).toEqual(
			[...fixture.responses.keys()].sort()
		);
		for (const { init } of fixture.requests) {
			expect(init).toMatchObject({
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
	});

	it('snapshots complete profiles and serializes every AWK trust field into cache identity', () => {
		const fixture = createFixture();
		const snapshot = snapshotAwkRuntimePreflightProfile(fixture.profile);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.wasmReceipt)).toBe(true);
		const runtime = {
			awk: {
				baseUrl: fixture.baseUrl,
				workerUrl: `${fixture.baseUrl}${AWK_RUNTIME_WORKER_PATH}`,
				manifestUrl: fixture.manifestUrl,
				...fixture.profile
			}
		};
		const key = createRuntimeAssetsKey(runtime);
		expect(key).toContain(`"awkManifestFingerprint":"${fixture.profile.manifestFingerprint}"`);
		expect(key).toContain('"awkGoShimReceipt"');
		expect(key).toContain('"awkWasmReceipt"');
		expect(key).not.toBe(
			createRuntimeAssetsKey({
				awk: {
					...runtime.awk,
					workerReceipt: {
						...fixture.profile.workerReceipt,
						sha256: 'f'.repeat(64)
					}
				}
			})
		);
		expect(() =>
			snapshotAwkRuntimePreflightProfile({
				...fixture.profile,
				[Symbol('hidden trust field')]: true
			})
		).toThrow(RuntimeConfigurationError);
		const accessorProfile = { ...fixture.profile } as Record<string, unknown>;
		Object.defineProperty(accessorProfile, 'profileId', {
			enumerable: true,
			get: () => fixture.profile.profileId
		});
		expect(() => snapshotAwkRuntimePreflightProfile(accessorProfile)).toThrow(
			RuntimeConfigurationError
		);
	});

	it('clones and exposes exactly the two transferable runtime buffers', async () => {
		const fixture = createFixture();
		const payload = await preflightAwkRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch
		});
		const cloned = cloneAwkRuntimePreflightPayload(payload);
		expect(cloned).toEqual(payload);
		expect(cloned.goShimBytes.buffer).not.toBe(payload.goShimBytes.buffer);
		expect(cloned.wasmBytes.buffer).not.toBe(payload.wasmBytes.buffer);
		expect(awkRuntimePreflightTransferables(cloned)).toEqual([
			cloned.goShimBytes.buffer,
			cloned.wasmBytes.buffer
		]);
		await expect(verifyAwkRuntimePreflightPayload(cloned, fixture.profile)).resolves.toBe(
			cloned
		);
		expect(() =>
			requireAwkRuntimePreflightPayload({ ...cloned, profileId: fixture.profile.profileId })
		).toThrow(ProtocolError);
		const spoofedWords = new Uint16Array([0, 97, 115, 109]);
		Object.defineProperty(spoofedWords, Symbol.toStringTag, { value: 'Uint8Array' });
		expect(() =>
			requireAwkRuntimePreflightPayload({
				...cloned,
				wasmBytes: spoofedWords
			})
		).toThrow(ProtocolError);
	});

	it('rejects duplicate decoded keys and unknown fields after raw-byte receipt verification', async () => {
		const duplicateFixture = createFixture();
		const duplicateSource = new TextDecoder()
			.decode(duplicateFixture.manifestBytes)
			.replace(
				'"format": "wasm-awk-runtime-manifest-v2",',
				'"format": "wasm-awk-runtime-manifest-v2", "\\u0066ormat": "wasm-awk-runtime-manifest-v2",'
			);
		replaceManifestBytes(duplicateFixture, encoder.encode(duplicateSource));
		await expect(
			preflightAwkRuntimeAssets({
				baseUrl: duplicateFixture.baseUrl,
				manifestUrl: duplicateFixture.manifestUrl,
				profile: duplicateFixture.profile,
				fetch: duplicateFixture.fetch
			})
		).rejects.toThrow(/duplicate object key/u);

		const unknownFixture = createFixture();
		const unknownBytes = encoder.encode(
			JSON.stringify({ ...unknownFixture.manifest, legacyFiles: ['goawk.wasm'] })
		);
		replaceManifestBytes(unknownFixture, unknownBytes);
		await expect(
			preflightAwkRuntimeAssets({
				baseUrl: unknownFixture.baseUrl,
				manifestUrl: unknownFixture.manifestUrl,
				profile: unknownFixture.profile,
				fetch: unknownFixture.fetch
			})
		).rejects.toThrow(/identity or shape/u);
	});

	it('rejects a receipt-authentic manifest that is not fatal UTF-8', async () => {
		const fixture = createFixture();
		replaceManifestBytes(fixture, Uint8Array.of(0xff));

		await expect(
			preflightAwkRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toThrow(/not valid UTF-8/u);
	});

	it('rejects manifest graph drift and corrupt storage without trying legacy URLs', async () => {
		const graphFixture = createFixture();
		const driftedManifest = {
			...graphFixture.manifest,
			assets: {
				...graphFixture.manifest.assets,
				worker: { ...graphFixture.manifest.assets.worker, sha256: 'a'.repeat(64) }
			}
		};
		replaceManifestBytes(graphFixture, encoder.encode(JSON.stringify(driftedManifest)));
		await expect(
			preflightAwkRuntimeAssets({
				baseUrl: graphFixture.baseUrl,
				manifestUrl: graphFixture.manifestUrl,
				profile: graphFixture.profile,
				fetch: graphFixture.fetch
			})
		).rejects.toThrow(/receipts do not match/u);

		const corruptFixture = createFixture();
		const wasmUrl = `${corruptFixture.baseUrl}${AWK_RUNTIME_WASM_STORAGE_PATH}?v=${corruptFixture.profile.wasmReceipt.sha256}`;
		const corruptBytes = Uint8Array.from(corruptFixture.compressedWasmBytes);
		corruptBytes[corruptBytes.byteLength - 1] ^= 1;
		corruptFixture.responses.set(wasmUrl, {
			bytes: corruptBytes,
			mediaType: 'application/octet-stream'
		});
		await expect(
			preflightAwkRuntimeAssets({
				baseUrl: corruptFixture.baseUrl,
				manifestUrl: corruptFixture.manifestUrl,
				profile: corruptFixture.profile,
				fetch: corruptFixture.fetch
			})
		).rejects.toBeInstanceOf(AssetIntegrityError);
		expect(corruptFixture.requests.every(({ url }) => !url.endsWith('.gz'))).toBe(true);
		expect(
			corruptFixture.requests.every(({ url }) => !url.includes('runtime-manifest.v1'))
		).toBe(true);
	});

	it('rejects logical decompression size drift even when storage bytes are authentic', async () => {
		const fixture = createFixture(7);
		await expect(
			preflightAwkRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toThrow(/exceeds its logical receipt/u);
	});

	it('rejects receipt-authentic truncated gzip storage', async () => {
		const fixture = createFixture(8, (bytes) =>
			bytes.slice(0, Math.max(2, Math.floor(bytes.byteLength / 2)))
		);

		await expect(
			preflightAwkRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(AssetIntegrityError);
	});

	it('rejects non-canonical URLs before issuing a request', async () => {
		const fixture = createFixture();
		await expect(
			preflightAwkRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: `${fixture.baseUrl}runtime-manifest.v1.json`,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		expect(fixture.fetch).not.toHaveBeenCalled();
	});

	it.each(['empty-url', 'substituted-url', 'redirected', 'opaque'] as const)(
		'rejects %s responses and cancels their bodies without accepting a fallback',
		async (mode) => {
			const fixture = createFixture();
			let cancelled = false;
			const fetch = vi.fn(async (input: RequestInfo | URL) => {
				const requestedUrl = String(input);
				const entry = fixture.responses.get(requestedUrl)!;
				const body = new ReadableStream<Uint8Array>({
					pull() {
						return new Promise<void>(() => {});
					},
					cancel() {
						cancelled = true;
						return new Promise<void>(() => {});
					}
				});
				const response = new Response(body, {
					status: 200,
					headers: {
						'content-length': String(entry.bytes.byteLength),
						'content-type': entry.mediaType
					}
				});
				Object.defineProperty(response, 'url', {
					value:
						mode === 'empty-url'
							? ''
							: mode === 'substituted-url'
								? `${requestedUrl}&substituted=1`
								: requestedUrl
				});
				if (mode === 'redirected') {
					Object.defineProperty(response, 'redirected', { value: true });
				}
				if (mode === 'opaque') {
					Object.defineProperty(response, 'type', { value: 'opaque' });
				}
				return response;
			}) as typeof globalThis.fetch;

			await expect(
				preflightAwkRuntimeAssets({
					baseUrl: fixture.baseUrl,
					manifestUrl: fixture.manifestUrl,
					profile: fixture.profile,
					fetch
				})
			).rejects.toThrow();
			await Promise.resolve();
			expect(cancelled).toBe(true);
			expect(fetch).toHaveBeenCalled();
		}
	);

	it('allows decoded HTTP encoding for identity manifest and shim responses', async () => {
		const fixture = createFixture();
		const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const requestedUrl =
				typeof input === 'string' || input instanceof URL ? String(input) : input.url;
			const original = await fixture.fetch(input, init);
			if (requestedUrl.includes('goawk.wasm.gz.bin')) return original;
			const bytes = await original.arrayBuffer();
			const response = new Response(bytes, {
				status: 200,
				headers: {
					'content-encoding': 'br',
					'content-length': String(bytes.byteLength),
					'content-type':
						original.headers.get('content-type') || 'application/octet-stream'
				}
			});
			Object.defineProperty(response, 'url', { value: requestedUrl });
			return response;
		}) as typeof globalThis.fetch;

		await expect(
			preflightAwkRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch
			})
		).resolves.toMatchObject({ protocol: AWK_PREFLIGHT_PROTOCOL });
	});

	it('rejects transparent HTTP encoding for stored-form Wasm bytes', async () => {
		const fixture = createFixture();
		const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const requestedUrl =
				typeof input === 'string' || input instanceof URL ? String(input) : input.url;
			const original = await fixture.fetch(input, init);
			if (!requestedUrl.includes('goawk.wasm.gz.bin')) return original;
			const bytes = await original.arrayBuffer();
			const response = new Response(bytes, {
				status: 200,
				headers: {
					'content-encoding': 'br',
					'content-length': String(bytes.byteLength),
					'content-type': 'application/octet-stream'
				}
			});
			Object.defineProperty(response, 'url', { value: requestedUrl });
			return response;
		}) as typeof globalThis.fetch;

		await expect(
			preflightAwkRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch
			})
		).rejects.toMatchObject({
			code: 'asset-not-found',
			cause: { code: 'asset-integrity' }
		});
	});

	it('snapshots a caller signal accessor exactly once', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		let signalReads = 0;
		const request = {
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch
		};
		Object.defineProperty(request, 'signal', {
			enumerable: true,
			get() {
				signalReads += 1;
				return controller.signal;
			}
		});

		await expect(preflightAwkRuntimeAssets(request)).resolves.toMatchObject({
			protocol: AWK_PREFLIGHT_PROTOCOL
		});
		expect(signalReads).toBe(1);
	});

	it('cancels a custom fetch that ignores AbortSignal', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		const fetch = vi.fn(() => new Promise<Response>(() => {})) as typeof globalThis.fetch;
		const pending = preflightAwkRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch,
			signal: controller.signal
		});
		controller.abort(new Error('stop AWK preflight'));
		await expectPromptRejection(pending, CancelledError);
	});

	it('preserves first-wins caller cancellation after the timeout deadline passes', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		const fetch = vi.fn(() => new Promise<Response>(() => {})) as typeof globalThis.fetch;
		const pending = preflightAwkRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch,
			signal: controller.signal,
			limits: { assetTimeoutMs: 5 }
		});
		const assertion = expect(pending).rejects.toBeInstanceOf(CancelledError);
		controller.abort(new Error('caller wins'));
		await new Promise((resolve) => setTimeout(resolve, 15));
		await assertion;
	});

	it('does not await stalled response reads or body cancellation after abort', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		let markReadStarted!: () => void;
		const readStarted = new Promise<void>((resolve) => {
			markReadStarted = resolve;
		});
		let cancelCalled = false;
		const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (!url.includes(AWK_RUNTIME_MANIFEST_PATH)) {
				return await fixture.fetch(input, init);
			}
			const body = new ReadableStream<Uint8Array>({
				pull() {
					markReadStarted();
					return new Promise<void>(() => {});
				},
				cancel() {
					cancelCalled = true;
					return new Promise<void>(() => {});
				}
			});
			const response = new Response(body, {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
			Object.defineProperty(response, 'url', { value: url });
			return response;
		}) as typeof globalThis.fetch;
		const pending = preflightAwkRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch,
			signal: controller.signal
		});
		await readStarted;
		controller.abort(new Error('stop stalled AWK read'));
		await expectPromptRejection(pending, CancelledError);
		expect(cancelCalled).toBe(true);
	});

	it('does not await stalled hashing after abort', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		let markDigestStarted!: () => void;
		const digestStarted = new Promise<void>((resolve) => {
			markDigestStarted = resolve;
		});
		vi.stubGlobal('crypto', {
			subtle: {
				digest() {
					markDigestStarted();
					return new Promise<ArrayBuffer>(() => {});
				}
			}
		});
		const pending = preflightAwkRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch,
			signal: controller.signal
		});
		await digestStarted;
		controller.abort(new Error('stop stalled AWK digest'));
		await expectPromptRejection(pending, CancelledError);
	});

	it('does not await stalled decompression or its cleanup after abort', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		let markDecompressionStarted!: () => void;
		const decompressionStarted = new Promise<void>((resolve) => {
			markDecompressionStarted = resolve;
		});
		class StalledDecompressionStream {
			constructor() {
				markDecompressionStarted();
				return new TransformStream<Uint8Array, Uint8Array>({
					transform() {
						return new Promise<void>(() => {});
					}
				}) as StalledDecompressionStream;
			}
		}
		vi.stubGlobal('DecompressionStream', StalledDecompressionStream);
		const pending = preflightAwkRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch,
			signal: controller.signal
		});
		await decompressionStarted;
		controller.abort(new Error('stop stalled AWK decompression'));
		await expectPromptRejection(pending, CancelledError);
	});

	it('times out a custom fetch that never settles', async () => {
		const fixture = createFixture();
		const fetch = vi.fn(() => new Promise<Response>(() => {})) as typeof globalThis.fetch;
		await expect(
			preflightAwkRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch,
				limits: { assetTimeoutMs: 5 }
			})
		).rejects.toBeInstanceOf(TimeoutError);
	});
});
