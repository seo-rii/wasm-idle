import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	RUST_EXECUTABLE_GRAPH_FORMAT,
	canonicalRustExecutableGraphProfile,
	loadVerifiedRustExecutableGraph as loadVerifiedRustExecutableGraphInternal,
	snapshotRustExecutableGraphProfile,
	type LoadRustExecutableGraphOptions,
	type RustExecutableGraphImport,
	type RustExecutableGraphProfile
} from './rustExecutableGraph';

const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const generation = '1'.repeat(64);
const manifestSha256 = '2'.repeat(64);
const moduleUrl = `https://cdn.test/wasm-rust/index.js?v=${generation}&rustManifestBytes=42&rustManifestSha256=${manifestSha256}`;
const runtimeProfile = Object.freeze({
	profileId: `wasm-rust-${generation}`,
	protocolVersion: 1,
	manifestPath: 'runtime/runtime-manifest.v3.json',
	manifestFingerprint: generation,
	manifestReceipt: Object.freeze({ bytes: 42, sha256: manifestSha256 })
});

function loadVerifiedRustExecutableGraph(
	options: Omit<LoadRustExecutableGraphOptions, 'runtimeProfile'> & {
		readonly runtimeProfile?: unknown;
	}
) {
	return loadVerifiedRustExecutableGraphInternal({ runtimeProfile, ...options });
}

type MutableProfile = {
	schemaVersion: 1;
	format: typeof RUST_EXECUTABLE_GRAPH_FORMAT;
	authority: 'published-static' | 'explicit-dist';
	entryPath: 'index.js';
	fingerprint: string;
	modules: Record<
		string,
		{
			delivery: { storagePath: string; encoding: 'identity' | 'gzip' };
			storage: { bytes: number; sha256: string };
			logical: { bytes: number; sha256: string };
			imports: Array<{
				specifier: string;
				target: string;
				kind: RustExecutableGraphImport['kind'];
			}>;
			assets: Array<{ specifier: string; target: string; kind: 'core-wasm' }>;
			externals: Array<{
				specifier: string;
				kind: 'dynamic';
				condition: 'node-only';
			}>;
		}
	>;
};

const imports = {
	'index.js': [
		{ specifier: './compiler.js', target: 'compiler.js', kind: 'static' },
		{ specifier: './browser-linker.js', target: 'browser-linker.js', kind: 'static' },
		{
			specifier: './vendor/jco/obj/wasm-tools.js',
			target: 'vendor/jco/obj/wasm-tools.js',
			kind: 'dynamic'
		}
	],
	'compiler.js': [
		{ specifier: './compiler-worker.js', target: 'compiler-worker.js', kind: 'worker' }
	],
	'compiler-worker.js': [
		{
			specifier: './rustc-thread-worker.js',
			target: 'rustc-thread-worker.js',
			kind: 'worker'
		}
	],
	'rustc-thread-worker.js': [
		{
			specifier: './rustc-thread-worker.js',
			target: 'rustc-thread-worker.js',
			kind: 'worker'
		}
	],
	'browser-linker.js': [
		{ specifier: 'llvm/llc.js', target: 'runtime/llvm/llc.js', kind: 'dynamic' }
	],
	'runtime/llvm/llc.js': [],
	'vendor/jco/obj/wasm-tools.js': []
} as const satisfies Record<string, readonly RustExecutableGraphImport[]>;

const sources = {
	'index.js':
		'import compiler from "./compiler.js";import linker from "./browser-linker.js";export const jco=()=>import("./vendor/jco/obj/wasm-tools.js");export{compiler,linker};',
	'compiler.js':
		'export default ()=>resolveVersionedAssetUrl(import.meta.url,"./compiler-worker.js");',
	'compiler-worker.js':
		'export default ()=>resolveVersionedAssetUrl(import.meta.url,"./rustc-thread-worker.js");',
	'rustc-thread-worker.js':
		'export default ()=>resolveVersionedAssetUrl(import.meta.url,"./rustc-thread-worker.js");',
	'browser-linker.js': 'export default async(assetUrl)=>import(assetUrl);',
	'runtime/llvm/llc.js': 'export default "llc";',
	'vendor/jco/obj/wasm-tools.js':
		'const a=new URL("./wasm-tools.core.wasm",import.meta.url);const b=new URL("./wasm-tools.core2.wasm",import.meta.url);if(false)import("node:fs/promises");export default [a,b];'
} as const;

interface Fixture {
	profile: RustExecutableGraphProfile;
	storageBytes: Readonly<Record<string, Uint8Array>>;
	logicalBytes: Readonly<Record<string, Uint8Array>>;
}

function withFingerprint(profile: MutableProfile): RustExecutableGraphProfile {
	profile.fingerprint = sha256(canonicalRustExecutableGraphProfile(profile));
	return profile;
}

function createFixture(
	overrides: Partial<Record<keyof typeof sources, string | Uint8Array>> = {}
): Fixture {
	const modules: MutableProfile['modules'] = {};
	const storageBytes: Record<string, Uint8Array> = {};
	const logicalBytes: Record<string, Uint8Array> = {};
	for (const modulePath of Object.keys(imports) as Array<keyof typeof imports>) {
		const overridden = overrides[modulePath];
		const logical =
			overridden instanceof Uint8Array
				? overridden
				: encoder.encode(overridden ?? sources[modulePath]);
		const isGzip = modulePath === 'vendor/jco/obj/wasm-tools.js';
		const storage = isGzip ? Uint8Array.from(gzipSync(logical)) : logical;
		const storagePath = isGzip ? `${modulePath}.gz.bin` : `${modulePath}.bin`;
		logicalBytes[modulePath] = logical;
		storageBytes[storagePath] = storage;
		modules[modulePath] = {
			delivery: { storagePath, encoding: isGzip ? 'gzip' : 'identity' },
			storage: { bytes: storage.byteLength, sha256: sha256(storage) },
			logical: { bytes: logical.byteLength, sha256: sha256(logical) },
			imports: imports[modulePath].map((entry) => ({ ...entry })),
			assets:
				modulePath === 'vendor/jco/obj/wasm-tools.js'
					? [
							{
								specifier: './wasm-tools.core.wasm',
								target: 'vendor/jco/obj/wasm-tools.core.wasm.gz',
								kind: 'core-wasm'
							},
							{
								specifier: './wasm-tools.core2.wasm',
								target: 'vendor/jco/obj/wasm-tools.core2.wasm',
								kind: 'core-wasm'
							}
						]
					: [],
			externals:
				modulePath === 'vendor/jco/obj/wasm-tools.js'
					? [
							{
								specifier: 'node:fs/promises',
								kind: 'dynamic',
								condition: 'node-only'
							}
						]
					: []
		};
	}
	const profile = withFingerprint({
		schemaVersion: 1,
		format: RUST_EXECUTABLE_GRAPH_FORMAT,
		authority: 'published-static',
		entryPath: 'index.js',
		fingerprint: '0'.repeat(64),
		modules
	});
	return { profile, storageBytes, logicalBytes };
}

function createFetch(
	fixture: Fixture,
	overrides: {
		body?: (storagePath: string) => Uint8Array;
		responseUrl?: (requestUrl: string) => string;
		wait?: (requestUrl: string, signal: AbortSignal | null) => Promise<void>;
	} = {}
) {
	return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const requestUrl = String(input);
		await overrides.wait?.(requestUrl, (init?.signal as AbortSignal | undefined) ?? null);
		const url = new URL(requestUrl);
		const storagePath = url.pathname.slice('/wasm-rust/'.length);
		const bytes = overrides.body?.(storagePath) ?? fixture.storageBytes[storagePath];
		if (!bytes) throw new Error(`unexpected storage path ${storagePath}`);
		const body = Uint8Array.from(bytes).buffer;
		const response = new Response(body, {
			status: 200,
			headers: {
				'content-length': String(bytes.byteLength),
				'content-type': 'application/octet-stream'
			}
		});
		Object.defineProperty(response, 'url', {
			value: overrides.responseUrl?.(requestUrl) ?? requestUrl
		});
		return response;
	});
}

function installBlobUrls(onCreate?: (count: number) => void) {
	const blobs = new Map<string, Blob>();
	let count = 0;
	const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
		if (!(blob instanceof Blob)) throw new TypeError('expected a Blob module');
		count += 1;
		onCreate?.(count);
		const url = `blob:https://app.test/${count}`;
		blobs.set(url, blob);
		return url;
	});
	const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	return { blobs, createObjectURL, revokeObjectURL };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Rust executable graph', () => {
	it('matches the producer canonical domain and record layout', () => {
		const { profile } = createFixture();
		const canonical = new TextDecoder().decode(canonicalRustExecutableGraphProfile(profile));

		expect(canonical).toMatch(/^wasm-idle:rust-executable-graph:v1\n/u);
		expect(canonical).toContain(
			`module\0vendor/jco/obj/wasm-tools.js\0vendor/jco/obj/wasm-tools.js.gz.bin\0gzip\0`
		);
		expect(canonical).toContain(
			'edge\0browser-linker.js\0dynamic\0llvm/llc.js\0runtime/llvm/llc.js\n'
		);
		expect(canonical).toContain(
			'asset\0vendor/jco/obj/wasm-tools.js\0core-wasm\0./wasm-tools.core.wasm\0vendor/jco/obj/wasm-tools.core.wasm.gz\n'
		);
		expect(canonical).toContain(
			'external\0vendor/jco/obj/wasm-tools.js\0dynamic\0node:fs/promises\0node-only\n'
		);
		expect(sha256(canonicalRustExecutableGraphProfile(profile))).toBe(profile.fingerprint);
	});

	it('verifies identity and gzip storage before creating and rewriting the complete Blob graph', async () => {
		const fixture = createFixture();
		const fetch = createFetch(fixture);
		const progress = vi.fn();
		const { blobs, createObjectURL, revokeObjectURL } = installBlobUrls();

		const graph = await loadVerifiedRustExecutableGraph({
			moduleUrl,
			profile: fixture.profile,
			fetch,
			reportProgress: progress
		});

		expect(fetch).toHaveBeenCalledTimes(Object.keys(fixture.profile.modules).length);
		for (const [input, init] of fetch.mock.calls) {
			const request = new URL(String(input));
			const storagePath = request.pathname.slice('/wasm-rust/'.length);
			expect(storagePath).toMatch(/\.bin$/u);
			const module = Object.values(fixture.profile.modules).find(
				(candidate) => candidate.delivery.storagePath === storagePath
			)!;
			expect(request.search).toBe(`?v=${module.storage.sha256}`);
			expect(init).toMatchObject({
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
		expect(createObjectURL).toHaveBeenCalledTimes(Object.keys(fixture.profile.modules).length);
		expect(graph.sourceModuleUrl).toBe(moduleUrl);
		expect(graph.assetBaseUrl).toBe(
			`https://cdn.test/wasm-rust/?v=${generation}&rustManifestBytes=42&rustManifestSha256=${manifestSha256}`
		);
		expect(graph.runtimeProfile).toEqual({
			profileId: `wasm-rust-${generation}`,
			protocolVersion: 1,
			manifestPath: 'runtime/runtime-manifest.v3.json',
			manifestFingerprint: generation,
			manifestReceipt: { bytes: 42, sha256: manifestSha256 },
			moduleUrl
		});
		const expectedNetworkModuleUrls = Object.keys(fixture.profile.modules)
			.sort()
			.map((path) => {
				const expectedNetworkUrl = new URL(path, graph.assetBaseUrl);
				expectedNetworkUrl.search = new URL(moduleUrl).search;
				return expectedNetworkUrl.href;
			});
		expect(graph.expectedNetworkModuleUrls).toEqual(expectedNetworkModuleUrls);
		expect(Object.isFrozen(graph.expectedNetworkModuleUrls)).toBe(true);
		for (const [path, blobUrl] of Object.entries(graph.moduleUrls)) {
			const expectedNetworkUrl = new URL(path, graph.assetBaseUrl);
			expectedNetworkUrl.search = new URL(moduleUrl).search;
			expect(graph.networkModuleUrls[expectedNetworkUrl.href]).toBe(blobUrl);
		}

		const indexSource = await blobs.get(graph.moduleUrls['index.js']!)!.text();
		expect(indexSource).toContain(JSON.stringify(graph.moduleUrls['compiler.js']));
		expect(indexSource).toContain(JSON.stringify(graph.moduleUrls['browser-linker.js']));
		expect(indexSource).toContain(
			JSON.stringify(graph.moduleUrls['vendor/jco/obj/wasm-tools.js'])
		);
		const compilerSource = await blobs.get(graph.moduleUrls['compiler.js']!)!.text();
		expect(compilerSource).toContain(JSON.stringify(graph.moduleUrls['compiler-worker.js']));
		const compilerWorkerSource = await blobs
			.get(graph.moduleUrls['compiler-worker.js']!)!
			.text();
		expect(compilerWorkerSource).toContain(
			JSON.stringify(graph.moduleUrls['rustc-thread-worker.js'])
		);
		const threadSource = await blobs.get(graph.moduleUrls['rustc-thread-worker.js']!)!.text();
		expect(threadSource).toContain('"./rustc-thread-worker.js"');
		const semanticSource = await blobs.get(graph.moduleUrls['browser-linker.js']!)!.text();
		expect(semanticSource).toBe(sources['browser-linker.js']);
		const jcoSource = await blobs
			.get(graph.moduleUrls['vendor/jco/obj/wasm-tools.js']!)!
			.text();
		expect(jcoSource).toContain(
			JSON.stringify(
				`https://cdn.test/wasm-rust/vendor/jco/obj/wasm-tools.core.wasm?v=${generation}&rustManifestBytes=42&rustManifestSha256=${manifestSha256}`
			)
		);
		expect(jcoSource).toContain(
			JSON.stringify(
				`https://cdn.test/wasm-rust/vendor/jco/obj/wasm-tools.core2.wasm?v=${generation}&rustManifestBytes=42&rustManifestSha256=${manifestSha256}`
			)
		);
		expect(jcoSource).toContain('"node:fs/promises"');
		const rewrittenCoreUrl = jcoSource.match(
			/https:\/\/cdn\.test\/wasm-rust\/vendor\/jco\/obj\/wasm-tools\.core\.wasm\?[^"']+/u
		)?.[0];
		expect(rewrittenCoreUrl).toBeTruthy();
		const observedCoreFetchUrl = new URL(rewrittenCoreUrl!);
		if (observedCoreFetchUrl.pathname.endsWith('.core.wasm')) {
			observedCoreFetchUrl.pathname += '.gz';
		}
		expect(observedCoreFetchUrl.pathname).toBe(
			'/wasm-rust/vendor/jco/obj/wasm-tools.core.wasm.gz'
		);
		expect(observedCoreFetchUrl.pathname).not.toContain('.gz.gz');
		expect(progress).toHaveBeenCalled();

		const owned = Object.values(graph.moduleUrls);
		graph.dispose();
		graph.dispose();
		expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual([...owned].reverse());
	});

	it('rejects corrupt storage and an inexact final response URL before creating a Blob', async () => {
		const fixture = createFixture();
		const { createObjectURL } = installBlobUrls();

		await expect(
			loadVerifiedRustExecutableGraph({
				moduleUrl,
				profile: fixture.profile,
				fetch: createFetch(fixture, {
					body: (path) =>
						path === 'index.js.bin'
							? encoder.encode('corrupt')
							: fixture.storageBytes[path]!
				})
			})
		).rejects.toThrow(/size mismatch|SHA-256 mismatch/u);
		expect(createObjectURL).not.toHaveBeenCalled();

		await expect(
			loadVerifiedRustExecutableGraph({
				moduleUrl,
				profile: fixture.profile,
				fetch: createFetch(fixture, { responseUrl: () => '' })
			})
		).rejects.toThrow('did not expose an exact final URL');
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it('verifies bounded gzip logical receipts and fatal UTF-8 before creating Blobs', async () => {
		const fixture = createFixture();
		const corruptLogical = encoder.encode(`${sources['vendor/jco/obj/wasm-tools.js']} `);
		const corruptStorage = Uint8Array.from(gzipSync(corruptLogical));
		const profile = structuredClone(fixture.profile) as MutableProfile;
		profile.modules['vendor/jco/obj/wasm-tools.js']!.storage = {
			bytes: corruptStorage.byteLength,
			sha256: sha256(corruptStorage)
		};
		withFingerprint(profile);
		const { createObjectURL } = installBlobUrls();

		await expect(
			loadVerifiedRustExecutableGraph({
				moduleUrl,
				profile,
				fetch: createFetch(fixture, {
					body: (path) =>
						path === 'vendor/jco/obj/wasm-tools.js.gz.bin'
							? corruptStorage
							: fixture.storageBytes[path]!
				})
			})
		).rejects.toThrow(/exceeds its logical receipt size|logical size mismatch/u);
		expect(createObjectURL).not.toHaveBeenCalled();

		const invalidUtf8 = Uint8Array.of(0xff);
		const minimal = createMinimalProfile(invalidUtf8);
		await expect(
			loadVerifiedRustExecutableGraph({
				moduleUrl,
				profile: minimal.profile,
				fetch: createFetch(minimal)
			})
		).rejects.toThrow('is not valid UTF-8');
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it('rejects a missing declared literal after all receipts but before Blob creation', async () => {
		const missing = createFixture({
			'compiler.js': 'export default ()=>undefined;'
		});
		const { createObjectURL } = installBlobUrls();

		await expect(
			loadVerifiedRustExecutableGraph({
				moduleUrl,
				profile: missing.profile,
				fetch: createFetch(missing)
			})
		).rejects.toThrow('must contain worker import ./compiler-worker.js');
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it('rewrites every deduplicated static import and re-export occurrence', async () => {
		const fixture = createFixture({
			'index.js':
				'import compiler from "./compiler.js";export{default as compilerAgain}from"./compiler.js";import linker from "./browser-linker.js";export const jco=()=>import("./vendor/jco/obj/wasm-tools.js");export{compiler,linker};'
		});
		const { blobs } = installBlobUrls();
		const graph = await loadVerifiedRustExecutableGraph({
			moduleUrl,
			profile: fixture.profile,
			fetch: createFetch(fixture)
		});

		const indexSource = await blobs.get(graph.moduleUrls['index.js']!)!.text();
		expect(indexSource.split(JSON.stringify(graph.moduleUrls['compiler.js'])).length - 1).toBe(
			2
		);
		graph.dispose();
	});

	it('constructs a verified 41-module DAG without weakening receipt or URL identity', async () => {
		const moduleCount = 41;
		const modules: MutableProfile['modules'] = {};
		const storageBytes: Record<string, Uint8Array> = {};
		for (let index = 0; index < moduleCount; index += 1) {
			const path = index === 0 ? 'index.js' : `module-${index}.js`;
			const nextPath = index + 1 < moduleCount ? `module-${index + 1}.js` : null;
			const specifier = nextPath ? `./${nextPath}` : null;
			const source = specifier
				? `import value from ${JSON.stringify(specifier)};export default value+1;`
				: 'export default 1;';
			const bytes = encoder.encode(source);
			storageBytes[`${path}.bin`] = bytes;
			modules[path] = {
				delivery: { storagePath: `${path}.bin`, encoding: 'identity' },
				storage: { bytes: bytes.byteLength, sha256: sha256(bytes) },
				logical: { bytes: bytes.byteLength, sha256: sha256(bytes) },
				imports: specifier ? [{ specifier, target: nextPath!, kind: 'static' }] : [],
				assets: [],
				externals: []
			};
		}
		const profile = withFingerprint({
			schemaVersion: 1,
			format: RUST_EXECUTABLE_GRAPH_FORMAT,
			authority: 'published-static',
			entryPath: 'index.js',
			fingerprint: '0'.repeat(64),
			modules
		});
		const fixture: Fixture = { profile, storageBytes, logicalBytes: storageBytes };
		const { createObjectURL } = installBlobUrls();

		const graph = await loadVerifiedRustExecutableGraph({
			moduleUrl,
			profile,
			fetch: createFetch(fixture)
		});

		expect(createObjectURL).toHaveBeenCalledTimes(moduleCount);
		expect(Object.keys(graph.moduleUrls)).toHaveLength(moduleCount);
		expect(graph.expectedNetworkModuleUrls).toHaveLength(moduleCount);
		expect(Object.isFrozen(graph.expectedNetworkModuleUrls)).toBe(true);
		expect(new Set(graph.expectedNetworkModuleUrls)).toEqual(
			new Set(Object.keys(graph.networkModuleUrls))
		);
		expect(Object.keys(graph.networkModuleUrls)).toHaveLength(moduleCount);
		graph.dispose();
	});

	it('rejects fingerprint drift and unsafe runtime-profile URLs before fetching', async () => {
		const fixture = createFixture();
		const stale = structuredClone(fixture.profile) as MutableProfile;
		stale.modules['index.js']!.storage.sha256 = 'f'.repeat(64);
		stale.modules['index.js']!.logical.sha256 = 'f'.repeat(64);
		const fetch = createFetch(fixture);

		await expect(
			loadVerifiedRustExecutableGraph({ moduleUrl, profile: stale, fetch })
		).rejects.toThrow('fingerprint does not match');
		expect(fetch).not.toHaveBeenCalled();

		await expect(
			loadVerifiedRustExecutableGraph({
				moduleUrl: `https://cdn.test/wasm-rust/index.js?v=${generation}`,
				profile: fixture.profile,
				fetch
			})
		).rejects.toThrow('must contain one exact runtime profile');
		await expect(
			loadVerifiedRustExecutableGraph({
				moduleUrl: `${moduleUrl}&extra=1`,
				profile: fixture.profile,
				fetch
			})
		).rejects.toThrow('must contain one exact runtime profile');
		for (const untrustedModuleUrl of [
			`https://cdn.test/wasm-rust/index.js?v=${'3'.repeat(64)}&rustManifestBytes=42&rustManifestSha256=${manifestSha256}`,
			`https://cdn.test/wasm-rust/index.js?v=${generation}&rustManifestBytes=43&rustManifestSha256=${manifestSha256}`,
			`https://cdn.test/wasm-rust/index.js?v=${generation}&rustManifestBytes=42&rustManifestSha256=${'3'.repeat(64)}`,
			`https://cdn.test/wasm-rust/index.js?v=${generation}&rustManifestBytes=%34%32&rustManifestSha256=${manifestSha256}`,
			`https://cdn.test/wasm-rust/index.js?rustManifestBytes=42&v=${generation}&rustManifestSha256=${manifestSha256}`
		]) {
			await expect(
				loadVerifiedRustExecutableGraph({
					moduleUrl: untrustedModuleUrl,
					profile: fixture.profile,
					fetch
				})
			).rejects.toThrow('invalid runtime profile');
		}
		expect(fetch).not.toHaveBeenCalled();
	});

	it('rejects unknown targets, unreachable nodes, non-thread cycles, and delivery drift', () => {
		const fixture = createFixture();
		const unknown = structuredClone(fixture.profile) as MutableProfile;
		unknown.modules['compiler.js']!.imports[0]!.target = 'missing.js';
		expect(() => snapshotRustExecutableGraphProfile(unknown)).toThrow('does not resolve');

		const unreachable = structuredClone(fixture.profile) as MutableProfile;
		unreachable.modules['unreachable.js'] = {
			delivery: { storagePath: 'unreachable.js.bin', encoding: 'identity' },
			storage: { bytes: 1, sha256: 'a'.repeat(64) },
			logical: { bytes: 1, sha256: 'a'.repeat(64) },
			imports: [],
			assets: [],
			externals: []
		};
		expect(() => snapshotRustExecutableGraphProfile(unreachable)).toThrow(
			'unreachable modules'
		);

		const cycle = structuredClone(fixture.profile) as MutableProfile;
		cycle.modules['runtime/llvm/llc.js']!.imports.push({
			specifier: '../../index.js',
			target: 'index.js',
			kind: 'dynamic'
		});
		expect(() => snapshotRustExecutableGraphProfile(cycle)).toThrow('contains a cycle');

		const wrongSelf = structuredClone(fixture.profile) as MutableProfile;
		wrongSelf.modules['compiler.js']!.imports = [
			{ specifier: './compiler.js', target: 'compiler.js', kind: 'worker' }
		];
		expect(() => snapshotRustExecutableGraphProfile(wrongSelf)).toThrow(
			'changed its declared worker boundary'
		);

		const sourceAuthority = structuredClone(fixture.profile) as MutableProfile;
		sourceAuthority.authority = 'explicit-dist';
		withFingerprint(sourceAuthority);
		expect(() => snapshotRustExecutableGraphProfile(sourceAuthority)).toThrow(
			'must describe published static assets'
		);

		const delivery = structuredClone(fixture.profile) as MutableProfile;
		delivery.modules['index.js']!.delivery.storagePath = 'other.js';
		expect(() => snapshotRustExecutableGraphProfile(delivery)).toThrow(
			'invalid authority or delivery path'
		);

		const boundary = structuredClone(fixture.profile) as MutableProfile;
		boundary.modules['vendor/jco/obj/wasm-tools.js']!.externals = [];
		expect(() => snapshotRustExecutableGraphProfile(boundary)).toThrow(
			'changed its declared node-only boundary'
		);

		const missingThreadSelf = structuredClone(fixture.profile) as MutableProfile;
		missingThreadSelf.modules['rustc-thread-worker.js']!.imports = [];
		expect(() => snapshotRustExecutableGraphProfile(missingThreadSelf)).toThrow(
			'changed its declared worker boundary'
		);
	});

	it('honors abort and asset limits without creating a late Blob', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		const fetch = createFetch(fixture, {
			wait: async (_url, signal) => {
				await new Promise<void>((resolve, reject) => {
					const abort = () => reject(signal?.reason ?? new Error('aborted'));
					signal?.addEventListener('abort', abort, { once: true });
					setTimeout(resolve, 100);
				});
			}
		});
		const { createObjectURL } = installBlobUrls();
		const pending = loadVerifiedRustExecutableGraph({
			moduleUrl,
			profile: fixture.profile,
			fetch,
			signal: controller.signal
		});
		controller.abort(new Error('cancelled graph'));
		await expect(pending).rejects.toThrow('cancelled graph');
		expect(createObjectURL).not.toHaveBeenCalled();

		await expect(
			loadVerifiedRustExecutableGraph({
				moduleUrl,
				profile: fixture.profile,
				fetch: createFetch(fixture),
				maxAssetBytes: 4
			})
		).rejects.toThrow('exceeds the configured asset limit');
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it('cleans partial Blob URLs when cancellation wins during graph construction', async () => {
		const fixture = createFixture();
		const controller = new AbortController();
		const { createObjectURL, revokeObjectURL } = installBlobUrls((count) => {
			if (count === 1) controller.abort(new Error('superseded graph'));
		});

		await expect(
			loadVerifiedRustExecutableGraph({
				moduleUrl,
				profile: fixture.profile,
				fetch: createFetch(fixture),
				signal: controller.signal
			})
		).rejects.toThrow('superseded graph');
		expect(createObjectURL).toHaveBeenCalledTimes(1);
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:https://app.test/1');
	});
});

function createMinimalProfile(logical: Uint8Array): Fixture {
	const profile = withFingerprint({
		schemaVersion: 1,
		format: RUST_EXECUTABLE_GRAPH_FORMAT,
		authority: 'published-static',
		entryPath: 'index.js',
		fingerprint: '0'.repeat(64),
		modules: {
			'index.js': {
				delivery: { storagePath: 'index.js.bin', encoding: 'identity' },
				storage: { bytes: logical.byteLength, sha256: sha256(logical) },
				logical: { bytes: logical.byteLength, sha256: sha256(logical) },
				imports: [],
				assets: [],
				externals: []
			}
		}
	});
	return {
		profile,
		storageBytes: { 'index.js.bin': logical },
		logicalBytes: { 'index.js': logical }
	};
}
