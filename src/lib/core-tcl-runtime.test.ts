// @vitest-environment node

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
	AssetIntegrityError,
	AssetTooLargeError,
	CancelledError,
	ProtocolError,
	RuntimeConfigurationError,
	TCL_MAX_ASSET_BYTES,
	TCL_PREFLIGHT_PROTOCOL,
	TCL_PREFLIGHT_PROTOCOL_VERSION,
	TimeoutError,
	UnsupportedBrowserFeatureError,
	cloneTclRuntimePreflightPayload,
	preflightTclRuntimeAssets,
	requireTclRuntimePreflightPayload,
	snapshotTclRuntimePreflightProfile,
	verifyTclRuntimePreflightPayload,
	type TclRuntimePreflightPayload,
	type TclRuntimePreflightProfile
} from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeTclRuntimeFingerprint } from '../../scripts/sync-wasm-tcl.mjs';

const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const VERIFIED_WASM_GLUE_PATCH =
	'var _wasmbly=Promise.resolve(typeof self!=="undefined"&&self.Module&&self.Module["wasmBinary"]||(function(){throw new Error("Verified Wacl Wasm was not provided.")})());';

function createFixture(options: { declaredLibraryBytes?: number } = {}) {
	const baseUrl = 'https://assets.example.com/releases/wasm-tcl/';
	const artifactRevision = '1'.repeat(40);
	const waclRevision = '2'.repeat(40);
	const tclRevision = '3'.repeat(40);
	const requireJsRevision = '4'.repeat(40);
	const emscriptenRevision = '5'.repeat(40);
	const requireJsBytes = encoder.encode('globalThis.requirejs = {};');
	const customDataBytes = encoder.encode('fixture Wacl custom data');
	const libraryDataBytes = encoder.encode('fixture Wacl library data');
	const glueBytes = encoder.encode(
		`define("tcl/wacl",[],function(){${VERIFIED_WASM_GLUE_PATCH}});`
	);
	const wasmBytes = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
	const compressedLibraryDataBytes = Uint8Array.from(gzipSync(libraryDataBytes));
	const compressedWasmBytes = Uint8Array.from(gzipSync(wasmBytes));
	const declaredLibraryBytes = options.declaredLibraryBytes ?? libraryDataBytes.byteLength;
	const manifest = {
		format: 'wasm-tcl-runtime-manifest-v2',
		runtime: 'wacl',
		profileId: 'wacl-test-1-tcl-8.6.6',
		artifact: {
			kind: 'opaque-prebuilt',
			path: 'wacl/releases/wacl.zip',
			repository: 'https://github.com/ecky-l/ecky-l.github.io.git',
			revision: artifactRevision,
			sha256: sha256(encoder.encode('fixture Wacl archive')),
			size: 20,
			url: `https://raw.githubusercontent.com/ecky-l/ecky-l.github.io/${artifactRevision}/wacl/releases/wacl.zip`
		},
		components: {
			wacl: {
				version: '2017-05-29',
				repository: 'https://github.com/ecky-l/wacl.git',
				revision: waclRevision,
				verifiedBuildInput: false
			},
			tcl: { version: '8.6.6', revision: tclRevision, verifiedBuildInput: false },
			tdom: { version: '0.8.3', revision: '6'.repeat(40), verifiedBuildInput: false },
			rlJson: { version: '0.9.7', revision: '7'.repeat(40), verifiedBuildInput: false },
			tcllib: { version: '1.18', revision: '8'.repeat(40), verifiedBuildInput: false },
			requirejs: {
				version: '2.3.3',
				revision: requireJsRevision,
				verifiedBuildInput: false
			},
			emscripten: {
				version: '1.37.9',
				revision: emscriptenRevision,
				verifiedBuildInput: false
			}
		},
		patches: [
			{ id: 'inject-verified-wasm' },
			{ id: 'inject-host-module' },
			{ id: 'preserve-host-output' },
			{ id: 'preserve-host-error-output' },
			{ id: 'guard-window-cleanup' }
		],
		licenses: [
			{
				path: 'licenses/WACL.txt',
				spdx: 'BSD-3-Clause',
				size: 1,
				sha256: sha256(encoder.encode('w'))
			},
			{
				path: 'licenses/TCL.txt',
				spdx: 'TCL',
				size: 1,
				sha256: sha256(encoder.encode('t'))
			},
			{
				path: 'licenses/REQUIREJS.txt',
				spdx: 'MIT',
				size: 1,
				sha256: sha256(encoder.encode('r'))
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
				path: 'require.js',
				mediaType: 'text/javascript',
				size: requireJsBytes.byteLength,
				sha256: sha256(requireJsBytes)
			},
			{
				path: 'tcl/wacl-custom.data',
				mediaType: 'application/octet-stream',
				size: customDataBytes.byteLength,
				sha256: sha256(customDataBytes)
			},
			{
				path: 'tcl/wacl-library.data',
				mediaType: 'application/octet-stream',
				size: declaredLibraryBytes,
				sha256: sha256(libraryDataBytes)
			},
			{
				path: 'tcl/wacl.js',
				mediaType: 'text/javascript',
				size: glueBytes.byteLength,
				sha256: sha256(glueBytes)
			},
			{
				path: 'tcl/wacl.wasm',
				mediaType: 'application/wasm',
				size: wasmBytes.byteLength,
				sha256: sha256(wasmBytes)
			}
		],
		storage: [
			{
				path: 'require.js',
				logicalPath: 'require.js',
				encoding: 'identity' as const,
				size: requireJsBytes.byteLength,
				sha256: sha256(requireJsBytes)
			},
			{
				path: 'tcl/wacl-custom.data.bin',
				logicalPath: 'tcl/wacl-custom.data',
				encoding: 'identity' as const,
				size: customDataBytes.byteLength,
				sha256: sha256(customDataBytes)
			},
			{
				path: 'tcl/wacl-library.data.gz.bin',
				logicalPath: 'tcl/wacl-library.data',
				encoding: 'gzip' as const,
				size: compressedLibraryDataBytes.byteLength,
				sha256: sha256(compressedLibraryDataBytes)
			},
			{
				path: 'tcl/wacl.js',
				logicalPath: 'tcl/wacl.js',
				encoding: 'identity' as const,
				size: glueBytes.byteLength,
				sha256: sha256(glueBytes)
			},
			{
				path: 'tcl/wacl.wasm.gz.bin',
				logicalPath: 'tcl/wacl.wasm',
				encoding: 'gzip' as const,
				size: compressedWasmBytes.byteLength,
				sha256: sha256(compressedWasmBytes)
			}
		]
	};
	const manifestFingerprint = computeTclRuntimeFingerprint(manifest);
	const manifestBytes = encoder.encode(
		JSON.stringify({ ...manifest, fingerprint: manifestFingerprint })
	);
	const profile = {
		profileId: manifest.profileId,
		artifactRevision,
		waclRevision,
		tclRevision,
		requireJsRevision,
		emscriptenRevision,
		manifestFingerprint,
		manifestReceipt: { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
		requireJsReceipt: { bytes: requireJsBytes.byteLength, sha256: sha256(requireJsBytes) },
		customDataReceipt: { bytes: customDataBytes.byteLength, sha256: sha256(customDataBytes) },
		libraryDataReceipt: {
			bytes: compressedLibraryDataBytes.byteLength,
			sha256: sha256(compressedLibraryDataBytes),
			uncompressedBytes: declaredLibraryBytes,
			uncompressedSha256: sha256(libraryDataBytes)
		},
		glueReceipt: { bytes: glueBytes.byteLength, sha256: sha256(glueBytes) },
		wasmReceipt: {
			bytes: compressedWasmBytes.byteLength,
			sha256: sha256(compressedWasmBytes),
			uncompressedBytes: wasmBytes.byteLength,
			uncompressedSha256: sha256(wasmBytes)
		}
	} satisfies TclRuntimePreflightProfile;
	const manifestUrl = `${baseUrl}runtime-manifest.v2.json?v=${manifestFingerprint}`;
	const responses = new Map<string, { bytes: Uint8Array; headers: HeadersInit }>([
		[manifestUrl, { bytes: manifestBytes, headers: { 'content-type': 'application/json' } }],
		[
			`${baseUrl}require.js?v=${profile.requireJsReceipt.sha256}`,
			{ bytes: requireJsBytes, headers: { 'content-type': 'text/javascript' } }
		],
		[
			`${baseUrl}tcl/wacl-custom.data.bin?v=${profile.customDataReceipt.sha256}`,
			{ bytes: customDataBytes, headers: { 'content-type': 'application/octet-stream' } }
		],
		[
			`${baseUrl}tcl/wacl-library.data.gz.bin?v=${profile.libraryDataReceipt.sha256}`,
			{
				bytes: compressedLibraryDataBytes,
				headers: { 'content-type': 'application/octet-stream' }
			}
		],
		[
			`${baseUrl}tcl/wacl.js?v=${profile.glueReceipt.sha256}`,
			{ bytes: glueBytes, headers: { 'content-type': 'text/javascript' } }
		],
		[
			`${baseUrl}tcl/wacl.wasm.gz.bin?v=${profile.wasmReceipt.sha256}`,
			{ bytes: compressedWasmBytes, headers: { 'content-type': 'application/octet-stream' } }
		]
	]);
	const requests: Array<{ url: string; init?: RequestInit }> = [];
	const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		requests.push({ url, init });
		const entry = responses.get(url);
		const response = entry
			? new Response(Uint8Array.from(entry.bytes), {
					status: 200,
					headers: {
						...entry.headers,
						'content-length': String(entry.bytes.byteLength)
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
		requireJsBytes,
		customDataBytes,
		libraryDataBytes,
		glueBytes,
		wasmBytes,
		compressedLibraryDataBytes,
		compressedWasmBytes,
		responses,
		requests,
		fetch
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Wacl Tcl runtime host preflight', () => {
	it('loads six pinned canonical assets and returns logical no-fetch payload bytes', async () => {
		const fixture = createFixture();
		const progress: string[] = [];

		const payload = await preflightTclRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch,
			reportProgress: ({ assetKey }) => progress.push(assetKey)
		});

		expect(payload).toMatchObject({
			protocol: TCL_PREFLIGHT_PROTOCOL,
			protocolVersion: TCL_PREFLIGHT_PROTOCOL_VERSION,
			profileId: fixture.profile.profileId,
			artifactRevision: fixture.profile.artifactRevision,
			waclRevision: fixture.profile.waclRevision,
			tclRevision: fixture.profile.tclRevision,
			requireJsRevision: fixture.profile.requireJsRevision,
			emscriptenRevision: fixture.profile.emscriptenRevision,
			manifestFingerprint: fixture.profile.manifestFingerprint
		});
		expect(payload.manifestBytes).toEqual(fixture.manifestBytes);
		expect(payload.requireJsBytes).toEqual(fixture.requireJsBytes);
		expect(payload.customDataBytes).toEqual(fixture.customDataBytes);
		expect(payload.libraryDataBytes).toEqual(fixture.libraryDataBytes);
		expect(payload.glueBytes).toEqual(fixture.glueBytes);
		expect(payload.wasmBytes).toEqual(fixture.wasmBytes);
		expect(fixture.requests.map(({ url }) => url).sort()).toEqual(
			[...fixture.responses.keys()].sort()
		);
		expect(fixture.requests.every(({ url }) => !/\.gz(?:\?|$)/u.test(url))).toBe(true);
		expect(
			fixture.requests.some(
				({ url }) => new URL(url).pathname === '/releases/wasm-tcl/tcl/wacl-custom.data'
			)
		).toBe(false);
		for (const { init } of fixture.requests) {
			expect(init).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
			expect(init?.signal).toBeInstanceOf(AbortSignal);
		}
		expect(new Set(progress)).toEqual(
			new Set(['manifest', 'requireJs', 'customData', 'libraryData', 'glue', 'wasm'])
		);
	});

	it('snapshots exact contracts and clones payload byte ownership', async () => {
		const fixture = createFixture();
		const profile = snapshotTclRuntimePreflightProfile(fixture.profile);
		expect(profile).toEqual(fixture.profile);
		expect(Object.isFrozen(profile)).toBe(true);
		expect(Object.isFrozen(profile.libraryDataReceipt)).toBe(true);
		expect(() =>
			snapshotTclRuntimePreflightProfile({ ...fixture.profile, extra: true })
		).toThrow(RuntimeConfigurationError);
		const { wasmReceipt: _missing, ...incomplete } = fixture.profile;
		expect(() => snapshotTclRuntimePreflightProfile(incomplete)).toThrow(
			RuntimeConfigurationError
		);

		const payload = await preflightTclRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch
		});
		const clone = cloneTclRuntimePreflightPayload(payload);
		expect(clone).toEqual(payload);
		expect(clone.wasmBytes).not.toBe(payload.wasmBytes);
		clone.wasmBytes[0] = 1;
		expect(payload.wasmBytes[0]).toBe(0);
		expect(() => requireTclRuntimePreflightPayload({ ...payload, extra: true })).toThrow(
			ProtocolError
		);
		const oversizedBacking = new Uint8Array(payload.wasmBytes.byteLength + 1);
		oversizedBacking.set(payload.wasmBytes);
		expect(() =>
			requireTclRuntimePreflightPayload({
				...payload,
				wasmBytes: oversizedBacking.subarray(0, payload.wasmBytes.byteLength)
			})
		).toThrow(ProtocolError);
	});

	it('rejects corrupt delivery bytes before producing a payload', async () => {
		const fixture = createFixture();
		const wasmUrl = `${fixture.baseUrl}tcl/wacl.wasm.gz.bin?v=${fixture.profile.wasmReceipt.sha256}`;
		fixture.responses.set(wasmUrl, {
			bytes: Uint8Array.from([...fixture.compressedWasmBytes, 0]),
			headers: { 'content-type': 'application/octet-stream' }
		});

		await expect(
			preflightTclRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toThrow(AssetIntegrityError);
	});

	it('rejects a receipt generation that disagrees with the manifest graph', async () => {
		const fixture = createFixture();
		const replacement = Uint8Array.from(fixture.compressedWasmBytes);
		replacement[4] = 1;
		const replacementReceipt = {
			...fixture.profile.wasmReceipt,
			sha256: sha256(replacement)
		};
		fixture.responses.set(
			`${fixture.baseUrl}tcl/wacl.wasm.gz.bin?v=${replacementReceipt.sha256}`,
			{ bytes: replacement, headers: { 'content-type': 'application/octet-stream' } }
		);

		await expect(
			preflightTclRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: { ...fixture.profile, wasmReceipt: replacementReceipt },
				fetch: fixture.fetch
			})
		).rejects.toThrow('manifest receipts do not match the selected preflight profile');
	});

	it('rejects HTTP-transparent gzip decoding', async () => {
		const fixture = createFixture();
		const wasmUrl = `${fixture.baseUrl}tcl/wacl.wasm.gz.bin?v=${fixture.profile.wasmReceipt.sha256}`;
		fixture.responses.get(wasmUrl)!.headers = {
			'content-encoding': 'gzip',
			'content-type': 'application/octet-stream'
		};

		await expect(
			preflightTclRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toThrow('transparently gzip-decoded');
	});

	it('bounds gzip expansion by the logical receipt', async () => {
		const fixture = createFixture({ declaredLibraryBytes: 4 });

		await expect(
			preflightTclRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toThrow('gzip exceeds its logical receipt size');
	});

	it('fails closed when gzip decompression is unavailable', async () => {
		const fixture = createFixture();
		vi.stubGlobal('DecompressionStream', undefined);

		await expect(
			preflightTclRuntimeAssets({
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
			'https://assets.example.com/releases/wasm-tcl/runtime-manifest.v2.json?v=wrong'
		]
	])('rejects %s before issuing a request', async (_label, manifestUrl) => {
		const fixture = createFixture();
		await expect(
			preflightTclRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl,
				profile: fixture.profile,
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		expect(fixture.fetch).not.toHaveBeenCalled();
	});

	it('rejects receipt sizes above the active cap before fetching', async () => {
		const fixture = createFixture();
		await expect(
			preflightTclRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				limits: { maxAssetBytes: fixture.requireJsBytes.byteLength - 1 },
				fetch: fixture.fetch
			})
		).rejects.toBeInstanceOf(AssetTooLargeError);
		expect(fixture.fetch).not.toHaveBeenCalled();
		expect(TCL_MAX_ASSET_BYTES).toBe(16 * 1024 * 1024);
	});

	it('preserves deterministic caller cancellation', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		controller.abort(new Error('stop Tcl preflight'));

		await expect(
			preflightTclRuntimeAssets({
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
			preflightTclRuntimeAssets({
				baseUrl: fixture.baseUrl,
				manifestUrl: fixture.manifestUrl,
				profile: fixture.profile,
				fetch: stalledFetch,
				limits: { assetTimeoutMs: 10 }
			})
		).rejects.toBeInstanceOf(TimeoutError);
	});

	it('revalidates the full manifest graph and logical bytes on receipt', async () => {
		const fixture = createFixture();
		const payload = await preflightTclRuntimeAssets({
			baseUrl: fixture.baseUrl,
			manifestUrl: fixture.manifestUrl,
			profile: fixture.profile,
			fetch: fixture.fetch
		});
		await expect(verifyTclRuntimePreflightPayload(payload)).resolves.toBe(payload);

		const corruptPayload: TclRuntimePreflightPayload = {
			...payload,
			customDataBytes: Uint8Array.from([...payload.customDataBytes, 0])
		};
		await expect(verifyTclRuntimePreflightPayload(corruptPayload)).rejects.toBeInstanceOf(
			AssetIntegrityError
		);
		const malformedManifestPayload: TclRuntimePreflightPayload = {
			...payload,
			manifestBytes: encoder.encode('{}')
		};
		await expect(
			verifyTclRuntimePreflightPayload(malformedManifestPayload)
		).rejects.toBeInstanceOf(AssetIntegrityError);

		const identityMismatchManifest = JSON.parse(
			new TextDecoder().decode(payload.manifestBytes)
		);
		identityMismatchManifest.storage.find(
			(receipt: { path: string }) => receipt.path === 'require.js'
		).size += 1;
		await expect(
			verifyTclRuntimePreflightPayload({
				...payload,
				manifestBytes: encoder.encode(JSON.stringify(identityMismatchManifest))
			})
		).rejects.toThrow('identity storage receipt does not match require.js');
	});
});
