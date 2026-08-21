// @vitest-environment node

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
	AssetIntegrityError,
	AssetTooLargeError,
	CancelledError,
	PERL_MAX_ASSET_BYTES,
	PERL_PREFLIGHT_PROTOCOL,
	PERL_PREFLIGHT_PROTOCOL_VERSION,
	ProtocolError,
	RuntimeConfigurationError,
	TimeoutError,
	clonePerlRuntimePreflightPayload,
	preflightPerlRuntimeAssets,
	requirePerlRuntimePreflightPayload,
	snapshotPerlRuntimePreflightProfile,
	verifyPerlRuntimePreflightPayload,
	type PerlRuntimePreflightPayload,
	type PerlRuntimePreflightProfile
} from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';
import { computePerlRuntimeFingerprint } from '../../scripts/sync-wasm-perl.mjs';

const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function createFixture() {
	const baseUrl = 'https://assets.example.com/releases/wasm-perl/';
	const artifactRevision = '6f2173d29a2c2e3536e1de75ff5d291ae96ab348';
	const webperlRevision = artifactRevision;
	const perlRevision = 'e70d909feb796ec99d5e91de5d1635d4526ec131';
	const emscriptenRevision = '69ab40586822209758165df170e9fc8b81e05608';
	const javascriptBytes = encoder.encode(
		'var Module=typeof Module!=="undefined"?Module:{};Module["getPreloadedPackage"];Module["wasmBinary"];'
	);
	const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
	const dataBytes = encoder.encode('fixture WebPerl data');
	const compressedJavaScriptBytes = Uint8Array.from(gzipSync(javascriptBytes));
	const compressedWasmBytes = Uint8Array.from(gzipSync(wasmBytes));
	const compressedDataBytes = Uint8Array.from(gzipSync(dataBytes));
	const manifest = {
		format: 'wasm-perl-runtime-manifest-v2',
		runtime: 'webperl',
		profileId: 'webperl-v0.09-beta-perl-5.28.1-emscripten-1.38.28',
		licenseExpression: 'Artistic-1.0-Perl OR GPL-1.0-or-later',
		artifact: {
			kind: 'opaque-prebuilt',
			repository: 'https://github.com/haukex/webperl.git',
			revision: artifactRevision,
			tag: 'v0.09-beta',
			doi: '10.5281/zenodo.2582586',
			path: 'webperl_prebuilt_v0.09-beta.zip',
			url: 'https://zenodo.org/api/records/2582586/files/webperl_prebuilt_v0.09-beta.zip/content',
			size: 3_936_557,
			sha256: '5f441249217e90ab378c666f473d4206ab4f44907f6bb0aa8d70834bc38c40dc'
		},
		components: {
			webperl: {
				version: 'v0.09-beta',
				repository: 'https://github.com/haukex/webperl.git',
				revision: webperlRevision,
				verifiedBuildInput: false,
				evidence: 'release tag and opaque prebuilt archive'
			},
			perl: {
				version: '5.28.1',
				repository: 'https://github.com/haukex/emperl5.git',
				revision: perlRevision,
				verifiedBuildInput: false,
				evidence:
					'embedded runtime version string and versioned WebPerl build configuration'
			},
			emscripten: {
				version: '1.38.28',
				repository: 'https://github.com/emscripten-core/emscripten.git',
				revision: emscriptenRevision,
				verifiedBuildInput: false,
				evidence: 'versioned WebPerl build configuration'
			},
			cpanExtensions: {
				modules: ['Cpanel::JSON::XS', 'Devel::StackTrace', 'Future'],
				verifiedBuildInput: false,
				evidence: 'versioned WebPerl build configuration without transitive artifact locks'
			}
		},
		licenses: [
			{
				path: 'licenses/LICENSE_artistic.txt',
				spdx: 'Artistic-1.0-Perl',
				size: 1,
				sha256: sha256(encoder.encode('a'))
			},
			{
				path: 'licenses/LICENSE_gpl.txt',
				spdx: 'GPL-1.0-or-later',
				size: 1,
				sha256: sha256(encoder.encode('g'))
			}
		],
		metadata: {
			path: 'runtime-build.json',
			mediaType: 'application/json',
			size: 2,
			sha256: sha256(encoder.encode('{}'))
		},
		assets: [
			{
				path: 'emperl.js',
				mediaType: 'text/javascript',
				size: javascriptBytes.byteLength,
				sha256: sha256(javascriptBytes)
			},
			{
				path: 'emperl.wasm',
				mediaType: 'application/wasm',
				size: wasmBytes.byteLength,
				sha256: sha256(wasmBytes)
			},
			{
				path: 'emperl.data',
				mediaType: 'application/octet-stream',
				size: dataBytes.byteLength,
				sha256: sha256(dataBytes)
			}
		],
		storage: [
			{
				path: 'emperl.js.gz.bin',
				logicalPath: 'emperl.js',
				encoding: 'gzip' as const,
				size: compressedJavaScriptBytes.byteLength,
				sha256: sha256(compressedJavaScriptBytes)
			},
			{
				path: 'emperl.wasm.gz.bin',
				logicalPath: 'emperl.wasm',
				encoding: 'gzip' as const,
				size: compressedWasmBytes.byteLength,
				sha256: sha256(compressedWasmBytes)
			},
			{
				path: 'emperl.data.gz.bin',
				logicalPath: 'emperl.data',
				encoding: 'gzip' as const,
				size: compressedDataBytes.byteLength,
				sha256: sha256(compressedDataBytes)
			}
		]
	};
	const manifestFingerprint = computePerlRuntimeFingerprint(manifest);
	const manifestBytes = encoder.encode(
		JSON.stringify({ ...manifest, fingerprint: manifestFingerprint })
	);
	const profile = {
		profileId: manifest.profileId,
		artifactRevision,
		webperlRevision,
		perlRevision,
		emscriptenRevision,
		manifestFingerprint,
		manifestReceipt: { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
		javascriptReceipt: {
			bytes: compressedJavaScriptBytes.byteLength,
			sha256: sha256(compressedJavaScriptBytes),
			uncompressedBytes: javascriptBytes.byteLength,
			uncompressedSha256: sha256(javascriptBytes)
		},
		wasmReceipt: {
			bytes: compressedWasmBytes.byteLength,
			sha256: sha256(compressedWasmBytes),
			uncompressedBytes: wasmBytes.byteLength,
			uncompressedSha256: sha256(wasmBytes)
		},
		dataReceipt: {
			bytes: compressedDataBytes.byteLength,
			sha256: sha256(compressedDataBytes),
			uncompressedBytes: dataBytes.byteLength,
			uncompressedSha256: sha256(dataBytes)
		}
	} satisfies PerlRuntimePreflightProfile;
	const manifestUrl = `${baseUrl}runtime-manifest.v2.json?v=${manifestFingerprint}`;
	const responses = new Map<string, Uint8Array>([
		[manifestUrl, manifestBytes],
		[
			`${baseUrl}emperl.js.gz.bin?v=${profile.javascriptReceipt.sha256}`,
			compressedJavaScriptBytes
		],
		[`${baseUrl}emperl.wasm.gz.bin?v=${profile.wasmReceipt.sha256}`, compressedWasmBytes],
		[`${baseUrl}emperl.data.gz.bin?v=${profile.dataReceipt.sha256}`, compressedDataBytes]
	]);
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		requests.push({ url, init });
		const bytes = responses.get(url);
		const response = bytes
			? new Response(Uint8Array.from(bytes), {
					status: 200,
					headers: {
						'content-length': String(bytes.byteLength),
						'content-type': url.includes('runtime-manifest')
							? 'application/json'
							: 'application/octet-stream'
					}
				})
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
		compressedDataBytes,
		compressedWasmBytes,
		responses,
		requests,
		fetch
	};
}

describe('WebPerl runtime host preflight', () => {
	it('downloads only pinned canonical storage and returns verified logical bytes', async () => {
		const fixture = createFixture();
		const payload = await preflightPerlRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch
		});

		expect(payload).toMatchObject({
			protocol: PERL_PREFLIGHT_PROTOCOL,
			protocolVersion: PERL_PREFLIGHT_PROTOCOL_VERSION,
			profileId: fixture.profile.profileId,
			artifactRevision: fixture.profile.artifactRevision,
			webperlRevision: fixture.profile.webperlRevision,
			perlRevision: fixture.profile.perlRevision,
			emscriptenRevision: fixture.profile.emscriptenRevision,
			manifestFingerprint: fixture.profile.manifestFingerprint
		});
		expect(payload.manifestBytes).toEqual(fixture.manifestBytes);
		expect(payload.javascriptBytes).toEqual(fixture.javascriptBytes);
		expect(payload.wasmBytes).toEqual(fixture.wasmBytes);
		expect(payload.dataBytes).toEqual(fixture.dataBytes);
		expect(fixture.requests.map(({ url }) => url).sort()).toEqual(
			[
				fixture.manifestUrl,
				`${fixture.baseUrl}emperl.js.gz.bin?v=${fixture.profile.javascriptReceipt.sha256}`,
				`${fixture.baseUrl}emperl.wasm.gz.bin?v=${fixture.profile.wasmReceipt.sha256}`,
				`${fixture.baseUrl}emperl.data.gz.bin?v=${fixture.profile.dataReceipt.sha256}`
			].sort()
		);
		for (const { init } of fixture.requests) {
			expect(init).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
	});

	it('snapshots exact profiles and clones exact payload byte arrays', async () => {
		const fixture = createFixture();
		const profile = snapshotPerlRuntimePreflightProfile(fixture.profile);
		const payload = await preflightPerlRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile,
			fetch: fixture.fetch
		});
		const clone = clonePerlRuntimePreflightPayload(payload);

		expect(profile).toEqual(fixture.profile);
		expect(clone).toEqual(payload);
		expect(clone).not.toBe(payload);
		expect(clone.javascriptBytes).not.toBe(payload.javascriptBytes);
		await expect(verifyPerlRuntimePreflightPayload(clone)).resolves.toBe(clone);
		expect(() => requirePerlRuntimePreflightPayload({ ...payload, extra: true })).toThrow(
			ProtocolError
		);
	});

	it('rejects partial profiles before any network request', async () => {
		const fixture = createFixture();
		const incomplete = { ...fixture.profile, dataReceipt: undefined };

		await expect(
			preflightPerlRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: incomplete as unknown as PerlRuntimePreflightProfile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		expect(fixture.fetch).not.toHaveBeenCalled();
	});

	it('rejects HTTP-transparent gzip decoding', async () => {
		const fixture = createFixture();
		const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const response = await fixture.fetch(input, init);
			if (!String(input).includes('emperl.wasm.gz.bin')) return response;
			const decoded = new Response(fixture.wasmBytes, {
				status: 200,
				headers: {
					'content-encoding': 'gzip',
					'content-length': String(fixture.wasmBytes.byteLength)
				}
			});
			Object.defineProperty(decoded, 'url', { value: String(input) });
			return decoded;
		}) as typeof globalThis.fetch;

		await expect(
			preflightPerlRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch
			})
		).rejects.toBeInstanceOf(AssetIntegrityError);
	});

	it('rejects a corrupt compressed asset before returning a payload', async () => {
		const fixture = createFixture();
		fixture.responses.set(
			`${fixture.baseUrl}emperl.data.gz.bin?v=${fixture.profile.dataReceipt.sha256}`,
			Uint8Array.from([...fixture.compressedDataBytes, 0])
		);

		await expect(
			preflightPerlRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(AssetIntegrityError);
	});

	it('enforces the aggregate logical byte limit before fetching', async () => {
		const fixture = createFixture();
		const profile = {
			...fixture.profile,
			javascriptReceipt: {
				...fixture.profile.javascriptReceipt,
				uncompressedBytes: 1
			},
			wasmReceipt: {
				...fixture.profile.wasmReceipt,
				uncompressedBytes: PERL_MAX_ASSET_BYTES
			},
			dataReceipt: {
				...fixture.profile.dataReceipt,
				uncompressedBytes: PERL_MAX_ASSET_BYTES
			}
		};

		await expect(
			preflightPerlRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(AssetTooLargeError);
		expect(fixture.fetch).not.toHaveBeenCalled();
		expect(PERL_MAX_ASSET_BYTES).toBe(16 * 1024 * 1024);
	});

	it('rejects an unpinned manifest query and cross-origin asset base', async () => {
		const fixture = createFixture();

		await expect(
			preflightPerlRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: `${fixture.baseUrl}runtime-manifest.v2.json?v=wrong`,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		await expect(
			preflightPerlRuntimeAssets({
				baseUrl: 'https://other.example.com/wasm-perl/',
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		expect(fixture.fetch).not.toHaveBeenCalled();
	});

	it('maps caller aborts to a typed cancellation', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		controller.abort(new Error('stop'));

		await expect(
			preflightPerlRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch,
				signal: controller.signal
			})
		).rejects.toBeInstanceOf(CancelledError);
	});

	it('times out a stalled asset request', async () => {
		const fixture = createFixture();
		const stalledFetch = vi.fn(() => new Promise<Response>(() => {})) as typeof fetch;

		await expect(
			preflightPerlRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: stalledFetch,
				limits: { assetTimeoutMs: 10 }
			})
		).rejects.toBeInstanceOf(TimeoutError);
	});

	it('rejects payload identity and logical byte tampering', async () => {
		const fixture = createFixture();
		const payload = await preflightPerlRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch
		});
		const wrongIdentity: PerlRuntimePreflightPayload = {
			...payload,
			perlRevision: '0'.repeat(40)
		};
		const wrongBytes: PerlRuntimePreflightPayload = {
			...payload,
			dataBytes: Uint8Array.from([...payload.dataBytes, 0])
		};

		await expect(verifyPerlRuntimePreflightPayload(wrongIdentity)).rejects.toBeInstanceOf(
			AssetIntegrityError
		);
		await expect(verifyPerlRuntimePreflightPayload(wrongBytes)).rejects.toBeInstanceOf(
			AssetIntegrityError
		);
	});
});
