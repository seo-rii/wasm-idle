// @vitest-environment node

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
	AssetIntegrityError,
	AssetTooLargeError,
	CancelledError,
	PROLOG_MAX_ASSET_BYTES,
	PROLOG_PREFLIGHT_PROTOCOL,
	PROLOG_PREFLIGHT_PROTOCOL_VERSION,
	ProtocolError,
	RuntimeConfigurationError,
	TimeoutError,
	UnsupportedBrowserFeatureError,
	preflightPrologRuntimeAssets,
	requirePrologRuntimePreflightPayload,
	snapshotPrologRuntimePreflightProfile,
	verifyPrologRuntimePreflightPayload,
	type PrologRuntimePreflightPayload,
	type PrologRuntimePreflightProfile
} from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computePrologRuntimeFingerprint } from '../../scripts/sync-wasm-prolog.mjs';

const encoder = new TextEncoder();

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

interface FixtureOptions {
	readonly declaredWasmBytes?: number;
	readonly declaredDataBytes?: number;
}

function createFixture(options: FixtureOptions = {}) {
	const baseUrl = 'https://assets.example.com/releases/wasm-prolog/';
	const javascriptBytes = encoder.encode('globalThis.SWIPL = async () => ({});\n');
	const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
	const dataBytes = encoder.encode('fixture SWI-Prolog data');
	const compressedWasmBytes = Uint8Array.from(gzipSync(wasmBytes));
	const compressedDataBytes = Uint8Array.from(gzipSync(dataBytes));
	const declaredWasmBytes = options.declaredWasmBytes ?? wasmBytes.byteLength;
	const declaredDataBytes = options.declaredDataBytes ?? dataBytes.byteLength;
	const manifest = {
		format: 'wasm-prolog-runtime-manifest-v2',
		runtime: 'swipl-wasm',
		profileId: 'swipl-wasm-8.0.1-swipl-10.1.9',
		package: {
			name: 'swipl-wasm',
			version: '8.0.1',
			repository: 'https://github.com/SWI-Prolog/npm-swipl-wasm.git',
			revision: '18fa003833dd4fb2531195063291687255038372',
			tarball: 'https://registry.npmjs.org/swipl-wasm/-/swipl-wasm-8.0.1.tgz',
			integrity: 'sha512-fixture'
		},
		toolchain: {
			swiplVersion: '10.1.9',
			swiplRevision: '6be143dbd030cc9ea621cde719a37f8385575453',
			emsdkVersion: '6.0.0',
			emsdkRevision: 'd223ae73c6998296e3ab27cf81dc2c2c9fd383de',
			zlibVersion: '1.3.2',
			pcre2Version: '10.47',
			pcre2Revision: 'f454e231fe5006dd7ff8f4693fd2b8eb94333429'
		},
		license: {
			path: 'LICENSE.txt',
			spdx: 'BSD-2-Clause',
			size: 7,
			sha256: sha256(encoder.encode('license'))
		},
		metadata: {
			path: 'runtime-build.json',
			mediaType: 'application/json',
			size: 2,
			sha256: sha256(encoder.encode('{}'))
		},
		assets: [
			{
				path: 'swipl-web.js',
				mediaType: 'text/javascript',
				size: javascriptBytes.byteLength,
				sha256: sha256(javascriptBytes)
			},
			{
				path: 'swipl-web.wasm',
				mediaType: 'application/wasm',
				size: declaredWasmBytes,
				sha256: sha256(wasmBytes)
			},
			{
				path: 'swipl-web.data',
				mediaType: 'application/octet-stream',
				size: declaredDataBytes,
				sha256: sha256(dataBytes)
			}
		],
		storage: [
			{
				path: 'swipl-web.js',
				logicalPath: 'swipl-web.js',
				encoding: 'identity' as const,
				size: javascriptBytes.byteLength,
				sha256: sha256(javascriptBytes)
			},
			{
				path: 'swipl-web.wasm.gz.bin',
				logicalPath: 'swipl-web.wasm',
				encoding: 'gzip' as const,
				size: compressedWasmBytes.byteLength,
				sha256: sha256(compressedWasmBytes)
			},
			{
				path: 'swipl-web.data.gz.bin',
				logicalPath: 'swipl-web.data',
				encoding: 'gzip' as const,
				size: compressedDataBytes.byteLength,
				sha256: sha256(compressedDataBytes)
			}
		]
	};
	const manifestFingerprint = computePrologRuntimeFingerprint(manifest);
	const manifestBytes = encoder.encode(
		JSON.stringify({
			...manifest,
			fingerprint: manifestFingerprint
		})
	);
	const profile = {
		profileId: manifest.profileId,
		packageRevision: manifest.package.revision,
		swiplRevision: manifest.toolchain.swiplRevision,
		manifestFingerprint,
		manifestReceipt: {
			bytes: manifestBytes.byteLength,
			sha256: sha256(manifestBytes)
		},
		javascriptReceipt: {
			bytes: javascriptBytes.byteLength,
			sha256: sha256(javascriptBytes)
		},
		wasmReceipt: {
			bytes: compressedWasmBytes.byteLength,
			sha256: sha256(compressedWasmBytes),
			uncompressedBytes: declaredWasmBytes,
			uncompressedSha256: sha256(wasmBytes)
		},
		dataReceipt: {
			bytes: compressedDataBytes.byteLength,
			sha256: sha256(compressedDataBytes),
			uncompressedBytes: declaredDataBytes,
			uncompressedSha256: sha256(dataBytes)
		}
	} satisfies PrologRuntimePreflightProfile;
	const manifestUrl = `${baseUrl}runtime-manifest.v2.json?v=${manifestFingerprint}`;
	const responses = new Map<string, { bytes: Uint8Array; headers: HeadersInit }>([
		[manifestUrl, { bytes: manifestBytes, headers: { 'content-type': 'application/json' } }],
		[
			`${baseUrl}swipl-web.js?v=${profile.javascriptReceipt.sha256}`,
			{ bytes: javascriptBytes, headers: { 'content-type': 'text/javascript' } }
		],
		[
			`${baseUrl}swipl-web.wasm.gz.bin?v=${profile.wasmReceipt.sha256}`,
			{ bytes: compressedWasmBytes, headers: { 'content-type': 'application/octet-stream' } }
		],
		[
			`${baseUrl}swipl-web.data.gz.bin?v=${profile.dataReceipt.sha256}`,
			{ bytes: compressedDataBytes, headers: { 'content-type': 'application/octet-stream' } }
		]
	]);
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		requests.push({ url, init });
		const entry = responses.get(url);
		const response = entry
			? new Response(Uint8Array.from(entry.bytes), { status: 200, headers: entry.headers })
			: new Response('missing', { status: 404 });
		Object.defineProperty(response, 'url', { value: url });
		return response;
	}) as typeof globalThis.fetch;
	return {
		baseUrl,
		manifestUrl,
		profile,
		manifestBytes,
		javascriptBytes,
		wasmBytes,
		dataBytes,
		compressedWasmBytes,
		compressedDataBytes,
		responses,
		requests,
		fetch
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('SWI-Prolog runtime host preflight', () => {
	it('loads only pinned canonical storage assets and returns logical no-fetch payload bytes', async () => {
		const fixture = createFixture();
		const progress: string[] = [];

		const payload = await preflightPrologRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch,
			reportProgress: ({ assetKey }) => progress.push(assetKey)
		});

		expect(payload).toMatchObject({
			protocol: PROLOG_PREFLIGHT_PROTOCOL,
			protocolVersion: PROLOG_PREFLIGHT_PROTOCOL_VERSION,
			profileId: fixture.profile.profileId,
			packageRevision: fixture.profile.packageRevision,
			swiplRevision: fixture.profile.swiplRevision,
			manifestFingerprint: fixture.profile.manifestFingerprint
		});
		expect(payload.manifestBytes).toEqual(fixture.manifestBytes);
		expect(payload.javascriptBytes).toEqual(fixture.javascriptBytes);
		expect(payload.wasmBytes).toEqual(fixture.wasmBytes);
		expect(payload.dataBytes).toEqual(fixture.dataBytes);
		expect(fixture.requests.map(({ url }) => url).sort()).toEqual(
			[...fixture.responses.keys()].sort()
		);
		expect(fixture.requests.every(({ url }) => !/\.gz(?:\?|$)/u.test(url))).toBe(true);
		expect(fixture.requests).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ url: expect.stringContaining('swipl-web.wasm?') }),
				expect.objectContaining({ url: expect.stringContaining('swipl-web.data?') })
			])
		);
		for (const { init } of fixture.requests) {
			expect(init).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
			expect(init?.signal).toBeInstanceOf(AbortSignal);
		}
		expect(new Set(progress)).toEqual(new Set(['manifest', 'javascript', 'wasm', 'data']));
	});

	it('snapshots only complete exact profile and payload contracts', () => {
		const fixture = createFixture();
		const profile = snapshotPrologRuntimePreflightProfile(fixture.profile);
		expect(profile).toEqual(fixture.profile);
		expect(Object.isFrozen(profile)).toBe(true);
		expect(Object.isFrozen(profile.wasmReceipt)).toBe(true);

		expect(() =>
			snapshotPrologRuntimePreflightProfile({ ...fixture.profile, extra: true })
		).toThrow(RuntimeConfigurationError);
		const { dataReceipt: _missing, ...incomplete } = fixture.profile;
		expect(() => snapshotPrologRuntimePreflightProfile(incomplete)).toThrow(
			RuntimeConfigurationError
		);
		expect(() =>
			requirePrologRuntimePreflightPayload({
				protocol: PROLOG_PREFLIGHT_PROTOCOL,
				protocolVersion: PROLOG_PREFLIGHT_PROTOCOL_VERSION,
				profileId: fixture.profile.profileId,
				packageRevision: fixture.profile.packageRevision,
				swiplRevision: fixture.profile.swiplRevision,
				manifestFingerprint: fixture.profile.manifestFingerprint,
				manifestBytes: fixture.manifestBytes,
				javascriptBytes: fixture.javascriptBytes,
				wasmBytes: fixture.wasmBytes,
				dataBytes: fixture.dataBytes,
				extra: true
			})
		).toThrow(ProtocolError);
	});

	it('rejects corrupt delivery bytes before producing a runtime payload', async () => {
		const fixture = createFixture();
		const wasmUrl = `${fixture.baseUrl}swipl-web.wasm.gz.bin?v=${fixture.profile.wasmReceipt.sha256}`;
		fixture.responses.set(wasmUrl, {
			bytes: Uint8Array.from([...fixture.compressedWasmBytes, 0]),
			headers: { 'content-type': 'application/octet-stream' }
		});

		await expect(
			preflightPrologRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toThrow(AssetIntegrityError);
	});

	it('rejects a delivery receipt generation that disagrees with the pinned manifest graph', async () => {
		const fixture = createFixture();
		const replacementWasmStorage = Uint8Array.from(fixture.compressedWasmBytes);
		replacementWasmStorage[4] = 1;
		const replacementReceipt = {
			...fixture.profile.wasmReceipt,
			sha256: sha256(replacementWasmStorage)
		};
		const wasmUrl = `${fixture.baseUrl}swipl-web.wasm.gz.bin?v=${replacementReceipt.sha256}`;
		fixture.responses.set(wasmUrl, {
			bytes: replacementWasmStorage,
			headers: { 'content-type': 'application/octet-stream' }
		});

		await expect(
			preflightPrologRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: { ...fixture.profile, wasmReceipt: replacementReceipt },
				fetch: fixture.fetch
			})
		).rejects.toThrow('manifest receipts do not match the selected preflight profile');
	});

	it('rejects HTTP-transparent gzip decoding at the delivery boundary', async () => {
		const fixture = createFixture();
		const wasmUrl = `${fixture.baseUrl}swipl-web.wasm.gz.bin?v=${fixture.profile.wasmReceipt.sha256}`;
		fixture.responses.get(wasmUrl)!.headers = {
			'content-encoding': 'gzip',
			'content-type': 'application/octet-stream'
		};

		await expect(
			preflightPrologRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toThrow('transparently gzip-decoded');
	});

	it('bounds gzip expansion by the logical receipt', async () => {
		const fixture = createFixture({ declaredDataBytes: 4 });

		await expect(
			preflightPrologRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toThrow('gzip output exceeds its logical receipt');
	});

	it('fails closed when gzip decompression is unavailable', async () => {
		const fixture = createFixture();
		vi.stubGlobal('DecompressionStream', undefined);

		await expect(
			preflightPrologRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(UnsupportedBrowserFeatureError);
	});

	it.each([
		['escaped manifest', 'https://assets.example.com/releases/other/manifest.json'],
		['cross-origin manifest', 'https://evil.example/manifest.json'],
		[
			'wrong manifest pin',
			'https://assets.example.com/releases/wasm-prolog/runtime-manifest.v2.json?v=wrong'
		]
	])('rejects %s before issuing a request', async (_label, manifestUrl) => {
		const fixture = createFixture();
		await expect(
			preflightPrologRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		expect(fixture.fetch).not.toHaveBeenCalled();
	});

	it('rejects receipt sizes above the active cap before issuing a request', async () => {
		const fixture = createFixture();
		await expect(
			preflightPrologRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				limits: { maxAssetBytes: fixture.javascriptBytes.byteLength - 1 },
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(AssetTooLargeError);
		expect(fixture.fetch).not.toHaveBeenCalled();
		expect(PROLOG_MAX_ASSET_BYTES).toBe(32 * 1024 * 1024);
	});

	it('preserves deterministic caller cancellation without creating a payload', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		controller.abort(new Error('stop Prolog preflight'));

		await expect(
			preflightPrologRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch,
				signal: controller.signal
			})
		).rejects.toBeInstanceOf(CancelledError);
		expect(fixture.fetch).not.toHaveBeenCalled();
	});

	it('times out a stalled asset request', async () => {
		const fixture = createFixture();
		const stalledFetch = vi.fn(() => new Promise<Response>(() => {})) as typeof fetch;

		await expect(
			preflightPrologRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: stalledFetch,
				limits: { assetTimeoutMs: 10 }
			})
		).rejects.toBeInstanceOf(TimeoutError);
	});

	it('revalidates the full manifest graph and logical bytes on payload receipt', async () => {
		const fixture = createFixture();
		const payload = await preflightPrologRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch
		});
		await expect(verifyPrologRuntimePreflightPayload(payload)).resolves.toBe(payload);

		const corruptPayload: PrologRuntimePreflightPayload = {
			...payload,
			dataBytes: Uint8Array.from([...payload.dataBytes, 0])
		};
		await expect(verifyPrologRuntimePreflightPayload(corruptPayload)).rejects.toBeInstanceOf(
			AssetIntegrityError
		);
		const malformedManifestPayload: PrologRuntimePreflightPayload = {
			...payload,
			manifestBytes: encoder.encode('{}')
		};
		await expect(
			verifyPrologRuntimePreflightPayload(malformedManifestPayload)
		).rejects.toBeInstanceOf(AssetIntegrityError);
	});
});
