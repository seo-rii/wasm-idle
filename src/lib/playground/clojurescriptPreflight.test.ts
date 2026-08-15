// @vitest-environment node

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ClojureScriptRuntimePreflightProfile } from './assets';
import { preflightClojureScriptRuntimeAssets } from './clojurescriptPreflight';

const baseUrl = 'https://runtime.example/nested/wasm-clojurescript/';
const fingerprint = 'a'.repeat(64);
const manifestBytes = Buffer.from('{"runtime":"fixture"}\n', 'utf8');
const compilerBytes = Buffer.from(
	'globalThis.wasm_idle={runner:{execute(source,path,context,done){done({ok:true})}}};\n',
	'utf8'
);
const compilerGzipBytes = gzipSync(compilerBytes, { level: 9 });

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const profile: ClojureScriptRuntimePreflightProfile = Object.freeze({
	profileId: 'clojurescript-1.12.134-test',
	sourceRevision: 'r1.12.134',
	integrationRevision: 'b'.repeat(40),
	manifestFingerprint: fingerprint,
	manifestReceipt: Object.freeze({
		bytes: manifestBytes.byteLength,
		sha256: sha256(manifestBytes)
	}),
	compilerReceipt: Object.freeze({
		bytes: compilerGzipBytes.byteLength,
		sha256: sha256(compilerGzipBytes),
		uncompressedBytes: compilerBytes.byteLength,
		uncompressedSha256: sha256(compilerBytes)
	})
});

function responseFor(
	requestUrl: string,
	overrides: {
		compilerGzipBytes?: Uint8Array;
		contentEncoding?: string;
		finalUrl?: string;
	} = {}
) {
	const pathname = new URL(requestUrl).pathname;
	const bytes = pathname.endsWith('/runtime-manifest.v2.json')
		? manifestBytes
		: pathname.endsWith('/compiler.js.gz.bin')
			? (overrides.compilerGzipBytes ?? compilerGzipBytes)
			: new Uint8Array();
	const response = new Response(Uint8Array.from(bytes), {
		status: 200,
		headers: {
			'content-length': String(bytes.byteLength),
			'content-type': pathname.endsWith('.json')
				? 'application/json'
				: 'application/octet-stream',
			...(overrides.contentEncoding ? { 'content-encoding': overrides.contentEncoding } : {})
		}
	});
	Object.defineProperty(response, 'url', { value: overrides.finalUrl ?? requestUrl });
	return response;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('preflightClojureScriptRuntimeAssets', () => {
	it('verifies pinned storage assets and returns only logical worker payload bytes', async () => {
		const requests: string[] = [];
		const progress: string[] = [];
		const payload = await preflightClojureScriptRuntimeAssets({
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
				`${baseUrl}compiler.js.gz.bin?v=${profile.compilerReceipt!.sha256}`,
				`${baseUrl}runtime-manifest.v2.json?v=${fingerprint}`
			].sort()
		);
		expect(requests.some((url) => /compiler\.js(?:\?|$)/u.test(url))).toBe(false);
		expect(new TextDecoder().decode(payload.manifestBytes)).toBe(
			manifestBytes.toString('utf8')
		);
		expect(new TextDecoder().decode(payload.compilerBytes)).toBe(
			compilerBytes.toString('utf8')
		);
		expect(payload).toMatchObject({
			protocol: 'wasm-idle-clojurescript-preflight',
			protocolVersion: 1,
			profileId: profile.profileId,
			sourceRevision: profile.sourceRevision,
			integrationRevision: profile.integrationRevision,
			manifestFingerprint: fingerprint
		});
		expect(new Set(progress)).toEqual(new Set(['manifest', 'compiler']));
	});

	it('accepts only an exact pinned manifest query', async () => {
		const fetch = vi.fn(async (input) => responseFor(String(input)));

		await expect(
			preflightClojureScriptRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json?v=${fingerprint}`,
				profile,
				fetch
			})
		).resolves.toMatchObject({ manifestFingerprint: fingerprint });
		await expect(
			preflightClojureScriptRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json?other=1`,
				profile,
				fetch
			})
		).rejects.toMatchObject({ code: 'runtime-configuration' });
	});

	it('rejects incomplete custom profiles and cross-origin manifests before fetching', async () => {
		const fetch = vi.fn();

		await expect(
			preflightClojureScriptRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile: { ...profile, compilerReceipt: undefined },
				fetch
			})
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'CLOJURESCRIPT'
		});
		await expect(
			preflightClojureScriptRuntimeAssets({
				baseUrl,
				manifestUrl: 'https://untrusted.example/runtime-manifest.v2.json',
				profile,
				fetch
			})
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'CLOJURESCRIPT'
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it('enforces the worker 16 MiB hard ceiling before fetching', async () => {
		const fetch = vi.fn();

		await expect(
			preflightClojureScriptRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile: {
					...profile,
					compilerReceipt: {
						...profile.compilerReceipt!,
						uncompressedBytes: 17 * 1024 * 1024
					}
				},
				limits: { maxAssetBytes: 32 * 1024 * 1024 },
				fetch
			})
		).rejects.toMatchObject({
			code: 'asset-too-large',
			limit: 16 * 1024 * 1024,
			runtimeId: 'CLOJURESCRIPT'
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects corrupted compressed storage and logical compiler receipts', async () => {
		const corruptGzip = Uint8Array.from(compilerGzipBytes);
		corruptGzip[corruptGzip.byteLength - 1] ^= 1;
		await expect(
			preflightClojureScriptRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile,
				fetch: vi.fn(async (input) =>
					responseFor(String(input), { compilerGzipBytes: corruptGzip })
				)
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'CLOJURESCRIPT' });

		await expect(
			preflightClojureScriptRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile: {
					...profile,
					compilerReceipt: {
						...profile.compilerReceipt!,
						uncompressedSha256: 'c'.repeat(64)
					}
				},
				fetch: vi.fn(async (input) => responseFor(String(input)))
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'CLOJURESCRIPT' });
	});

	it('bounds gzip expansion and rejects transparent HTTP decompression', async () => {
		await expect(
			preflightClojureScriptRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile: {
					...profile,
					compilerReceipt: {
						...profile.compilerReceipt!,
						uncompressedBytes: compilerBytes.byteLength - 1
					}
				},
				fetch: vi.fn(async (input) => responseFor(String(input)))
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'CLOJURESCRIPT' });

		await expect(
			preflightClojureScriptRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile,
				fetch: vi.fn(async (input) => {
					const requestUrl = String(input);
					return responseFor(requestUrl, {
						contentEncoding: requestUrl.includes('compiler.js.gz.bin')
							? 'gzip'
							: undefined
					});
				})
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'CLOJURESCRIPT' });
	});

	it('rejects an unexpected final URL and deterministic cancellation', async () => {
		await expect(
			preflightClojureScriptRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile,
				fetch: vi.fn(async (input) => {
					const requestUrl = String(input);
					return responseFor(requestUrl, {
						finalUrl: requestUrl.includes('compiler.js.gz.bin')
							? `${baseUrl}other.bin?v=${profile.compilerReceipt!.sha256}`
							: requestUrl
					});
				})
			})
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'CLOJURESCRIPT'
		});

		const controller = new AbortController();
		controller.abort(new Error('cancel fixture'));
		await expect(
			preflightClojureScriptRuntimeAssets({
				baseUrl,
				manifestUrl: `${baseUrl}runtime-manifest.v2.json`,
				profile,
				signal: controller.signal,
				fetch: vi.fn()
			})
		).rejects.toMatchObject({ code: 'cancelled', runtimeId: 'CLOJURESCRIPT' });
	});
});
