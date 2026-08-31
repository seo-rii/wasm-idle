import {
	RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
	RuntimeConfigurationError,
	preflightRuntimeAssets,
	type ExecutionLimits,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';

export const TINYGO_EXECUTABLE_GRAPH_FORMAT = 'wasm-idle-tinygo-executable-graph-v1' as const;
export const TINYGO_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN =
	'wasm-idle:tinygo-executable-graph:v1\n' as const;

export type TinyGoExecutableImportKind = 'static' | 'dynamic' | 'worker';

export interface TinyGoExecutableGraphImport {
	readonly specifier: string;
	readonly target: string;
	readonly kind: TinyGoExecutableImportKind;
}

export interface TinyGoExecutableGraphModule {
	readonly bytes: number;
	readonly sha256: string;
	readonly imports: readonly TinyGoExecutableGraphImport[];
}

export interface TinyGoExecutableGraphProfile {
	readonly schemaVersion: 1;
	readonly format: typeof TINYGO_EXECUTABLE_GRAPH_FORMAT;
	readonly entryPath: string;
	readonly fingerprint: string;
	readonly modules: Readonly<Record<string, TinyGoExecutableGraphModule>>;
}

export interface LoadedTinyGoExecutableGraph {
	readonly entryUrl: string;
	readonly assetBaseUrl: string;
	readonly moduleUrls: Readonly<Record<string, string>>;
	dispose(): void;
}

export interface TinyGoExecutableGraphProgress {
	readonly path: string;
	readonly loadedBytes: number;
	readonly totalBytes: number;
}

export interface LoadTinyGoExecutableGraphOptions {
	readonly moduleUrl: string;
	readonly currentUrl?: string;
	readonly profile: unknown;
	readonly fetch?: typeof globalThis.fetch;
	readonly signal?: AbortSignal;
	readonly maxAssetBytes?: number;
	readonly assetTimeoutMs?: number;
	readonly reportProgress?: (progress: TinyGoExecutableGraphProgress) => void;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/-]+$/u;
const SAFE_BLOB_URL_PATTERN = /^blob:[^'"`\\\r\n]+$/u;
const MAX_MODULES = 32;
const MAX_IMPORTS = 128;
const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

const compareCodeUnits = (left: string, right: string) =>
	left < right ? -1 : left > right ? 1 : 0;

const configurationError = (message: string, cause?: unknown) =>
	new RuntimeConfigurationError(message, {
		phase: 'asset',
		runtimeId: 'TINYGO',
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
		!SAFE_PATH_PATTERN.test(value) ||
		value.startsWith('/') ||
		value.includes('\\') ||
		value.includes('\0') ||
		value.includes('?') ||
		value.includes('#') ||
		value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
	) {
		throw configurationError(`${label} must be a normalized safe relative path`);
	}
	return value;
}

function resolveImportTarget(importer: string, specifier: string): string {
	if (
		!specifier ||
		specifier.startsWith('/') ||
		specifier.includes('\\') ||
		specifier.includes('\0') ||
		specifier.includes('\r') ||
		specifier.includes('\n') ||
		specifier.includes('?') ||
		specifier.includes('#') ||
		/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(specifier)
	) {
		throw configurationError(`TinyGo executable import ${specifier || '<empty>'} is unsafe`);
	}
	const segments = importer.split('/');
	segments.pop();
	for (const segment of specifier.split('/')) {
		if (!segment || segment === '.') continue;
		if (segment === '..') {
			if (segments.length === 0) {
				throw configurationError(
					`TinyGo executable import ${specifier} escapes its graph root`
				);
			}
			segments.pop();
			continue;
		}
		if (!/^[A-Za-z0-9._-]+$/u.test(segment)) {
			throw configurationError(`TinyGo executable import ${specifier} is unsafe`);
		}
		segments.push(segment);
	}
	return segments.join('/');
}

export function snapshotTinyGoExecutableGraphProfile(
	value: unknown
): Readonly<TinyGoExecutableGraphProfile> {
	const profile = requireRecord(value, 'TinyGo executable graph profile');
	requireExactKeys(
		profile,
		['schemaVersion', 'format', 'entryPath', 'fingerprint', 'modules'],
		'TinyGo executable graph profile'
	);
	if (profile.schemaVersion !== 1 || profile.format !== TINYGO_EXECUTABLE_GRAPH_FORMAT) {
		throw configurationError('TinyGo executable graph profile has an unsupported format');
	}
	const entryPath = requireSafePath(profile.entryPath, 'TinyGo executable graph entry path');
	if (typeof profile.fingerprint !== 'string' || !SHA256_PATTERN.test(profile.fingerprint)) {
		throw configurationError('TinyGo executable graph fingerprint must be a lowercase SHA-256');
	}
	const sourceModules = requireRecord(profile.modules, 'TinyGo executable graph modules');
	const modulePaths = Object.keys(sourceModules).sort(compareCodeUnits);
	if (modulePaths.length === 0 || modulePaths.length > MAX_MODULES) {
		throw configurationError(
			`TinyGo executable graph must contain 1 through ${MAX_MODULES} modules`
		);
	}

	let importCount = 0;
	const modules: Record<string, Readonly<TinyGoExecutableGraphModule>> = {};
	for (const rawPath of modulePaths) {
		const modulePath = requireSafePath(rawPath, 'TinyGo executable module path');
		const sourceModule = requireRecord(
			sourceModules[rawPath],
			`TinyGo executable module ${modulePath}`
		);
		requireExactKeys(
			sourceModule,
			['bytes', 'sha256', 'imports'],
			`TinyGo executable module ${modulePath}`
		);
		if (!Number.isSafeInteger(sourceModule.bytes) || Number(sourceModule.bytes) <= 0) {
			throw configurationError(`TinyGo executable module ${modulePath} has an invalid size`);
		}
		if (typeof sourceModule.sha256 !== 'string' || !SHA256_PATTERN.test(sourceModule.sha256)) {
			throw configurationError(
				`TinyGo executable module ${modulePath} has an invalid SHA-256`
			);
		}
		if (!Array.isArray(sourceModule.imports)) {
			throw configurationError(
				`TinyGo executable module ${modulePath} imports must be an array`
			);
		}
		const specifiers = new Set<string>();
		const imports = sourceModule.imports.map((rawImport, index) => {
			const graphImport = requireRecord(
				rawImport,
				`TinyGo executable module ${modulePath} import ${index}`
			);
			requireExactKeys(
				graphImport,
				['specifier', 'target', 'kind'],
				`TinyGo executable module ${modulePath} import ${index}`
			);
			const specifier = graphImport.specifier;
			const target = requireSafePath(
				graphImport.target,
				`TinyGo executable module ${modulePath} import target`
			);
			if (typeof specifier !== 'string' || specifiers.has(specifier)) {
				throw configurationError(
					`TinyGo executable module ${modulePath} has an invalid or duplicate import specifier`
				);
			}
			specifiers.add(specifier);
			if (!['static', 'dynamic', 'worker'].includes(String(graphImport.kind))) {
				throw configurationError(
					`TinyGo executable module ${modulePath} import ${specifier} has an invalid kind`
				);
			}
			if (resolveImportTarget(modulePath, specifier) !== target) {
				throw configurationError(
					`TinyGo executable module ${modulePath} import ${specifier} does not resolve to ${target}`
				);
			}
			importCount += 1;
			if (importCount > MAX_IMPORTS) {
				throw configurationError(`TinyGo executable graph exceeds ${MAX_IMPORTS} imports`);
			}
			return Object.freeze({
				specifier,
				target,
				kind: graphImport.kind as TinyGoExecutableImportKind
			});
		});
		modules[modulePath] = Object.freeze({
			bytes: Number(sourceModule.bytes),
			sha256: sourceModule.sha256,
			imports: Object.freeze(imports)
		});
	}
	if (!Object.prototype.hasOwnProperty.call(modules, entryPath)) {
		throw configurationError('TinyGo executable graph entry module is missing');
	}
	for (const [modulePath, module] of Object.entries(modules)) {
		for (const graphImport of module.imports) {
			if (!Object.prototype.hasOwnProperty.call(modules, graphImport.target)) {
				throw configurationError(
					`TinyGo executable module ${modulePath} imports undeclared ${graphImport.target}`
				);
			}
		}
	}

	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (modulePath: string) => {
		if (visiting.has(modulePath)) {
			throw configurationError(`TinyGo executable graph contains a cycle at ${modulePath}`);
		}
		if (visited.has(modulePath)) return;
		visiting.add(modulePath);
		for (const graphImport of modules[modulePath]!.imports) visit(graphImport.target);
		visiting.delete(modulePath);
		visited.add(modulePath);
	};
	visit(entryPath);
	if (visited.size !== modulePaths.length) {
		throw configurationError('TinyGo executable graph contains unreachable modules');
	}

	return Object.freeze({
		schemaVersion: 1,
		format: TINYGO_EXECUTABLE_GRAPH_FORMAT,
		entryPath,
		fingerprint: profile.fingerprint,
		modules: Object.freeze(modules)
	});
}

export function canonicalTinyGoExecutableGraphProfile(
	profile: Readonly<TinyGoExecutableGraphProfile>
): Uint8Array {
	let canonical = TINYGO_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN;
	canonical += `schema\0${profile.format}\0${profile.schemaVersion}\n`;
	canonical += `entry\0${profile.entryPath}\n`;
	const paths = Object.keys(profile.modules).sort(compareCodeUnits);
	for (const modulePath of paths) {
		const module = profile.modules[modulePath]!;
		canonical += `module\0${modulePath}\0${module.bytes}\0${module.sha256}\n`;
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
	return encoder.encode(canonical);
}

async function sha256Hex(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
	if (!globalThis.crypto?.subtle) {
		throw configurationError('TinyGo executable graph verification requires Web Crypto');
	}
	const digestInput = Uint8Array.from(bytes).buffer;
	const pending = globalThis.crypto.subtle.digest('SHA-256', digestInput);
	const digest = signal
		? await new Promise<ArrayBuffer>((resolve, reject) => {
				let settled = false;
				const abort = () => {
					if (settled) return;
					settled = true;
					signal.removeEventListener('abort', abort);
					reject(
						signal.reason ?? new Error('TinyGo executable graph verification aborted')
					);
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
			})
		: await pending;
	return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
		''
	);
}

function resolvePinnedGraphUrls(
	moduleUrl: string,
	currentUrl: string | undefined,
	profile: Readonly<TinyGoExecutableGraphProfile>
) {
	let entryUrl: URL;
	try {
		entryUrl = new URL(moduleUrl, currentUrl);
	} catch (cause) {
		throw configurationError('TinyGo executable entry URL is invalid', cause);
	}
	if (
		(entryUrl.protocol !== 'http:' && entryUrl.protocol !== 'https:') ||
		entryUrl.username ||
		entryUrl.password ||
		entryUrl.hash ||
		/%(?:2e|2f|5c)/iu.test(entryUrl.pathname) ||
		!entryUrl.pathname.endsWith(`/${profile.entryPath}`)
	) {
		throw configurationError('TinyGo executable entry URL is unsafe or has the wrong path');
	}
	const entryReceipt = profile.modules[profile.entryPath]!;
	if (entryUrl.search && entryUrl.search !== `?v=${entryReceipt.sha256}`) {
		throw configurationError(
			'TinyGo executable entry URL must use its exact receipt query pin'
		);
	}
	entryUrl.search = `?v=${entryReceipt.sha256}`;
	const baseUrl = new URL('./', entryUrl);
	const assetUrls: Record<string, string> = {};
	const keysByPath: Record<string, string> = {};
	for (const [index, modulePath] of Object.keys(profile.modules)
		.sort(compareCodeUnits)
		.entries()) {
		const key = `module-${index}`;
		const url = new URL(modulePath, baseUrl);
		url.search = `?v=${profile.modules[modulePath]!.sha256}`;
		assetUrls[key] = url.href;
		keysByPath[modulePath] = key;
	}
	return Object.freeze({
		entryUrl: entryUrl.href,
		baseUrl: baseUrl.href,
		assetUrls: Object.freeze(assetUrls),
		keysByPath: Object.freeze(keysByPath)
	});
}

function createPreflightManifest(
	profile: Readonly<TinyGoExecutableGraphProfile>,
	keysByPath: Readonly<Record<string, string>>
): RuntimeRegistryManifest {
	return {
		schemaVersion: RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
		manifestId: 'wasm-idle/tinygo-executable-graph',
		revision: profile.fingerprint,
		runtimes: [
			{
				runtimeId: 'tinygo/executable-graph',
				identity: {
					languageId: 'TINYGO',
					implementationId: 'tinygo-upstream-browser',
					implementationVersion: '0.40.1',
					profile: {
						profileId: 'tinygo-executable-graph-v1',
						manifestSchemaVersion: 1,
						manifestSha256: profile.fingerprint,
						protocolVersion: 1,
						trustProfileId: 'receipt-verified-module-graph-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: {
					stdin: 'prebuffered',
					workspace: true,
					abort: true,
					artifacts: true,
					streamingOutput: true
				},
				workerLifetime: { mode: 'per-run' },
				requiredBrowserFeatures: ['blob', 'crypto.subtle', 'module-worker'],
				assetRoot: '.',
				assets: Object.keys(profile.modules)
					.sort(compareCodeUnits)
					.map((modulePath) => {
						const receipt = profile.modules[modulePath]!;
						return {
							key: keysByPath[modulePath]!,
							path: modulePath,
							compressedSha256: receipt.sha256,
							uncompressedSha256: receipt.sha256,
							compressedBytes: receipt.bytes,
							uncompressedBytes: receipt.bytes,
							mediaType: 'text/javascript',
							encoding: 'identity' as const
						};
					}),
				contracts: {
					routeId: 'tinygo',
					runtimeAssetKey: 'tinygo-executable-graph',
					documentationId: 'TINYGO',
					syncTarget: 'wasm-tinygo',
					browserTestId: 'tinygo-executable-graph'
				}
			}
		]
	};
}

function replaceUniqueSpecifier(
	source: string,
	specifier: string,
	replacement: string,
	modulePath: string
) {
	const first = source.indexOf(specifier);
	if (first < 0 || source.indexOf(specifier, first + specifier.length) >= 0) {
		throw configurationError(
			`TinyGo executable module ${modulePath} must contain import ${specifier} exactly once`
		);
	}
	if (!SAFE_BLOB_URL_PATTERN.test(replacement)) {
		throw configurationError('TinyGo executable Blob URL is unsafe for source rewriting');
	}
	return `${source.slice(0, first)}${replacement}${source.slice(first + specifier.length)}`;
}

export async function loadVerifiedTinyGoExecutableGraph(
	options: LoadTinyGoExecutableGraphOptions
): Promise<LoadedTinyGoExecutableGraph> {
	const profile = snapshotTinyGoExecutableGraphProfile(options.profile);
	const urls = resolvePinnedGraphUrls(options.moduleUrl, options.currentUrl, profile);
	const actualFingerprint = await sha256Hex(
		canonicalTinyGoExecutableGraphProfile(profile),
		options.signal
	);
	if (actualFingerprint !== profile.fingerprint) {
		throw configurationError('TinyGo executable graph fingerprint does not match its receipts');
	}
	const totalBytes = Object.values(profile.modules).reduce(
		(total, module) => total + module.bytes,
		0
	);
	if (!Number.isSafeInteger(totalBytes)) {
		throw configurationError('TinyGo executable graph aggregate size is unsafe');
	}
	const limits: Partial<ExecutionLimits> = {};
	if (options.maxAssetBytes !== undefined) limits.maxAssetBytes = options.maxAssetBytes;
	if (options.assetTimeoutMs !== undefined) limits.assetTimeoutMs = options.assetTimeoutMs;
	const preflight = await preflightRuntimeAssets({
		manifest: createPreflightManifest(profile, urls.keysByPath),
		runtimeId: 'tinygo/executable-graph',
		rootUrl: urls.baseUrl,
		assetUrls: urls.assetUrls,
		...(options.fetch ? { fetch: options.fetch } : {}),
		...(options.signal ? { signal: options.signal } : {}),
		limits,
		cache: 'no-store',
		redirect: 'error',
		requireExactResponseUrl: true,
		maxConcurrentDownloads: Math.min(5, Object.keys(profile.modules).length),
		maxTotalDeliveryBytes: totalBytes,
		reportProgress: options.reportProgress
			? ({ assetKey, loadedBytes, totalBytes }) => {
					const path = Object.keys(urls.keysByPath).find(
						(candidate) => urls.keysByPath[candidate] === assetKey
					);
					if (path) options.reportProgress?.({ path, loadedBytes, totalBytes });
				}
			: undefined
	});

	const sources: Record<string, string> = {};
	for (const modulePath of Object.keys(profile.modules)) {
		try {
			sources[modulePath] = fatalDecoder.decode(
				preflight.assets[urls.keysByPath[modulePath]!]!.bytes
			);
		} catch (cause) {
			throw configurationError(
				`TinyGo executable module ${modulePath} is not valid UTF-8`,
				cause
			);
		}
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL?.createObjectURL !== 'function' ||
		typeof URL?.revokeObjectURL !== 'function'
	) {
		throw configurationError('TinyGo executable graph requires Blob module URLs');
	}

	const order: string[] = [];
	const visited = new Set<string>();
	const visit = (modulePath: string) => {
		if (visited.has(modulePath)) return;
		visited.add(modulePath);
		for (const graphImport of profile.modules[modulePath]!.imports) visit(graphImport.target);
		order.push(modulePath);
	};
	visit(profile.entryPath);
	const moduleUrls: Record<string, string> = {};
	const ownedUrls: string[] = [];
	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		for (const url of ownedUrls.reverse()) {
			try {
				URL.revokeObjectURL(url);
			} catch {
				// Blob cleanup must not replace the graph result.
			}
		}
	};
	try {
		for (const modulePath of order) {
			let source = sources[modulePath]!;
			for (const graphImport of profile.modules[modulePath]!.imports) {
				source = replaceUniqueSpecifier(
					source,
					graphImport.specifier,
					moduleUrls[graphImport.target]!,
					modulePath
				);
			}
			const blobUrl = URL.createObjectURL(
				new Blob([source], { type: 'text/javascript;charset=utf-8' })
			);
			if (!SAFE_BLOB_URL_PATTERN.test(blobUrl)) {
				try {
					URL.revokeObjectURL(blobUrl);
				} catch {}
				throw configurationError('TinyGo executable graph received an unsafe Blob URL');
			}
			moduleUrls[modulePath] = blobUrl;
			ownedUrls.push(blobUrl);
		}
		return Object.freeze({
			entryUrl: moduleUrls[profile.entryPath]!,
			assetBaseUrl: urls.baseUrl,
			moduleUrls: Object.freeze({ ...moduleUrls }),
			dispose
		});
	} catch (error) {
		dispose();
		throw error;
	}
}
