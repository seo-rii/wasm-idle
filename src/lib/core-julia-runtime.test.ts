// @vitest-environment node

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
	AssetIntegrityError,
	AssetNotFoundError,
	AssetTooLargeError,
	CancelledError,
	JULIA_MAX_ASSET_BYTES,
	JULIA_PREFLIGHT_PROTOCOL,
	JULIA_PREFLIGHT_PROTOCOL_VERSION,
	JULIA_RUNTIME_PREFLIGHT_CAPABILITIES,
	ProtocolError,
	RuntimeConfigurationError,
	TimeoutError,
	cloneJuliaRuntimePreflightPayload,
	preflightJuliaRuntimeAssets,
	requireJuliaRuntimePreflightPayload,
	snapshotJuliaRuntimePreflightProfile,
	verifyJuliaRuntimePreflightPayload,
	type JuliaRuntimePreflightPayload,
	type JuliaRuntimePreflightProfile
} from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';
import { computeJuliaRuntimeFingerprint } from '../../scripts/sync-wasm-julia.mjs';

const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function createFixture() {
	const baseUrl = 'https://assets.example.com/releases/wasm-julia/';
	const packageRevision = '22a55e0d10ad50f2999d059b325abe4d95cf17b3';
	const importedByCommit = 'c9529ad7b7ecfaea8a55c0fe5693c4d07cd0ae26';
	const juliaVersion = '1.3.0-DEV.560';
	const emscriptenVersion = 'unrecorded';
	const javascriptBytes = encoder.encode(
		'WebAssembly.instantiate; getPreloadedPackage; "julia-wasm/julia.wasm"; "/npm/@chriskoch/julia-wasm/julia.data"; _jl_eval_string;'
	);
	const wasmBytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
	const dataBytes = encoder.encode('verified julia data fixture');
	const compressedJavascriptBytes = Uint8Array.from(gzipSync(javascriptBytes));
	const compressedWasmBytes = Uint8Array.from(gzipSync(wasmBytes));
	const compressedDataBytes = Uint8Array.from(gzipSync(dataBytes));
	const manifest = {
		format: 'wasm-julia-runtime-manifest-v2',
		runtime: 'chriskoch-julia-wasm',
		profileId: 'julia-1.3.0-dev.560-chriskoch-npm-1.0.4-22a55e0d',
		licenseExpression: 'MIT AND LicenseRef-Julia-Third-Party',
		artifact: {
			kind: 'opaque-npm-prebuilt',
			packageName: '@chriskoch/julia-wasm',
			packageVersion: '1.0.4',
			packageSpec: '@chriskoch/julia-wasm@1.0.4',
			registryUrl: 'https://registry.npmjs.org/',
			tarballUrl: 'https://registry.npmjs.org/@chriskoch/julia-wasm/-/julia-wasm-1.0.4.tgz',
			publishedAt: '2020-12-05T19:33:59.354Z',
			repository: 'https://github.com/chris-koch-penn/polylang.git',
			sourceRevision: 'unrecorded',
			importedByCommit,
			npmGitHead: 'unrecorded',
			verifiedBuildInput: false,
			bytes: 12_406_918,
			sha256: '03d0e93196dbeec55946bbe447d4c9b2d244dba15fdd882c750fb33598bf640f',
			sha512: '86b957b1b800430c76542eae9959c528f540ad94fbaa34c9edaecc245497216b9cbc353f56aac392db4ddba81aa78a354383a3a11924688b0df40307ce146fc4',
			npmIntegrity:
				'sha512-hrlXsbgAQwx2VC6umVnFKPVArZT7qjTJ7a7MJFSXIWucvDU/VqrDkttN26gap4o1Q4OjoRkkaIsN9AMHzhRvxA==',
			npmShasum: packageRevision
		},
		components: {
			distribution: {
				version: '1.0.4',
				repository: 'https://github.com/chris-koch-penn/polylang.git',
				revision: 'unrecorded',
				verifiedBuildInput: false,
				evidence:
					'content-locked npm package; source revision and build recipe are not published in package metadata'
			},
			julia: {
				version: juliaVersion,
				repository: 'https://github.com/JuliaLang/julia.git',
				revision: 'unrecorded',
				verifiedBuildInput: false,
				evidence:
					'exact VERSION observed in the real Chromium runtime; the binary embeds the matching 1.3.0-DEV family string; binary-to-source attestation is unavailable'
			},
			emscripten: {
				version: emscriptenVersion,
				repository: 'https://github.com/emscripten-core/emscripten.git',
				revision: 'unrecorded',
				verifiedBuildInput: false,
				evidence: 'opaque prebuilt Emscripten loader without recorded toolchain revision'
			}
		},
		license: {
			path: 'LICENSE.md',
			spdx: 'MIT AND LicenseRef-Julia-Third-Party',
			size: 1,
			sha256: sha256(encoder.encode('l'))
		},
		documentation: {
			path: 'readme.md',
			mediaType: 'text/markdown',
			size: 1,
			sha256: sha256(encoder.encode('d'))
		},
		metadata: {
			path: 'runtime-build.json',
			mediaType: 'application/json',
			size: 2,
			sha256: sha256(encoder.encode('{}'))
		},
		assets: [
			{
				path: 'julia.data',
				mediaType: 'application/octet-stream',
				size: dataBytes.byteLength,
				sha256: sha256(dataBytes)
			},
			{
				path: 'julia.js',
				mediaType: 'text/javascript',
				size: javascriptBytes.byteLength,
				sha256: sha256(javascriptBytes)
			},
			{
				path: 'julia.wasm',
				mediaType: 'application/wasm',
				size: wasmBytes.byteLength,
				sha256: sha256(wasmBytes)
			}
		],
		storage: [
			{
				path: 'julia.data.gz.bin',
				logicalPath: 'julia.data',
				encoding: 'gzip' as const,
				size: compressedDataBytes.byteLength,
				sha256: sha256(compressedDataBytes)
			},
			{
				path: 'julia.js.gz.bin',
				logicalPath: 'julia.js',
				encoding: 'gzip' as const,
				size: compressedJavascriptBytes.byteLength,
				sha256: sha256(compressedJavascriptBytes)
			},
			{
				path: 'julia.wasm.gz.bin',
				logicalPath: 'julia.wasm',
				encoding: 'gzip' as const,
				size: compressedWasmBytes.byteLength,
				sha256: sha256(compressedWasmBytes)
			}
		]
	};
	const manifestFingerprint = computeJuliaRuntimeFingerprint(manifest);
	const manifestBytes = encoder.encode(
		JSON.stringify({ ...manifest, fingerprint: manifestFingerprint })
	);
	const profile = {
		profileId: manifest.profileId,
		packageRevision,
		importedByCommit,
		juliaVersion,
		emscriptenVersion,
		manifestFingerprint,
		manifestReceipt: { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
		javascriptReceipt: {
			bytes: compressedJavascriptBytes.byteLength,
			sha256: sha256(compressedJavascriptBytes),
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
	} satisfies JuliaRuntimePreflightProfile;
	const manifestUrl = `${baseUrl}runtime-manifest.v2.json?v=${manifestFingerprint}`;
	const responses = new Map<string, Uint8Array>([
		[manifestUrl, manifestBytes],
		[
			`${baseUrl}julia.js.gz.bin?v=${profile.javascriptReceipt.sha256}`,
			compressedJavascriptBytes
		],
		[`${baseUrl}julia.wasm.gz.bin?v=${profile.wasmReceipt.sha256}`, compressedWasmBytes],
		[`${baseUrl}julia.data.gz.bin?v=${profile.dataReceipt.sha256}`, compressedDataBytes]
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
		compressedJavascriptBytes,
		compressedWasmBytes,
		compressedDataBytes,
		responses,
		requests,
		fetch
	};
}

describe('Julia runtime host preflight', () => {
	it('downloads only pinned canonical storage and returns verified logical bytes', async () => {
		const fixture = createFixture();
		const payload = await preflightJuliaRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch
		});

		expect(payload).toMatchObject({
			protocol: JULIA_PREFLIGHT_PROTOCOL,
			protocolVersion: JULIA_PREFLIGHT_PROTOCOL_VERSION,
			profileId: fixture.profile.profileId,
			packageRevision: fixture.profile.packageRevision,
			importedByCommit: fixture.profile.importedByCommit,
			juliaVersion: fixture.profile.juliaVersion,
			emscriptenVersion: fixture.profile.emscriptenVersion,
			manifestFingerprint: fixture.profile.manifestFingerprint
		});
		expect(payload.manifestBytes).toEqual(fixture.manifestBytes);
		expect(payload.javascriptBytes).toEqual(fixture.javascriptBytes);
		expect(payload.wasmBytes).toEqual(fixture.wasmBytes);
		expect(payload.dataBytes).toEqual(fixture.dataBytes);
		expect(fixture.requests.map(({ url }) => url).sort()).toEqual(
			[
				fixture.manifestUrl,
				`${fixture.baseUrl}julia.js.gz.bin?v=${fixture.profile.javascriptReceipt.sha256}`,
				`${fixture.baseUrl}julia.wasm.gz.bin?v=${fixture.profile.wasmReceipt.sha256}`,
				`${fixture.baseUrl}julia.data.gz.bin?v=${fixture.profile.dataReceipt.sha256}`
			].sort()
		);
		for (const { init } of fixture.requests) {
			expect(init).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
		expect(JULIA_RUNTIME_PREFLIGHT_CAPABILITIES.workspace).toBe(false);
	});

	it('snapshots exact profiles and clones exact payload byte arrays', async () => {
		const fixture = createFixture();
		const profile = snapshotJuliaRuntimePreflightProfile(fixture.profile);
		const payload = await preflightJuliaRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile,
			fetch: fixture.fetch
		});
		const clone = cloneJuliaRuntimePreflightPayload(payload);

		expect(profile).toEqual(fixture.profile);
		expect(clone).toEqual(payload);
		expect(clone).not.toBe(payload);
		expect(clone.dataBytes).not.toBe(payload.dataBytes);
		await expect(verifyJuliaRuntimePreflightPayload(clone)).resolves.toBe(clone);
		expect(() => requireJuliaRuntimePreflightPayload({ ...payload, extra: true })).toThrow(
			ProtocolError
		);
	});

	it('rejects partial profiles before any network request', async () => {
		const fixture = createFixture();
		const incomplete = { ...fixture.profile, dataReceipt: undefined };

		await expect(
			preflightJuliaRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: incomplete as unknown as JuliaRuntimePreflightProfile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		expect(fixture.fetch).not.toHaveBeenCalled();
	});

	it('rejects HTTP-transparent gzip decoding', async () => {
		const fixture = createFixture();
		const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const response = await fixture.fetch(input, init);
			if (!String(input).includes('julia.data.gz.bin')) return response;
			const decoded = new Response(fixture.dataBytes, {
				status: 200,
				headers: {
					'content-encoding': 'gzip',
					'content-length': String(fixture.dataBytes.byteLength)
				}
			});
			Object.defineProperty(decoded, 'url', { value: String(input) });
			return decoded;
		}) as typeof globalThis.fetch;

		await expect(
			preflightJuliaRuntimeAssets({
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
			`${fixture.baseUrl}julia.data.gz.bin?v=${fixture.profile.dataReceipt.sha256}`,
			Uint8Array.from([...fixture.compressedDataBytes, 0])
		);

		await expect(
			preflightJuliaRuntimeAssets({
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
			dataReceipt: {
				...fixture.profile.dataReceipt,
				uncompressedBytes: JULIA_MAX_ASSET_BYTES + 1
			}
		};

		await expect(
			preflightJuliaRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(AssetTooLargeError);
		expect(fixture.fetch).not.toHaveBeenCalled();
		expect(JULIA_MAX_ASSET_BYTES).toBe(64 * 1024 * 1024);
	});

	it('rejects profiles whose aggregate delivery receipts exceed 64 MiB before fetching', async () => {
		const fixture = createFixture();
		const deliveryBytes = 22 * 1024 * 1024;
		const profile = {
			...fixture.profile,
			javascriptReceipt: { ...fixture.profile.javascriptReceipt, bytes: deliveryBytes },
			wasmReceipt: { ...fixture.profile.wasmReceipt, bytes: deliveryBytes },
			dataReceipt: { ...fixture.profile.dataReceipt, bytes: deliveryBytes }
		};

		await expect(
			preflightJuliaRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(AssetTooLargeError);
		expect(fixture.fetch).not.toHaveBeenCalled();
	});

	it('rejects an unpinned manifest query and cross-origin asset base', async () => {
		const fixture = createFixture();

		await expect(
			preflightJuliaRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: `${fixture.baseUrl}runtime-manifest.v2.json?v=wrong`,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		await expect(
			preflightJuliaRuntimeAssets({
				baseUrl: 'https://other.example.com/wasm-julia/',
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
			preflightJuliaRuntimeAssets({
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
			preflightJuliaRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: stalledFetch,
				limits: { assetTimeoutMs: 10 }
			})
		).rejects.toBeInstanceOf(TimeoutError);
	});

	it('aborts sibling canonical downloads before a clean retry', async () => {
		const fixture = createFixture();
		const signals: AbortSignal[] = [];
		let liveRequests = 0;
		const failingFetch = vi.fn(
			(input: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					liveRequests += 1;
					const signal = init?.signal as AbortSignal;
					signals.push(signal);
					let settled = false;
					const settle = (reason: unknown) => {
						if (settled) return;
						settled = true;
						liveRequests -= 1;
						reject(reason);
					};
					signal.addEventListener('abort', () => settle(signal.reason), { once: true });
					if (String(input).includes('runtime-manifest.v2.json')) {
						queueMicrotask(() => settle(new Error('manifest fetch failed')));
					}
				})
		) as typeof globalThis.fetch;

		await expect(
			preflightJuliaRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: failingFetch
			})
		).rejects.toBeInstanceOf(AssetNotFoundError);
		expect(signals).toHaveLength(4);
		expect(signals.every((signal) => signal.aborted)).toBe(true);
		expect(liveRequests).toBe(0);

		await expect(
			preflightJuliaRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).resolves.toMatchObject({ profileId: fixture.profile.profileId });
		expect(fixture.requests).toHaveLength(4);
	});

	it('rejects payload identity and logical byte tampering', async () => {
		const fixture = createFixture();
		const payload = await preflightJuliaRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch
		});
		const wrongIdentity: JuliaRuntimePreflightPayload = {
			...payload,
			juliaVersion: '1.3.1'
		};
		const wrongBytes: JuliaRuntimePreflightPayload = {
			...payload,
			dataBytes: Uint8Array.from([...payload.dataBytes, 0])
		};

		await expect(verifyJuliaRuntimePreflightPayload(wrongIdentity)).rejects.toBeInstanceOf(
			ProtocolError
		);
		await expect(verifyJuliaRuntimePreflightPayload(wrongBytes)).rejects.toBeInstanceOf(
			AssetIntegrityError
		);
	});
});
