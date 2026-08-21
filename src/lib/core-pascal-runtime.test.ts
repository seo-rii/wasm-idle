// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
	PASCAL_MAX_ASSET_BYTES,
	PASCAL_MAX_DELIVERY_BYTES,
	PASCAL_MAX_LOGICAL_BYTES,
	PASCAL_MAX_MANIFEST_BYTES,
	PASCAL_PREFLIGHT_PROTOCOL,
	PASCAL_PREFLIGHT_PROTOCOL_VERSION,
	clonePascalRuntimePreflightPayload,
	preflightPascalRuntimeAssets,
	requirePascalRuntimePreflightPayload,
	snapshotPascalRuntimePreflightProfile,
	verifyPascalRuntimePreflightPayload,
	type PascalRuntimePreflightProfile
} from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WASM_PASCAL_RUNTIME_PROFILE } from '$lib/playground/wasmPascalVersion';

const encoder = new TextEncoder();
const sha = (digit: string) => digit.repeat(64);

function hash(bytes: Uint8Array | string) {
	return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function compareCodeUnits(left: { path: string }, right: { path: string }) {
	return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function manifestFingerprint(manifest: Record<string, any>) {
	let canonical =
		`wasm-idle:pascal-runtime-manifest:v2\n` +
		`format\0wasm-pascal-runtime-manifest-v2\n` +
		`runtime\0pas2js\n` +
		`profileId\0${manifest.profileId}\n` +
		`licenseExpression\0LGPL-2.1-only WITH Independent-modules-exception\n`;
	canonical += `artifact\0${canonicalJson(manifest.artifact)}\n`;
	canonical += `components\0${canonicalJson(manifest.components)}\n`;
	canonical += `build\0${canonicalJson(manifest.build)}\n`;
	canonical += `license\0${canonicalJson(manifest.license)}\n`;
	canonical += `metadata\0${manifest.metadata.path}\0${manifest.metadata.mediaType}\0${manifest.metadata.size}\0${manifest.metadata.sha256}\n`;
	for (const asset of [...manifest.assets].sort(compareCodeUnits)) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...manifest.storage].sort(compareCodeUnits)) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return hash(canonical);
}

function receipt(bytes: Uint8Array) {
	return { bytes: bytes.byteLength, sha256: hash(bytes) };
}

function pairedReceipt(compressed: Uint8Array, logical: Uint8Array) {
	return {
		...receipt(compressed),
		uncompressedBytes: logical.byteLength,
		uncompressedSha256: hash(logical)
	};
}

function createRuntimeFixture() {
	const compilerJavaScriptBytes = encoder.encode(
		'globalThis.__wasmIdlePascalCompiler = { compile() { return "ok"; } };'
	);
	const rtlJavaScriptBytes = encoder.encode('globalThis.rtl = { run() {} };');
	const systemPascalBytes = encoder.encode(
		'unit System; interface procedure ReadLn; implementation end.'
	);
	const compilerStorage = Uint8Array.from(gzipSync(compilerJavaScriptBytes));
	const profileId = 'pascal-pas2js-3.2.1-legacy-2c1edc2d';
	const artifactRevision = '2c1edc2d47a221498d6086f62431796012e2f3ca';
	const pas2jsVersion = '3.2.1';
	const pas2jsRevision = '9ac46614dc82';
	const manifest: Record<string, any> = {
		format: 'wasm-pascal-runtime-manifest-v2',
		runtime: 'pas2js',
		profileId,
		fingerprint: '',
		licenseExpression: 'LGPL-2.1-only WITH Independent-modules-exception',
		artifact: {
			kind: 'opaque-vendored',
			repository: 'https://github.com/seo-rii/wasm-idle.git',
			revision: artifactRevision,
			path: 'static/wasm-pascal',
			provenance: 'legacy-import',
			verifiedBuildInput: false
		},
		components: {
			pas2js: {
				version: pas2jsVersion,
				repository: 'https://gitlab.com/freepascal.org/fpc/pas2js.git',
				revision: pas2jsRevision,
				revisionKind: 'recorded-abbreviated',
				verifiedBuildInput: false,
				evidence: 'runtime-build.json; full upstream commit was not recorded'
			}
		},
		build: {
			target: 'browser',
			compiler: 'native pas2js',
			entrypoint: 'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
			integrationSources: [
				'runtimes/wasm-pascal/src/system.pas',
				'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
				'runtimes/wasm-pascal/src/webfilecache.pp'
			],
			transformations: [
				'strip trailing horizontal whitespace and normalize final newline',
				'gzip compiler.js with Node zlib level 9'
			],
			verifiedBuildInput: false
		},
		license: {
			spdx: 'LGPL-2.1-only WITH Independent-modules-exception',
			sourceUrl:
				'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/COPYING.txt',
			exceptionSourceUrl:
				'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/LICENSE',
			verifiedBuildInput: false,
			evidence:
				'upstream license URLs recorded; texts were not vendored with the legacy generation'
		},
		metadata: {
			path: 'runtime-build.json',
			mediaType: 'application/json',
			size: 2,
			sha256: hash('{}')
		},
		assets: [
			{
				path: 'compiler.js',
				mediaType: 'text/javascript',
				size: compilerJavaScriptBytes.byteLength,
				sha256: hash(compilerJavaScriptBytes)
			},
			{
				path: 'rtl.js',
				mediaType: 'text/javascript',
				size: rtlJavaScriptBytes.byteLength,
				sha256: hash(rtlJavaScriptBytes)
			},
			{
				path: 'system.pas',
				mediaType: 'text/plain',
				size: systemPascalBytes.byteLength,
				sha256: hash(systemPascalBytes)
			}
		],
		storage: [
			{
				path: 'compiler.js.gz.bin',
				logicalPath: 'compiler.js',
				encoding: 'gzip',
				size: compilerStorage.byteLength,
				sha256: hash(compilerStorage)
			},
			{
				path: 'rtl.js.bin',
				logicalPath: 'rtl.js',
				encoding: 'identity',
				size: rtlJavaScriptBytes.byteLength,
				sha256: hash(rtlJavaScriptBytes)
			},
			{
				path: 'system.pas.bin',
				logicalPath: 'system.pas',
				encoding: 'identity',
				size: systemPascalBytes.byteLength,
				sha256: hash(systemPascalBytes)
			}
		]
	};
	manifest.fingerprint = manifestFingerprint(manifest);
	const manifestBytes = encoder.encode(JSON.stringify(manifest));
	const profile = Object.freeze({
		profileId,
		artifactRevision,
		pas2jsVersion,
		pas2jsRevision,
		manifestFingerprint: manifest.fingerprint,
		manifestReceipt: receipt(manifestBytes),
		compilerJavaScriptReceipt: pairedReceipt(compilerStorage, compilerJavaScriptBytes),
		rtlJavaScriptReceipt: receipt(rtlJavaScriptBytes),
		systemPascalReceipt: receipt(systemPascalBytes)
	}) satisfies PascalRuntimePreflightProfile;
	const storageByPath = new Map<string, Uint8Array>([
		['/wasm-pascal/runtime-manifest.v2.json', manifestBytes],
		['/wasm-pascal/compiler.js.gz.bin', compilerStorage],
		['/wasm-pascal/rtl.js.bin', rtlJavaScriptBytes],
		['/wasm-pascal/system.pas.bin', systemPascalBytes]
	]);
	return {
		manifest,
		manifestBytes,
		profile,
		compilerJavaScriptBytes,
		rtlJavaScriptBytes,
		systemPascalBytes,
		compilerStorage,
		storageByPath
	};
}

function createFixtureFetch(fixture: ReturnType<typeof createRuntimeFixture>) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const bytes = fixture.storageByPath.get(url.pathname);
		if (!bytes) return new Response('missing', { status: 404 });
		expect(init).toMatchObject({
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: expect.any(AbortSignal)
		});
		const response = new Response(Uint8Array.from(bytes), {
			headers: {
				'content-length': String(bytes.byteLength),
				'content-type': url.pathname.endsWith('.json')
					? 'application/json'
					: 'application/octet-stream'
			}
		});
		Object.defineProperty(response, 'url', { value: url.href });
		return response;
	});
}

describe('Pascal runtime host preflight contract', () => {
	afterEach(() => vi.useRealTimers());

	it('accepts the frozen producer manifest and generated receipt profile', async () => {
		const [manifestBytes, compilerStorage, rtlBytes, systemBytes] = await Promise.all([
			readFile(resolve(process.cwd(), 'static/wasm-pascal/runtime-manifest.v2.json')),
			readFile(resolve(process.cwd(), 'static/wasm-pascal/compiler.js.gz.bin')),
			readFile(resolve(process.cwd(), 'static/wasm-pascal/rtl.js.bin')),
			readFile(resolve(process.cwd(), 'static/wasm-pascal/system.pas.bin'))
		]);
		const payload = Object.freeze({
			protocol: PASCAL_PREFLIGHT_PROTOCOL,
			protocolVersion: PASCAL_PREFLIGHT_PROTOCOL_VERSION,
			profileId: WASM_PASCAL_RUNTIME_PROFILE.profileId,
			artifactRevision: WASM_PASCAL_RUNTIME_PROFILE.artifactRevision,
			pas2jsVersion: WASM_PASCAL_RUNTIME_PROFILE.pas2jsVersion,
			pas2jsRevision: WASM_PASCAL_RUNTIME_PROFILE.pas2jsRevision,
			manifestFingerprint: WASM_PASCAL_RUNTIME_PROFILE.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestBytes),
			compilerJavaScriptBytes: Uint8Array.from(gunzipSync(compilerStorage)),
			rtlJavaScriptBytes: Uint8Array.from(rtlBytes),
			systemPascalBytes: Uint8Array.from(systemBytes)
		});

		expect(snapshotPascalRuntimePreflightProfile(WASM_PASCAL_RUNTIME_PROFILE)).toEqual(
			WASM_PASCAL_RUNTIME_PROFILE
		);
		await expect(verifyPascalRuntimePreflightPayload(payload)).resolves.toBe(payload);
	});

	it('snapshots exact profiles and requires an exact four-buffer payload', () => {
		const fixture = createRuntimeFixture();
		expect(PASCAL_PREFLIGHT_PROTOCOL).toBe('wasm-idle-pascal-preflight');
		expect(PASCAL_PREFLIGHT_PROTOCOL_VERSION).toBe(1);
		expect(PASCAL_MAX_MANIFEST_BYTES).toBe(64 * 1024);
		expect(PASCAL_MAX_ASSET_BYTES).toBe(8 * 1024 * 1024);
		expect(PASCAL_MAX_DELIVERY_BYTES).toBe(8 * 1024 * 1024);
		expect(PASCAL_MAX_LOGICAL_BYTES).toBe(16 * 1024 * 1024);
		expect(snapshotPascalRuntimePreflightProfile(fixture.profile)).toEqual(fixture.profile);
		expect(() =>
			snapshotPascalRuntimePreflightProfile({
				...fixture.profile,
				rtlJavaScriptReceipt: undefined
			})
		).toThrow(/profile|receipt/iu);

		const payload = Object.freeze({
			protocol: PASCAL_PREFLIGHT_PROTOCOL,
			protocolVersion: PASCAL_PREFLIGHT_PROTOCOL_VERSION,
			profileId: fixture.profile.profileId,
			artifactRevision: fixture.profile.artifactRevision,
			pas2jsVersion: fixture.profile.pas2jsVersion,
			pas2jsRevision: fixture.profile.pas2jsRevision,
			manifestFingerprint: fixture.profile.manifestFingerprint,
			manifestBytes: new Uint8Array([1]),
			compilerJavaScriptBytes: new Uint8Array([2]),
			rtlJavaScriptBytes: new Uint8Array([3]),
			systemPascalBytes: new Uint8Array([4])
		});
		expect(requirePascalRuntimePreflightPayload(payload)).toBe(payload);
		const clone = clonePascalRuntimePreflightPayload(payload);
		expect(clone).toEqual(payload);
		for (const key of [
			'manifestBytes',
			'compilerJavaScriptBytes',
			'rtlJavaScriptBytes',
			'systemPascalBytes'
		] as const) {
			expect(clone[key]).not.toBe(payload[key]);
		}
		expect(() => requirePascalRuntimePreflightPayload({ ...payload, extra: true })).toThrow(
			/shape/iu
		);
	});

	it('downloads only four canonical query-pinned storage assets and returns logical bytes', async () => {
		const fixture = createRuntimeFixture();
		const fetch = createFixtureFetch(fixture);
		const payload = await preflightPascalRuntimeAssets({
			baseUrl: 'https://assets.example.test/wasm-pascal/',
			manifestUrl: 'runtime-manifest.v2.json',
			profile: fixture.profile,
			fetch
		});

		expect(payload.manifestBytes).toEqual(fixture.manifestBytes);
		expect(payload.compilerJavaScriptBytes).toEqual(fixture.compilerJavaScriptBytes);
		expect(payload.rtlJavaScriptBytes).toEqual(fixture.rtlJavaScriptBytes);
		expect(payload.systemPascalBytes).toEqual(fixture.systemPascalBytes);
		expect(fetch).toHaveBeenCalledTimes(4);
		const urls = fetch.mock.calls.map(([input]) => new URL(String(input)));
		expect(urls.map(({ pathname }) => pathname).sort()).toEqual(
			[
				'/wasm-pascal/runtime-manifest.v2.json',
				'/wasm-pascal/compiler.js.gz.bin',
				'/wasm-pascal/rtl.js.bin',
				'/wasm-pascal/system.pas.bin'
			].sort()
		);
		expect(
			Object.fromEntries(urls.map((url) => [url.pathname, url.searchParams.get('v')]))
		).toEqual({
			'/wasm-pascal/runtime-manifest.v2.json': fixture.profile.manifestFingerprint,
			'/wasm-pascal/compiler.js.gz.bin': fixture.profile.compilerJavaScriptReceipt.sha256,
			'/wasm-pascal/rtl.js.bin': fixture.profile.rtlJavaScriptReceipt.sha256,
			'/wasm-pascal/system.pas.bin': fixture.profile.systemPascalReceipt.sha256
		});
		await expect(verifyPascalRuntimePreflightPayload(payload)).resolves.toBe(payload);
	});

	it('rejects manifest graph replacement, logical tampering, and corrupt compressed bytes', async () => {
		const fixture = createRuntimeFixture();
		const payload = await preflightPascalRuntimeAssets({
			baseUrl: 'https://assets.example.test/wasm-pascal/',
			manifestUrl: 'runtime-manifest.v2.json',
			profile: fixture.profile,
			fetch: createFixtureFetch(fixture)
		});
		await expect(
			verifyPascalRuntimePreflightPayload({
				...payload,
				rtlJavaScriptBytes: encoder.encode('tampered')
			})
		).rejects.toThrow(/integrity|rtl/iu);

		const graphTamper = createRuntimeFixture();
		graphTamper.manifest.storage[1].logicalPath = 'system.pas';
		graphTamper.manifest.fingerprint = manifestFingerprint(graphTamper.manifest);
		const graphManifestBytes = encoder.encode(JSON.stringify(graphTamper.manifest));
		const graphProfile = {
			...graphTamper.profile,
			manifestFingerprint: graphTamper.manifest.fingerprint,
			manifestReceipt: receipt(graphManifestBytes)
		};
		await expect(
			preflightPascalRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-pascal/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: graphProfile,
				fetch: createFixtureFetch({
					...graphTamper,
					manifestBytes: graphManifestBytes,
					storageByPath: new Map(graphTamper.storageByPath).set(
						'/wasm-pascal/runtime-manifest.v2.json',
						graphManifestBytes
					)
				})
			})
		).rejects.toThrow(/storage|logical|asset/iu);

		const corrupt = createRuntimeFixture();
		corrupt.storageByPath.set(
			'/wasm-pascal/compiler.js.gz.bin',
			Uint8Array.from([...corrupt.compilerStorage, 0])
		);
		await expect(
			preflightPascalRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-pascal/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: corrupt.profile,
				fetch: createFixtureFetch(corrupt)
			})
		).rejects.toThrow(/integrity|byte|hash/iu);
	});

	it('fails before network for path, query, and declared aggregate budget drift', async () => {
		const fixture = createRuntimeFixture();
		const fetch = createFixtureFetch(fixture);
		for (const manifestUrl of [
			`runtime-manifest.v2.json?v=${sha('9')}`,
			'../runtime-manifest.v2.json'
		]) {
			await expect(
				preflightPascalRuntimeAssets({
					baseUrl: 'https://assets.example.test/wasm-pascal/',
					manifestUrl,
					profile: fixture.profile,
					fetch
				})
			).rejects.toThrow(/canonical|query-pinned|path/iu);
		}
		expect(fetch).not.toHaveBeenCalled();

		const overflow = {
			...fixture.profile,
			compilerJavaScriptReceipt: {
				...fixture.profile.compilerJavaScriptReceipt,
				bytes: PASCAL_MAX_DELIVERY_BYTES
			}
		};
		expect(() => snapshotPascalRuntimePreflightProfile(overflow)).toThrow(/aggregate|budget/iu);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects final URL drift and HTTP transparent decoding of gzip storage', async () => {
		const fixture = createRuntimeFixture();
		const finalUrlDriftFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			const bytes = fixture.storageByPath.get(url.pathname)!;
			expect(init?.redirect).toBe('error');
			const response = new Response(Uint8Array.from(bytes), {
				headers: {
					'content-length': String(bytes.byteLength),
					'content-type': url.pathname.endsWith('.json')
						? 'application/json'
						: 'application/octet-stream'
				}
			});
			Object.defineProperty(response, 'url', {
				value: url.pathname.endsWith('/rtl.js.bin')
					? `${url.origin}${url.pathname}?v=${sha('9')}`
					: url.href
			});
			return response;
		});
		await expect(
			preflightPascalRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-pascal/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: fixture.profile,
				fetch: finalUrlDriftFetch
			})
		).rejects.toThrow(/response URL|canonical|requested URL/iu);

		const identityEncodedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			const bytes = fixture.storageByPath.get(url.pathname)!;
			expect(init?.redirect).toBe('error');
			const response = new Response(Uint8Array.from(bytes), {
				headers: {
					...(url.pathname.endsWith('/compiler.js.gz.bin')
						? {}
						: { 'content-encoding': 'br' }),
					'content-length': String(bytes.byteLength),
					'content-type': url.pathname.endsWith('.json')
						? 'application/json'
						: 'application/octet-stream'
				}
			});
			Object.defineProperty(response, 'url', { value: url.href });
			return response;
		});
		await expect(
			preflightPascalRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-pascal/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: fixture.profile,
				fetch: identityEncodedFetch
			})
		).resolves.toMatchObject({ protocol: PASCAL_PREFLIGHT_PROTOCOL });

		const encodedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			const bytes = fixture.storageByPath.get(url.pathname)!;
			expect(init?.redirect).toBe('error');
			const response = new Response(Uint8Array.from(bytes), {
				headers: {
					...(url.pathname.endsWith('/compiler.js.gz.bin')
						? { 'content-encoding': 'br' }
						: {}),
					'content-length': String(bytes.byteLength),
					'content-type': url.pathname.endsWith('.json')
						? 'application/json'
						: 'application/octet-stream'
				}
			});
			Object.defineProperty(response, 'url', { value: url.href });
			return response;
		});
		await expect(
			preflightPascalRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-pascal/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: fixture.profile,
				fetch: encodedFetch
			})
		).rejects.toThrow(/Content-Encoding|encoded|encoding/iu);
	});

	it('rejects gzip truncation and expansion beyond the logical receipt', async () => {
		const fixture = createRuntimeFixture();
		const truncated = createRuntimeFixture();
		truncated.storageByPath.set(
			'/wasm-pascal/compiler.js.gz.bin',
			truncated.compilerStorage.subarray(0, truncated.compilerStorage.byteLength - 1)
		);
		await expect(
			preflightPascalRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-pascal/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: truncated.profile,
				fetch: createFixtureFetch(truncated)
			})
		).rejects.toThrow(/byte|integrity|truncated/iu);

		const expandedCompiler = new Uint8Array(256).fill(65);
		const expandedStorage = Uint8Array.from(gzipSync(expandedCompiler));
		const expandedManifest = structuredClone(fixture.manifest);
		const storage = expandedManifest.storage.find(
			(entry: { path: string }) => entry.path === 'compiler.js.gz.bin'
		)!;
		storage.size = expandedStorage.byteLength;
		storage.sha256 = hash(expandedStorage);
		expandedManifest.fingerprint = manifestFingerprint(expandedManifest);
		const manifestBytes = encoder.encode(JSON.stringify(expandedManifest));
		const expandedProfile = {
			...fixture.profile,
			manifestFingerprint: expandedManifest.fingerprint,
			manifestReceipt: receipt(manifestBytes),
			compilerJavaScriptReceipt: {
				...fixture.profile.compilerJavaScriptReceipt,
				...receipt(expandedStorage)
			}
		};
		await expect(
			preflightPascalRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-pascal/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: expandedProfile,
				fetch: createFixtureFetch({
					...fixture,
					manifest: expandedManifest,
					manifestBytes,
					profile: expandedProfile,
					storageByPath: new Map(fixture.storageByPath)
						.set('/wasm-pascal/runtime-manifest.v2.json', manifestBytes)
						.set('/wasm-pascal/compiler.js.gz.bin', expandedStorage)
				})
			})
		).rejects.toThrow(/decompress|logical|byte|integrity/iu);
	});

	it('cancels sibling downloads on caller abort and allows a clean retry', async () => {
		const fixture = createRuntimeFixture();
		const controller = new AbortController();
		const aborted: unknown[] = [];
		const fetch = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) =>
				await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => {
							aborted.push(init.signal?.reason);
							reject(init.signal?.reason);
						},
						{ once: true }
					);
				})
		);
		const pending = preflightPascalRuntimeAssets({
			baseUrl: 'https://assets.example.test/wasm-pascal/',
			manifestUrl: 'runtime-manifest.v2.json',
			profile: fixture.profile,
			fetch,
			signal: controller.signal
		});
		await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
		controller.abort(new Error('cancel Pascal assets'));
		await expect(pending).rejects.toMatchObject({ name: 'CancelledError' });
		expect(aborted).toHaveLength(4);
		await expect(
			preflightPascalRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-pascal/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: fixture.profile,
				fetch: createFixtureFetch(fixture)
			})
		).resolves.toMatchObject({ protocol: PASCAL_PREFLIGHT_PROTOCOL });
	});

	it('times out every sibling download and allows a clean retry', async () => {
		vi.useFakeTimers();
		const fixture = createRuntimeFixture();
		const aborted: unknown[] = [];
		const fetch = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) =>
				await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						'abort',
						() => {
							aborted.push(init.signal?.reason);
							reject(init.signal?.reason);
						},
						{ once: true }
					);
				})
		);
		const pending = preflightPascalRuntimeAssets({
			baseUrl: 'https://assets.example.test/wasm-pascal/',
			manifestUrl: 'runtime-manifest.v2.json',
			profile: fixture.profile,
			fetch,
			limits: { assetTimeoutMs: 5 }
		}).catch((reason: unknown) => reason);
		await Promise.resolve();
		await Promise.resolve();
		expect(fetch).toHaveBeenCalledTimes(4);
		await vi.advanceTimersByTimeAsync(5);
		expect(await pending).toMatchObject({
			name: 'TimeoutError',
			runtimeId: 'PASCAL',
			timeoutMs: 5
		});
		expect(aborted).toHaveLength(4);
		vi.useRealTimers();
		await expect(
			preflightPascalRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-pascal/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: fixture.profile,
				fetch: createFixtureFetch(fixture)
			})
		).resolves.toMatchObject({ protocol: PASCAL_PREFLIGHT_PROTOCOL });
	});
});
