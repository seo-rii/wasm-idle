// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
	RUBY_MAX_ASSET_BYTES,
	RUBY_MAX_DELIVERY_BYTES,
	RUBY_MAX_LOGICAL_BYTES,
	RUBY_MAX_MANIFEST_BYTES,
	RUBY_MAX_MODULE_BYTES,
	RUBY_PREFLIGHT_PROTOCOL,
	RUBY_PREFLIGHT_PROTOCOL_VERSION,
	RUBY_RUNTIME_ASSET_PATH,
	RUBY_RUNTIME_ASSET_RECEIPTS,
	RUBY_RUNTIME_MANIFEST_PATH,
	RUBY_RUNTIME_MODULE_STORAGE_PATH,
	RUBY_RUNTIME_PROFILE,
	RUBY_RUNTIME_WASM_STORAGE_PATH,
	cloneRubyRuntimePreflightPayload,
	deriveRubyRuntimeWasmUrl,
	preflightRubyRuntimeAssets,
	requireRubyRuntimePreflightPayload,
	snapshotRubyRuntimePreflightProfile,
	snapshotRubyRuntimeAssetReceipts,
	verifyRubyRuntimePreflightPayload,
	type RubyRuntimePreflightProfile
} from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const encoder = new TextEncoder();

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

function manifestFingerprint(manifest: Record<string, any>) {
	let canonical =
		`wasm-idle:ruby-runtime-manifest:v2\n` +
		`format\0${manifest.format}\n` +
		`runtime\0${manifest.runtime}\n` +
		`profileId\0${manifest.profileId}\n` +
		`provenanceLevel\0${manifest.provenanceLevel}\n` +
		`licenseExpression\0${manifest.licenseExpression}\n`;
	for (const key of ['artifact', 'components', 'packages', 'producer', 'transformations']) {
		canonical += `${key}\0${canonicalJson(manifest[key])}\n`;
	}
	for (const legal of [...manifest.legalFiles].sort((left, right) =>
		left.targetPath < right.targetPath ? -1 : left.targetPath > right.targetPath ? 1 : 0
	)) {
		canonical += `legal\0${legal.targetPath}\0${legal.mediaType}\0${legal.spdx}\0${legal.size}\0${legal.sha256}\n`;
	}
	canonical += `metadata\0${manifest.metadata.path}\0${manifest.metadata.mediaType}\0${manifest.metadata.size}\0${manifest.metadata.sha256}\n`;
	for (const asset of [...manifest.assets].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...manifest.storage].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return hash(canonical);
}

function receipt(bytes: Uint8Array) {
	return { bytes: bytes.byteLength, sha256: hash(bytes) };
}

async function createRuntimeFixture() {
	const template = JSON.parse(
		await readFile(resolve(process.cwd(), 'static/wasm-ruby/runtime-manifest.v2.json'), 'utf8')
	);
	const moduleJavaScriptBytes = encoder.encode(
		`export const rubyStdlibWasmUrl = new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)}, import.meta.url);\nexport const RubyVM = {}; export const wasiShim = {}; export const consolePrinter = () => ({});`
	);
	const wasmBytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
	const wasmStorage = Uint8Array.from(gzipSync(wasmBytes));
	for (const asset of template.assets) {
		const bytes = asset.path === 'runtime.mjs' ? moduleJavaScriptBytes : wasmBytes;
		asset.size = bytes.byteLength;
		asset.sha256 = hash(bytes);
	}
	for (const asset of template.storage) {
		const bytes =
			asset.path === RUBY_RUNTIME_MODULE_STORAGE_PATH ? moduleJavaScriptBytes : wasmStorage;
		asset.size = bytes.byteLength;
		asset.sha256 = hash(bytes);
	}
	template.fingerprint = manifestFingerprint(template);
	const manifestBytes = encoder.encode(JSON.stringify(template));
	const profile = Object.freeze({
		profileId: template.profileId,
		artifactRevision: template.artifact.revision,
		rubyVersion: template.components.ruby.version,
		rubyRevision: template.components.ruby.revision,
		rubyWasmVersion: template.components.rubyWasm.version,
		rubyWasmRevision: template.components.rubyWasm.revision,
		wasiSdkVersion: template.components.wasiSdk.version,
		manifestFingerprint: template.fingerprint,
		manifestReceipt: receipt(manifestBytes),
		moduleJavaScriptReceipt: receipt(moduleJavaScriptBytes),
		wasmReceipt: {
			...receipt(wasmStorage),
			uncompressedBytes: wasmBytes.byteLength,
			uncompressedSha256: hash(wasmBytes)
		}
	}) satisfies RubyRuntimePreflightProfile;
	return {
		manifest: template,
		manifestBytes,
		moduleJavaScriptBytes,
		wasmBytes,
		wasmStorage,
		profile,
		storageByPath: new Map<string, Uint8Array>([
			[`/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}`, manifestBytes],
			[`/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}`, moduleJavaScriptBytes],
			[`/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}`, wasmStorage]
		])
	};
}

function createFixtureFetch(
	fixture: Awaited<ReturnType<typeof createRuntimeFixture>>,
	contentEncoding?: (path: string) => string | undefined
) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const bytes = fixture.storageByPath.get(url.pathname);
		if (!bytes) return new Response('missing', { status: 404 });
		expect(init).toMatchObject({
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: expect.any(AbortSignal)
		});
		const headers = new Headers({
			'content-length': String(bytes.byteLength),
			'content-type': url.pathname.endsWith('.json')
				? 'application/json'
				: 'application/octet-stream'
		});
		const encoding = contentEncoding?.(url.pathname);
		if (encoding) headers.set('content-encoding', encoding);
		const response = new Response(Uint8Array.from(bytes), { headers });
		Object.defineProperty(response, 'url', { value: url.href });
		return response;
	});
}

describe('Core Ruby runtime receipts', () => {
	it('publishes the frozen Ruby host-preflight protocol and hard byte budgets', () => {
		expect(RUBY_PREFLIGHT_PROTOCOL).toBe('wasm-idle-ruby-preflight');
		expect(RUBY_PREFLIGHT_PROTOCOL_VERSION).toBe(1);
		expect(RUBY_MAX_MANIFEST_BYTES).toBe(64 * 1024);
		expect(RUBY_MAX_MODULE_BYTES).toBe(1024 * 1024);
		expect(RUBY_MAX_ASSET_BYTES).toBe(40 * 1024 * 1024);
		expect(RUBY_MAX_DELIVERY_BYTES).toBe(16 * 1024 * 1024);
		expect(RUBY_MAX_LOGICAL_BYTES).toBe(40 * 1024 * 1024);
	});

	it('snapshots the exact full profile and clones the exact three-buffer payload', () => {
		const receipt = { bytes: 1, sha256: 'a'.repeat(64) };
		const profile = snapshotRubyRuntimePreflightProfile({
			profileId: 'ruby-3.4.1-ruby-wasm-2.9.3-2.9.4',
			artifactRevision: '3'.repeat(40),
			rubyVersion: '3.4.1',
			rubyRevision: '4'.repeat(40),
			rubyWasmVersion: '2.9.3-2.9.4',
			rubyWasmRevision: '3'.repeat(40),
			wasiSdkVersion: '22.0',
			manifestFingerprint: '5'.repeat(64),
			manifestReceipt: receipt,
			moduleJavaScriptReceipt: receipt,
			wasmReceipt: {
				...receipt,
				uncompressedBytes: 8,
				uncompressedSha256: 'b'.repeat(64)
			}
		});
		const source = Object.freeze({
			protocol: RUBY_PREFLIGHT_PROTOCOL,
			protocolVersion: RUBY_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			artifactRevision: profile.artifactRevision,
			rubyVersion: profile.rubyVersion,
			rubyRevision: profile.rubyRevision,
			rubyWasmVersion: profile.rubyWasmVersion,
			rubyWasmRevision: profile.rubyWasmRevision,
			wasiSdkVersion: profile.wasiSdkVersion,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: new Uint8Array([1]),
			moduleJavaScriptBytes: new Uint8Array([2]),
			wasmBytes: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
		});
		const cloned = cloneRubyRuntimePreflightPayload(source);

		expect(requireRubyRuntimePreflightPayload(cloned)).toBe(cloned);
		expect(Object.keys(profile).sort()).toEqual([
			'artifactRevision',
			'manifestFingerprint',
			'manifestReceipt',
			'moduleJavaScriptReceipt',
			'profileId',
			'rubyRevision',
			'rubyVersion',
			'rubyWasmRevision',
			'rubyWasmVersion',
			'wasiSdkVersion',
			'wasmReceipt'
		]);
		expect(Object.keys(cloned).sort()).toEqual(Object.keys(source).sort());
		expect(cloned.manifestBytes).not.toBe(source.manifestBytes);
		expect(cloned.moduleJavaScriptBytes).not.toBe(source.moduleJavaScriptBytes);
		expect(cloned.wasmBytes).not.toBe(source.wasmBytes);
	});
	it('publishes an exact detached and deeply immutable two-asset snapshot', () => {
		const moduleReceipt: { bytes: number; sha256: string } = {
			bytes: RUBY_RUNTIME_ASSET_RECEIPTS['runtime.mjs'].bytes,
			sha256: RUBY_RUNTIME_ASSET_RECEIPTS['runtime.mjs'].sha256
		};
		const wasmReceipt: { bytes: number; sha256: string } = {
			bytes: RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].bytes,
			sha256: RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].sha256
		};
		const input = {
			'runtime.mjs': moduleReceipt,
			[RUBY_RUNTIME_ASSET_PATH]: wasmReceipt
		};

		const snapshot = snapshotRubyRuntimeAssetReceipts(input);
		moduleReceipt.bytes = 1;
		wasmReceipt.sha256 = '0'.repeat(64);

		expect(snapshot).toEqual(RUBY_RUNTIME_ASSET_RECEIPTS);
		expect(snapshot).not.toBe(input);
		expect(snapshot['runtime.mjs']).not.toBe(moduleReceipt);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot['runtime.mjs'])).toBe(true);
		expect(Object.isFrozen(snapshot[RUBY_RUNTIME_ASSET_PATH])).toBe(true);
	});

	it('captures each untrusted receipt and field exactly once', () => {
		const moduleReceipt = {
			get bytes() {
				return RUBY_RUNTIME_ASSET_RECEIPTS['runtime.mjs'].bytes;
			},
			get sha256() {
				return RUBY_RUNTIME_ASSET_RECEIPTS['runtime.mjs'].sha256;
			}
		};
		const wasmReceipt = {
			get bytes() {
				return RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].bytes;
			},
			get sha256() {
				return RUBY_RUNTIME_ASSET_RECEIPTS[RUBY_RUNTIME_ASSET_PATH].sha256;
			}
		};
		const moduleGetter = vi.fn(() => moduleReceipt);
		const wasmGetter = vi.fn(() => wasmReceipt);
		const input = Object.defineProperties(
			{},
			{
				'runtime.mjs': { enumerable: true, get: moduleGetter },
				[RUBY_RUNTIME_ASSET_PATH]: { enumerable: true, get: wasmGetter }
			}
		);
		const moduleBytes = vi.spyOn(moduleReceipt, 'bytes', 'get');
		const moduleSha = vi.spyOn(moduleReceipt, 'sha256', 'get');
		const wasmBytes = vi.spyOn(wasmReceipt, 'bytes', 'get');
		const wasmSha = vi.spyOn(wasmReceipt, 'sha256', 'get');

		expect(snapshotRubyRuntimeAssetReceipts(input)).toEqual(RUBY_RUNTIME_ASSET_RECEIPTS);
		expect(moduleGetter).toHaveBeenCalledOnce();
		expect(wasmGetter).toHaveBeenCalledOnce();
		expect(moduleBytes).toHaveBeenCalledOnce();
		expect(moduleSha).toHaveBeenCalledOnce();
		expect(wasmBytes).toHaveBeenCalledOnce();
		expect(wasmSha).toHaveBeenCalledOnce();
	});

	it.each([
		null,
		{},
		{ ...RUBY_RUNTIME_ASSET_RECEIPTS, extra: { bytes: 1, sha256: 'a'.repeat(64) } },
		{
			...RUBY_RUNTIME_ASSET_RECEIPTS,
			'runtime.mjs': { bytes: 0, sha256: 'a'.repeat(64) }
		},
		{
			...RUBY_RUNTIME_ASSET_RECEIPTS,
			[RUBY_RUNTIME_ASSET_PATH]: { bytes: 1, sha256: 'A'.repeat(64) }
		}
	])('rejects malformed or widened receipt sets', (value) => {
		expect(() => snapshotRubyRuntimeAssetReceipts(value)).toThrow('Ruby runtime');
	});

	it('derives one query-preserving Wasm sibling for absolute and root-relative modules', () => {
		expect(deriveRubyRuntimeWasmUrl('https://cdn.example/runtime/runtime.mjs?v=profile')).toBe(
			`https://cdn.example/runtime/${RUBY_RUNTIME_ASSET_PATH}?v=profile`
		);
		expect(deriveRubyRuntimeWasmUrl('/app/wasm-ruby/runtime.mjs?v=profile')).toBe(
			`/app/wasm-ruby/${RUBY_RUNTIME_ASSET_PATH}?v=profile`
		);
		expect(
			deriveRubyRuntimeWasmUrl(
				'./wasm-ruby/runtime.mjs?v=profile',
				'https://app.example/base/'
			)
		).toBe(`https://app.example/base/wasm-ruby/${RUBY_RUNTIME_ASSET_PATH}?v=profile`);
	});

	it('rejects ambiguous document-relative modules without a resolution context', () => {
		expect(() => deriveRubyRuntimeWasmUrl('wasm-ruby/runtime.mjs')).toThrow(
			'absolute or root-relative'
		);
		expect(() => deriveRubyRuntimeWasmUrl('/wasm-ruby/runtime.mjs#unsafe')).toThrow(
			'must not include a fragment'
		);
	});
});

describe('Ruby runtime host preflight contract', () => {
	afterEach(() => vi.useRealTimers());

	it('accepts the frozen producer manifest and generated full profile', async () => {
		const [manifestBytes, moduleBytes, wasmStorage] = await Promise.all([
			readFile(resolve(process.cwd(), 'static/wasm-ruby/runtime-manifest.v2.json')),
			readFile(resolve(process.cwd(), 'static/wasm-ruby/runtime.mjs.bin')),
			readFile(resolve(process.cwd(), `static/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}`))
		]);
		const wasmBytes = Uint8Array.from(gunzipSync(wasmStorage));
		const payload = Object.freeze({
			protocol: RUBY_PREFLIGHT_PROTOCOL,
			protocolVersion: RUBY_PREFLIGHT_PROTOCOL_VERSION,
			profileId: RUBY_RUNTIME_PROFILE.profileId,
			artifactRevision: RUBY_RUNTIME_PROFILE.artifactRevision,
			rubyVersion: RUBY_RUNTIME_PROFILE.rubyVersion,
			rubyRevision: RUBY_RUNTIME_PROFILE.rubyRevision,
			rubyWasmVersion: RUBY_RUNTIME_PROFILE.rubyWasmVersion,
			rubyWasmRevision: RUBY_RUNTIME_PROFILE.rubyWasmRevision,
			wasiSdkVersion: RUBY_RUNTIME_PROFILE.wasiSdkVersion,
			manifestFingerprint: RUBY_RUNTIME_PROFILE.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestBytes),
			moduleJavaScriptBytes: Uint8Array.from(moduleBytes),
			wasmBytes: Uint8Array.from(wasmBytes)
		});

		expect(snapshotRubyRuntimePreflightProfile(RUBY_RUNTIME_PROFILE)).toEqual(
			RUBY_RUNTIME_PROFILE
		);
		expect(hash(wasmStorage)).toBe(RUBY_RUNTIME_PROFILE.wasmReceipt.sha256);
		expect(hash(Uint8Array.from(gunzipSync(wasmStorage)))).toBe(
			RUBY_RUNTIME_PROFILE.wasmReceipt.uncompressedSha256
		);
		await expect(verifyRubyRuntimePreflightPayload(payload)).resolves.toBe(payload);
	}, 30_000);

	it('downloads only the three query-pinned canonical storage assets and returns logical bytes', async () => {
		const fixture = await createRuntimeFixture();
		const fetch = createFixtureFetch(fixture);
		const payload = await preflightRubyRuntimeAssets({
			baseUrl: 'https://app.example/wasm-ruby/',
			manifestUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}?v=${fixture.profile.manifestFingerprint}`,
			moduleUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}?v=${fixture.profile.moduleJavaScriptReceipt.sha256}`,
			wasmUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}?v=${fixture.profile.wasmReceipt.sha256}`,
			profile: fixture.profile,
			fetch
		});

		expect(payload.manifestBytes).toEqual(fixture.manifestBytes);
		expect(payload.moduleJavaScriptBytes).toEqual(fixture.moduleJavaScriptBytes);
		expect(payload.wasmBytes).toEqual(fixture.wasmBytes);
		expect(fetch.mock.calls.map(([url]) => String(url)).sort()).toEqual(
			[
				`https://app.example/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}?v=${fixture.profile.manifestFingerprint}`,
				`https://app.example/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}?v=${fixture.profile.moduleJavaScriptReceipt.sha256}`,
				`https://app.example/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}?v=${fixture.profile.wasmReceipt.sha256}`
			].sort()
		);
		expect(fetch).toHaveBeenCalledTimes(3);
		for (const [, init] of fetch.mock.calls) expect(init?.cache).toBe('no-store');
	});

	it('rejects extra payload fields, graph tampering, and corrupt logical bytes', async () => {
		const fixture = await createRuntimeFixture();
		const payload = await preflightRubyRuntimeAssets({
			baseUrl: 'https://app.example/wasm-ruby/',
			manifestUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}`,
			moduleUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}`,
			wasmUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}`,
			profile: fixture.profile,
			fetch: createFixtureFetch(fixture)
		});
		expect(() => requireRubyRuntimePreflightPayload({ ...payload, extra: true })).toThrow(
			'invalid shape'
		);
		const corruptWasm = cloneRubyRuntimePreflightPayload(payload);
		corruptWasm.wasmBytes[7] ^= 1;
		await expect(verifyRubyRuntimePreflightPayload(corruptWasm)).rejects.toThrow(
			'SHA-256 mismatch'
		);
		const manifest = structuredClone(fixture.manifest);
		manifest.components.wasiSdk.revision = '0'.repeat(40);
		manifest.fingerprint = manifestFingerprint(manifest);
		const manifestBytes = encoder.encode(JSON.stringify(manifest));
		const widened = {
			...payload,
			manifestFingerprint: manifest.fingerprint,
			manifestBytes
		};
		await expect(verifyRubyRuntimePreflightPayload(widened)).rejects.toThrow(
			'wasiSdk component identity'
		);
		const provenance = structuredClone(fixture.manifest);
		provenance.packages[0].integrity = `sha512-${'A'.repeat(88)}`;
		provenance.fingerprint = manifestFingerprint(provenance);
		await expect(
			verifyRubyRuntimePreflightPayload({
				...payload,
				manifestFingerprint: provenance.fingerprint,
				manifestBytes: encoder.encode(JSON.stringify(provenance))
			})
		).rejects.toThrow('pinned provenance graph');
	});

	it('permits decoded identity transport encoding but rejects it on gzip storage', async () => {
		const fixture = await createRuntimeFixture();
		const request = {
			baseUrl: 'https://app.example/wasm-ruby/',
			manifestUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}`,
			moduleUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}`,
			wasmUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}`,
			profile: fixture.profile
		};
		await expect(
			preflightRubyRuntimeAssets({
				...request,
				fetch: createFixtureFetch(fixture, (path) =>
					path.endsWith('.json') || path.endsWith('runtime.mjs.bin') ? 'gzip' : undefined
				)
			})
		).resolves.toMatchObject({ profileId: fixture.profile.profileId });
		await expect(
			preflightRubyRuntimeAssets({
				...request,
				fetch: createFixtureFetch(fixture, (path) =>
					path.endsWith('.gz.bin') ? 'br' : undefined
				)
			})
		).rejects.toThrow('Content-Encoding');
	});

	it('rejects noncanonical paths, queries, redirects, and final URLs before activation', async () => {
		const fixture = await createRuntimeFixture();
		const base = {
			baseUrl: 'https://app.example/wasm-ruby/',
			manifestUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}`,
			moduleUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}`,
			wasmUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}`,
			profile: fixture.profile,
			fetch: createFixtureFetch(fixture)
		};
		await expect(
			preflightRubyRuntimeAssets({
				...base,
				moduleUrl: 'https://evil.example/runtime.mjs.bin'
			})
		).rejects.toThrow('canonical storage path');
		await expect(
			preflightRubyRuntimeAssets({ ...base, wasmUrl: `${base.wasmUrl}?v=${'f'.repeat(64)}` })
		).rejects.toThrow('query-pinned');
		const redirectedFetch = createFixtureFetch(fixture);
		redirectedFetch.mockImplementationOnce(async (input) => {
			const url = new URL(String(input));
			const response = new Response(fixture.manifestBytes, {
				headers: {
					'content-length': String(fixture.manifestBytes.byteLength),
					'content-type': 'application/json'
				}
			});
			Object.defineProperty(response, 'url', { value: `${url.origin}/other.json` });
			return response;
		});
		await expect(
			preflightRubyRuntimeAssets({ ...base, fetch: redirectedFetch })
		).rejects.toThrow('outside its declared asset root');
	});

	it('aborts sibling downloads on timeout and succeeds with a clean retry', async () => {
		vi.useFakeTimers();
		const fixture = await createRuntimeFixture();
		const aborted: string[] = [];
		const stalledFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					'abort',
					() => {
						aborted.push(url);
						reject(init.signal?.reason);
					},
					{ once: true }
				);
			});
		});
		const request = {
			baseUrl: 'https://app.example/wasm-ruby/',
			manifestUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_MANIFEST_PATH}`,
			moduleUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_MODULE_STORAGE_PATH}`,
			wasmUrl: `https://app.example/wasm-ruby/${RUBY_RUNTIME_WASM_STORAGE_PATH}`,
			profile: fixture.profile,
			timeoutMs: 10
		};
		const pending = preflightRubyRuntimeAssets({ ...request, fetch: stalledFetch });
		const settled = pending.catch((error) => error);
		await vi.advanceTimersByTimeAsync(11);
		expect(await settled).toMatchObject({ code: 'timeout' });
		expect(aborted).toHaveLength(3);
		vi.useRealTimers();
		await expect(
			preflightRubyRuntimeAssets({
				...request,
				timeoutMs: 5_000,
				fetch: createFixtureFetch(fixture)
			})
		).resolves.toMatchObject({ profileId: fixture.profile.profileId });
	});
});
