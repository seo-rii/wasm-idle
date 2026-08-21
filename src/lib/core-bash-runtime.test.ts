import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	BASH_MAX_ASSET_BYTES,
	BASH_MAX_DELIVERY_BYTES,
	BASH_PREFLIGHT_PROTOCOL,
	BASH_PREFLIGHT_PROTOCOL_VERSION,
	cloneBashRuntimePreflightPayload,
	preflightBashRuntimeAssets,
	requireBashRuntimePreflightPayload,
	snapshotBashRuntimePreflightProfile,
	verifyBashRuntimePreflightPayload
} from '@wasm-idle/core';
import { WASM_BASH_RUNTIME_PROFILE } from '$lib/playground/wasmBashVersion';

const sha = (digit: string) => digit.repeat(64);

const profile = Object.freeze({
	profileId: 'bash-1.0.25-wasmer-sdk-0.9.0-fc809648',
	bashPackageVersion: '1.0.25',
	bashSourceRevision: 'fc8096485478055f4fcf31402004fdd8ff6b72b7',
	wasmerSdkVersion: '0.9.0',
	wasmerSdkPackageIntegrity:
		'sha512-k/CY19NfeLCjA9ZpX69JAoZKiuMT3hKjDFJYWdRGkCdfig9NtC9Op7Gpg2LeezuuQKd4WaSSq8bpSMdHw1BMgg==',
	manifestFingerprint: sha('a'),
	manifestReceipt: { bytes: 1024, sha256: sha('b') },
	sdkJavaScriptReceipt: { bytes: 128, sha256: sha('c') },
	wasmerWasmReceipt: {
		bytes: 64,
		sha256: sha('d'),
		uncompressedBytes: 256,
		uncompressedSha256: sha('e')
	},
	webcReceipt: {
		bytes: 96,
		sha256: sha('f'),
		uncompressedBytes: 384,
		uncompressedSha256: sha('1')
	}
});

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
	let canonical = `wasm-idle:bash-runtime-manifest:v2\nformat\0wasm-bash-runtime-manifest-v2\nruntime\0wasmer-bash-wasix\nprofileId\0${manifest.profileId}\n`;
	canonical += `licenseExpression\0GPL-3.0-or-later AND MIT\n`;
	canonical += `artifact\0${canonicalJson(manifest.artifact)}\n`;
	canonical += `components\0${canonicalJson(manifest.components)}\n`;
	canonical += `build\0${canonicalJson(manifest.build)}\n`;
	canonical += `license\0${canonicalJson(manifest.license)}\n`;
	canonical += `metadata\0${manifest.metadata.path}\0${manifest.metadata.mediaType}\0${manifest.metadata.size}\0${manifest.metadata.sha256}\n`;
	for (const asset of [...manifest.assets].sort((left, right) =>
		left.path.localeCompare(right.path)
	)) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...manifest.storage].sort((left, right) =>
		left.path.localeCompare(right.path)
	)) {
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
	const sdkJavaScriptBytes = encoder.encode('export const verifiedBashSdk = true;');
	const wasmerWasmBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 0]);
	const webcBytes = new Uint8Array([0, 119, 101, 98, 99, 48, 48, 51, 1, 2, 3]);
	const wasmerWasmStorage = gzipSync(wasmerWasmBytes);
	const webcStorage = gzipSync(webcBytes);
	const profileId = 'bash-1.0.25-wasmer-sdk-0.9.0-fc809648';
	const artifact = {
		kind: 'source-built-webc',
		package: 'wasmer/bash',
		packageVersion: '1.0.25',
		repository: 'https://github.com/wasix-org/bash',
		revision: 'fc8096485478055f4fcf31402004fdd8ff6b72b7',
		sourceArchiveUrl:
			'https://github.com/wasix-org/bash/archive/fc8096485478055f4fcf31402004fdd8ff6b72b7.tar.gz',
		sourceArchiveSha256: sha('2'),
		verifiedBuildInput: true
	};
	const components = {
		bash: {
			version: '1.0.25',
			repository: 'https://github.com/wasix-org/bash',
			revision: 'fc8096485478055f4fcf31402004fdd8ff6b72b7',
			verifiedBuildInput: true,
			evidence: 'runtime-build.json'
		},
		wasmerSdk: {
			version: '0.9.0',
			package: '@wasmer/sdk',
			packageIntegrity: profile.wasmerSdkPackageIntegrity,
			repository: 'https://github.com/wasmerio/wasmer-js',
			verifiedBuildInput: true,
			evidence: 'pnpm-lock.yaml'
		}
	};
	const build = {
		target: 'shell',
		abi: 'wasix_32v1',
		toolchain: {
			name: 'WASI SDK 20.0 (LLVM 16.0.0)',
			archiveUrl: 'https://example.test/wasi-sdk.tar.gz',
			archiveSha256: hash(encoder.encode('wasi-sdk'))
		},
		sysroot: {
			release: 'fixture',
			archiveUrl: 'https://example.test/sysroot',
			archiveSha256: sha('3')
		},
		binaryen: {
			version: '108',
			archiveUrl: 'https://example.test/binaryen',
			archiveSha256: sha('4')
		},
		packager: {
			name: 'wasmer',
			version: '7.2.0',
			archiveUrl: 'https://example.test/wasmer',
			archiveSha256: sha('5')
		},
		postprocessArgs: ['--strip-debug'],
		wasmFeatures: ['threads', 'bulk-memory']
	};
	const license = {
		bash: {
			path: 'LICENSE.txt',
			sourceUrl: 'https://example.test/bash-license',
			spdx: 'GPL-3.0-or-later',
			size: 1,
			sha256: sha('6')
		},
		wasmerSdk: {
			path: 'sdk/LICENSE.txt',
			sourceUrl: 'https://example.test/sdk-license',
			spdx: 'MIT',
			size: 1,
			sha256: sha('7')
		}
	};
	const manifest: Record<string, any> = {
		format: 'wasm-bash-runtime-manifest-v2',
		runtime: 'wasmer-bash-wasix',
		profileId,
		fingerprint: '',
		licenseExpression: 'GPL-3.0-or-later AND MIT',
		artifact,
		components,
		build,
		license,
		metadata: {
			path: 'runtime-build.json',
			mediaType: 'application/json',
			size: 1,
			sha256: sha('8')
		},
		assets: [
			{
				path: 'sdk/index.mjs',
				mediaType: 'text/javascript',
				size: sdkJavaScriptBytes.byteLength,
				sha256: hash(sdkJavaScriptBytes)
			},
			{
				path: 'sdk/wasmer_js_bg.wasm',
				mediaType: 'application/wasm',
				size: wasmerWasmBytes.byteLength,
				sha256: hash(wasmerWasmBytes)
			},
			{
				path: 'bash.webc',
				mediaType: 'application/octet-stream',
				size: webcBytes.byteLength,
				sha256: hash(webcBytes)
			}
		],
		storage: [
			{
				path: 'sdk/index.mjs.bin',
				logicalPath: 'sdk/index.mjs',
				encoding: 'identity',
				size: sdkJavaScriptBytes.byteLength,
				sha256: hash(sdkJavaScriptBytes)
			},
			{
				path: 'sdk/wasmer_js_bg.wasm.gz.bin',
				logicalPath: 'sdk/wasmer_js_bg.wasm',
				encoding: 'gzip',
				size: wasmerWasmStorage.byteLength,
				sha256: hash(wasmerWasmStorage)
			},
			{
				path: 'bash.webc.gz.bin',
				logicalPath: 'bash.webc',
				encoding: 'gzip',
				size: webcStorage.byteLength,
				sha256: hash(webcStorage)
			}
		]
	};
	manifest.fingerprint = manifestFingerprint(manifest);
	const manifestBytes = encoder.encode(JSON.stringify(manifest));
	const runtimeProfile = Object.freeze({
		profileId,
		bashPackageVersion: '1.0.25',
		bashSourceRevision: 'fc8096485478055f4fcf31402004fdd8ff6b72b7',
		wasmerSdkVersion: '0.9.0',
		wasmerSdkPackageIntegrity: profile.wasmerSdkPackageIntegrity,
		manifestFingerprint: manifest.fingerprint,
		manifestReceipt: receipt(manifestBytes),
		sdkJavaScriptReceipt: receipt(sdkJavaScriptBytes),
		wasmerWasmReceipt: pairedReceipt(wasmerWasmStorage, wasmerWasmBytes),
		webcReceipt: pairedReceipt(webcStorage, webcBytes)
	});
	const storageByPath = new Map<string, Uint8Array>([
		['/wasm-bash/runtime-manifest.v2.json', manifestBytes],
		['/wasm-bash/sdk/index.mjs.bin', sdkJavaScriptBytes],
		['/wasm-bash/sdk/wasmer_js_bg.wasm.gz.bin', wasmerWasmStorage],
		['/wasm-bash/bash.webc.gz.bin', webcStorage]
	]);
	return {
		manifest,
		manifestBytes,
		profile: runtimeProfile,
		sdkJavaScriptBytes,
		wasmerWasmBytes,
		webcBytes,
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
		return new Response(Uint8Array.from(bytes), {
			headers: {
				'content-length': String(bytes.byteLength),
				'content-type': url.pathname.endsWith('.json')
					? 'application/json'
					: 'application/octet-stream'
			}
		});
	});
}

describe('Bash runtime host preflight contract', () => {
	afterEach(() => vi.useRealTimers());

	it('accepts the frozen producer manifest and generated receipt bundle', async () => {
		const manifestBytes = await readFile(
			resolve(process.cwd(), 'static/wasm-bash/runtime-manifest.v2.json')
		);
		const sdkJavaScriptBytes = await readFile(
			resolve(process.cwd(), 'static/wasm-bash/sdk/index.mjs.bin')
		);
		const wasmerWasmStorage = await readFile(
			resolve(process.cwd(), 'static/wasm-bash/sdk/wasmer_js_bg.wasm.gz.bin')
		);
		const webcStorage = await readFile(
			resolve(process.cwd(), 'static/wasm-bash/bash.webc.gz.bin')
		);
		const payload = Object.freeze({
			protocol: BASH_PREFLIGHT_PROTOCOL,
			protocolVersion: BASH_PREFLIGHT_PROTOCOL_VERSION,
			profileId: WASM_BASH_RUNTIME_PROFILE.profileId,
			bashPackageVersion: WASM_BASH_RUNTIME_PROFILE.bashPackageVersion,
			bashSourceRevision: WASM_BASH_RUNTIME_PROFILE.bashSourceRevision,
			wasmerSdkVersion: WASM_BASH_RUNTIME_PROFILE.wasmerSdkVersion,
			wasmerSdkPackageIntegrity: WASM_BASH_RUNTIME_PROFILE.wasmerSdkPackageIntegrity,
			manifestFingerprint: WASM_BASH_RUNTIME_PROFILE.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestBytes),
			sdkJavaScriptBytes: Uint8Array.from(sdkJavaScriptBytes),
			wasmerWasmBytes: Uint8Array.from(gunzipSync(wasmerWasmStorage)),
			webcBytes: Uint8Array.from(gunzipSync(webcStorage))
		});

		expect(snapshotBashRuntimePreflightProfile(WASM_BASH_RUNTIME_PROFILE)).toEqual(
			WASM_BASH_RUNTIME_PROFILE
		);
		await expect(verifyBashRuntimePreflightPayload(payload)).resolves.toBe(payload);
	});
	it('snapshots the exact immutable profile and rejects partial trust', () => {
		expect(BASH_PREFLIGHT_PROTOCOL).toBe('wasm-idle-bash-preflight');
		expect(BASH_PREFLIGHT_PROTOCOL_VERSION).toBe(1);
		expect(BASH_MAX_ASSET_BYTES).toBe(8 * 1024 * 1024);
		expect(snapshotBashRuntimePreflightProfile(profile)).toEqual(profile);
		expect(() =>
			snapshotBashRuntimePreflightProfile({ ...profile, webcReceipt: undefined })
		).toThrow(/profile|receipt/iu);
	});

	it('requires and clones an exact four-buffer payload', () => {
		const payload = Object.freeze({
			protocol: BASH_PREFLIGHT_PROTOCOL,
			protocolVersion: BASH_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			bashPackageVersion: profile.bashPackageVersion,
			bashSourceRevision: profile.bashSourceRevision,
			wasmerSdkVersion: profile.wasmerSdkVersion,
			wasmerSdkPackageIntegrity: profile.wasmerSdkPackageIntegrity,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: new Uint8Array([1]),
			sdkJavaScriptBytes: new Uint8Array([2]),
			wasmerWasmBytes: new Uint8Array([3]),
			webcBytes: new Uint8Array([4])
		});
		expect(requireBashRuntimePreflightPayload(payload)).toBe(payload);
		const cloned = cloneBashRuntimePreflightPayload(payload);
		expect(cloned).toEqual(payload);
		expect(cloned.manifestBytes).not.toBe(payload.manifestBytes);
		expect(cloned.sdkJavaScriptBytes).not.toBe(payload.sdkJavaScriptBytes);
		expect(cloned.wasmerWasmBytes).not.toBe(payload.wasmerWasmBytes);
		expect(cloned.webcBytes).not.toBe(payload.webcBytes);
		expect(() => requireBashRuntimePreflightPayload({ ...payload, extra: true })).toThrow(
			/shape/iu
		);
	});

	it('downloads four canonical query-pinned assets and verifies both gzip layers', async () => {
		const fixture = createRuntimeFixture();
		const fetch = createFixtureFetch(fixture);
		const payload = await preflightBashRuntimeAssets({
			baseUrl: 'https://assets.example.test/wasm-bash/',
			manifestUrl: 'runtime-manifest.v2.json',
			profile: fixture.profile,
			fetch
		});

		expect(Array.from(payload.manifestBytes)).toEqual(Array.from(fixture.manifestBytes));
		expect(Array.from(payload.sdkJavaScriptBytes)).toEqual(
			Array.from(fixture.sdkJavaScriptBytes)
		);
		expect(Array.from(payload.wasmerWasmBytes)).toEqual(Array.from(fixture.wasmerWasmBytes));
		expect(Array.from(payload.webcBytes)).toEqual(Array.from(fixture.webcBytes));
		expect(fetch).toHaveBeenCalledTimes(4);
		const urls = fetch.mock.calls.map(([input]) => new URL(String(input)));
		expect(urls.map(({ pathname }) => pathname).sort()).toEqual(
			[
				'/wasm-bash/runtime-manifest.v2.json',
				'/wasm-bash/sdk/index.mjs.bin',
				'/wasm-bash/sdk/wasmer_js_bg.wasm.gz.bin',
				'/wasm-bash/bash.webc.gz.bin'
			].sort()
		);
		expect(
			Object.fromEntries(urls.map((url) => [url.pathname, url.searchParams.get('v')]))
		).toEqual({
			'/wasm-bash/runtime-manifest.v2.json': fixture.profile.manifestFingerprint,
			'/wasm-bash/sdk/index.mjs.bin': fixture.profile.sdkJavaScriptReceipt.sha256,
			'/wasm-bash/sdk/wasmer_js_bg.wasm.gz.bin': fixture.profile.wasmerWasmReceipt.sha256,
			'/wasm-bash/bash.webc.gz.bin': fixture.profile.webcReceipt.sha256
		});
	});

	it('rejects manifest/profile graph replacement and corrupt logical payloads', async () => {
		const fixture = createRuntimeFixture();
		const payload = await preflightBashRuntimeAssets({
			baseUrl: 'https://assets.example.test/wasm-bash/',
			manifestUrl: 'runtime-manifest.v2.json',
			profile: fixture.profile,
			fetch: createFixtureFetch(fixture)
		});
		await expect(
			verifyBashRuntimePreflightPayload({
				...payload,
				wasmerWasmBytes: Uint8Array.from(payload.wasmerWasmBytes, (byte, index) =>
					index === 8 ? byte ^ 1 : byte
				)
			})
		).rejects.toThrow(/integrity|Wasm/iu);

		const replacement = createRuntimeFixture();
		replacement.manifest.storage[2].logicalPath = 'sdk/wasmer_js_bg.wasm';
		replacement.manifest.fingerprint = manifestFingerprint(replacement.manifest);
		const manifestBytes = encoder.encode(JSON.stringify(replacement.manifest));
		await expect(
			preflightBashRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-bash/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: {
					...replacement.profile,
					manifestFingerprint: replacement.manifest.fingerprint,
					manifestReceipt: receipt(manifestBytes)
				},
				fetch: createFixtureFetch({
					...replacement,
					manifestBytes,
					storageByPath: new Map(replacement.storageByPath).set(
						'/wasm-bash/runtime-manifest.v2.json',
						manifestBytes
					)
				})
			})
		).rejects.toThrow(/storage|logical|asset/iu);
	});

	it('fails before network for path/query drift and aggregate receipt overflow', async () => {
		const fixture = createRuntimeFixture();
		const fetch = createFixtureFetch(fixture);
		await expect(
			preflightBashRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-bash/',
				manifestUrl: `runtime-manifest.v2.json?v=${sha('9')}`,
				profile: fixture.profile,
				fetch
			})
		).rejects.toThrow(/query-pinned|canonical/iu);
		expect(fetch).not.toHaveBeenCalled();

		const oversized = {
			...fixture.profile,
			wasmerWasmReceipt: {
				...fixture.profile.wasmerWasmReceipt,
				bytes: BASH_MAX_DELIVERY_BYTES / 2
			},
			webcReceipt: {
				...fixture.profile.webcReceipt,
				bytes: BASH_MAX_DELIVERY_BYTES / 2
			}
		};
		expect(() => snapshotBashRuntimePreflightProfile(oversized)).toThrow(/aggregate|budget/iu);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects final URL drift', async () => {
		const fixture = createRuntimeFixture();
		const redirectedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
			if (url.pathname.endsWith('/sdk/index.mjs.bin')) {
				Object.defineProperty(response, 'url', {
					value: `${url.origin}/wasm-bash/sdk/index.mjs.bin?v=${sha('9')}`
				});
			}
			return response;
		});
		await expect(
			preflightBashRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-bash/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: fixture.profile,
				fetch: redirectedFetch
			})
		).rejects.toThrow(/response URL|canonical|requested URL/iu);
	});

	it('allows transport encoding for identity assets but rejects it for gzip storage', async () => {
		const fixture = createRuntimeFixture();
		const identityEncodedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			const bytes = fixture.storageByPath.get(url.pathname)!;
			expect(init?.redirect).toBe('error');
			return new Response(Uint8Array.from(bytes), {
				headers: {
					...(url.pathname.endsWith('.json')
						? { 'content-encoding': 'gzip' }
						: url.pathname.endsWith('/sdk/index.mjs.bin')
							? { 'content-encoding': 'br' }
							: {}),
					'content-length': String(bytes.byteLength),
					'content-type': url.pathname.endsWith('.json')
						? 'application/json'
						: 'application/octet-stream'
				}
			});
		});
		await expect(
			preflightBashRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-bash/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: fixture.profile,
				fetch: identityEncodedFetch
			})
		).resolves.toMatchObject({ protocol: BASH_PREFLIGHT_PROTOCOL });

		for (const encodedPath of [
			'/wasm-bash/sdk/wasmer_js_bg.wasm.gz.bin',
			'/wasm-bash/bash.webc.gz.bin'
		]) {
			const storageEncodedFetch = vi.fn(
				async (input: RequestInfo | URL, init?: RequestInit) => {
					const url = new URL(String(input));
					const bytes = fixture.storageByPath.get(url.pathname)!;
					expect(init?.redirect).toBe('error');
					return new Response(Uint8Array.from(bytes), {
						headers: {
							...(url.pathname === encodedPath ? { 'content-encoding': 'br' } : {}),
							'content-length': String(bytes.byteLength),
							'content-type': url.pathname.endsWith('.json')
								? 'application/json'
								: 'application/octet-stream'
						}
					});
				}
			);
			await expect(
				preflightBashRuntimeAssets({
					baseUrl: 'https://assets.example.test/wasm-bash/',
					manifestUrl: 'runtime-manifest.v2.json',
					profile: fixture.profile,
					fetch: storageEncodedFetch
				})
			).rejects.toThrow(/Content-Encoding|encoded|encoding/iu);
		}
	});

	it('rejects truncated storage and a self-consistent gzip expansion beyond its logical receipt', async () => {
		const fixture = createRuntimeFixture();
		const truncatedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			const source = fixture.storageByPath.get(url.pathname)!;
			const bytes = url.pathname.endsWith('/bash.webc.gz.bin')
				? source.subarray(0, source.byteLength - 1)
				: source;
			expect(init?.redirect).toBe('error');
			return new Response(Uint8Array.from(bytes), {
				headers: {
					'content-length': String(bytes.byteLength),
					'content-type': url.pathname.endsWith('.json')
						? 'application/json'
						: 'application/octet-stream'
				}
			});
		});
		await expect(
			preflightBashRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-bash/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: fixture.profile,
				fetch: truncatedFetch
			})
		).rejects.toThrow(/byte|integrity|truncated/iu);

		const expandedWasm = new Uint8Array(256);
		expandedWasm.set([0, 97, 115, 109, 1, 0, 0, 0]);
		const expandedStorage = gzipSync(expandedWasm);
		const expandedManifest = structuredClone(fixture.manifest);
		const expandedStorageEntry = expandedManifest.storage.find(
			(entry: { path: string }) => entry.path === 'sdk/wasmer_js_bg.wasm.gz.bin'
		)!;
		expandedStorageEntry.size = expandedStorage.byteLength;
		expandedStorageEntry.sha256 = hash(expandedStorage);
		expandedManifest.fingerprint = manifestFingerprint(expandedManifest);
		const expandedManifestBytes = encoder.encode(JSON.stringify(expandedManifest));
		const expandedProfile = {
			...fixture.profile,
			manifestFingerprint: expandedManifest.fingerprint,
			manifestReceipt: receipt(expandedManifestBytes),
			wasmerWasmReceipt: {
				...fixture.profile.wasmerWasmReceipt,
				...receipt(expandedStorage)
			}
		};
		const expandedFixture = {
			...fixture,
			manifest: expandedManifest,
			manifestBytes: expandedManifestBytes,
			profile: expandedProfile,
			storageByPath: new Map(fixture.storageByPath)
				.set('/wasm-bash/runtime-manifest.v2.json', expandedManifestBytes)
				.set('/wasm-bash/sdk/wasmer_js_bg.wasm.gz.bin', expandedStorage)
		};
		await expect(
			preflightBashRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-bash/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: expandedProfile,
				fetch: createFixtureFetch(expandedFixture)
			})
		).rejects.toThrow(/decompress|logical|byte|limit|integrity/iu);
	});

	it('rejects caller abort without activating bytes and permits a clean retry', async () => {
		const fixture = createRuntimeFixture();
		const controller = new AbortController();
		const reason = new Error('cancel Bash assets');
		const fetch = vi.fn(
			async (_input: RequestInfo | URL, init?: RequestInit) =>
				await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
						once: true
					});
				})
		);
		const pending = preflightBashRuntimeAssets({
			baseUrl: 'https://assets.example.test/wasm-bash/',
			manifestUrl: 'runtime-manifest.v2.json',
			profile: fixture.profile,
			fetch,
			signal: controller.signal
		});
		await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
		controller.abort(reason);
		await expect(pending).rejects.toMatchObject({ name: 'CancelledError', cause: reason });
		await expect(
			preflightBashRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-bash/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: fixture.profile,
				fetch: createFixtureFetch(fixture)
			})
		).resolves.toMatchObject({ protocol: BASH_PREFLIGHT_PROTOCOL });
	});

	it('times out every sibling download and permits a clean retry', async () => {
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
		const pending = preflightBashRuntimeAssets({
			baseUrl: 'https://assets.example.test/wasm-bash/',
			manifestUrl: 'runtime-manifest.v2.json',
			profile: fixture.profile,
			fetch,
			limits: { assetTimeoutMs: 5 }
		}).catch((reason: unknown) => reason);
		await Promise.resolve();
		await Promise.resolve();
		expect(fetch).toHaveBeenCalledTimes(4);

		await vi.advanceTimersByTimeAsync(5);
		const timeout = await pending;
		expect(timeout).toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'asset',
			runtimeId: 'BASH',
			timeoutMs: 5
		});
		expect(aborted).toHaveLength(4);

		vi.useRealTimers();
		await expect(
			preflightBashRuntimeAssets({
				baseUrl: 'https://assets.example.test/wasm-bash/',
				manifestUrl: 'runtime-manifest.v2.json',
				profile: fixture.profile,
				fetch: createFixtureFetch(fixture)
			})
		).resolves.toMatchObject({ protocol: BASH_PREFLIGHT_PROTOCOL });
	});
});
