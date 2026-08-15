import { createRuntimeAssetsKey } from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';
import manifestSource from '../../../static/wasm-forth/runtime-manifest.v2.json?raw';
import runtimeSource from '../../../static/wasm-forth/waforth.js?raw';
import { preflightForthRuntimeAssets } from './forthPreflight';
import { WASM_FORTH_ASSET_VERSION, WASM_FORTH_RUNTIME_PROFILE } from './wasmForthVersion';

const encoder = new TextEncoder();
const manifestBytes = encoder.encode(manifestSource);
const runtimeBytes = encoder.encode(runtimeSource);

function createFixtureFetch(options: { corruptRuntime?: boolean } = {}) {
	return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		const url = String(input);
		const isManifest = new URL(url).pathname.endsWith('/runtime-manifest.v2.json');
		let bytes = Uint8Array.from(isManifest ? manifestBytes : runtimeBytes);
		if (!isManifest && options.corruptRuntime) bytes[bytes.byteLength - 1] ^= 1;
		const response = new Response(bytes, {
			status: 200,
			headers: {
				'content-length': String(bytes.byteLength),
				'content-type': isManifest ? 'application/json' : 'application/javascript'
			}
		});
		Object.defineProperty(response, 'url', { value: url });
		return response;
	});
}

describe('Forth runtime host preflight', () => {
	it('downloads and verifies the exact generated manifest and runtime at an origin root', async () => {
		const fetch = createFixtureFetch();
		const progress = vi.fn();

		const payload = await preflightForthRuntimeAssets({
			baseUrl: 'https://runtime.example/',
			manifestUrl: 'https://runtime.example/runtime-manifest.v2.json',
			profile: WASM_FORTH_RUNTIME_PROFILE,
			fetch,
			reportProgress: progress
		});

		expect(payload).toMatchObject({
			protocol: 'wasm-idle-forth-preflight',
			protocolVersion: 1,
			profileId: WASM_FORTH_RUNTIME_PROFILE.profileId,
			implementationVersion: WASM_FORTH_RUNTIME_PROFILE.implementationVersion,
			manifestFingerprint: WASM_FORTH_ASSET_VERSION
		});
		expect(Array.from(payload.manifestBytes)).toEqual(Array.from(manifestBytes));
		expect(Array.from(payload.runtimeBytes)).toEqual(Array.from(runtimeBytes));
		expect(fetch.mock.calls.map(([url]) => String(url)).sort()).toEqual([
			`https://runtime.example/runtime-manifest.v2.json?v=${WASM_FORTH_ASSET_VERSION}`,
			`https://runtime.example/waforth.js?v=${WASM_FORTH_RUNTIME_PROFILE.runtimeReceipt.sha256}`
		]);
		for (const [, init] of fetch.mock.calls) {
			expect(init).toMatchObject({
				credentials: 'omit',
				redirect: 'follow',
				referrerPolicy: 'no-referrer'
			});
		}
		expect(progress).toHaveBeenCalled();
	});

	it('rejects corrupted runtime bytes before returning a worker payload', async () => {
		await expect(
			preflightForthRuntimeAssets({
				baseUrl: 'https://runtime.example/wasm-forth/',
				manifestUrl: 'https://runtime.example/wasm-forth/runtime-manifest.v2.json',
				profile: WASM_FORTH_RUNTIME_PROFILE,
				fetch: createFixtureFetch({ corruptRuntime: true })
			})
		).rejects.toMatchObject({
			code: 'asset-integrity',
			profileId: WASM_FORTH_RUNTIME_PROFILE.profileId,
			runtimeId: 'FORTH'
		});
	});

	it('rejects out-of-base manifests and incomplete custom profiles before fetch', async () => {
		const fetch = createFixtureFetch();
		await expect(
			preflightForthRuntimeAssets({
				baseUrl: 'https://runtime.example/wasm-forth/',
				manifestUrl: 'https://other.example/runtime-manifest.v2.json',
				profile: WASM_FORTH_RUNTIME_PROFILE,
				fetch
			})
		).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'FORTH' });
		await expect(
			preflightForthRuntimeAssets({
				baseUrl: 'https://runtime.example/wasm-forth/',
				manifestUrl: 'https://runtime.example/wasm-forth/runtime-manifest.v2.json',
				profile: {
					profileId: 'waforth-custom',
					implementationVersion: 'custom',
					manifestFingerprint: 'a'.repeat(64)
				},
				fetch
			})
		).rejects.toThrow('manifest preflight receipt is invalid');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('accepts only the exact pinned manifest cache-buster', async () => {
		const fetch = createFixtureFetch();
		await expect(
			preflightForthRuntimeAssets({
				baseUrl: 'https://runtime.example/wasm-forth/',
				manifestUrl: `https://runtime.example/wasm-forth/runtime-manifest.v2.json?v=${WASM_FORTH_ASSET_VERSION}`,
				profile: WASM_FORTH_RUNTIME_PROFILE,
				fetch
			})
		).resolves.toMatchObject({ manifestFingerprint: WASM_FORTH_ASSET_VERSION });
		await expect(
			preflightForthRuntimeAssets({
				baseUrl: 'https://runtime.example/wasm-forth/',
				manifestUrl: 'https://runtime.example/wasm-forth/runtime-manifest.v2.json?v=stale',
				profile: WASM_FORTH_RUNTIME_PROFILE,
				fetch
			})
		).rejects.toThrow('pinned manifest fingerprint cache-buster');
	});

	it('includes every custom preflight receipt in the runtime asset cache identity', () => {
		const first = createRuntimeAssetsKey({
			forth: {
				manifestFingerprint: 'a'.repeat(64),
				profileId: 'waforth-custom',
				implementationVersion: 'custom',
				manifestReceipt: { bytes: 10, sha256: 'b'.repeat(64) },
				runtimeReceipt: { bytes: 20, sha256: 'c'.repeat(64) }
			}
		});
		const second = createRuntimeAssetsKey({
			forth: {
				manifestFingerprint: 'a'.repeat(64),
				profileId: 'waforth-custom',
				implementationVersion: 'custom',
				manifestReceipt: { bytes: 10, sha256: 'b'.repeat(64) },
				runtimeReceipt: { bytes: 20, sha256: 'd'.repeat(64) }
			}
		});

		expect(first).not.toBe(second);
		expect(first).toContain('forthProfileId');
		expect(first).toContain('forthImplementationVersion');
		expect(first).toContain('forthManifestReceipt');
		expect(first).toContain('forthRuntimeReceipt');
	});
});
