import {
	RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
	RuntimeConfigurationError,
	preflightRuntimeAssets,
	type ExecutionLimits,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';

export const RUST_EXECUTABLE_GRAPH_FORMAT = 'wasm-idle-rust-executable-graph-v1' as const;
export const RUST_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN =
	'wasm-idle:rust-executable-graph:v1\n' as const;

export type RustExecutableGraphAuthority = 'published-static' | 'explicit-dist';
export type RustExecutableGraphEncoding = 'identity' | 'gzip';
export type RustExecutableImportKind = 'static' | 'dynamic' | 'worker';

export interface RustExecutableGraphImport {
	readonly specifier: string;
	readonly target: string;
	readonly kind: RustExecutableImportKind;
}

export interface RustExecutableGraphAsset {
	readonly specifier: string;
	readonly target: string;
	readonly kind: 'core-wasm';
}

export interface RustExecutableGraphExternal {
	readonly specifier: string;
	readonly kind: 'dynamic';
	readonly condition: 'node-only';
}

export interface RustExecutableGraphReceipt {
	readonly bytes: number;
	readonly sha256: string;
}

export interface RustExecutableGraphModule {
	readonly delivery: Readonly<{
		storagePath: string;
		encoding: RustExecutableGraphEncoding;
	}>;
	readonly storage: RustExecutableGraphReceipt;
	readonly logical: RustExecutableGraphReceipt;
	readonly imports: readonly RustExecutableGraphImport[];
	readonly assets: readonly RustExecutableGraphAsset[];
	readonly externals: readonly RustExecutableGraphExternal[];
}

export interface RustExecutableGraphProfile {
	readonly schemaVersion: 1;
	readonly format: typeof RUST_EXECUTABLE_GRAPH_FORMAT;
	readonly authority: RustExecutableGraphAuthority;
	readonly entryPath: 'index.js';
	readonly fingerprint: string;
	readonly modules: Readonly<Record<string, RustExecutableGraphModule>>;
}

export interface RustExecutableGraphRuntimeProfile {
	readonly profileId: string;
	readonly protocolVersion: 1;
	readonly manifestPath: 'runtime/runtime-manifest.v3.json';
	readonly manifestFingerprint: string;
	readonly manifestReceipt: Readonly<{ bytes: number; sha256: string }>;
	readonly moduleUrl: string;
}

export interface LoadedRustExecutableGraph {
	readonly entryUrl: string;
	readonly sourceModuleUrl: string;
	readonly assetBaseUrl: string;
	readonly runtimeProfile: RustExecutableGraphRuntimeProfile;
	readonly moduleUrls: Readonly<Record<string, string>>;
	/** Complete canonical HTTP(S) module URL set expected by this verified graph. */
	readonly expectedNetworkModuleUrls: readonly string[];
	/** Exact generation-pinned HTTP(S) module URL to owned Blob module URL. */
	readonly networkModuleUrls: Readonly<Record<string, string>>;
	dispose(): void;
}

export interface RustExecutableGraphProgress {
	readonly path: string;
	readonly loadedBytes: number;
	readonly totalBytes: number;
}

export interface LoadRustExecutableGraphOptions {
	readonly moduleUrl: string;
	readonly currentUrl?: string;
	readonly profile: unknown;
	readonly runtimeProfile: unknown;
	readonly fetch?: typeof globalThis.fetch;
	readonly signal?: AbortSignal;
	readonly maxAssetBytes?: number;
	readonly assetTimeoutMs?: number;
	readonly reportProgress?: (progress: RustExecutableGraphProgress) => void;
}

interface PinnedRustRuntimeProfile {
	readonly profileId: string;
	readonly protocolVersion: 1;
	readonly manifestPath: 'runtime/runtime-manifest.v3.json';
	readonly manifestFingerprint: string;
	readonly manifestReceipt: RustExecutableGraphReceipt;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/u;
const SAFE_SPECIFIER_PATTERN = /^[A-Za-z0-9._/-]+$/u;
const SAFE_BLOB_URL_PATTERN = /^blob:[^'"`\\\r\n]+$/u;
const MAX_MODULES = 256;
const MAX_EDGES = 4096;
const MAX_MODULE_STORAGE_BYTES = 32 * 1024 * 1024;
const MAX_MODULE_LOGICAL_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

const RUNTIME_DYNAMIC_MODULE_SPECIFIERS = new Set([
	'../vendor/jco/src/browser.js',
	'../vendor/jco/obj/wasm-tools.js',
	'../vendor/preview2-shim/lib/browser/cli.js',
	'../vendor/preview2-shim/lib/browser/clocks.js',
	'../vendor/preview2-shim/lib/browser/filesystem.js',
	'../vendor/preview2-shim/lib/browser/http.js',
	'../vendor/preview2-shim/lib/browser/io.js',
	'../vendor/preview2-shim/lib/browser/random.js',
	'../vendor/preview2-shim/lib/browser/sockets.js'
]);

const EXPECTED_CORE_ASSETS = Object.freeze({
	'vendor/jco/obj/js-component-bindgen-component.js': Object.freeze([
		Object.freeze({
			specifier: './js-component-bindgen-component.core.wasm',
			target: 'vendor/jco/obj/js-component-bindgen-component.core.wasm.gz'
		}),
		Object.freeze({
			specifier: './js-component-bindgen-component.core2.wasm',
			target: 'vendor/jco/obj/js-component-bindgen-component.core2.wasm'
		})
	]),
	'vendor/jco/obj/wasm-tools.js': Object.freeze([
		Object.freeze({
			specifier: './wasm-tools.core.wasm',
			target: 'vendor/jco/obj/wasm-tools.core.wasm.gz'
		}),
		Object.freeze({
			specifier: './wasm-tools.core2.wasm',
			target: 'vendor/jco/obj/wasm-tools.core2.wasm'
		})
	])
} as const);

const EXPECTED_NODE_EXTERNALS = Object.freeze({
	'vendor/jco/obj/js-component-bindgen-component.js': 'node:fs/promises',
	'vendor/jco/obj/wasm-tools.js': 'node:fs/promises'
} as const);

const EXPECTED_WORKER_EDGES = Object.freeze({
	'compiler.js': Object.freeze({
		specifier: './compiler-worker.js',
		target: 'compiler-worker.js'
	}),
	'compiler-worker.js': Object.freeze({
		specifier: './rustc-thread-worker.js',
		target: 'rustc-thread-worker.js'
	}),
	'rustc-thread-worker.js': Object.freeze({
		specifier: './rustc-thread-worker.js',
		target: 'rustc-thread-worker.js'
	})
} as const);

const compareCodeUnits = (left: string, right: string) =>
	left < right ? -1 : left > right ? 1 : 0;

const configurationError = (message: string, cause?: unknown) =>
	new RuntimeConfigurationError(message, {
		phase: 'asset',
		runtimeId: 'RUST',
		...(cause === undefined ? {} : { cause })
	});

function requireExactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	label: string
) {
	const received = Object.keys(value).sort(compareCodeUnits);
	const sortedExpected = [...expected].sort(compareCodeUnits);
	if (
		received.length !== sortedExpected.length ||
		received.some((key, index) => key !== sortedExpected[index])
	) {
		throw configurationError(`${label} must contain exactly ${sortedExpected.join(', ')}`);
	}
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw configurationError(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requireSafePath(value: unknown, label: string): string {
	if (
		typeof value !== 'string' ||
		!value ||
		value.length > 512 ||
		!SAFE_PATH_PATTERN.test(value) ||
		value.startsWith('/') ||
		value.includes('\\') ||
		value.includes('\0') ||
		value.includes('?') ||
		value.includes('#') ||
		value.includes(':') ||
		value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
	) {
		throw configurationError(`${label} must be a normalized safe relative path`);
	}
	return value;
}

function requireSpecifier(value: unknown, label: string): string {
	if (
		typeof value !== 'string' ||
		!value ||
		value.length > 512 ||
		!SAFE_SPECIFIER_PATTERN.test(value) ||
		value.startsWith('/') ||
		value.includes('\\') ||
		value.includes('\0') ||
		value.includes('?') ||
		value.includes('#') ||
		value.includes(':')
	) {
		throw configurationError(`${label} must be a safe module specifier`);
	}
	return value;
}

function requireReceipt(value: unknown, label: string, maximum: number) {
	const receipt = requireRecord(value, label);
	requireExactKeys(receipt, ['bytes', 'sha256'], label);
	if (
		!Number.isSafeInteger(receipt.bytes) ||
		Number(receipt.bytes) <= 0 ||
		Number(receipt.bytes) > maximum
	) {
		throw configurationError(`${label} has an invalid size`);
	}
	if (typeof receipt.sha256 !== 'string' || !SHA256_PATTERN.test(receipt.sha256)) {
		throw configurationError(`${label} has an invalid SHA-256`);
	}
	return Object.freeze({ bytes: Number(receipt.bytes), sha256: receipt.sha256 });
}

function snapshotPinnedRustRuntimeProfile(value: unknown): Readonly<PinnedRustRuntimeProfile> {
	const profile = requireRecord(value, 'Rust runtime profile');
	if (
		profile.protocolVersion !== 1 ||
		profile.manifestPath !== 'runtime/runtime-manifest.v3.json' ||
		typeof profile.manifestFingerprint !== 'string' ||
		!SHA256_PATTERN.test(profile.manifestFingerprint) ||
		profile.profileId !== `wasm-rust-${profile.manifestFingerprint}`
	) {
		throw configurationError('Rust runtime profile is invalid');
	}
	return Object.freeze({
		profileId: profile.profileId,
		protocolVersion: 1,
		manifestPath: 'runtime/runtime-manifest.v3.json',
		manifestFingerprint: profile.manifestFingerprint,
		manifestReceipt: requireReceipt(
			profile.manifestReceipt,
			'Rust runtime manifest receipt',
			16 * 1024 * 1024
		)
	});
}

function resolveRelativeTarget(importer: string, specifier: string): string {
	const segments = importer.split('/');
	segments.pop();
	for (const segment of specifier.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') {
			if (segments.length === 0) {
				throw configurationError(
					`Rust executable import ${specifier} escapes its graph root`
				);
			}
			segments.pop();
			continue;
		}
		if (!/^[A-Za-z0-9._-]+$/u.test(segment)) {
			throw configurationError(`Rust executable import ${specifier} is unsafe`);
		}
		segments.push(segment);
	}
	return segments.join('/');
}

function resolveDeclaredImportTarget(
	importer: string,
	specifier: string,
	kind: RustExecutableImportKind
) {
	if (
		kind === 'dynamic' &&
		(importer === 'browser-linker.js' || importer === 'compiler-preload.js')
	) {
		return resolveRelativeTarget('runtime/placeholder.js', specifier);
	}
	if (kind === 'dynamic' && RUNTIME_DYNAMIC_MODULE_SPECIFIERS.has(specifier)) {
		return resolveRelativeTarget('runtime/placeholder.js', specifier);
	}
	return resolveRelativeTarget(importer, specifier);
}

function isAllowedThreadSelfEdge(modulePath: string, graphImport: RustExecutableGraphImport) {
	return (
		modulePath === 'rustc-thread-worker.js' &&
		graphImport.kind === 'worker' &&
		graphImport.specifier === './rustc-thread-worker.js' &&
		graphImport.target === modulePath
	);
}

function assertExpectedBoundaryDeclarations(
	modulePath: string,
	imports: readonly RustExecutableGraphImport[],
	assets: readonly RustExecutableGraphAsset[],
	externals: readonly RustExecutableGraphExternal[]
) {
	const workerEdges = imports.filter(({ kind }) => kind === 'worker');
	const expectedWorker = EXPECTED_WORKER_EDGES[modulePath as keyof typeof EXPECTED_WORKER_EDGES];
	if (
		(expectedWorker === undefined && workerEdges.length !== 0) ||
		(expectedWorker !== undefined &&
			(workerEdges.length !== 1 ||
				workerEdges[0]?.specifier !== expectedWorker.specifier ||
				workerEdges[0]?.target !== expectedWorker.target))
	) {
		throw configurationError(
			`Rust executable module ${modulePath} changed its declared worker boundary`
		);
	}
	const expectedAssets =
		EXPECTED_CORE_ASSETS[modulePath as keyof typeof EXPECTED_CORE_ASSETS] ?? [];
	if (
		assets.length !== expectedAssets.length ||
		assets.some(
			(asset, index) =>
				asset.specifier !== expectedAssets[index]?.specifier ||
				asset.target !== expectedAssets[index]?.target
		)
	) {
		throw configurationError(
			`Rust executable module ${modulePath} changed its declared core Wasm boundary`
		);
	}
	const expectedExternal =
		EXPECTED_NODE_EXTERNALS[modulePath as keyof typeof EXPECTED_NODE_EXTERNALS];
	if (
		(expectedExternal === undefined && externals.length !== 0) ||
		(expectedExternal !== undefined &&
			(externals.length !== 1 || externals[0]?.specifier !== expectedExternal))
	) {
		throw configurationError(
			`Rust executable module ${modulePath} changed its declared node-only boundary`
		);
	}
}

export function snapshotRustExecutableGraphProfile(
	value: unknown
): Readonly<RustExecutableGraphProfile> {
	const profile = requireRecord(value, 'Rust executable graph profile');
	requireExactKeys(
		profile,
		['schemaVersion', 'format', 'authority', 'entryPath', 'fingerprint', 'modules'],
		'Rust executable graph profile'
	);
	if (profile.schemaVersion !== 1 || profile.format !== RUST_EXECUTABLE_GRAPH_FORMAT) {
		throw configurationError('Rust executable graph profile has an unsupported format');
	}
	if (profile.authority !== 'published-static') {
		throw configurationError(
			'Rust executable graph profile must describe published static assets'
		);
	}
	const entryPath = requireSafePath(profile.entryPath, 'Rust executable graph entry path');
	if (entryPath !== 'index.js') {
		throw configurationError('Rust executable graph entry path must be index.js');
	}
	if (typeof profile.fingerprint !== 'string' || !SHA256_PATTERN.test(profile.fingerprint)) {
		throw configurationError('Rust executable graph fingerprint must be a lowercase SHA-256');
	}
	const sourceModules = requireRecord(profile.modules, 'Rust executable graph modules');
	const modulePaths = Object.keys(sourceModules).sort(compareCodeUnits);
	if (modulePaths.length === 0 || modulePaths.length > MAX_MODULES) {
		throw configurationError(
			`Rust executable graph must contain 1 through ${MAX_MODULES} modules`
		);
	}

	let edgeCount = 0;
	const storagePaths = new Set<string>();
	const modules: Record<string, Readonly<RustExecutableGraphModule>> = {};
	for (const rawPath of modulePaths) {
		const modulePath = requireSafePath(rawPath, 'Rust executable module path');
		if (!modulePath.endsWith('.js')) {
			throw configurationError(`Rust executable module ${modulePath} must be JavaScript`);
		}
		const sourceModule = requireRecord(
			sourceModules[rawPath],
			`Rust executable module ${modulePath}`
		);
		requireExactKeys(
			sourceModule,
			['delivery', 'storage', 'logical', 'imports', 'assets', 'externals'],
			`Rust executable module ${modulePath}`
		);
		const delivery = requireRecord(
			sourceModule.delivery,
			`Rust executable module ${modulePath} delivery`
		);
		requireExactKeys(
			delivery,
			['storagePath', 'encoding'],
			`Rust executable module ${modulePath} delivery`
		);
		const storagePath = requireSafePath(
			delivery.storagePath,
			`Rust executable module ${modulePath} storage path`
		);
		if (delivery.encoding !== 'identity' && delivery.encoding !== 'gzip') {
			throw configurationError(
				`Rust executable module ${modulePath} has an invalid encoding`
			);
		}
		if (
			(delivery.encoding === 'identity' && storagePath !== `${modulePath}.bin`) ||
			(delivery.encoding === 'gzip' && storagePath !== `${modulePath}.gz.bin`)
		) {
			throw configurationError(
				`Rust executable module ${modulePath} has an invalid authority or delivery path`
			);
		}
		if (storagePaths.has(storagePath)) {
			throw configurationError(`Rust executable graph repeats storage path ${storagePath}`);
		}
		storagePaths.add(storagePath);
		const storage = requireReceipt(
			sourceModule.storage,
			`Rust executable module ${modulePath} storage receipt`,
			MAX_MODULE_STORAGE_BYTES
		);
		const logical = requireReceipt(
			sourceModule.logical,
			`Rust executable module ${modulePath} logical receipt`,
			MAX_MODULE_LOGICAL_BYTES
		);
		if (
			delivery.encoding === 'identity' &&
			(storage.bytes !== logical.bytes || storage.sha256 !== logical.sha256)
		) {
			throw configurationError(
				`Rust executable module ${modulePath} identity receipts must match`
			);
		}
		if (!Array.isArray(sourceModule.imports)) {
			throw configurationError(
				`Rust executable module ${modulePath} imports must be an array`
			);
		}
		if (!Array.isArray(sourceModule.assets)) {
			throw configurationError(
				`Rust executable module ${modulePath} assets must be an array`
			);
		}
		if (!Array.isArray(sourceModule.externals)) {
			throw configurationError(
				`Rust executable module ${modulePath} externals must be an array`
			);
		}

		const declaredSpecifiers = new Set<string>();
		const imports = sourceModule.imports.map((rawImport, index) => {
			const graphImport = requireRecord(
				rawImport,
				`Rust executable module ${modulePath} import ${index}`
			);
			requireExactKeys(
				graphImport,
				['specifier', 'target', 'kind'],
				`Rust executable module ${modulePath} import ${index}`
			);
			const specifier = requireSpecifier(
				graphImport.specifier,
				`Rust executable module ${modulePath} import specifier`
			);
			const target = requireSafePath(
				graphImport.target,
				`Rust executable module ${modulePath} import target`
			);
			if (!target.endsWith('.js')) {
				throw configurationError(
					`Rust executable module ${modulePath} import target must be JavaScript`
				);
			}
			if (!['static', 'dynamic', 'worker'].includes(String(graphImport.kind))) {
				throw configurationError(
					`Rust executable module ${modulePath} import ${specifier} has an invalid kind`
				);
			}
			const kind = graphImport.kind as RustExecutableImportKind;
			if (resolveDeclaredImportTarget(modulePath, specifier, kind) !== target) {
				throw configurationError(
					`Rust executable module ${modulePath} import ${specifier} does not resolve to ${target}`
				);
			}
			if (declaredSpecifiers.has(specifier)) {
				throw configurationError(
					`Rust executable module ${modulePath} has a duplicate declared specifier`
				);
			}
			declaredSpecifiers.add(specifier);
			edgeCount += 1;
			return Object.freeze({ specifier, target, kind });
		});

		const assets = sourceModule.assets.map((rawAsset, index) => {
			const asset = requireRecord(
				rawAsset,
				`Rust executable module ${modulePath} asset ${index}`
			);
			requireExactKeys(
				asset,
				['specifier', 'target', 'kind'],
				`Rust executable module ${modulePath} asset ${index}`
			);
			const specifier = requireSpecifier(
				asset.specifier,
				`Rust executable module ${modulePath} asset specifier`
			);
			const target = requireSafePath(
				asset.target,
				`Rust executable module ${modulePath} asset target`
			);
			if (asset.kind !== 'core-wasm') {
				throw configurationError(
					`Rust executable module ${modulePath} asset ${specifier} has an invalid kind`
				);
			}
			const logicalTarget = resolveRelativeTarget(modulePath, specifier);
			if (target !== logicalTarget && target !== `${logicalTarget}.gz`) {
				throw configurationError(
					`Rust executable module ${modulePath} asset ${specifier} does not resolve to ${target}`
				);
			}
			if (declaredSpecifiers.has(specifier)) {
				throw configurationError(
					`Rust executable module ${modulePath} has a duplicate declared specifier`
				);
			}
			declaredSpecifiers.add(specifier);
			edgeCount += 1;
			return Object.freeze({ specifier, target, kind: 'core-wasm' as const });
		});

		const externals = sourceModule.externals.map((rawExternal, index) => {
			const external = requireRecord(
				rawExternal,
				`Rust executable module ${modulePath} external ${index}`
			);
			requireExactKeys(
				external,
				['specifier', 'kind', 'condition'],
				`Rust executable module ${modulePath} external ${index}`
			);
			if (
				external.specifier !== 'node:fs/promises' ||
				external.kind !== 'dynamic' ||
				external.condition !== 'node-only'
			) {
				throw configurationError(
					`Rust executable module ${modulePath} has an unapproved external`
				);
			}
			if (declaredSpecifiers.has(external.specifier)) {
				throw configurationError(
					`Rust executable module ${modulePath} has a duplicate declared specifier`
				);
			}
			declaredSpecifiers.add(external.specifier);
			edgeCount += 1;
			return Object.freeze({
				specifier: external.specifier,
				kind: 'dynamic' as const,
				condition: 'node-only' as const
			});
		});
		if (edgeCount > MAX_EDGES) {
			throw configurationError(`Rust executable graph exceeds ${MAX_EDGES} declarations`);
		}
		assertExpectedBoundaryDeclarations(modulePath, imports, assets, externals);
		modules[modulePath] = Object.freeze({
			delivery: Object.freeze({
				storagePath,
				encoding: delivery.encoding as RustExecutableGraphEncoding
			}),
			storage,
			logical,
			imports: Object.freeze(imports),
			assets: Object.freeze(assets),
			externals: Object.freeze(externals)
		});
	}

	if (!Object.prototype.hasOwnProperty.call(modules, entryPath)) {
		throw configurationError('Rust executable graph entry module is missing');
	}
	for (const [modulePath, module] of Object.entries(modules)) {
		for (const graphImport of module.imports) {
			if (!Object.prototype.hasOwnProperty.call(modules, graphImport.target)) {
				throw configurationError(
					`Rust executable module ${modulePath} imports undeclared ${graphImport.target}`
				);
			}
		}
	}

	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (modulePath: string) => {
		if (visiting.has(modulePath)) {
			throw configurationError(`Rust executable graph contains a cycle at ${modulePath}`);
		}
		if (visited.has(modulePath)) return;
		visiting.add(modulePath);
		for (const graphImport of modules[modulePath]!.imports) {
			if (isAllowedThreadSelfEdge(modulePath, graphImport)) continue;
			visit(graphImport.target);
		}
		visiting.delete(modulePath);
		visited.add(modulePath);
	};
	visit(entryPath);
	if (visited.size !== modulePaths.length) {
		throw configurationError('Rust executable graph contains unreachable modules');
	}

	return Object.freeze({
		schemaVersion: 1,
		format: RUST_EXECUTABLE_GRAPH_FORMAT,
		authority: profile.authority,
		entryPath: 'index.js',
		fingerprint: profile.fingerprint,
		modules: Object.freeze(modules)
	});
}

export function canonicalRustExecutableGraphProfile(
	profile: Readonly<RustExecutableGraphProfile>
): Uint8Array {
	let canonical = RUST_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN;
	canonical += `schema\0${profile.format}\0${profile.schemaVersion}\n`;
	canonical += `authority\0${profile.authority}\n`;
	canonical += `entry\0${profile.entryPath}\n`;
	const paths = Object.keys(profile.modules).sort(compareCodeUnits);
	for (const modulePath of paths) {
		const module = profile.modules[modulePath]!;
		canonical += `module\0${modulePath}\0${module.delivery.storagePath}\0${module.delivery.encoding}\0${module.storage.bytes}\0${module.storage.sha256}\0${module.logical.bytes}\0${module.logical.sha256}\n`;
	}
	const edges = paths.flatMap((modulePath) =>
		profile.modules[modulePath]!.imports.map((graphImport) => ({
			importer: modulePath,
			...graphImport
		}))
	);
	edges.sort((left, right) => {
		for (const field of ['importer', 'kind', 'specifier', 'target'] as const) {
			const compared = compareCodeUnits(left[field], right[field]);
			if (compared !== 0) return compared;
		}
		return 0;
	});
	for (const edge of edges) {
		canonical += `edge\0${edge.importer}\0${edge.kind}\0${edge.specifier}\0${edge.target}\n`;
	}
	const assets = paths.flatMap((modulePath) =>
		profile.modules[modulePath]!.assets.map((asset) => ({ importer: modulePath, ...asset }))
	);
	assets.sort(
		(left, right) =>
			compareCodeUnits(left.importer, right.importer) ||
			compareCodeUnits(left.specifier, right.specifier) ||
			compareCodeUnits(left.target, right.target)
	);
	for (const asset of assets) {
		canonical += `asset\0${asset.importer}\0${asset.kind}\0${asset.specifier}\0${asset.target}\n`;
	}
	const externals = paths.flatMap((modulePath) =>
		profile.modules[modulePath]!.externals.map((external) => ({
			importer: modulePath,
			...external
		}))
	);
	externals.sort(
		(left, right) =>
			compareCodeUnits(left.importer, right.importer) ||
			compareCodeUnits(left.specifier, right.specifier)
	);
	for (const external of externals) {
		canonical += `external\0${external.importer}\0${external.kind}\0${external.specifier}\0${external.condition}\n`;
	}
	return encoder.encode(canonical);
}

async function sha256Hex(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
	if (!globalThis.crypto?.subtle) {
		throw configurationError('Rust executable graph verification requires Web Crypto');
	}
	const pending = globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
	if (!signal) {
		return Array.from(new Uint8Array(await pending), (value) =>
			value.toString(16).padStart(2, '0')
		).join('');
	}
	const digest = await new Promise<ArrayBuffer>((resolve, reject) => {
		let settled = false;
		const abort = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', abort);
			reject(signal.reason ?? new Error('Rust executable graph verification aborted'));
		};
		signal.addEventListener('abort', abort, { once: true });
		pending.then(
			(value) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', abort);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', abort);
				reject(error);
			}
		);
		if (signal.aborted) abort();
	});
	return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
		''
	);
}

function resolveSourceNetworkContext(
	moduleUrl: string,
	currentUrl: string | undefined,
	profile: Readonly<RustExecutableGraphProfile>,
	runtimeProfile: Readonly<PinnedRustRuntimeProfile>
) {
	let sourceModule: URL;
	try {
		sourceModule = new URL(moduleUrl, currentUrl);
	} catch (cause) {
		throw configurationError('Rust executable entry URL is invalid', cause);
	}
	if (
		(sourceModule.protocol !== 'http:' && sourceModule.protocol !== 'https:') ||
		sourceModule.username ||
		sourceModule.password ||
		sourceModule.hash ||
		/%(?:2e|2f|5c)/iu.test(sourceModule.pathname) ||
		!sourceModule.pathname.endsWith(`/${profile.entryPath}`)
	) {
		throw configurationError('Rust executable entry URL is unsafe or has the wrong path');
	}
	const queryKeys = [...sourceModule.searchParams.keys()].sort(compareCodeUnits);
	if (
		queryKeys.length !== 3 ||
		queryKeys[0] !== 'rustManifestBytes' ||
		queryKeys[1] !== 'rustManifestSha256' ||
		queryKeys[2] !== 'v' ||
		sourceModule.searchParams.getAll('v').length !== 1 ||
		sourceModule.searchParams.getAll('rustManifestBytes').length !== 1 ||
		sourceModule.searchParams.getAll('rustManifestSha256').length !== 1
	) {
		throw configurationError(
			'Rust executable entry URL must contain one exact runtime profile'
		);
	}
	const generation = sourceModule.searchParams.get('v')!;
	const manifestBytesText = sourceModule.searchParams.get('rustManifestBytes')!;
	const manifestSha256 = sourceModule.searchParams.get('rustManifestSha256')!;
	const manifestBytes = Number(manifestBytesText);
	const canonicalRuntimeProfileQuery = `?v=${runtimeProfile.manifestFingerprint}&rustManifestBytes=${runtimeProfile.manifestReceipt.bytes}&rustManifestSha256=${runtimeProfile.manifestReceipt.sha256}`;
	if (
		generation !== runtimeProfile.manifestFingerprint ||
		manifestSha256 !== runtimeProfile.manifestReceipt.sha256 ||
		manifestBytesText !== String(runtimeProfile.manifestReceipt.bytes) ||
		sourceModule.search !== canonicalRuntimeProfileQuery ||
		!/^\d+$/u.test(manifestBytesText) ||
		!Number.isSafeInteger(manifestBytes) ||
		manifestBytes <= 0
	) {
		throw configurationError('Rust executable entry URL has an invalid runtime profile');
	}
	const sourceBase = new URL('./', sourceModule);
	sourceBase.search = sourceModule.search;
	const storageUrls: Record<string, string> = {};
	const keysByPath: Record<string, string> = {};
	const networkUrlsByPath: Record<string, string> = {};
	const modulePaths = Object.keys(profile.modules).sort(compareCodeUnits);
	for (const [index, modulePath] of modulePaths.entries()) {
		const key = `module-${index}`;
		const module = profile.modules[modulePath]!;
		const storageUrl = new URL(module.delivery.storagePath, sourceBase);
		storageUrl.search = `?v=${module.storage.sha256}`;
		storageUrls[key] = storageUrl.href;
		keysByPath[modulePath] = key;
		const networkUrl = new URL(modulePath, sourceBase);
		networkUrl.search = sourceModule.search;
		networkUrlsByPath[modulePath] = networkUrl.href;
	}
	const expectedNetworkModuleUrls = Object.freeze(
		modulePaths.map((modulePath) => networkUrlsByPath[modulePath]!)
	);
	return Object.freeze({
		sourceModuleUrl: sourceModule.href,
		assetBaseUrl: sourceBase.href,
		storageRootUrl: new URL('./', sourceModule).href,
		storageUrls: Object.freeze(storageUrls),
		keysByPath: Object.freeze(keysByPath),
		networkUrlsByPath: Object.freeze(networkUrlsByPath),
		expectedNetworkModuleUrls,
		runtimeProfile: Object.freeze({
			...runtimeProfile,
			moduleUrl: sourceModule.href
		})
	});
}

function createPreflightManifest(
	profile: Readonly<RustExecutableGraphProfile>,
	keysByPath: Readonly<Record<string, string>>
): RuntimeRegistryManifest {
	return {
		schemaVersion: RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
		manifestId: 'wasm-idle/rust-executable-graph',
		revision: profile.fingerprint,
		runtimes: [
			{
				runtimeId: 'rust/executable-graph',
				identity: {
					languageId: 'RUST',
					implementationId: 'wasm-rust-browser',
					implementationVersion: '1',
					profile: {
						profileId: 'rust-executable-graph-v1',
						manifestSchemaVersion: 1,
						manifestSha256: profile.fingerprint,
						protocolVersion: 1,
						trustProfileId: 'receipt-verified-module-graph-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: {
					stdin: 'streaming',
					workspace: true,
					abort: true,
					artifacts: true,
					streamingOutput: true
				},
				workerLifetime: { mode: 'per-run' },
				requiredBrowserFeatures: [
					'blob',
					'crypto.subtle',
					'decompression-stream',
					'module-worker'
				],
				assetRoot: '.',
				assets: Object.keys(profile.modules)
					.sort(compareCodeUnits)
					.map((modulePath) => {
						const module = profile.modules[modulePath]!;
						return {
							key: keysByPath[modulePath]!,
							path: module.delivery.storagePath,
							compressedSha256: module.storage.sha256,
							uncompressedSha256: module.storage.sha256,
							compressedBytes: module.storage.bytes,
							uncompressedBytes: module.storage.bytes,
							mediaType: 'application/octet-stream',
							encoding: 'identity' as const
						};
					}),
				contracts: {
					routeId: 'rust',
					runtimeAssetKey: 'rust-executable-graph',
					documentationId: 'RUST',
					syncTarget: 'wasm-rust',
					browserTestId: 'rust-executable-graph'
				}
			}
		]
	};
}

async function decodeGzipBounded(bytes: Uint8Array, expectedBytes: number, signal?: AbortSignal) {
	if (typeof DecompressionStream !== 'function') {
		throw configurationError('Rust executable graph gzip requires DecompressionStream');
	}
	const body = new Response(Uint8Array.from(bytes)).body;
	if (!body) {
		throw configurationError('Rust executable graph gzip requires readable response bodies');
	}
	let reader: ReadableStreamDefaultReader<Uint8Array>;
	try {
		reader = body.pipeThrough(new DecompressionStream('gzip')).getReader();
	} catch (cause) {
		throw configurationError('Rust executable graph gzip decoder initialization failed', cause);
	}
	const output = new Uint8Array(expectedBytes);
	let offset = 0;
	const abort = () => {
		try {
			void reader.cancel(signal?.reason).catch(() => {});
		} catch {
			// Preserve the abort reason rather than a decoder cleanup failure.
		}
	};
	signal?.addEventListener('abort', abort, { once: true });
	try {
		for (;;) {
			if (signal?.aborted) {
				throw signal.reason ?? new Error('Rust executable graph verification aborted');
			}
			const { done, value } = await reader.read();
			if (done) break;
			if (offset + value.byteLength > expectedBytes) {
				throw configurationError(
					'Rust executable graph gzip exceeds its logical receipt size'
				);
			}
			output.set(value, offset);
			offset += value.byteLength;
		}
	} catch (cause) {
		try {
			await reader.cancel(cause);
		} catch {}
		if (signal?.aborted) {
			throw signal.reason ?? cause;
		}
		if (cause instanceof RuntimeConfigurationError) throw cause;
		throw configurationError('Rust executable graph gzip decoding failed', cause);
	} finally {
		signal?.removeEventListener('abort', abort);
	}
	if (signal?.aborted) {
		throw signal.reason ?? new Error('Rust executable graph verification aborted');
	}
	if (offset !== expectedBytes) {
		throw configurationError('Rust executable graph gzip logical size mismatch');
	}
	return output;
}

interface StringLiteralLocation {
	readonly value: string;
	readonly start: number;
	readonly end: number;
}

function scanUnescapedStringLiterals(source: string): readonly StringLiteralLocation[] {
	const literals: StringLiteralLocation[] = [];
	let index = 0;
	while (index < source.length) {
		const character = source[index]!;
		if (character === '/' && source[index + 1] === '/') {
			index += 2;
			while (index < source.length && source[index] !== '\n' && source[index] !== '\r')
				index++;
			continue;
		}
		if (character === '/' && source[index + 1] === '*') {
			const end = source.indexOf('*/', index + 2);
			index = end < 0 ? source.length : end + 2;
			continue;
		}
		if (character === '`') {
			index += 1;
			while (index < source.length) {
				if (source[index] === '\\') {
					index += 2;
					continue;
				}
				if (source[index++] === '`') break;
			}
			continue;
		}
		if (character !== "'" && character !== '"') {
			index += 1;
			continue;
		}
		const quote = character;
		const start = index++;
		let escaped = false;
		let closed = false;
		while (index < source.length) {
			const next = source[index]!;
			if (next === '\\') {
				escaped = true;
				index += 2;
				continue;
			}
			index += 1;
			if (next === quote) {
				closed = true;
				break;
			}
			if (next === '\n' || next === '\r') break;
		}
		if (closed && !escaped) {
			literals.push({ value: source.slice(start + 1, index - 1), start, end: index });
		}
	}
	return literals;
}

interface PlannedReplacement {
	readonly start: number;
	readonly end: number;
	readonly target: string;
	readonly type: 'module' | 'asset';
}

function planSourceReplacements(
	modulePath: string,
	source: string,
	module: Readonly<RustExecutableGraphModule>
): readonly PlannedReplacement[] {
	const literals = scanUnescapedStringLiterals(source);
	const replacements: PlannedReplacement[] = [];
	for (const graphImport of module.imports) {
		if (isAllowedThreadSelfEdge(modulePath, graphImport)) continue;
		const matches = literals.filter((literal) => literal.value === graphImport.specifier);
		if (matches.length === 0 && graphImport.kind !== 'dynamic') {
			throw configurationError(
				`Rust executable module ${modulePath} must contain ${graphImport.kind} import ${graphImport.specifier}`
			);
		}
		for (const match of matches) {
			replacements.push({
				start: match.start,
				end: match.end,
				target: graphImport.target,
				type: 'module'
			});
		}
	}
	for (const asset of module.assets) {
		const matches = literals.filter((literal) => literal.value === asset.specifier);
		if (matches.length !== 1) {
			throw configurationError(
				`Rust executable module ${modulePath} must contain core Wasm asset ${asset.specifier} exactly once`
			);
		}
		replacements.push({
			start: matches[0]!.start,
			end: matches[0]!.end,
			// The generated JCO loader appends `.gz` to `.core.wasm` itself. The
			// declared target remains the storage/receipt cross-check above.
			target: resolveRelativeTarget(modulePath, asset.specifier),
			type: 'asset'
		});
	}
	for (const external of module.externals) {
		if (literals.filter((literal) => literal.value === external.specifier).length !== 1) {
			throw configurationError(
				`Rust executable module ${modulePath} must contain node-only import ${external.specifier} exactly once`
			);
		}
	}
	const offsets = new Set(replacements.map(({ start }) => start));
	if (offsets.size !== replacements.length) {
		throw configurationError(`Rust executable module ${modulePath} has ambiguous declarations`);
	}
	return Object.freeze(replacements.sort((left, right) => right.start - left.start));
}

function applySourceReplacements(
	source: string,
	replacements: readonly PlannedReplacement[],
	moduleUrls: Readonly<Record<string, string>>,
	sourceContext: ReturnType<typeof resolveSourceNetworkContext>
) {
	let rewritten = source;
	for (const replacement of replacements) {
		let targetUrl: string;
		if (replacement.type === 'module') {
			targetUrl = moduleUrls[replacement.target]!;
			if (!isSafeBlobUrl(targetUrl)) {
				throw configurationError(
					'Rust executable graph Blob URL is unsafe for source rewriting'
				);
			}
		} else {
			const assetUrl = new URL(replacement.target, sourceContext.assetBaseUrl);
			assetUrl.search = new URL(sourceContext.sourceModuleUrl).search;
			targetUrl = assetUrl.href;
			if (
				(assetUrl.protocol !== 'http:' && assetUrl.protocol !== 'https:') ||
				assetUrl.username ||
				assetUrl.password ||
				assetUrl.hash ||
				/[\r\n]/u.test(targetUrl)
			) {
				throw configurationError('Rust executable graph core Wasm URL is unsafe');
			}
		}
		rewritten = `${rewritten.slice(0, replacement.start)}${JSON.stringify(targetUrl)}${rewritten.slice(
			replacement.end
		)}`;
	}
	return rewritten;
}

function isSafeBlobUrl(value: string) {
	if (!SAFE_BLOB_URL_PATTERN.test(value)) return false;
	try {
		const url = new URL(value);
		return url.protocol === 'blob:' && !url.search && !url.hash && url.href === value;
	} catch {
		return false;
	}
}

export async function loadVerifiedRustExecutableGraph(
	options: LoadRustExecutableGraphOptions
): Promise<LoadedRustExecutableGraph> {
	const profile = snapshotRustExecutableGraphProfile(options.profile);
	const runtimeProfile = snapshotPinnedRustRuntimeProfile(options.runtimeProfile);
	const sourceContext = resolveSourceNetworkContext(
		options.moduleUrl,
		options.currentUrl,
		profile,
		runtimeProfile
	);
	const actualFingerprint = await sha256Hex(
		canonicalRustExecutableGraphProfile(profile),
		options.signal
	);
	if (actualFingerprint !== profile.fingerprint) {
		throw configurationError('Rust executable graph fingerprint does not match its receipts');
	}
	let totalStorageBytes = 0;
	let totalLogicalBytes = 0;
	for (const module of Object.values(profile.modules)) {
		totalStorageBytes += module.storage.bytes;
		totalLogicalBytes += module.logical.bytes;
	}
	if (!Number.isSafeInteger(totalStorageBytes) || !Number.isSafeInteger(totalLogicalBytes)) {
		throw configurationError('Rust executable graph aggregate size is unsafe');
	}
	const maxAssetBytes = options.maxAssetBytes;
	if (
		maxAssetBytes !== undefined &&
		Object.values(profile.modules).some(
			(module) => module.storage.bytes > maxAssetBytes || module.logical.bytes > maxAssetBytes
		)
	) {
		throw configurationError('Rust executable graph module exceeds the configured asset limit');
	}
	const limits: Partial<ExecutionLimits> = {};
	if (maxAssetBytes !== undefined) limits.maxAssetBytes = maxAssetBytes;
	if (options.assetTimeoutMs !== undefined) limits.assetTimeoutMs = options.assetTimeoutMs;
	const preflight = await preflightRuntimeAssets({
		manifest: createPreflightManifest(profile, sourceContext.keysByPath),
		runtimeId: 'rust/executable-graph',
		rootUrl: sourceContext.storageRootUrl,
		assetUrls: sourceContext.storageUrls,
		...(options.fetch ? { fetch: options.fetch } : {}),
		...(options.signal ? { signal: options.signal } : {}),
		limits,
		cache: 'no-store',
		redirect: 'error',
		requireExactResponseUrl: true,
		maxConcurrentDownloads: Math.min(5, Object.keys(profile.modules).length),
		maxTotalDeliveryBytes: totalStorageBytes,
		reportProgress: options.reportProgress
			? ({ assetKey, loadedBytes, totalBytes }) => {
					const path = Object.keys(sourceContext.keysByPath).find(
						(candidate) => sourceContext.keysByPath[candidate] === assetKey
					);
					if (path) options.reportProgress?.({ path, loadedBytes, totalBytes });
				}
			: undefined
	});

	const sources: Record<string, string> = {};
	const replacementPlans: Record<string, readonly PlannedReplacement[]> = {};
	for (const modulePath of Object.keys(profile.modules).sort(compareCodeUnits)) {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('Rust executable graph verification aborted');
		}
		const module = profile.modules[modulePath]!;
		const storageBytes = preflight.assets[sourceContext.keysByPath[modulePath]!]!.bytes;
		const logicalBytes =
			module.delivery.encoding === 'gzip'
				? await decodeGzipBounded(storageBytes, module.logical.bytes, options.signal)
				: storageBytes;
		if (logicalBytes.byteLength !== module.logical.bytes) {
			throw configurationError(`Rust executable module ${modulePath} logical size mismatch`);
		}
		if ((await sha256Hex(logicalBytes, options.signal)) !== module.logical.sha256) {
			throw configurationError(
				`Rust executable module ${modulePath} logical SHA-256 mismatch`
			);
		}
		let source: string;
		try {
			source = fatalDecoder.decode(logicalBytes);
		} catch (cause) {
			throw configurationError(
				`Rust executable module ${modulePath} is not valid UTF-8`,
				cause
			);
		}
		sources[modulePath] = source;
		replacementPlans[modulePath] = planSourceReplacements(modulePath, source, module);
	}

	if (
		typeof Blob !== 'function' ||
		typeof URL?.createObjectURL !== 'function' ||
		typeof URL?.revokeObjectURL !== 'function'
	) {
		throw configurationError('Rust executable graph requires Blob module URLs');
	}
	const order: string[] = [];
	const visited = new Set<string>();
	const visit = (modulePath: string) => {
		if (visited.has(modulePath)) return;
		visited.add(modulePath);
		for (const graphImport of profile.modules[modulePath]!.imports) {
			if (isAllowedThreadSelfEdge(modulePath, graphImport)) continue;
			visit(graphImport.target);
		}
		order.push(modulePath);
	};
	visit(profile.entryPath);

	const moduleUrls: Record<string, string> = {};
	const networkModuleUrls: Record<string, string> = {};
	const ownedUrls: string[] = [];
	const ownedUrlSet = new Set<string>();
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const url of ownedUrls.reverse()) {
			try {
				URL.revokeObjectURL(url);
			} catch {
				// Cleanup is best effort and must remain idempotent.
			}
		}
	};
	try {
		for (const modulePath of order) {
			if (options.signal?.aborted) {
				throw (
					options.signal.reason ?? new Error('Rust executable graph verification aborted')
				);
			}
			const source = applySourceReplacements(
				sources[modulePath]!,
				replacementPlans[modulePath]!,
				moduleUrls,
				sourceContext
			);
			const blobUrl = URL.createObjectURL(
				new Blob([source], { type: 'text/javascript;charset=utf-8' })
			);
			if (!isSafeBlobUrl(blobUrl) || ownedUrlSet.has(blobUrl)) {
				try {
					URL.revokeObjectURL(blobUrl);
				} catch {}
				throw configurationError('Rust executable graph received an unsafe Blob URL');
			}
			moduleUrls[modulePath] = blobUrl;
			networkModuleUrls[sourceContext.networkUrlsByPath[modulePath]!] = blobUrl;
			ownedUrls.push(blobUrl);
			ownedUrlSet.add(blobUrl);
			if (options.signal?.aborted) {
				throw (
					options.signal.reason ?? new Error('Rust executable graph verification aborted')
				);
			}
		}
		return Object.freeze({
			entryUrl: moduleUrls[profile.entryPath]!,
			sourceModuleUrl: sourceContext.sourceModuleUrl,
			assetBaseUrl: sourceContext.assetBaseUrl,
			runtimeProfile: sourceContext.runtimeProfile,
			moduleUrls: Object.freeze({ ...moduleUrls }),
			expectedNetworkModuleUrls: sourceContext.expectedNetworkModuleUrls,
			networkModuleUrls: Object.freeze({ ...networkModuleUrls }),
			dispose
		});
	} catch (error) {
		dispose();
		throw error;
	}
}
