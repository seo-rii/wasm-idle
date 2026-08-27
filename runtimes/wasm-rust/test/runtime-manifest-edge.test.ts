import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadBundledRuntimeContext } from '../src/compiler-runtime.js';
import {
	clearRegisteredRuntimeAssetReceipts,
	hasRegisteredRuntimeAssetReceipt
} from '../src/runtime-asset.js';
import {
	clearVerifiedRuntimeExecutableModuleUrls,
	collectRuntimeManifestAssetPaths,
	configureVerifiedRuntimeExecutableModuleUrls,
	loadRuntimeManifest,
	normalizeRuntimeManifest,
	parseWasmRustRuntimeProfileFromModuleUrl,
	parseRuntimeManifest,
	registerRuntimeManifestAssetReceipts,
	resolveRuntimeAssetUrl,
	resolveTargetManifest,
	verifyRuntimeManifestAssetReceipts
} from '../src/runtime-manifest.js';
import {
	createIntegratedRuntimeManifestV3,
	createRuntimeManifest,
	createRuntimeManifestV2,
	createRuntimeManifestV3
} from './helpers.js';

describe('runtime manifest edge cases', () => {
	afterEach(() => {
		clearRegisteredRuntimeAssetReceipts();
		clearVerifiedRuntimeExecutableModuleUrls();
	});

	const createIntegratedManifestWithReceipts = () => {
		const source = createIntegratedRuntimeManifestV3();
		const normalized = normalizeRuntimeManifest(parseRuntimeManifest(source));
		const assetReceipts = Object.fromEntries(
			collectRuntimeManifestAssetPaths(normalized).map((assetPath) => [
				assetPath,
				{
					bytes: assetPath.endsWith('.pack.gz') ? 2 : 1,
					sha256: 'a'.repeat(64),
					...(assetPath.endsWith('.pack.gz')
						? { uncompressedBytes: 3, uncompressedSha256: 'b'.repeat(64) }
						: {})
				}
			])
		);
		return { ...source, assetReceipts };
	};

	it('requires an exact receipt graph for every manifest-referenced binary asset', () => {
		const source = createIntegratedManifestWithReceipts();
		const manifest = normalizeRuntimeManifest(parseRuntimeManifest(source));

		expect(() => verifyRuntimeManifestAssetReceipts(manifest)).not.toThrow();

		const missing = structuredClone(source);
		delete missing.assetReceipts['wasm-rust/runtime/rustc/rustc.wasm.gz'];
		expect(() =>
			verifyRuntimeManifestAssetReceipts(
				normalizeRuntimeManifest(parseRuntimeManifest(missing))
			)
		).toThrow(/receipt graph mismatch.*rustc\/rustc\.wasm\.gz/);

		const extra = structuredClone(source);
		extra.assetReceipts['unreferenced.wasm'] = { bytes: 1, sha256: 'c'.repeat(64) };
		expect(() =>
			verifyRuntimeManifestAssetReceipts(
				normalizeRuntimeManifest(parseRuntimeManifest(extra))
			)
		).toThrow(/extra=unreferenced\.wasm/);
	});

	it('registers every receipt against a renamed nested runtime layout', () => {
		const manifest = normalizeRuntimeManifest(
			parseRuntimeManifest(createIntegratedManifestWithReceipts())
		);
		const runtimeBaseUrl = new URL(
			'https://cdn.example.test/deploy/custom-rust/runtime/?v=' + '1'.repeat(64)
		);

		registerRuntimeManifestAssetReceipts(runtimeBaseUrl, manifest);

		for (const canonicalPath of collectRuntimeManifestAssetPaths(manifest)) {
			let relativePath: string;
			if (canonicalPath.startsWith('wasm-rust/runtime/')) {
				relativePath = canonicalPath.slice('wasm-rust/runtime/'.length);
			} else if (canonicalPath.startsWith('wasm-rust/vendor/')) {
				relativePath = `../vendor/${canonicalPath.slice('wasm-rust/vendor/'.length)}`;
			} else {
				relativePath = `../../shared/emscripten-lld/${canonicalPath.slice('shared/emscripten-lld/'.length)}`;
			}
			const assetUrl = new URL(relativePath, runtimeBaseUrl);
			assetUrl.search = runtimeBaseUrl.search;
			expect(hasRegisteredRuntimeAssetReceipt(assetUrl), canonicalPath).toBe(true);
		}
		expect(
			hasRegisteredRuntimeAssetReceipt(
				`https://cdn.example.test/wasm-rust/runtime/rustc/rustc.wasm.gz?v=${'1'.repeat(64)}`
			)
		).toBe(false);
	});

	it('resolves declared executable modules to their verified Blob URLs only', () => {
		const sourceUrl =
			'https://cdn.example.test/wasm-rust/runtime/llvm/llc.js?v=' + '1'.repeat(64);
		const blobUrl = 'blob:https://cdn.example.test/verified-llc';
		configureVerifiedRuntimeExecutableModuleUrls({ [sourceUrl]: blobUrl }, 'a'.repeat(64));

		expect(
			resolveRuntimeAssetUrl(
				`https://cdn.example.test/wasm-rust/runtime/?v=${'1'.repeat(64)}`,
				'llvm/llc.js'
			)
		).toBe(blobUrl);
		expect(
			resolveRuntimeAssetUrl(
				`https://cdn.example.test/wasm-rust/runtime/?v=${'1'.repeat(64)}`,
				'llvm/llc.wasm.gz'
			)
		).toBe(`https://cdn.example.test/wasm-rust/runtime/llvm/llc.wasm.gz?v=${'1'.repeat(64)}`);
		expect(() =>
			resolveRuntimeAssetUrl(
				`https://cdn.example.test/wasm-rust/runtime/?v=${'1'.repeat(64)}`,
				'llvm/lld.js'
			)
		).toThrow(/missing from the verified Blob graph/u);
		expect(() =>
			resolveRuntimeAssetUrl(
				`https://cdn.example.test/wasm-rust/runtime/?v=${'1'.repeat(64)}`,
				'llvm/lld.mjs'
			)
		).toThrow(/missing from the verified Blob graph/u);
	});

	it('rejects unsafe or duplicate verified executable module URL mappings', () => {
		expect(() =>
			configureVerifiedRuntimeExecutableModuleUrls(
				{
					'file:///tmp/llc.js': 'blob:https://example.test/llc'
				},
				'a'.repeat(64)
			)
		).toThrow(/source URL is unsafe/);
		expect(() =>
			configureVerifiedRuntimeExecutableModuleUrls(
				{
					'https://example.test/llc.js': 'blob:https://example.test/llc?generation=1'
				},
				'a'.repeat(64)
			)
		).toThrow(/Blob URL is unsafe/);
		expect(() =>
			configureVerifiedRuntimeExecutableModuleUrls(
				{
					'https://example.test/llc.js': 'blob:https://example.test/shared',
					'https://example.test/lld.js': 'blob:https://example.test/shared'
				},
				'a'.repeat(64)
			)
		).toThrow(/duplicated/);
	});

	it('keeps one immutable executable graph configuration per worker realm', () => {
		const sourceUrl = 'https://example.test/wasm-rust/runtime/llvm/llc.js';
		const moduleUrls = { [sourceUrl]: 'blob:https://example.test/verified-llc' };
		configureVerifiedRuntimeExecutableModuleUrls(moduleUrls, 'a'.repeat(64));

		expect(() =>
			configureVerifiedRuntimeExecutableModuleUrls(moduleUrls, 'a'.repeat(64))
		).not.toThrow();
		expect(() =>
			configureVerifiedRuntimeExecutableModuleUrls(moduleUrls, 'b'.repeat(64))
		).toThrow(/cannot change within one worker/u);
		expect(() =>
			configureVerifiedRuntimeExecutableModuleUrls(moduleUrls, 'not-a-fingerprint')
		).toThrow(/fingerprint is invalid/u);
	});

	it('parses a complete host trust root and rejects partial receipt query parameters', () => {
		const fingerprint = '1'.repeat(64);
		const manifestSha256 = '2'.repeat(64);
		expect(
			parseWasmRustRuntimeProfileFromModuleUrl(
				`https://example.test/wasm-rust/index.js?v=${fingerprint}&rustManifestBytes=42&rustManifestSha256=${manifestSha256}`
			)
		).toMatchObject({
			protocolVersion: 1,
			manifestFingerprint: fingerprint,
			manifestReceipt: { bytes: 42, sha256: manifestSha256 }
		});
		expect(() =>
			parseWasmRustRuntimeProfileFromModuleUrl(
				`https://example.test/wasm-rust/index.js?v=${fingerprint}`
			)
		).toThrow(/invalid receipt profile/);
	});

	it('pins one v3 manifest URL and disables legacy fallback for a runtime profile', async () => {
		const fingerprint = '3'.repeat(64);
		const manifestBytes = new TextEncoder().encode(
			JSON.stringify(createIntegratedManifestWithReceipts())
		);
		const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
		const moduleUrl = `https://example.test/wasm-rust/index.js?v=${fingerprint}&rustManifestBytes=${manifestBytes.byteLength}&rustManifestSha256=${manifestSha256}`;
		const profile = parseWasmRustRuntimeProfileFromModuleUrl(moduleUrl)!;
		const requestedUrls: string[] = [];
		const injectedLoader = vi.fn(async () => createRuntimeManifest());
		vi.stubGlobal('fetch', async (input: string | URL | Request) => {
			requestedUrls.push(String(input));
			return new Response(manifestBytes);
		});
		let loaded;
		try {
			loaded = await loadBundledRuntimeContext(injectedLoader, 'wasm32-wasip1', profile);
		} finally {
			vi.unstubAllGlobals();
		}

		expect(requestedUrls).toHaveLength(1);
		expect(injectedLoader).not.toHaveBeenCalled();
		expect(requestedUrls[0]).toContain('/runtime/runtime-manifest.v3.json');
		expect(requestedUrls[0]).toContain(`v=${fingerprint}`);
		expect(loaded.versionedRuntimeBaseUrl.searchParams.get('v')).toBe(fingerprint);
	});

	it('verifies raw manifest bytes before parsing JSON', async () => {
		const manifestBytes = new TextEncoder().encode(
			JSON.stringify(createIntegratedManifestWithReceipts())
		);
		const receipt = {
			bytes: manifestBytes.byteLength,
			sha256: createHash('sha256').update(manifestBytes).digest('hex')
		};
		await expect(
			loadRuntimeManifest(
				'https://example.test/runtime/runtime-manifest.v3.json',
				async () => new Response(manifestBytes),
				{ receipt }
			)
		).resolves.toMatchObject({ version: 'test-integrated-runtime-v3', manifestVersion: 3 });

		const corrupted = Uint8Array.from(manifestBytes);
		corrupted[corrupted.byteLength - 1] ^= 1;
		await expect(
			loadRuntimeManifest(
				'https://example.test/runtime/runtime-manifest.v3.json',
				async () => new Response(corrupted),
				{ receipt }
			)
		).rejects.toThrow(/storage SHA-256 differs/);
	});

	it('rejects legacy, invalid UTF-8, and duplicate-key JSON in pinned mode', async () => {
		const loadPinnedBytes = (bytes: Uint8Array) =>
			loadRuntimeManifest(
				'https://example.test/runtime/runtime-manifest.v3.json',
				async () => new Response(bytes),
				{
					receipt: {
						bytes: bytes.byteLength,
						sha256: createHash('sha256').update(bytes).digest('hex')
					}
				}
			);

		const legacyBytes = new TextEncoder().encode(JSON.stringify(createRuntimeManifest()));
		await expect(loadPinnedBytes(legacyBytes)).rejects.toThrow(
			/requires a v3 asset receipt graph/
		);

		const invalidUtf8 = Uint8Array.of(0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d);
		await expect(loadPinnedBytes(invalidUtf8)).rejects.toThrow(/invalid.*UTF-8/);

		const validSource = JSON.stringify(createIntegratedManifestWithReceipts());
		const duplicateRoot = new TextEncoder().encode(
			validSource.replace(
				'"manifestVersion":3',
				'"manifestVersion":3,"\\u006danifestVersion":3'
			)
		);
		await expect(loadPinnedBytes(duplicateRoot)).rejects.toThrow(/duplicate object key/);

		const duplicateNested = new TextEncoder().encode(
			validSource.replace('"rustcWasm":', '"rustcWasm":"ignored","rustcWasm":')
		);
		await expect(loadPinnedBytes(duplicateNested)).rejects.toThrow(/duplicate object key/);
	});

	it('rejects ambiguous duplicate runtime profile query parameters', () => {
		const fingerprint = '1'.repeat(64);
		const manifestSha256 = '2'.repeat(64);
		const base = `https://example.test/wasm-rust/index.js?v=${fingerprint}&rustManifestBytes=42&rustManifestSha256=${manifestSha256}`;
		for (const duplicate of [
			`v=${fingerprint}`,
			'rustManifestBytes=42',
			`rustManifestSha256=${manifestSha256}`
		]) {
			expect(() => parseWasmRustRuntimeProfileFromModuleUrl(`${base}&${duplicate}`)).toThrow(
				/invalid receipt profile/
			);
		}
	});

	it('strictly rejects unknown fields, unknown targets, and mixed asset alternatives in v3', () => {
		const integrated = createIntegratedManifestWithReceipts();
		expect(() => parseRuntimeManifest({ ...integrated, unexpected: true })).toThrow(
			/unknown fields unexpected/
		);
		expect(() =>
			parseRuntimeManifest({
				...integrated,
				targets: {
					...integrated.targets,
					'wasm32-unknown': integrated.targets['wasm32-wasip1']
				}
			})
		).toThrow(/unknown fields wasm32-unknown/);
		expect(() =>
			parseRuntimeManifest({
				...integrated,
				compiler: { ...integrated.compiler, unexpected: true }
			})
		).toThrow(/compiler.*unknown fields unexpected/);

		const mixedSysroot = structuredClone(integrated);
		mixedSysroot.targets['wasm32-wasip1'].sysrootFiles = [
			{ asset: 'sysroot/libstd.rlib', runtimePath: '/lib/libstd.rlib' }
		];
		expect(() => parseRuntimeManifest(mixedSysroot)).toThrow(/mutually exclusive/);

		const strayIntegrated = structuredClone(integrated);
		strayIntegrated.targets['wasm32-wasip1'].compile.llvm = {
			llc: 'llvm/llc.js',
			lld: 'llvm/lld.js'
		};
		expect(() => parseRuntimeManifest(strayIntegrated)).toThrow(/compile.*unknown fields llvm/);

		const split = createRuntimeManifestV3();
		const mixedLink = structuredClone(split);
		Object.assign(mixedLink.targets['wasm32-wasip1'].compile.link, {
			allocatorObjectRuntimePath: '/work/alloc.o',
			allocatorObjectAsset: 'link/alloc.o',
			files: [{ asset: 'link/lib.o', runtimePath: '/work/lib.o' }]
		});
		expect(() => parseRuntimeManifest(mixedLink)).toThrow(/mutually exclusive/);
	});

	it.each([
		'./rustc.wasm',
		'rustc//rustc.wasm',
		'rustc/../rustc.wasm',
		'rustc/%2e/rustc.wasm',
		'rustc\\rustc.wasm',
		'rustc/rustc.wasm?x=1',
		'rustc/rustc.wasm#x'
	])('rejects a non-canonical v3 asset reference: %s', (rustcWasm) => {
		const source = createIntegratedManifestWithReceipts();
		expect(() =>
			parseRuntimeManifest({
				...source,
				compiler: { ...source.compiler, rustcWasm }
			})
		).toThrow(/non-canonical path/);
	});
	it('rejects malformed runtime manifest fields', () => {
		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifest(),
				rustcWasm: ''
			})
		).toThrow(/invalid rustcWasm/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifest(),
				rustcMemory: {
					initialPages: 8,
					maximumPages: 0
				}
			})
		).toThrow(/invalid rustcMemory.maximumPages/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifest(),
				link: {
					...createRuntimeManifest().link,
					args: ['-o', '']
				}
			})
		).toThrow(/invalid link.args/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifest(),
				sysrootFiles: [{ asset: '', runtimePath: '/libstd.rlib' }]
			})
		).toThrow(/invalid sysrootFiles\[0\]\.asset/);
	});

	it('rejects malformed v2 target fields', () => {
		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifestV2(),
				defaultTargetTriple: 'wasm32-wasi'
			})
		).toThrow(/invalid defaultTargetTriple/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifestV2(),
				targets: {
					...createRuntimeManifestV2().targets,
					'wasm32-wasip2': {
						...createRuntimeManifestV2().targets['wasm32-wasip2'],
						artifactFormat: 'wasm'
					}
				}
			})
		).toThrow(/invalid targets\.wasm32-wasip2\.artifactFormat/);
	});

	it('rejects malformed v3 pack fields', () => {
		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifestV3(),
				targets: {
					...createRuntimeManifestV3().targets,
					'wasm32-wasip1': {
						...createRuntimeManifestV3().targets['wasm32-wasip1'],
						sysrootPack: {
							...createRuntimeManifestV3().targets['wasm32-wasip1'].sysrootPack,
							asset: ''
						}
					}
				}
			})
		).toThrow(/invalid targets\.wasm32-wasip1\.sysrootPack\.asset/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifestV3(),
				targets: {
					...createRuntimeManifestV3().targets,
					'wasm32-wasip1': {
						...createRuntimeManifestV3().targets['wasm32-wasip1'],
						compile: {
							...createRuntimeManifestV3().targets['wasm32-wasip1'].compile,
							link: {
								args: ['-o', '/work/main.wasm']
							}
						}
					}
				}
			})
		).toThrow(/missing legacy link asset fields/);
	});

	it('parses recursive delta pack references and accepts zero byte counts', () => {
		const fixture = createRuntimeManifestV3();
		const zeroByteBasePack = {
			asset: 'packs/sysroot/base.pack',
			index: 'packs/sysroot/base.index.json',
			fileCount: 0,
			totalBytes: 0
		};
		const middlePack = {
			asset: 'packs/sysroot/middle.delta.pack',
			index: 'packs/sysroot/middle.delta.index.json',
			fileCount: 0,
			totalBytes: 0,
			decodedTotalBytes: 0,
			delta: {
				format: 'copy-literal-v1',
				base: zeroByteBasePack
			}
		};
		const deltaPack = {
			asset: 'packs/sysroot/final.delta.pack',
			index: 'packs/sysroot/final.delta.index.json',
			fileCount: 0,
			totalBytes: 0,
			decodedTotalBytes: 0,
			delta: {
				format: 'copy-literal-v1',
				base: middlePack
			}
		};

		const manifest = normalizeRuntimeManifest(
			parseRuntimeManifest({
				...fixture,
				targets: {
					...fixture.targets,
					'wasm32-wasip1': {
						...fixture.targets['wasm32-wasip1'],
						sysrootPack: deltaPack
					}
				}
			})
		);

		expect(manifest.targets['wasm32-wasip1']?.sysrootPack).toEqual(deltaPack);
	});

	it('rejects invalid delta formats and negative nested pack sizes', () => {
		const fixture = createRuntimeManifestV3();
		const sysrootPack = fixture.targets['wasm32-wasip1'].sysrootPack;
		const createManifestWithPack = (pack: object) => ({
			...fixture,
			targets: {
				...fixture.targets,
				'wasm32-wasip1': {
					...fixture.targets['wasm32-wasip1'],
					sysrootPack: pack
				}
			}
		});

		expect(() =>
			parseRuntimeManifest(
				createManifestWithPack({
					...sysrootPack,
					decodedTotalBytes: 3,
					delta: { format: 'copy-literal-v2', base: sysrootPack }
				})
			)
		).toThrow(/invalid targets\.wasm32-wasip1\.sysrootPack\.delta\.format/);

		expect(() =>
			parseRuntimeManifest(
				createManifestWithPack({
					...sysrootPack,
					decodedTotalBytes: 3,
					delta: {
						format: 'copy-literal-v1',
						base: {
							...sysrootPack,
							asset: 'packs/sysroot/base.pack.gz',
							index: 'packs/sysroot/base.index.json.gz',
							totalBytes: -1
						}
					}
				})
			)
		).toThrow(/invalid targets\.wasm32-wasip1\.sysrootPack\.delta\.base\.totalBytes/);

		expect(() =>
			parseRuntimeManifest(
				createManifestWithPack({
					...sysrootPack,
					decodedTotalBytes: 3,
					delta: {
						format: 'copy-literal-v1',
						base: {
							...sysrootPack,
							asset: 'packs/sysroot/base.pack.gz',
							index: 'packs/sysroot/base.index.json.gz',
							fileCount: -1
						}
					}
				})
			)
		).toThrow(/invalid targets\.wasm32-wasip1\.sysrootPack\.delta\.base\.fileCount/);

		expect(() =>
			parseRuntimeManifest(createManifestWithPack({ ...sysrootPack, decodedTotalBytes: -1 }))
		).toThrow(/invalid targets\.wasm32-wasip1\.sysrootPack\.decodedTotalBytes/);
	});

	it('accepts integrated rustc targets without split LLVM or link assets', () => {
		const manifest = normalizeRuntimeManifest(
			parseRuntimeManifest(createIntegratedRuntimeManifestV3())
		);

		expect(manifest.compiler.workerBitcodeFile).toBe('main.wasm');
		expect(manifest.targets['wasm32-wasip1']?.compile).toEqual({
			kind: 'integrated-rustc'
		});
		expect(manifest.targets['wasm32-wasip3']?.compile).toEqual({
			kind: 'integrated-rustc+component-encoder'
		});
	});

	it('fails to resolve an unavailable target from the normalized manifest', () => {
		const manifest = normalizeRuntimeManifest(
			parseRuntimeManifest({
				...createRuntimeManifestV2(),
				targets: {
					'wasm32-wasip1': createRuntimeManifestV2().targets['wasm32-wasip1']
				}
			})
		);

		expect(() => resolveTargetManifest(manifest, 'wasm32-wasip2')).toThrow(
			/unsupported wasm-rust target wasm32-wasip2/
		);
		expect(() => resolveTargetManifest(manifest, 'wasm32-wasip3')).toThrow(
			/unsupported wasm-rust target wasm32-wasip3/
		);
	});

	it('fails when runtime-manifest fetch returns a non-ok response', async () => {
		await expect(
			loadRuntimeManifest(
				'https://example.com/runtime-manifest.json',
				async () =>
					({
						ok: false,
						status: 500,
						statusText: 'Internal Server Error'
					}) as Response
			)
		).rejects.toMatchObject({
			manifestUrl: 'https://example.com/runtime-manifest.json',
			status: 500
		});
		await expect(
			loadRuntimeManifest(
				'https://example.com/runtime-manifest.json',
				async () =>
					({
						ok: false,
						status: 500,
						statusText: 'Internal Server Error'
					}) as Response
			)
		).rejects.toThrow(
			'failed to load wasm-rust runtime manifest from https://example.com/runtime-manifest.json (HTTP 500 Internal Server Error)'
		);
	});

	it('falls back from v3 to an older bundled manifest only when the newer manifest is missing', async () => {
		const requestedUrls: string[] = [];
		const loaded = await loadBundledRuntimeContext(async (manifestUrl) => {
			const url = manifestUrl.toString();
			requestedUrls.push(url);
			if (url.endsWith('runtime-manifest.v3.json')) {
				throw Object.assign(new Error('missing v3 manifest'), { status: 404 });
			}
			if (url.endsWith('runtime-manifest.v2.json')) {
				return createRuntimeManifestV2();
			}
			throw new Error(`unexpected manifest request: ${url}`);
		});

		expect(requestedUrls).toEqual([
			expect.stringContaining('runtime-manifest.v3.json'),
			expect.stringContaining('runtime-manifest.v2.json')
		]);
		expect(loaded.manifest.manifestVersion).toBe(2);
		expect(loaded.targetConfig.targetTriple).toBe('wasm32-wasip1');
	});

	it('does not hide a broken v3 manifest behind legacy fallback loading', async () => {
		await expect(
			loadBundledRuntimeContext(async (manifestUrl) => {
				if (manifestUrl.toString().endsWith('runtime-manifest.v3.json')) {
					throw new Error('broken v3 manifest');
				}
				return createRuntimeManifestV2();
			})
		).rejects.toThrow('broken v3 manifest');
	});
});
