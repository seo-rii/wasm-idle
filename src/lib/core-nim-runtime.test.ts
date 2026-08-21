// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { computeNimRuntimeFingerprint } from '../../scripts/sync-wasm-nim.mjs';
import {
	NIM_MAX_ASSET_BYTES,
	NIM_MAX_DELIVERY_BYTES,
	NIM_MAX_LOGICAL_BYTES,
	NIM_PREFLIGHT_PROTOCOL,
	NIM_PREFLIGHT_PROTOCOL_VERSION,
	cloneNimRuntimePreflightPayload,
	preflightNimRuntimeAssets,
	requireNimRuntimePreflightPayload,
	snapshotNimRuntimePreflightProfile,
	verifyNimRuntimePreflightPayload,
	type NimRuntimePreflightProfile
} from '@wasm-idle/core';
import { WASM_NIM_RUNTIME_PROFILE } from './playground/wasmNimVersion';

const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const wasmBytes = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
const sysrootBytes = new Uint8Array(512);
sysrootBytes.set(encoder.encode('ustar'), 257);

const logicalFixture = Object.freeze({
	'nim/nim-bundle.js': encoder.encode('__NIM_USER_CODE__; callMain();\n'),
	'nim/nim.wasm': wasmBytes,
	'nim/nimbase.h': encoder.encode('#define NIM_INTBITS 32\n'),
	'clang/clang.js': encoder.encode(
		'const fixture="payload:{port:c,assets:l} async function p({assets:l}) compile-each-link-done";\n'
	),
	'clang/clang.wasm': wasmBytes,
	'clang/lld.wasm': wasmBytes,
	'clang/memfs.wasm': wasmBytes,
	'clang/sysroot.tar': sysrootBytes
});

type Fixture = ReturnType<typeof createFixture>;
type NimFixtureManifest = Parameters<typeof computeNimRuntimeFingerprint>[0] & {
	fingerprint: string;
	assets: Array<{ path: keyof typeof logicalFixture; size: number; sha256: string }>;
	storage: Array<{
		encoding: 'gzip' | 'identity';
		logicalPath: keyof typeof logicalFixture;
		path: string;
		size: number;
		sha256: string;
	}>;
};

function createFixture() {
	const manifest = JSON.parse(
		readFileSync('static/wasm-nim/runtime-manifest.v2.json', 'utf8')
	) as NimFixtureManifest;
	const storageBytes = new Map<string, Uint8Array>();
	for (const asset of manifest.assets) {
		const bytes = logicalFixture[asset.path];
		asset.size = bytes.byteLength;
		asset.sha256 = sha256(bytes);
	}
	for (const storage of manifest.storage) {
		const logicalBytes = logicalFixture[storage.logicalPath];
		const bytes =
			storage.encoding === 'gzip'
				? Uint8Array.from(gzipSync(logicalBytes))
				: Uint8Array.from(logicalBytes);
		storage.size = bytes.byteLength;
		storage.sha256 = sha256(bytes);
		storageBytes.set(storage.path, bytes);
	}
	manifest.fingerprint = computeNimRuntimeFingerprint(manifest);
	const manifestBytes = encoder.encode(`${JSON.stringify(manifest, null, '\t')}\n`);
	const storageByLogicalPath = new Map(
		manifest.storage.map((storage) => [storage.logicalPath, storage] as const)
	);
	const receipt = (logicalPath: keyof typeof logicalFixture) => {
		const logical = logicalFixture[logicalPath];
		const storage = storageByLogicalPath.get(logicalPath)!;
		const delivery = storageBytes.get(storage.path)!;
		return storage.encoding === 'gzip'
			? {
					bytes: delivery.byteLength,
					sha256: sha256(delivery),
					uncompressedBytes: logical.byteLength,
					uncompressedSha256: sha256(logical)
				}
			: { bytes: delivery.byteLength, sha256: sha256(delivery) };
	};
	const profile: NimRuntimePreflightProfile = {
		profileId: WASM_NIM_RUNTIME_PROFILE.profileId,
		artifactRevision: WASM_NIM_RUNTIME_PROFILE.artifactRevision,
		nimRevision: WASM_NIM_RUNTIME_PROFILE.nimRevision,
		llvmRevision: WASM_NIM_RUNTIME_PROFILE.llvmRevision,
		memfsRevision: WASM_NIM_RUNTIME_PROFILE.memfsRevision,
		emscriptenRevision: WASM_NIM_RUNTIME_PROFILE.emscriptenRevision,
		manifestFingerprint: manifest.fingerprint,
		manifestReceipt: { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
		nimJavaScriptReceipt: receipt('nim/nim-bundle.js'),
		nimWasmReceipt: receipt('nim/nim.wasm'),
		nimbaseReceipt: receipt('nim/nimbase.h'),
		clangJavaScriptReceipt: receipt('clang/clang.js'),
		clangWasmReceipt: receipt('clang/clang.wasm'),
		lldWasmReceipt: receipt('clang/lld.wasm'),
		memfsWasmReceipt: receipt('clang/memfs.wasm'),
		sysrootReceipt: receipt('clang/sysroot.tar')
	};
	return { manifest, manifestBytes, profile, storageBytes };
}

function createFixtureFetch(fixture: Fixture, contentEncodingPath = '') {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const relativePath = url.pathname.split('/wasm-nim/')[1] || '';
		const bytes =
			relativePath === 'runtime-manifest.v2.json'
				? fixture.manifestBytes
				: fixture.storageBytes.get(relativePath);
		if (!bytes) return new Response('missing', { status: 404 });
		return new Response(Uint8Array.from(bytes), {
			status: 200,
			headers: {
				'content-length': String(bytes.byteLength),
				'content-type':
					relativePath === 'runtime-manifest.v2.json'
						? 'application/json'
						: 'application/octet-stream',
				...(relativePath === contentEncodingPath ? { 'content-encoding': 'gzip' } : {})
			}
		});
	});
}

describe('Nim runtime host preflight', () => {
	it('preflights the exact canonical storage graph into nine owned logical buffers', async () => {
		const fixture = createFixture();
		const fetch = createFixtureFetch(fixture);
		const payload = await preflightNimRuntimeAssets({
			baseUrl: 'https://cdn.example.com/wasm-nim/',
			manifestUrl: `https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${fixture.profile.manifestFingerprint}`,
			profile: fixture.profile,
			fetch
		});

		expect(NIM_PREFLIGHT_PROTOCOL).toBe('wasm-idle-nim-preflight');
		expect(NIM_PREFLIGHT_PROTOCOL_VERSION).toBe(1);
		expect(NIM_MAX_ASSET_BYTES).toBe(40 * 1024 * 1024);
		expect(NIM_MAX_DELIVERY_BYTES).toBe(32 * 1024 * 1024);
		expect(NIM_MAX_LOGICAL_BYTES).toBe(96 * 1024 * 1024);
		expect(Object.isFrozen(payload)).toBe(true);
		expect(Object.keys(payload).sort()).toEqual(
			[
				'artifactRevision',
				'clangJavaScriptBytes',
				'clangWasmBytes',
				'emscriptenRevision',
				'lldWasmBytes',
				'llvmRevision',
				'manifestBytes',
				'manifestFingerprint',
				'memfsRevision',
				'memfsWasmBytes',
				'nimJavaScriptBytes',
				'nimRevision',
				'nimWasmBytes',
				'nimbaseBytes',
				'profileId',
				'protocol',
				'protocolVersion',
				'sysrootBytes'
			].sort()
		);
		const buffers = [
			payload.manifestBytes,
			payload.nimJavaScriptBytes,
			payload.nimWasmBytes,
			payload.nimbaseBytes,
			payload.clangJavaScriptBytes,
			payload.clangWasmBytes,
			payload.lldWasmBytes,
			payload.memfsWasmBytes,
			payload.sysrootBytes
		];
		expect(buffers).toHaveLength(9);
		expect(new Set(buffers.map((bytes) => bytes.buffer)).size).toBe(9);
		expect(
			buffers.every(
				(bytes) =>
					bytes.byteLength > 0 &&
					bytes.byteOffset === 0 &&
					bytes.byteLength === bytes.buffer.byteLength
			)
		).toBe(true);
		expect(payload.nimJavaScriptBytes).toEqual(logicalFixture['nim/nim-bundle.js']);
		expect(payload.sysrootBytes).toEqual(logicalFixture['clang/sysroot.tar']);
		expect(fetch).toHaveBeenCalledTimes(9);
		for (const [input, init] of fetch.mock.calls) {
			expect(String(input)).toMatch(/\?v=[a-f0-9]{64}$/u);
			expect(init).toMatchObject({
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
		expect(requireNimRuntimePreflightPayload(payload)).toBe(payload);
	});

	it('rejects an oversized delivery graph before issuing any request', async () => {
		const fixture = createFixture();
		const fetch = createFixtureFetch(fixture);
		const profile = {
			...fixture.profile,
			nimJavaScriptReceipt: {
				...fixture.profile.nimJavaScriptReceipt,
				bytes: NIM_MAX_DELIVERY_BYTES
			}
		};

		await expect(
			preflightNimRuntimeAssets({
				baseUrl: 'https://cdn.example.com/wasm-nim/',
				manifestUrl: `https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${profile.manifestFingerprint}`,
				profile,
				fetch
			})
		).rejects.toMatchObject({ code: 'asset-too-large', runtimeId: 'NIM' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects transparent decoding and non-exact profile receipts', async () => {
		const fixture = createFixture();
		const fetch = createFixtureFetch(fixture, 'nim/nim-bundle.js.gz.bin');
		await expect(
			preflightNimRuntimeAssets({
				baseUrl: 'https://cdn.example.com/wasm-nim/',
				manifestUrl: `https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${fixture.profile.manifestFingerprint}`,
				profile: fixture.profile,
				fetch
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'NIM' });

		expect(() =>
			snapshotNimRuntimePreflightProfile({
				...fixture.profile,
				nimbaseReceipt: { ...fixture.profile.nimbaseReceipt, uncompressedBytes: 1 }
			})
		).toThrow('Nim runtime preflight profile');
	});

	it('accepts an HTTP-encoded identity manifest after fetch verifies its logical bytes', async () => {
		const fixture = createFixture();
		await expect(
			preflightNimRuntimeAssets({
				baseUrl: 'https://cdn.example.com/wasm-nim/',
				manifestUrl: `https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${fixture.profile.manifestFingerprint}`,
				profile: fixture.profile,
				fetch: createFixtureFetch(fixture, 'runtime-manifest.v2.json')
			})
		).resolves.toMatchObject({ manifestFingerprint: fixture.profile.manifestFingerprint });
	});

	it('rejects manifest identity and storage-graph tampering', async () => {
		for (const tamper of ['identity', 'storage'] as const) {
			const fixture = createFixture();
			const manifest = structuredClone(fixture.manifest);
			if (tamper === 'identity') {
				(manifest.components as Record<string, Record<string, unknown>>).nim.revision =
					'tampered';
			} else {
				manifest.storage[0]!.logicalPath = manifest.storage[1]!.logicalPath;
			}
			const manifestBytes = encoder.encode(`${JSON.stringify(manifest, null, '\t')}\n`);
			const profile = {
				...fixture.profile,
				manifestReceipt: {
					bytes: manifestBytes.byteLength,
					sha256: sha256(manifestBytes)
				}
			};
			const fetch = createFixtureFetch({ ...fixture, manifest, manifestBytes, profile });

			await expect(
				preflightNimRuntimeAssets({
					baseUrl: 'https://cdn.example.com/wasm-nim/',
					manifestUrl: `https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${profile.manifestFingerprint}`,
					profile,
					fetch
				})
			).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'NIM' });
		}
	});

	it('rejects corrupt delivery and logical bytes plus payload shape extensions', async () => {
		const fixture = createFixture();
		const corruptFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const response = await createFixtureFetch(fixture)(input, init);
			if (!String(input).includes('nim/nim.wasm.gz.bin')) return response;
			const bytes = new Uint8Array(await response.arrayBuffer());
			bytes[bytes.byteLength - 1] ^= 1;
			return new Response(bytes, {
				status: 200,
				headers: {
					'content-length': String(bytes.byteLength),
					'content-type': 'application/octet-stream'
				}
			});
		});
		await expect(
			preflightNimRuntimeAssets({
				baseUrl: 'https://cdn.example.com/wasm-nim/',
				manifestUrl: `https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${fixture.profile.manifestFingerprint}`,
				profile: fixture.profile,
				fetch: corruptFetch
			})
		).rejects.toMatchObject({ code: 'asset-integrity', runtimeId: 'NIM' });

		const payload = await preflightNimRuntimeAssets({
			baseUrl: 'https://cdn.example.com/wasm-nim/',
			manifestUrl: `https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${fixture.profile.manifestFingerprint}`,
			profile: fixture.profile,
			fetch: createFixtureFetch(fixture)
		});
		const corruptPayload = cloneNimRuntimePreflightPayload(payload);
		corruptPayload.nimWasmBytes[7] ^= 1;
		await expect(verifyNimRuntimePreflightPayload(corruptPayload)).rejects.toMatchObject({
			code: 'asset-integrity',
			runtimeId: 'NIM'
		});
		expect(() => requireNimRuntimePreflightPayload({ ...payload, unexpected: true })).toThrow(
			'invalid shape'
		);
	});

	it('confines the manifest to the exact query-pinned canonical path before fetch', async () => {
		const fixture = createFixture();
		for (const manifestUrl of [
			'https://cdn.example.com/wasm-nim/runtime-manifest.v2.json',
			`https://cdn.example.com/wasm-nim/runtime-manifest.v1.json?v=${fixture.profile.manifestFingerprint}`,
			`https://other.example.com/wasm-nim/runtime-manifest.v2.json?v=${fixture.profile.manifestFingerprint}`,
			`https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${'0'.repeat(64)}`
		]) {
			const fetch = createFixtureFetch(fixture);
			await expect(
				preflightNimRuntimeAssets({
					baseUrl: 'https://cdn.example.com/wasm-nim/',
					manifestUrl,
					profile: fixture.profile,
					fetch
				})
			).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'NIM' });
			expect(fetch).not.toHaveBeenCalled();
		}
	});

	it('aborts sibling requests on caller cancellation and retries with a clean graph', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		const signals: AbortSignal[] = [];
		const stalledFetch = vi.fn(
			(_input: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					const signal = init?.signal as AbortSignal;
					signals.push(signal);
					signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				})
		);
		const pending = preflightNimRuntimeAssets({
			baseUrl: 'https://cdn.example.com/wasm-nim/',
			manifestUrl: `https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${fixture.profile.manifestFingerprint}`,
			profile: fixture.profile,
			fetch: stalledFetch,
			signal: controller.signal
		});
		await vi.waitFor(() => expect(stalledFetch).toHaveBeenCalledTimes(4));
		controller.abort(new Error('cancel Nim fixture'));
		await expect(pending).rejects.toMatchObject({ code: 'cancelled', runtimeId: 'NIM' });
		expect(signals.every((signal) => signal.aborted)).toBe(true);

		await expect(
			preflightNimRuntimeAssets({
				baseUrl: 'https://cdn.example.com/wasm-nim/',
				manifestUrl: `https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${fixture.profile.manifestFingerprint}`,
				profile: fixture.profile,
				fetch: createFixtureFetch(fixture)
			})
		).resolves.toMatchObject({ profileId: fixture.profile.profileId });
	});

	it('times out stalled sibling requests and permits a clean retry', async () => {
		const fixture = createFixture();
		const signals: AbortSignal[] = [];
		const stalledFetch = vi.fn(
			(_input: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					const signal = init?.signal as AbortSignal;
					signals.push(signal);
					signal.addEventListener('abort', () => reject(signal.reason), { once: true });
				})
		);
		await expect(
			preflightNimRuntimeAssets({
				baseUrl: 'https://cdn.example.com/wasm-nim/',
				manifestUrl: `https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${fixture.profile.manifestFingerprint}`,
				profile: fixture.profile,
				fetch: stalledFetch,
				limits: { assetTimeoutMs: 5 }
			})
		).rejects.toMatchObject({ code: 'timeout', runtimeId: 'NIM' });
		expect(signals).toHaveLength(4);
		expect(signals.every((signal) => signal.aborted)).toBe(true);

		await expect(
			preflightNimRuntimeAssets({
				baseUrl: 'https://cdn.example.com/wasm-nim/',
				manifestUrl: `https://cdn.example.com/wasm-nim/runtime-manifest.v2.json?v=${fixture.profile.manifestFingerprint}`,
				profile: fixture.profile,
				fetch: createFixtureFetch(fixture)
			})
		).resolves.toMatchObject({ manifestFingerprint: fixture.profile.manifestFingerprint });
	});
});
