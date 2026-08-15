// @vitest-environment node

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JRuntimePreflightProfile } from './assets';
import { preflightJRuntimeAssets } from './jPreflight';

const baseUrl = 'https://runtime.example/nested/wasm-j/';
const fingerprint = 'a'.repeat(64);
const manifestBytes = Buffer.from('{"runtime":"fixture"}\n', 'utf8');
const moduleBytes = Buffer.from('export default function createJ() {}\n', 'utf8');
const wasmBytes = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const wasmGzipBytes = gzipSync(wasmBytes, { level: 9 });

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const profile: JRuntimePreflightProfile = Object.freeze({
	profileId: 'jsoftware-j-playground-test',
	sourceRevision: 'fixture',
	manifestFingerprint: fingerprint,
	manifestReceipt: Object.freeze({
		bytes: manifestBytes.byteLength,
		sha256: sha256(manifestBytes)
	}),
	moduleReceipt: Object.freeze({
		bytes: moduleBytes.byteLength,
		sha256: sha256(moduleBytes)
	}),
	wasmReceipt: Object.freeze({
		bytes: wasmGzipBytes.byteLength,
		sha256: sha256(wasmGzipBytes),
		uncompressedBytes: wasmBytes.byteLength,
		uncompressedSha256: sha256(wasmBytes)
	})
});

function responseFor(
	requestUrl: string,
	overrides: {
		contentEncoding?: string;
		finalUrl?: string;
		gzipBytes?: Uint8Array;
		moduleBytes?: Uint8Array;
	} = {}
) {
	const pathname = new URL(requestUrl).pathname;
	const bytes = pathname.endsWith('/runtime-manifest.v2.json')
		? manifestBytes
		: pathname.endsWith('/jamalgam.js')
			? (overrides.moduleBytes ?? moduleBytes)
			: pathname.endsWith('/jamalgam.wasm.gz.bin')
				? (overrides.gzipBytes ?? wasmGzipBytes)
				: new Uint8Array();
	const contentType = pathname.endsWith('.json')
		? 'application/json'
		: pathname.endsWith('.js')
			? 'application/javascript'
			: 'application/gzip';
	const response = new Response(Uint8Array.from(bytes), {
		status: 200,
		headers: {
			'content-length': String(bytes.byteLength),
			'content-type': contentType,
			...(overrides.contentEncoding ? { 'content-encoding': overrides.contentEncoding } : {})
		}
	});
	Object.defineProperty(response, 'url', { value: overrides.finalUrl ?? requestUrl });
	return response;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('preflightJRuntimeAssets', () => {
	it('verifies cache-busted storage assets and returns only logical worker payload bytes', async () => {
		const requests: string[] = [];
		const progress: string[] = [];
		const payload = await preflightJRuntimeAssets({
			baseUrl,
			manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
			profile,
			fetch: vi.fn(async (input) => {
				const requestUrl = String(input);
				requests.push(requestUrl);
				return responseFor(requestUrl);
			}),
			reportProgress(value) {
				progress.push(value.assetKey);
			}
		});

		expect(requests.sort()).toEqual(
			[
				`${baseUrl}jamalgam.js?v=${profile.moduleReceipt!.sha256}`,
				`${baseUrl}jamalgam.wasm.gz.bin?v=${profile.wasmReceipt!.sha256}`,
				`${baseUrl}runtime-manifest.v2.json?v=${fingerprint}`
			].sort()
		);
		expect(requests.some((url) => /jamalgam\.wasm(?:\?|$)/u.test(url))).toBe(false);
		expect(new TextDecoder().decode(payload.manifestBytes)).toBe(
			manifestBytes.toString('utf8')
		);
		expect(new TextDecoder().decode(payload.moduleBytes)).toBe(moduleBytes.toString('utf8'));
		expect(payload.wasmBytes).toEqual(Uint8Array.from(wasmBytes));
		expect(payload).toMatchObject({
			protocol: 'wasm-idle-j-preflight',
			protocolVersion: 1,
			profileId: profile.profileId,
			sourceRevision: profile.sourceRevision,
			manifestFingerprint: fingerprint
		});
		expect(new Set(progress)).toEqual(new Set(['manifest', 'module', 'wasm']));
	});

	it('accepts an exact pinned manifest query', async () => {
		const fetch = vi.fn(async (input) => responseFor(String(input)));

		await expect(
			preflightJRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json?v=${fingerprint}`,
				profile,
				fetch
			})
		).resolves.toMatchObject({ manifestFingerprint: fingerprint });
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('rejects incomplete custom profiles and cross-origin manifests before fetching', async () => {
		const fetch = vi.fn();

		await expect(
			preflightJRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile: { ...profile, moduleReceipt: undefined },
				fetch
			})
		).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'J' });
		await expect(
			preflightJRuntimeAssets({
				baseUrl,
				manifestUrl: 'https://untrusted.example/runtime-manifest.v2.json',
				profile,
				fetch
			})
		).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'J' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects corrupted compressed storage and logical Wasm receipts', async () => {
		const corruptGzip = Uint8Array.from(wasmGzipBytes);
		corruptGzip[corruptGzip.byteLength - 1] ^= 1;
		await expect(
			preflightJRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile,
				fetch: vi.fn(async (input) =>
					responseFor(String(input), { gzipBytes: corruptGzip })
				)
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'J' });

		await expect(
			preflightJRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile: {
					...profile,
					wasmReceipt: {
						...profile.wasmReceipt!,
						uncompressedSha256: 'b'.repeat(64)
					}
				},
				fetch: vi.fn(async (input) => responseFor(String(input)))
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'J' });
	});

	it('bounds gzip expansion and rejects transparent HTTP decompression', async () => {
		await expect(
			preflightJRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile: {
					...profile,
					wasmReceipt: {
						...profile.wasmReceipt!,
						uncompressedBytes: wasmBytes.byteLength - 1
					}
				},
				fetch: vi.fn(async (input) => responseFor(String(input)))
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'J' });

		await expect(
			preflightJRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile,
				fetch: vi.fn(async (input) => {
					const requestUrl = String(input);
					return responseFor(requestUrl, {
						contentEncoding: requestUrl.includes('jamalgam.wasm.gz.bin')
							? 'gzip'
							: undefined
					});
				})
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'J' });
	});

	it('rejects an unexpected final URL and deterministic cancellation', async () => {
		await expect(
			preflightJRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile,
				fetch: vi.fn(async (input) => {
					const requestUrl = String(input);
					return responseFor(requestUrl, {
						finalUrl: requestUrl.includes('jamalgam.js')
							? `${baseUrl}other.js?v=${profile.moduleReceipt!.sha256}`
							: requestUrl
					});
				})
			})
		).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'J' });

		const controller = new AbortController();
		controller.abort(new Error('cancel fixture'));
		await expect(
			preflightJRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile,
				signal: controller.signal,
				fetch: vi.fn()
			})
		).rejects.toMatchObject({ code: 'cancelled', runtimeId: 'J' });
	});
});
