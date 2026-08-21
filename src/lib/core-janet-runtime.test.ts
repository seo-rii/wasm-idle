// @vitest-environment node

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
	AssetIntegrityError,
	AssetTooLargeError,
	CancelledError,
	JANET_MAX_ASSET_BYTES,
	JANET_PREFLIGHT_PROTOCOL,
	JANET_PREFLIGHT_PROTOCOL_VERSION,
	ProtocolError,
	RuntimeConfigurationError,
	TimeoutError,
	cloneJanetRuntimePreflightPayload,
	preflightJanetRuntimeAssets,
	requireJanetRuntimePreflightPayload,
	snapshotJanetRuntimePreflightProfile,
	verifyJanetRuntimePreflightPayload,
	type JanetRuntimePreflightPayload,
	type JanetRuntimePreflightProfile
} from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';
import { computeJanetRuntimeFingerprint } from '../../scripts/sync-wasm-janet.mjs';

const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function createFixture() {
	const baseUrl = 'https://assets.example.com/releases/wasm-janet/';
	const artifactRevision = 'd647850cd6448b457f778d01c304358aefa5244b';
	const janetVersion = '1.41.3-dev';
	const emscriptenVersion = '3.1.8';
	const javascriptBytes = encoder.encode(
		'const Module = {}; Module["wasmBinary"]; Module.FS.init; Module.callMain; export default Module;'
	);
	const wasmBytes = Uint8Array.from([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		...encoder.encode(janetVersion)
	]);
	const compressedWasmBytes = Uint8Array.from(gzipSync(wasmBytes));
	const manifest = {
		format: 'wasm-janet-runtime-manifest-v2',
		runtime: 'janet-lang-janet',
		profileId: 'janet-1.41.3-dev-emscripten-3.1.8-wasm-idle-d647850c',
		licenseExpression: 'MIT',
		artifact: {
			kind: 'opaque-vendored',
			repository: 'https://github.com/seo-rii/wasm-idle.git',
			revision: artifactRevision,
			path: 'static/wasm-janet',
			provenance: 'legacy-import-unrecorded',
			verifiedBuildInput: false
		},
		components: {
			janet: {
				version: janetVersion,
				repository: 'https://github.com/janet-lang/janet.git',
				revision: 'unrecorded',
				verifiedBuildInput: false,
				evidence: 'embedded runtime version string'
			},
			emscripten: {
				version: emscriptenVersion,
				repository: 'https://github.com/emscripten-core/emscripten.git',
				revision: 'unrecorded',
				verifiedBuildInput: false,
				evidence: 'unverified metadata copied from the initial vendored runtime manifest'
			}
		},
		build: {
			options: [
				'ENVIRONMENT=worker',
				'MODULARIZE=1',
				'EXPORT_ES6=1',
				'FORCE_FILESYSTEM=1',
				'INVOKE_RUN=0',
				'EXIT_RUNTIME=1',
				'JANET_REDUCED_OS'
			],
			runner: {
				path: 'scripts/runtime-build/wasm-janet-runner.c',
				verifiedBuildInput: false,
				bytes: 1378,
				sha256: '1a2f357f16e250ed64260a77bd11435837ae033647fb23166eb924a42b4036ee'
			}
		},
		license: {
			path: 'LICENSE.txt',
			spdx: 'MIT',
			size: 1,
			sha256: sha256(encoder.encode('l'))
		},
		metadata: {
			path: 'runtime-build.json',
			mediaType: 'application/json',
			size: 2,
			sha256: sha256(encoder.encode('{}'))
		},
		assets: [
			{
				path: 'janet.js',
				mediaType: 'text/javascript',
				size: javascriptBytes.byteLength,
				sha256: sha256(javascriptBytes)
			},
			{
				path: 'janet.wasm',
				mediaType: 'application/wasm',
				size: wasmBytes.byteLength,
				sha256: sha256(wasmBytes)
			}
		],
		storage: [
			{
				path: 'janet.js',
				logicalPath: 'janet.js',
				encoding: 'identity' as const,
				size: javascriptBytes.byteLength,
				sha256: sha256(javascriptBytes)
			},
			{
				path: 'janet.wasm.gz.bin',
				logicalPath: 'janet.wasm',
				encoding: 'gzip' as const,
				size: compressedWasmBytes.byteLength,
				sha256: sha256(compressedWasmBytes)
			}
		]
	};
	const manifestFingerprint = computeJanetRuntimeFingerprint(manifest);
	const manifestBytes = encoder.encode(
		JSON.stringify({ ...manifest, fingerprint: manifestFingerprint })
	);
	const profile = {
		profileId: manifest.profileId,
		artifactRevision,
		janetVersion,
		emscriptenVersion,
		manifestFingerprint,
		manifestReceipt: { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
		javascriptReceipt: {
			bytes: javascriptBytes.byteLength,
			sha256: sha256(javascriptBytes)
		},
		wasmReceipt: {
			bytes: compressedWasmBytes.byteLength,
			sha256: sha256(compressedWasmBytes),
			uncompressedBytes: wasmBytes.byteLength,
			uncompressedSha256: sha256(wasmBytes)
		}
	} satisfies JanetRuntimePreflightProfile;
	const manifestUrl = `${baseUrl}runtime-manifest.v2.json?v=${manifestFingerprint}`;
	const responses = new Map<string, Uint8Array>([
		[manifestUrl, manifestBytes],
		[`${baseUrl}janet.js?v=${profile.javascriptReceipt.sha256}`, javascriptBytes],
		[`${baseUrl}janet.wasm.gz.bin?v=${profile.wasmReceipt.sha256}`, compressedWasmBytes]
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
							: url.includes('janet.js')
								? 'text/javascript'
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
		compressedWasmBytes,
		responses,
		requests,
		fetch
	};
}

describe('Janet runtime host preflight', () => {
	it('downloads only pinned canonical storage and returns verified logical bytes', async () => {
		const fixture = createFixture();
		const payload = await preflightJanetRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch
		});

		expect(payload).toMatchObject({
			protocol: JANET_PREFLIGHT_PROTOCOL,
			protocolVersion: JANET_PREFLIGHT_PROTOCOL_VERSION,
			profileId: fixture.profile.profileId,
			artifactRevision: fixture.profile.artifactRevision,
			janetVersion: fixture.profile.janetVersion,
			emscriptenVersion: fixture.profile.emscriptenVersion,
			manifestFingerprint: fixture.profile.manifestFingerprint
		});
		expect(payload.manifestBytes).toEqual(fixture.manifestBytes);
		expect(payload.javascriptBytes).toEqual(fixture.javascriptBytes);
		expect(payload.wasmBytes).toEqual(fixture.wasmBytes);
		expect(fixture.requests.map(({ url }) => url).sort()).toEqual(
			[
				fixture.manifestUrl,
				`${fixture.baseUrl}janet.js?v=${fixture.profile.javascriptReceipt.sha256}`,
				`${fixture.baseUrl}janet.wasm.gz.bin?v=${fixture.profile.wasmReceipt.sha256}`
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
		const profile = snapshotJanetRuntimePreflightProfile(fixture.profile);
		const payload = await preflightJanetRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile,
			fetch: fixture.fetch
		});
		const clone = cloneJanetRuntimePreflightPayload(payload);

		expect(profile).toEqual(fixture.profile);
		expect(clone).toEqual(payload);
		expect(clone).not.toBe(payload);
		expect(clone.javascriptBytes).not.toBe(payload.javascriptBytes);
		await expect(verifyJanetRuntimePreflightPayload(clone)).resolves.toBe(clone);
		expect(() => requireJanetRuntimePreflightPayload({ ...payload, extra: true })).toThrow(
			ProtocolError
		);
	});

	it('rejects partial profiles before any network request', async () => {
		const fixture = createFixture();
		const incomplete = { ...fixture.profile, wasmReceipt: undefined };

		await expect(
			preflightJanetRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: incomplete as unknown as JanetRuntimePreflightProfile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		expect(fixture.fetch).not.toHaveBeenCalled();
	});

	it('rejects HTTP-transparent gzip decoding', async () => {
		const fixture = createFixture();
		const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const response = await fixture.fetch(input, init);
			if (!String(input).includes('janet.wasm.gz.bin')) return response;
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
			preflightJanetRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch
			})
		).rejects.toBeInstanceOf(AssetIntegrityError);
	});

	it('rejects corrupt compressed bytes before returning a payload', async () => {
		const fixture = createFixture();
		fixture.responses.set(
			`${fixture.baseUrl}janet.wasm.gz.bin?v=${fixture.profile.wasmReceipt.sha256}`,
			Uint8Array.from([...fixture.compressedWasmBytes, 0])
		);

		await expect(
			preflightJanetRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(AssetIntegrityError);
	});

	it('enforces per-asset and aggregate logical byte limits before fetching', async () => {
		const fixture = createFixture();
		const profile = {
			...fixture.profile,
			javascriptReceipt: {
				...fixture.profile.javascriptReceipt,
				bytes: JANET_MAX_ASSET_BYTES
			},
			wasmReceipt: {
				...fixture.profile.wasmReceipt,
				uncompressedBytes: JANET_MAX_ASSET_BYTES + 1
			}
		};

		await expect(
			preflightJanetRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(AssetTooLargeError);
		expect(fixture.fetch).not.toHaveBeenCalled();
		expect(JANET_MAX_ASSET_BYTES).toBe(8 * 1024 * 1024);
	});

	it('rejects an unpinned manifest query and cross-origin asset base', async () => {
		const fixture = createFixture();

		await expect(
			preflightJanetRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: `${fixture.baseUrl}runtime-manifest.v2.json?v=wrong`,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		await expect(
			preflightJanetRuntimeAssets({
				baseUrl: 'https://other.example.com/wasm-janet/',
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		expect(fixture.fetch).not.toHaveBeenCalled();
	});

	it('maps caller aborts to typed cancellation', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		controller.abort(new Error('stop'));

		await expect(
			preflightJanetRuntimeAssets({
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
			preflightJanetRuntimeAssets({
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
		const payload = await preflightJanetRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch
		});
		const wrongIdentity: JanetRuntimePreflightPayload = {
			...payload,
			janetVersion: '1.41.4'
		};
		const wrongBytes: JanetRuntimePreflightPayload = {
			...payload,
			wasmBytes: Uint8Array.from([...payload.wasmBytes, 0])
		};

		await expect(verifyJanetRuntimePreflightPayload(wrongIdentity)).rejects.toBeInstanceOf(
			AssetIntegrityError
		);
		await expect(verifyJanetRuntimePreflightPayload(wrongBytes)).rejects.toBeInstanceOf(
			AssetIntegrityError
		);
	});
});
