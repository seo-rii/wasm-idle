import { verifyRuntimeAssetIntegrity } from './asset-integrity.js';

export const LISP_RUNTIME_MANIFEST_FORMAT = 'wasm-lisp-runtime-manifest-v2' as const;
export const LISP_RUNTIME_FINGERPRINT_DOMAIN = 'wasm-idle:lisp-runtime-manifest:v2' as const;
export const LISP_RUNTIME_ID = 'puppy-scheme' as const;

const LISP_RUNTIME_ASSET_CONTRACT = Object.freeze({
	'index.js': Object.freeze({ mediaType: 'text/javascript', role: 'runtime' }),
	'puppyc.core.wasm': Object.freeze({ mediaType: 'application/wasm', role: 'runtime' }),
	'puppyc.core2.wasm': Object.freeze({ mediaType: 'application/wasm', role: 'runtime' }),
	'puppyc.js': Object.freeze({ mediaType: 'text/javascript', role: 'runtime' })
} as const);

export type LispRuntimeAssetPath = keyof typeof LISP_RUNTIME_ASSET_CONTRACT;
export type LispRuntimeAssetRole = 'runtime' | 'provenance';

export const LISP_RUNTIME_ASSET_PATHS = Object.freeze(
	(Object.keys(LISP_RUNTIME_ASSET_CONTRACT) as LispRuntimeAssetPath[]).sort()
);
export const LISP_RUNTIME_EXECUTABLE_ASSET_PATHS = Object.freeze(
	LISP_RUNTIME_ASSET_PATHS.filter((path) => LISP_RUNTIME_ASSET_CONTRACT[path].role === 'runtime')
);

export interface LispRuntimeLogicalAsset {
	readonly path: LispRuntimeAssetPath;
	readonly mediaType: string;
	readonly role: LispRuntimeAssetRole;
	readonly size: number;
	readonly sha256: string;
}

export interface LispRuntimeStorageAsset {
	readonly path: string;
	readonly logicalPath: LispRuntimeAssetPath;
	readonly encoding: 'identity' | 'gzip';
	readonly size: number;
	readonly sha256: string;
}

export interface LispRuntimeManifest {
	readonly format: typeof LISP_RUNTIME_MANIFEST_FORMAT;
	readonly runtime: typeof LISP_RUNTIME_ID;
	readonly profileId: string;
	readonly fingerprint: string;
	readonly provenanceLevel: string;
	readonly licenseExpression: string;
	readonly artifact: Readonly<Record<string, unknown>>;
	readonly components: Readonly<Record<string, unknown>>;
	readonly transformations: readonly unknown[];
	readonly license: Readonly<{
		path: 'LICENSE';
		spdx: string;
		size: number;
		sha256: string;
	}>;
	readonly notices: Readonly<{
		path: 'THIRD_PARTY_NOTICES.md';
		mediaType: 'text/markdown';
		size: number;
		sha256: string;
	}>;
	readonly metadata: Readonly<{
		path: 'runtime-build.json';
		mediaType: 'application/json';
		size: number;
		sha256: string;
	}>;
	readonly assets: readonly LispRuntimeLogicalAsset[];
	readonly storage: readonly LispRuntimeStorageAsset[];
}

export interface LispRuntimeComponentModule {
	instantiate: (
		getCoreModule: (name: string) => Promise<WebAssembly.Module>,
		imports: Record<string, unknown>,
		instantiateCore?: typeof WebAssembly.instantiate
	) => Promise<Record<string, unknown>>;
}

export interface LispRuntimeRootModule {
	createLispCompiler?: (options?: Record<string, unknown>) => Promise<unknown>;
	default?: (options?: Record<string, unknown>) => Promise<unknown>;
	executeBrowserLispArtifact?: (...args: unknown[]) => Promise<unknown>;
}

export interface LispRuntimeModuleEnvironment {
	createObjectUrl(source: string | Uint8Array, mediaType: string): string;
	revokeObjectUrl(url: string): void;
	importModule(url: string): Promise<Record<string, unknown>>;
}

export interface VerifyLispRuntimeAssetsRequest {
	manifest: unknown;
	expectedFingerprint: string;
	loadStorageAsset: (
		asset: LispRuntimeStorageAsset,
		signal: AbortSignal,
		logicalAsset: LispRuntimeLogicalAsset
	) => Promise<Uint8Array>;
	decompressGzip?: (
		bytes: Uint8Array,
		expectedBytes: number,
		signal: AbortSignal
	) => Promise<Uint8Array>;
	signal?: AbortSignal;
}

export interface LoadVerifiedLispRuntimeRequest extends VerifyLispRuntimeAssetsRequest {
	moduleEnvironment?: LispRuntimeModuleEnvironment;
}

export interface VerifiedLispRuntimeAssets {
	readonly manifest: LispRuntimeManifest;
	readonly logicalAssets: ReadonlyMap<LispRuntimeAssetPath, Uint8Array>;
	readonly storageAssets: ReadonlyMap<string, Uint8Array>;
}

export interface VerifiedLispRuntime {
	readonly manifest: LispRuntimeManifest;
	readonly module: LispRuntimeRootModule;
	readonly compilerModule: LispRuntimeComponentModule;
	readonly compilerCoreModules: Readonly<{
		'puppyc.core.wasm': WebAssembly.Module;
		'puppyc.core2.wasm': WebAssembly.Module;
	}>;
}

const MANIFEST_KEYS = [
	'artifact',
	'assets',
	'components',
	'fingerprint',
	'format',
	'license',
	'licenseExpression',
	'metadata',
	'notices',
	'profileId',
	'provenanceLevel',
	'runtime',
	'storage',
	'transformations'
].sort();
const LOGICAL_ASSET_KEYS = ['mediaType', 'path', 'role', 'sha256', 'size'].sort();
const STORAGE_ASSET_KEYS = ['encoding', 'logicalPath', 'path', 'sha256', 'size'].sort();
const LICENSE_KEYS = ['path', 'sha256', 'size', 'spdx'].sort();
const METADATA_KEYS = ['mediaType', 'path', 'sha256', 'size'].sort();

const isObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
	isObject(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (isObject(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;
	}
	const primitive = JSON.stringify(value);
	if (primitive === undefined) throw new TypeError('Scheme manifest contains a non-JSON value');
	return primitive;
}

function requireReceipt(value: unknown, label: string) {
	if (
		!Number.isSafeInteger(value) ||
		(value as number) <= 0 ||
		(value as number) > 16 * 1024 * 1024
	) {
		throw new TypeError(`${label} has an invalid byte size`);
	}
	return value as number;
}

function requireSha256(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError(`${label} has an invalid SHA-256 receipt`);
	}
	return value;
}

function fingerprintPayload(manifest: LispRuntimeManifest) {
	return {
		format: manifest.format,
		runtime: manifest.runtime,
		profileId: manifest.profileId,
		provenanceLevel: manifest.provenanceLevel,
		licenseExpression: manifest.licenseExpression,
		artifact: manifest.artifact,
		components: manifest.components,
		transformations: manifest.transformations,
		license: manifest.license,
		notices: manifest.notices,
		metadata: manifest.metadata,
		assets: manifest.assets,
		storage: manifest.storage
	};
}

async function sha256Text(value: string) {
	if (!globalThis.crypto?.subtle) {
		throw new TypeError('Web Crypto SHA-256 is required to verify the Scheme manifest');
	}
	const digest = new Uint8Array(
		await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
	);
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function normalizeLispRuntimeManifest(
	value: unknown,
	expectedFingerprint: string
): Promise<LispRuntimeManifest> {
	if (!/^[a-f0-9]{64}$/u.test(expectedFingerprint)) {
		throw new TypeError(
			'Scheme runtime requires an explicit 64-character manifest fingerprint'
		);
	}
	if (
		!hasExactKeys(value, MANIFEST_KEYS) ||
		value.format !== LISP_RUNTIME_MANIFEST_FORMAT ||
		value.runtime !== LISP_RUNTIME_ID ||
		typeof value.profileId !== 'string' ||
		!/^puppy-scheme-[A-Za-z0-9._-]+$/u.test(value.profileId) ||
		value.fingerprint !== expectedFingerprint ||
		typeof value.provenanceLevel !== 'string' ||
		!value.provenanceLevel ||
		typeof value.licenseExpression !== 'string' ||
		!value.licenseExpression ||
		!isObject(value.artifact) ||
		!isObject(value.components) ||
		!Array.isArray(value.transformations) ||
		!Array.isArray(value.assets) ||
		!Array.isArray(value.storage) ||
		value.assets.length !== LISP_RUNTIME_ASSET_PATHS.length ||
		value.storage.length !== LISP_RUNTIME_ASSET_PATHS.length
	) {
		throw new TypeError('Scheme runtime manifest has an invalid profile or schema');
	}
	if (
		!hasExactKeys(value.license, LICENSE_KEYS) ||
		value.license.path !== 'LICENSE' ||
		typeof value.license.spdx !== 'string' ||
		!hasExactKeys(value.notices, METADATA_KEYS) ||
		value.notices.path !== 'THIRD_PARTY_NOTICES.md' ||
		value.notices.mediaType !== 'text/markdown' ||
		!hasExactKeys(value.metadata, METADATA_KEYS) ||
		value.metadata.path !== 'runtime-build.json' ||
		value.metadata.mediaType !== 'application/json'
	) {
		throw new TypeError('Scheme runtime manifest has invalid legal or build receipts');
	}
	const assets = new Map<LispRuntimeAssetPath, LispRuntimeLogicalAsset>();
	for (const candidate of value.assets) {
		if (
			!hasExactKeys(candidate, LOGICAL_ASSET_KEYS) ||
			typeof candidate.path !== 'string' ||
			!Object.hasOwn(LISP_RUNTIME_ASSET_CONTRACT, candidate.path) ||
			assets.has(candidate.path as LispRuntimeAssetPath)
		) {
			throw new TypeError('Scheme runtime manifest has an invalid or duplicate asset');
		}
		const path = candidate.path as LispRuntimeAssetPath;
		const contract = LISP_RUNTIME_ASSET_CONTRACT[path];
		if (candidate.mediaType !== contract.mediaType || candidate.role !== contract.role) {
			throw new TypeError(`Scheme runtime manifest contract drifted for ${path}`);
		}
		assets.set(
			path,
			Object.freeze({
				path,
				mediaType: contract.mediaType,
				role: contract.role,
				size: requireReceipt(candidate.size, `Scheme runtime ${path}`),
				sha256: requireSha256(candidate.sha256, `Scheme runtime ${path}`)
			})
		);
	}
	if (LISP_RUNTIME_ASSET_PATHS.some((path) => !assets.has(path))) {
		throw new TypeError('Scheme runtime manifest is missing a required asset');
	}
	const storage = new Map<LispRuntimeAssetPath, LispRuntimeStorageAsset>();
	for (const candidate of value.storage) {
		if (
			!hasExactKeys(candidate, STORAGE_ASSET_KEYS) ||
			typeof candidate.logicalPath !== 'string' ||
			!Object.hasOwn(LISP_RUNTIME_ASSET_CONTRACT, candidate.logicalPath) ||
			storage.has(candidate.logicalPath as LispRuntimeAssetPath) ||
			(candidate.encoding !== 'identity' && candidate.encoding !== 'gzip')
		) {
			throw new TypeError('Scheme runtime manifest has invalid or duplicate storage');
		}
		const logicalPath = candidate.logicalPath as LispRuntimeAssetPath;
		const expectedPath = candidate.encoding === 'gzip' ? `${logicalPath}.gz` : logicalPath;
		if (candidate.path !== expectedPath) {
			throw new TypeError(`Scheme runtime storage path does not match ${logicalPath}`);
		}
		storage.set(
			logicalPath,
			Object.freeze({
				path: expectedPath,
				logicalPath,
				encoding: candidate.encoding,
				size: requireReceipt(candidate.size, `Scheme runtime storage ${expectedPath}`),
				sha256: requireSha256(candidate.sha256, `Scheme runtime storage ${expectedPath}`)
			})
		);
	}
	if (LISP_RUNTIME_ASSET_PATHS.some((path) => !storage.has(path))) {
		throw new TypeError('Scheme runtime manifest is missing required storage');
	}
	const normalized: LispRuntimeManifest = Object.freeze({
		format: LISP_RUNTIME_MANIFEST_FORMAT,
		runtime: LISP_RUNTIME_ID,
		profileId: value.profileId,
		fingerprint: expectedFingerprint,
		provenanceLevel: value.provenanceLevel,
		licenseExpression: value.licenseExpression,
		artifact: Object.freeze({ ...value.artifact }),
		components: Object.freeze({ ...value.components }),
		transformations: Object.freeze([...value.transformations]),
		license: Object.freeze({
			path: 'LICENSE',
			spdx: value.license.spdx,
			size: requireReceipt(value.license.size, 'Scheme runtime license'),
			sha256: requireSha256(value.license.sha256, 'Scheme runtime license')
		}),
		notices: Object.freeze({
			path: 'THIRD_PARTY_NOTICES.md',
			mediaType: 'text/markdown',
			size: requireReceipt(value.notices.size, 'Scheme runtime notices'),
			sha256: requireSha256(value.notices.sha256, 'Scheme runtime notices')
		}),
		metadata: Object.freeze({
			path: 'runtime-build.json',
			mediaType: 'application/json',
			size: requireReceipt(value.metadata.size, 'Scheme runtime metadata'),
			sha256: requireSha256(value.metadata.sha256, 'Scheme runtime metadata')
		}),
		assets: Object.freeze(LISP_RUNTIME_ASSET_PATHS.map((path) => assets.get(path)!)),
		storage: Object.freeze(LISP_RUNTIME_ASSET_PATHS.map((path) => storage.get(path)!))
	});
	const actualFingerprint = await sha256Text(
		`${LISP_RUNTIME_FINGERPRINT_DOMAIN}\n${canonicalJson(fingerprintPayload(normalized))}`
	);
	if (actualFingerprint !== expectedFingerprint) {
		throw new TypeError('Scheme runtime manifest fingerprint does not match its trust anchor');
	}
	return normalized;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

function decodeModule(bytes: Uint8Array, path: string) {
	try {
		return decoder.decode(bytes);
	} catch {
		throw new TypeError(`Verified Scheme module ${path} is not valid UTF-8`);
	}
}

function defaultModuleEnvironment(): LispRuntimeModuleEnvironment {
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function'
	) {
		throw new TypeError('Scheme runtime requires Blob module URL support');
	}
	return {
		createObjectUrl(source, mediaType) {
			const part =
				typeof source === 'string'
					? source
					: source.byteOffset === 0 && source.byteLength === source.buffer.byteLength
						? (source.buffer as ArrayBuffer)
						: Uint8Array.from(source).buffer;
			return URL.createObjectURL(new Blob([part], { type: mediaType }));
		},
		revokeObjectUrl(url) {
			URL.revokeObjectURL(url);
		},
		async importModule(url) {
			return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
		}
	};
}

async function materializeVerifiedGraph(
	bytes: ReadonlyMap<LispRuntimeAssetPath, Uint8Array>,
	environment: LispRuntimeModuleEnvironment
) {
	const urls: string[] = [];
	const createUrl = (source: string | Uint8Array, mediaType = 'text/javascript') => {
		const url = environment.createObjectUrl(source, mediaType);
		if (typeof url !== 'string' || !url) {
			throw new TypeError('Scheme module environment returned an invalid object URL');
		}
		urls.push(url);
		return url;
	};
	try {
		const rootUrl = createUrl(decodeModule(bytes.get('index.js')!, 'index.js'));
		const puppyUrl = createUrl(decodeModule(bytes.get('puppyc.js')!, 'puppyc.js'));
		const [rootModule, compilerModule, compilerCore, compilerCore2] = await Promise.all([
			environment.importModule(rootUrl),
			environment.importModule(puppyUrl),
			WebAssembly.compile(Uint8Array.from(bytes.get('puppyc.core.wasm')!).buffer),
			WebAssembly.compile(Uint8Array.from(bytes.get('puppyc.core2.wasm')!).buffer)
		]);
		if (
			(typeof rootModule.createLispCompiler !== 'function' &&
				typeof rootModule.default !== 'function') ||
			typeof rootModule.executeBrowserLispArtifact !== 'function'
		) {
			throw new TypeError('Verified Scheme root module has an invalid public contract');
		}
		if (typeof compilerModule.instantiate !== 'function') {
			throw new TypeError('Verified Puppy Scheme compiler module is invalid');
		}
		return {
			module: rootModule as LispRuntimeRootModule,
			compilerModule: compilerModule as unknown as LispRuntimeComponentModule,
			compilerCoreModules: Object.freeze({
				'puppyc.core.wasm': compilerCore,
				'puppyc.core2.wasm': compilerCore2
			})
		};
	} finally {
		for (const url of [...urls].reverse()) {
			try {
				environment.revokeObjectUrl(url);
			} catch {
				// Cleanup must not replace graph verification or import failures.
			}
		}
	}
}

async function decompressVerifiedGzip(
	bytes: Uint8Array,
	expectedBytes: number,
	signal: AbortSignal
) {
	if (typeof DecompressionStream !== 'function') {
		throw new TypeError('Scheme runtime requires browser gzip decompression support');
	}
	const stream = new Blob([Uint8Array.from(bytes).buffer])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	const reader = stream.getReader();
	const output = new Uint8Array(expectedBytes);
	let offset = 0;
	const abort = () => {
		void reader.cancel(signal.reason).catch(() => undefined);
	};
	signal.addEventListener('abort', abort, { once: true });
	try {
		for (;;) {
			if (signal.aborted) throw signal.reason;
			const { done, value } = await reader.read();
			if (done) break;
			if (offset + value.byteLength > expectedBytes) {
				await reader.cancel('Scheme runtime gzip output exceeds its receipt');
				throw new TypeError('Scheme runtime gzip output exceeds its receipt');
			}
			output.set(value, offset);
			offset += value.byteLength;
		}
	} finally {
		signal.removeEventListener('abort', abort);
		releaseReader(reader);
	}
	if (offset !== expectedBytes) {
		throw new TypeError('Scheme runtime gzip output is shorter than its receipt');
	}
	return output;
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
	try {
		reader.releaseLock();
	} catch {
		// Cancellation may already have released the stream lock.
	}
}

export async function verifyLispRuntimeAssets(
	request: VerifyLispRuntimeAssetsRequest
): Promise<VerifiedLispRuntimeAssets> {
	if (typeof request.loadStorageAsset !== 'function') {
		throw new TypeError('Scheme runtime requires a storage asset loader');
	}
	const manifest = await normalizeLispRuntimeManifest(
		request.manifest,
		request.expectedFingerprint
	);
	const controller = new AbortController();
	const onAbort = () =>
		controller.abort(
			request.signal?.reason ?? new DOMException('Scheme runtime load aborted', 'AbortError')
		);
	if (request.signal) {
		request.signal.addEventListener('abort', onAbort, { once: true });
		if (request.signal.aborted) onAbort();
	}
	/** @type {Map<LispRuntimeAssetPath, Uint8Array>} */
	const verified = new Map<LispRuntimeAssetPath, Uint8Array>();
	const verifiedStorage = new Map<string, Uint8Array>();
	try {
		await Promise.all(
			manifest.assets.map(async (asset) => {
				const storage = manifest.storage.find(
					(candidate) => candidate.logicalPath === asset.path
				)!;
				const loaded = await request.loadStorageAsset(storage, controller.signal, asset);
				if (controller.signal.aborted) {
					throw controller.signal.reason;
				}
				const storedBytes = Uint8Array.from(loaded);
				let storageReceiptMatches = true;
				try {
					await verifyRuntimeAssetIntegrity({
						asset: storage.path,
						bytes: storedBytes,
						expected: { bytes: storage.size, sha256: storage.sha256 },
						runtimeId: 'LISP',
						profileId: manifest.profileId
					});
				} catch (storageError) {
					if (storage.encoding !== 'gzip') throw storageError;
					try {
						await verifyRuntimeAssetIntegrity({
							asset: asset.path,
							bytes: storedBytes,
							expected: { bytes: asset.size, sha256: asset.sha256 },
							runtimeId: 'LISP',
							profileId: manifest.profileId
						});
					} catch {
						throw storageError;
					}
					// A server may publish the .gz path with Content-Encoding: gzip. Fetch
					// then exposes logical bytes, so their pinned receipt is the trust boundary.
					storageReceiptMatches = false;
				}
				verifiedStorage.set(storage.path, storedBytes);
				const bytes =
					storage.encoding === 'gzip' && storageReceiptMatches
						? await (request.decompressGzip ?? decompressVerifiedGzip)(
								storedBytes,
								asset.size,
								controller.signal
							)
						: storedBytes;
				if (storageReceiptMatches) {
					await verifyRuntimeAssetIntegrity({
						asset: asset.path,
						bytes,
						expected: { bytes: asset.size, sha256: asset.sha256 },
						runtimeId: 'LISP',
						profileId: manifest.profileId
					});
				}
				if (controller.signal.aborted) throw controller.signal.reason;
				verified.set(asset.path, bytes);
			})
		);
		return Object.freeze({
			manifest,
			logicalAssets: verified,
			storageAssets: verifiedStorage
		});
	} catch (error) {
		controller.abort(error);
		throw error;
	} finally {
		request.signal?.removeEventListener('abort', onAbort);
	}
}

export async function loadVerifiedLispRuntime(
	request: LoadVerifiedLispRuntimeRequest
): Promise<VerifiedLispRuntime> {
	const verified = await verifyLispRuntimeAssets(request);
	if (request.signal?.aborted) throw request.signal.reason;
	const graph = await materializeVerifiedGraph(
		verified.logicalAssets,
		request.moduleEnvironment ?? defaultModuleEnvironment()
	);
	if (request.signal?.aborted) throw request.signal.reason;
	return Object.freeze({ manifest: verified.manifest, ...graph });
}
