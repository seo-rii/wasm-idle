import { verifyRuntimeAssetIntegrity } from './asset-integrity.js';
import {
	AssetIntegrityError,
	AssetTooLargeError,
	CancelledError,
	ProtocolError,
	RuntimeConfigurationError,
	TimeoutError,
	UnsupportedBrowserFeatureError,
	isWasmIdleError
} from './errors.js';
import { resolveExecutionLimits, type ExecutionLimits } from './execution.js';
import { preflightRuntimeAssets, type RuntimeAssetPreflightProgress } from './runtime-preflight.js';
import type { RuntimeAssetIntegrityEntry } from './runtime-assets.js';
import type { RuntimeRegistryManifest } from './runtime-manifest.js';

export const PASCAL_PREFLIGHT_PROTOCOL = 'wasm-idle-pascal-preflight' as const;
export const PASCAL_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const PASCAL_PREFLIGHT_RUNTIME_ID = 'PASCAL' as const;
export const PASCAL_MAX_MANIFEST_BYTES = 64 * 1024;
export const PASCAL_MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const PASCAL_MAX_DELIVERY_BYTES = 8 * 1024 * 1024;
export const PASCAL_MAX_LOGICAL_BYTES = 16 * 1024 * 1024;

const MANIFEST_FORMAT = 'wasm-pascal-runtime-manifest-v2';
const FINGERPRINT_DOMAIN = 'wasm-idle:pascal-runtime-manifest:v2';
const EXPECTED_RUNTIME = 'pas2js';
const EXPECTED_LICENSE_EXPRESSION = 'LGPL-2.1-only WITH Independent-modules-exception';
const MANIFEST_PATH = 'runtime-manifest.v2.json';
const COMPILER_PATH = 'compiler.js';
const COMPILER_STORAGE_PATH = 'compiler.js.gz.bin';
const RTL_PATH = 'rtl.js';
const RTL_STORAGE_PATH = 'rtl.js.bin';
const SYSTEM_PATH = 'system.pas';
const SYSTEM_STORAGE_PATH = 'system.pas.bin';
const MANIFEST_KEYS = [
	'artifact',
	'assets',
	'build',
	'components',
	'fingerprint',
	'format',
	'license',
	'licenseExpression',
	'metadata',
	'profileId',
	'runtime',
	'storage'
] as const;
const PROFILE_KEYS = [
	'artifactRevision',
	'compilerJavaScriptReceipt',
	'manifestFingerprint',
	'manifestReceipt',
	'pas2jsRevision',
	'pas2jsVersion',
	'profileId',
	'rtlJavaScriptReceipt',
	'systemPascalReceipt'
] as const;
const PAYLOAD_KEYS = [
	'artifactRevision',
	'compilerJavaScriptBytes',
	'manifestBytes',
	'manifestFingerprint',
	'pas2jsRevision',
	'pas2jsVersion',
	'profileId',
	'protocol',
	'protocolVersion',
	'rtlJavaScriptBytes',
	'systemPascalBytes'
] as const;
const RECEIPT_KEYS = ['mediaType', 'path', 'sha256', 'size'] as const;
const STORAGE_RECEIPT_KEYS = ['encoding', 'logicalPath', 'path', 'sha256', 'size'] as const;
const LOGICAL_ASSETS = Object.freeze({
	[COMPILER_PATH]: 'text/javascript',
	[RTL_PATH]: 'text/javascript',
	[SYSTEM_PATH]: 'text/plain'
});
const STORAGE_ASSETS = Object.freeze({
	[COMPILER_STORAGE_PATH]: Object.freeze({
		logicalPath: COMPILER_PATH,
		encoding: 'gzip'
	}),
	[RTL_STORAGE_PATH]: Object.freeze({ logicalPath: RTL_PATH, encoding: 'identity' }),
	[SYSTEM_STORAGE_PATH]: Object.freeze({ logicalPath: SYSTEM_PATH, encoding: 'identity' })
} as const);
const EXPECTED_ARTIFACT = Object.freeze({
	kind: 'opaque-vendored',
	repository: 'https://github.com/seo-rii/wasm-idle.git',
	path: 'static/wasm-pascal',
	provenance: 'legacy-import',
	verifiedBuildInput: false
});
const EXPECTED_PAS2JS_REPOSITORY = 'https://gitlab.com/freepascal.org/fpc/pas2js.git';
const EXPECTED_PAS2JS_REVISION_KIND = 'recorded-abbreviated';
const EXPECTED_PAS2JS_EVIDENCE = 'runtime-build.json; full upstream commit was not recorded';
const EXPECTED_BUILD = Object.freeze({
	target: 'browser',
	compiler: 'native pas2js',
	entrypoint: 'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
	integrationSources: Object.freeze([
		'runtimes/wasm-pascal/src/system.pas',
		'runtimes/wasm-pascal/src/wasm_idle_pascal_compiler.pas',
		'runtimes/wasm-pascal/src/webfilecache.pp'
	]),
	transformations: Object.freeze([
		'strip trailing horizontal whitespace and normalize final newline',
		'gzip compiler.js with Node zlib level 9'
	]),
	verifiedBuildInput: false
});
const EXPECTED_LICENSE = Object.freeze({
	spdx: EXPECTED_LICENSE_EXPRESSION,
	sourceUrl: 'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/COPYING.txt',
	exceptionSourceUrl: 'https://gitlab.com/freepascal.org/fpc/pas2js/-/raw/release_3_2_0/LICENSE',
	verifiedBuildInput: false,
	evidence: 'upstream license URLs recorded; texts were not vendored with the legacy generation'
});
const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

export interface PascalRuntimePreflightProfile {
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly pas2jsVersion: string;
	readonly pas2jsRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestReceipt: RuntimeAssetIntegrityEntry;
	readonly compilerJavaScriptReceipt: RuntimeAssetIntegrityEntry;
	readonly rtlJavaScriptReceipt: RuntimeAssetIntegrityEntry;
	readonly systemPascalReceipt: RuntimeAssetIntegrityEntry;
}

export interface PascalRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly compilerJavaScriptUrl?: string;
	readonly rtlJavaScriptUrl?: string;
	readonly systemPascalUrl?: string;
	readonly profile: PascalRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (loadedBytes: number, totalBytes: number) => void;
}

export interface PascalRuntimePreflightPayload {
	readonly protocol: typeof PASCAL_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof PASCAL_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly pas2jsVersion: string;
	readonly pas2jsRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly compilerJavaScriptBytes: Uint8Array;
	readonly rtlJavaScriptBytes: Uint8Array;
	readonly systemPascalBytes: Uint8Array;
}

type PascalRuntimePreflightIdentity = Pick<
	PascalRuntimePreflightPayload,
	'profileId' | 'artifactRevision' | 'pas2jsVersion' | 'pas2jsRevision' | 'manifestFingerprint'
>;
type UnknownRecord = Record<string, unknown>;
type LogicalAssetPath = keyof typeof LOGICAL_ASSETS;
type StorageAssetPath = keyof typeof STORAGE_ASSETS;

interface ManifestReceipt {
	readonly path: LogicalAssetPath;
	readonly mediaType: string;
	readonly size: number;
	readonly sha256: string;
}

interface ManifestStorageReceipt {
	readonly path: StorageAssetPath;
	readonly logicalPath: LogicalAssetPath;
	readonly encoding: 'gzip' | 'identity';
	readonly size: number;
	readonly sha256: string;
}

interface ParsedPascalManifest {
	readonly assetByPath: ReadonlyMap<LogicalAssetPath, ManifestReceipt>;
	readonly storageByPath: ReadonlyMap<StorageAssetPath, ManifestStorageReceipt>;
}

function isPlainRecord(value: unknown): value is UnknownRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length && actual.every((key, index) => key === expected[index])
	);
}

function isByteArray(value: unknown): value is Uint8Array {
	return (
		ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]'
	);
}

function isVersion(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(value);
}

function isArtifactRevision(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}

function isPas2jsRevision(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{12}$/u.test(value);
}

function expectedProfileId(version: string, artifactRevision: string): string {
	return `pascal-pas2js-${version}-legacy-${artifactRevision.slice(0, 8)}`;
}

function snapshotReceipt(
	value: unknown,
	label: string,
	requireLogical: boolean,
	maxBytes: number,
	profileId?: string
): Readonly<RuntimeAssetIntegrityEntry> {
	if (!isPlainRecord(value)) {
		throw new RuntimeConfigurationError(`Pascal runtime ${label} receipt is missing`, {
			phase: 'asset',
			profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	const keys = requireLogical
		? ['bytes', 'sha256', 'uncompressedBytes', 'uncompressedSha256']
		: ['bytes', 'sha256'];
	if (
		!hasExactKeys(value, keys) ||
		!Number.isSafeInteger(value.bytes) ||
		(value.bytes as number) <= 0 ||
		(value.bytes as number) > maxBytes ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256) ||
		(requireLogical &&
			(!Number.isSafeInteger(value.uncompressedBytes) ||
				(value.uncompressedBytes as number) <= 0 ||
				(value.uncompressedBytes as number) > maxBytes ||
				typeof value.uncompressedSha256 !== 'string' ||
				!/^[a-f0-9]{64}$/u.test(value.uncompressedSha256)))
	) {
		throw new RuntimeConfigurationError(`Pascal runtime ${label} receipt is invalid`, {
			phase: 'asset',
			profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	return Object.freeze({
		bytes: value.bytes as number,
		sha256: value.sha256,
		...(requireLogical
			? {
					uncompressedBytes: value.uncompressedBytes as number,
					uncompressedSha256: value.uncompressedSha256 as string
				}
			: {})
	});
}

export function snapshotPascalRuntimePreflightProfile(
	value: unknown
): Readonly<Required<PascalRuntimePreflightProfile>> {
	if (!isPlainRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) {
		throw new RuntimeConfigurationError('Pascal runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!isArtifactRevision(value.artifactRevision) ||
		!isVersion(value.pas2jsVersion) ||
		!isPas2jsRevision(value.pas2jsRevision) ||
		value.profileId !== expectedProfileId(value.pas2jsVersion, value.artifactRevision) ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('Pascal runtime preflight identity is invalid', {
			phase: 'asset',
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	const profileId = value.profileId as string;
	const snapshot = Object.freeze({
		profileId,
		artifactRevision: value.artifactRevision as string,
		pas2jsVersion: value.pas2jsVersion as string,
		pas2jsRevision: value.pas2jsRevision as string,
		manifestFingerprint: value.manifestFingerprint as string,
		manifestReceipt: snapshotReceipt(
			value.manifestReceipt,
			'manifest',
			false,
			PASCAL_MAX_MANIFEST_BYTES,
			profileId
		),
		compilerJavaScriptReceipt: snapshotReceipt(
			value.compilerJavaScriptReceipt,
			'compiler JavaScript',
			true,
			PASCAL_MAX_ASSET_BYTES,
			profileId
		),
		rtlJavaScriptReceipt: snapshotReceipt(
			value.rtlJavaScriptReceipt,
			'RTL JavaScript',
			false,
			PASCAL_MAX_ASSET_BYTES,
			profileId
		),
		systemPascalReceipt: snapshotReceipt(
			value.systemPascalReceipt,
			'system Pascal',
			false,
			PASCAL_MAX_ASSET_BYTES,
			profileId
		)
	});
	const deliveryTotal =
		snapshot.manifestReceipt.bytes! +
		snapshot.compilerJavaScriptReceipt.bytes! +
		snapshot.rtlJavaScriptReceipt.bytes! +
		snapshot.systemPascalReceipt.bytes!;
	const logicalTotal =
		snapshot.compilerJavaScriptReceipt.uncompressedBytes! +
		snapshot.rtlJavaScriptReceipt.bytes! +
		snapshot.systemPascalReceipt.bytes!;
	if (deliveryTotal > PASCAL_MAX_DELIVERY_BYTES || logicalTotal > PASCAL_MAX_LOGICAL_BYTES) {
		throw new RuntimeConfigurationError(
			'Pascal runtime profile exceeds its aggregate byte budget',
			{ phase: 'asset', profileId, runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID }
		);
	}
	return snapshot;
}

export function requirePascalRuntimePreflightPayload(
	value: unknown
): PascalRuntimePreflightPayload {
	if (!isPlainRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
		throw new ProtocolError('Pascal runtime preflight payload has an invalid shape', {
			phase: 'protocol',
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.protocol !== PASCAL_PREFLIGHT_PROTOCOL ||
		value.protocolVersion !== PASCAL_PREFLIGHT_PROTOCOL_VERSION ||
		!isArtifactRevision(value.artifactRevision) ||
		!isVersion(value.pas2jsVersion) ||
		!isPas2jsRevision(value.pas2jsRevision) ||
		value.profileId !== expectedProfileId(value.pas2jsVersion, value.artifactRevision) ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint) ||
		!isByteArray(value.manifestBytes) ||
		!isByteArray(value.compilerJavaScriptBytes) ||
		!isByteArray(value.rtlJavaScriptBytes) ||
		!isByteArray(value.systemPascalBytes)
	) {
		throw new ProtocolError('Pascal runtime preflight payload is invalid', {
			phase: 'protocol',
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	return value as unknown as PascalRuntimePreflightPayload;
}

export function clonePascalRuntimePreflightPayload(value: unknown): PascalRuntimePreflightPayload {
	const payload = requirePascalRuntimePreflightPayload(value);
	return Object.freeze({
		protocol: payload.protocol,
		protocolVersion: payload.protocolVersion,
		profileId: payload.profileId,
		artifactRevision: payload.artifactRevision,
		pas2jsVersion: payload.pas2jsVersion,
		pas2jsRevision: payload.pas2jsRevision,
		manifestFingerprint: payload.manifestFingerprint,
		manifestBytes: Uint8Array.from(payload.manifestBytes),
		compilerJavaScriptBytes: Uint8Array.from(payload.compilerJavaScriptBytes),
		rtlJavaScriptBytes: Uint8Array.from(payload.rtlJavaScriptBytes),
		systemPascalBytes: Uint8Array.from(payload.systemPascalBytes)
	});
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (isPlainRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;
	}
	const primitive = JSON.stringify(value);
	if (primitive === undefined) {
		throw new AssetIntegrityError('Pascal runtime manifest contains a non-JSON value', {
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	return primitive;
}

async function waitForAbortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return operation;
	if (signal.aborted) throw signal.reason;
	return await new Promise<T>((resolve, reject) => {
		let settled = false;
		const onAbort = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', onAbort);
			reject(signal.reason);
		};
		signal.addEventListener('abort', onAbort, { once: true });
		operation.then(
			(value) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', onAbort);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', onAbort);
				reject(error);
			}
		);
	});
}

async function sha256Hex(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
	if (!globalThis.crypto?.subtle) {
		throw new AssetIntegrityError('Pascal runtime integrity verification requires Web Crypto', {
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	const input =
		bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength &&
		bytes.buffer instanceof ArrayBuffer
			? bytes.buffer
			: Uint8Array.from(bytes).buffer;
	const digest = new Uint8Array(
		await waitForAbortable(globalThis.crypto.subtle.digest('SHA-256', input), signal)
	);
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireExactRecord(
	value: unknown,
	keys: readonly string[],
	label: string,
	profileId: string
): UnknownRecord {
	if (!isPlainRecord(value) || !hasExactKeys(value, keys)) {
		throw new AssetIntegrityError(`Pascal runtime manifest ${label} is invalid`, {
			profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	return value;
}

function exactJsonValue(actual: unknown, expected: unknown): boolean {
	return canonicalJson(actual) === canonicalJson(expected);
}

function validateManifestIdentityGraph(
	manifest: UnknownRecord,
	profile: PascalRuntimePreflightIdentity
): void {
	const artifact = requireExactRecord(
		manifest.artifact,
		['kind', 'path', 'provenance', 'repository', 'revision', 'verifiedBuildInput'],
		'artifact',
		profile.profileId
	);
	if (
		artifact.revision !== profile.artifactRevision ||
		artifact.kind !== EXPECTED_ARTIFACT.kind ||
		artifact.repository !== EXPECTED_ARTIFACT.repository ||
		artifact.path !== EXPECTED_ARTIFACT.path ||
		artifact.provenance !== EXPECTED_ARTIFACT.provenance ||
		artifact.verifiedBuildInput !== EXPECTED_ARTIFACT.verifiedBuildInput
	) {
		throw new AssetIntegrityError('Pascal runtime artifact identity is invalid', {
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	const components = requireExactRecord(
		manifest.components,
		['pas2js'],
		'components',
		profile.profileId
	);
	const pas2js = requireExactRecord(
		components.pas2js,
		['evidence', 'repository', 'revision', 'revisionKind', 'verifiedBuildInput', 'version'],
		'pas2js component',
		profile.profileId
	);
	if (
		pas2js.version !== profile.pas2jsVersion ||
		pas2js.revision !== profile.pas2jsRevision ||
		pas2js.repository !== EXPECTED_PAS2JS_REPOSITORY ||
		pas2js.revisionKind !== EXPECTED_PAS2JS_REVISION_KIND ||
		pas2js.verifiedBuildInput !== false ||
		pas2js.evidence !== EXPECTED_PAS2JS_EVIDENCE
	) {
		throw new AssetIntegrityError('Pascal runtime pas2js component identity is invalid', {
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	const build = requireExactRecord(
		manifest.build,
		[
			'compiler',
			'entrypoint',
			'integrationSources',
			'target',
			'transformations',
			'verifiedBuildInput'
		],
		'build',
		profile.profileId
	);
	if (!exactJsonValue(build, EXPECTED_BUILD)) {
		throw new AssetIntegrityError('Pascal runtime build identity is invalid', {
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	const license = requireExactRecord(
		manifest.license,
		['evidence', 'exceptionSourceUrl', 'sourceUrl', 'spdx', 'verifiedBuildInput'],
		'license',
		profile.profileId
	);
	if (!exactJsonValue(license, EXPECTED_LICENSE)) {
		throw new AssetIntegrityError('Pascal runtime license identity is invalid', {
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
}

function normalizeManifestReceipt(
	value: unknown,
	path: LogicalAssetPath,
	profileId: string
): ManifestReceipt {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, RECEIPT_KEYS) ||
		value.path !== path ||
		value.mediaType !== LOGICAL_ASSETS[path] ||
		!Number.isSafeInteger(value.size) ||
		(value.size as number) <= 0 ||
		(value.size as number) > PASCAL_MAX_ASSET_BYTES ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new AssetIntegrityError(`Pascal runtime manifest receipt ${path} is invalid`, {
			profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	return {
		path,
		mediaType: LOGICAL_ASSETS[path],
		size: value.size as number,
		sha256: value.sha256
	};
}

function normalizeStorageReceipt(
	value: unknown,
	path: StorageAssetPath,
	profileId: string
): ManifestStorageReceipt {
	const expected = STORAGE_ASSETS[path];
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, STORAGE_RECEIPT_KEYS) ||
		value.path !== path ||
		value.logicalPath !== expected.logicalPath ||
		value.encoding !== expected.encoding ||
		!Number.isSafeInteger(value.size) ||
		(value.size as number) <= 0 ||
		(value.size as number) > PASCAL_MAX_ASSET_BYTES ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new AssetIntegrityError(`Pascal runtime storage receipt ${path} is invalid`, {
			profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	return {
		path,
		logicalPath: expected.logicalPath,
		encoding: expected.encoding,
		size: value.size as number,
		sha256: value.sha256
	};
}

function comparePath(left: { path: string }, right: { path: string }): number {
	return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

async function computeManifestFingerprint(
	manifest: UnknownRecord,
	assets: readonly ManifestReceipt[],
	storage: readonly ManifestStorageReceipt[],
	signal?: AbortSignal
): Promise<string> {
	const metadata = manifest.metadata as UnknownRecord;
	let canonical =
		`${FINGERPRINT_DOMAIN}\n` +
		`format\0${MANIFEST_FORMAT}\n` +
		`runtime\0${EXPECTED_RUNTIME}\n` +
		`profileId\0${String(manifest.profileId)}\n` +
		`licenseExpression\0${EXPECTED_LICENSE_EXPRESSION}\n`;
	canonical += `artifact\0${canonicalJson(manifest.artifact)}\n`;
	canonical += `components\0${canonicalJson(manifest.components)}\n`;
	canonical += `build\0${canonicalJson(manifest.build)}\n`;
	canonical += `license\0${canonicalJson(manifest.license)}\n`;
	canonical += `metadata\0${String(metadata.path)}\0${String(metadata.mediaType)}\0${String(metadata.size)}\0${String(metadata.sha256)}\n`;
	for (const asset of [...assets].sort(comparePath)) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...storage].sort(comparePath)) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return await sha256Hex(textEncoder.encode(canonical), signal);
}

async function parseAndVerifyManifest(
	bytes: Uint8Array,
	profile: PascalRuntimePreflightIdentity,
	signal?: AbortSignal
): Promise<ParsedPascalManifest> {
	let value: unknown;
	try {
		value = JSON.parse(fatalDecoder.decode(bytes));
	} catch (error) {
		throw new AssetIntegrityError('Pascal runtime manifest is not valid UTF-8 JSON', {
			cause: error,
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!isPlainRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
		throw new AssetIntegrityError('Pascal runtime manifest schema is invalid', {
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.format !== MANIFEST_FORMAT ||
		value.runtime !== EXPECTED_RUNTIME ||
		value.profileId !== profile.profileId ||
		value.fingerprint !== profile.manifestFingerprint ||
		value.licenseExpression !== EXPECTED_LICENSE_EXPRESSION
	) {
		throw new AssetIntegrityError('Pascal runtime manifest identity is invalid', {
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	validateManifestIdentityGraph(value, profile);
	const metadata = requireExactRecord(
		value.metadata,
		['mediaType', 'path', 'sha256', 'size'],
		'metadata receipt',
		profile.profileId
	);
	if (
		metadata.path !== 'runtime-build.json' ||
		metadata.mediaType !== 'application/json' ||
		!Number.isSafeInteger(metadata.size) ||
		(metadata.size as number) <= 0 ||
		typeof metadata.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(metadata.sha256)
	) {
		throw new AssetIntegrityError('Pascal runtime metadata receipt is invalid', {
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!Array.isArray(value.assets) || value.assets.length !== 3) {
		throw new AssetIntegrityError('Pascal runtime manifest must declare three logical assets', {
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 3) {
		throw new AssetIntegrityError('Pascal runtime manifest must declare three storage assets', {
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	const assetByPath = new Map<LogicalAssetPath, ManifestReceipt>();
	for (const candidate of value.assets) {
		const path = isPlainRecord(candidate) ? candidate.path : undefined;
		if (
			typeof path !== 'string' ||
			!Object.prototype.hasOwnProperty.call(LOGICAL_ASSETS, path) ||
			assetByPath.has(path as LogicalAssetPath)
		) {
			throw new AssetIntegrityError(
				'Pascal runtime manifest has an unexpected logical asset',
				{
					profileId: profile.profileId,
					runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		assetByPath.set(
			path as LogicalAssetPath,
			normalizeManifestReceipt(candidate, path as LogicalAssetPath, profile.profileId)
		);
	}
	const storageByPath = new Map<StorageAssetPath, ManifestStorageReceipt>();
	for (const candidate of value.storage) {
		const path = isPlainRecord(candidate) ? candidate.path : undefined;
		if (
			typeof path !== 'string' ||
			!Object.prototype.hasOwnProperty.call(STORAGE_ASSETS, path) ||
			storageByPath.has(path as StorageAssetPath)
		) {
			throw new AssetIntegrityError(
				'Pascal runtime manifest has an unexpected storage asset',
				{
					profileId: profile.profileId,
					runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		storageByPath.set(
			path as StorageAssetPath,
			normalizeStorageReceipt(candidate, path as StorageAssetPath, profile.profileId)
		);
	}
	if (
		Object.keys(LOGICAL_ASSETS).some((path) => !assetByPath.has(path as LogicalAssetPath)) ||
		Object.keys(STORAGE_ASSETS).some((path) => !storageByPath.has(path as StorageAssetPath))
	) {
		throw new AssetIntegrityError('Pascal runtime manifest omits a required asset receipt', {
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	const fingerprint = await computeManifestFingerprint(
		value,
		[...assetByPath.values()],
		[...storageByPath.values()],
		signal
	);
	if (fingerprint !== profile.manifestFingerprint) {
		throw new AssetIntegrityError(
			'Pascal runtime receipt graph failed fingerprint verification',
			{ profileId: profile.profileId, runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID }
		);
	}
	return { assetByPath, storageByPath };
}

function profileReceiptForLogicalPath(
	profile: Readonly<Required<PascalRuntimePreflightProfile>>,
	path: LogicalAssetPath
): Readonly<RuntimeAssetIntegrityEntry> {
	return path === COMPILER_PATH
		? profile.compilerJavaScriptReceipt
		: path === RTL_PATH
			? profile.rtlJavaScriptReceipt
			: profile.systemPascalReceipt;
}

function assertManifestMatchesProfile(
	manifest: ParsedPascalManifest,
	profile: Readonly<Required<PascalRuntimePreflightProfile>>
): void {
	for (const [storagePath, expected] of Object.entries(STORAGE_ASSETS) as Array<
		[StorageAssetPath, (typeof STORAGE_ASSETS)[StorageAssetPath]]
	>) {
		const storage = manifest.storageByPath.get(storagePath)!;
		const logical = manifest.assetByPath.get(expected.logicalPath)!;
		const receipt = profileReceiptForLogicalPath(profile, expected.logicalPath);
		if (
			storage.size !== receipt.bytes ||
			storage.sha256 !== receipt.sha256 ||
			logical.size !== (receipt.uncompressedBytes ?? receipt.bytes) ||
			logical.sha256 !== (receipt.uncompressedSha256 ?? receipt.sha256)
		) {
			throw new AssetIntegrityError(
				`Pascal runtime profile receipt mismatch for ${storagePath}`,
				{ profileId: profile.profileId, runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID }
			);
		}
	}
}

async function verifyLogicalBytes(
	manifest: ParsedPascalManifest,
	path: LogicalAssetPath,
	bytes: Uint8Array,
	profileId: string,
	signal?: AbortSignal
): Promise<void> {
	const receipt = manifest.assetByPath.get(path)!;
	await waitForAbortable(
		verifyRuntimeAssetIntegrity({
			asset: path,
			bytes,
			expected: {
				bytes: receipt.size,
				sha256: receipt.sha256,
				uncompressedBytes: receipt.size,
				uncompressedSha256: receipt.sha256
			},
			stage: 'uncompressed',
			profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		}),
		signal
	);
}

export async function verifyPascalRuntimePreflightPayload(
	value: unknown,
	options: { readonly maxAssetBytes?: number; readonly signal?: AbortSignal } = {}
): Promise<PascalRuntimePreflightPayload> {
	const payload = requirePascalRuntimePreflightPayload(value);
	const maxAssetBytes = Math.min(
		options.maxAssetBytes ?? PASCAL_MAX_ASSET_BYTES,
		PASCAL_MAX_ASSET_BYTES
	);
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new RuntimeConfigurationError('Pascal runtime asset byte limit is invalid', {
			phase: 'asset',
			profileId: payload.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const [label, bytes, limit] of [
		['manifest', payload.manifestBytes, Math.min(maxAssetBytes, PASCAL_MAX_MANIFEST_BYTES)],
		['compiler JavaScript', payload.compilerJavaScriptBytes, maxAssetBytes],
		['RTL JavaScript', payload.rtlJavaScriptBytes, maxAssetBytes],
		['system Pascal', payload.systemPascalBytes, maxAssetBytes]
	] as const) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new AssetTooLargeError(
				`Pascal runtime ${label} exceeds the ${limit} byte limit`,
				{
					actual: bytes.byteLength,
					limit,
					phase: 'asset',
					profileId: payload.profileId,
					runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}
	const logicalTotal =
		payload.compilerJavaScriptBytes.byteLength +
		payload.rtlJavaScriptBytes.byteLength +
		payload.systemPascalBytes.byteLength;
	if (!Number.isSafeInteger(logicalTotal) || logicalTotal > PASCAL_MAX_LOGICAL_BYTES) {
		throw new AssetTooLargeError(
			`Pascal runtime logical payload exceeds the ${PASCAL_MAX_LOGICAL_BYTES} byte aggregate limit`,
			{
				actual: logicalTotal,
				limit: PASCAL_MAX_LOGICAL_BYTES,
				phase: 'asset',
				profileId: payload.profileId,
				runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const manifest = await parseAndVerifyManifest(payload.manifestBytes, payload, options.signal);
	await verifyLogicalBytes(
		manifest,
		COMPILER_PATH,
		payload.compilerJavaScriptBytes,
		payload.profileId,
		options.signal
	);
	await verifyLogicalBytes(
		manifest,
		RTL_PATH,
		payload.rtlJavaScriptBytes,
		payload.profileId,
		options.signal
	);
	await verifyLogicalBytes(
		manifest,
		SYSTEM_PATH,
		payload.systemPascalBytes,
		payload.profileId,
		options.signal
	);
	for (const [label, bytes] of [
		['compiler JavaScript', payload.compilerJavaScriptBytes],
		['RTL JavaScript', payload.rtlJavaScriptBytes],
		['system Pascal', payload.systemPascalBytes]
	] as const) {
		try {
			fatalDecoder.decode(bytes);
		} catch (error) {
			throw new AssetIntegrityError(`Pascal runtime ${label} is not valid UTF-8`, {
				cause: error,
				profileId: payload.profileId,
				runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	return payload;
}

async function decompressGzipBounded(
	compressedBytes: Uint8Array,
	expectedBytes: number,
	maxAssetBytes: number,
	signal: AbortSignal,
	reportProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			phase: 'asset',
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!Number.isSafeInteger(expectedBytes) ||
		expectedBytes <= 0 ||
		expectedBytes > maxAssetBytes
	) {
		throw new AssetTooLargeError(
			`Pascal runtime compiler logical bytes exceed the ${maxAssetBytes} byte limit`,
			{
				actual: expectedBytes,
				limit: maxAssetBytes,
				phase: 'asset',
				runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const body = new Response(Uint8Array.from(compressedBytes)).body;
	if (!body) {
		throw new UnsupportedBrowserFeatureError('ReadableStream response bodies', {
			phase: 'asset',
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	const reader = body.pipeThrough(new DecompressionStream('gzip')).getReader();
	const output = new Uint8Array(expectedBytes);
	let offset = 0;
	const cancelOnAbort = () => {
		try {
			void reader.cancel(signal.reason).catch(() => undefined);
		} catch {
			// Preserve the cancellation reason.
		}
	};
	signal.addEventListener('abort', cancelOnAbort, { once: true });
	try {
		for (;;) {
			if (signal.aborted) throw signal.reason;
			const { done, value } = await waitForAbortable(reader.read(), signal);
			if (done) break;
			if (!value) continue;
			if (offset + value.byteLength > output.byteLength) {
				throw new AssetIntegrityError(
					'Pascal runtime compiler gzip output exceeds its logical receipt',
					{ runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID }
				);
			}
			output.set(value, offset);
			offset += value.byteLength;
			reportProgress?.(offset, output.byteLength);
		}
	} catch (error) {
		try {
			await reader.cancel(error);
		} catch {
			// Preserve the decompression failure.
		}
		if (signal.aborted || isWasmIdleError(error)) throw error;
		throw new AssetIntegrityError('Pascal runtime compiler gzip decompression failed', {
			cause: error,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	} finally {
		signal.removeEventListener('abort', cancelOnAbort);
		try {
			reader.releaseLock();
		} catch {
			// Cancellation may already have detached the reader.
		}
	}
	if (offset !== output.byteLength) {
		throw new AssetIntegrityError('Pascal runtime compiler gzip output is truncated', {
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	return output;
}

function resolvePinnedAssetUrl(
	configured: string | undefined,
	baseUrl: URL,
	path: string,
	sha256: string,
	profileId: string
): URL {
	let url: URL;
	try {
		url = configured ? new URL(configured, baseUrl) : new URL(path, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError(`Pascal runtime ${path} URL is invalid`, {
			cause: error,
			phase: 'asset',
			profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	const expected = new URL(path, baseUrl);
	if (
		(url.protocol !== 'http:' && url.protocol !== 'https:') ||
		url.username ||
		url.password ||
		url.hash ||
		url.origin !== expected.origin ||
		url.pathname !== expected.pathname ||
		(url.search && url.search !== `?v=${sha256}`)
	) {
		throw new RuntimeConfigurationError(
			`Pascal runtime ${path} URL must match its query-pinned canonical storage path`,
			{ phase: 'asset', profileId, runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (!url.search) url.searchParams.set('v', sha256);
	return url;
}

export async function preflightPascalRuntimeAssets(
	request: PascalRuntimePreflightRequest
): Promise<PascalRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('Pascal runtime preflight request is required', {
			phase: 'asset',
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	const profile = snapshotPascalRuntimePreflightProfile(request.profile);
	let baseUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
	} catch (error) {
		throw new RuntimeConfigurationError('Pascal runtime asset base URL is invalid', {
			cause: error,
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		(baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') ||
		baseUrl.username ||
		baseUrl.password ||
		baseUrl.search ||
		baseUrl.hash
	) {
		throw new RuntimeConfigurationError(
			'Pascal runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID }
		);
	}
	const manifestUrl = resolvePinnedAssetUrl(
		request.manifestUrl,
		baseUrl,
		MANIFEST_PATH,
		profile.manifestFingerprint,
		profile.profileId
	);
	const compilerJavaScriptUrl = resolvePinnedAssetUrl(
		request.compilerJavaScriptUrl,
		baseUrl,
		COMPILER_STORAGE_PATH,
		profile.compilerJavaScriptReceipt.sha256,
		profile.profileId
	);
	const rtlJavaScriptUrl = resolvePinnedAssetUrl(
		request.rtlJavaScriptUrl,
		baseUrl,
		RTL_STORAGE_PATH,
		profile.rtlJavaScriptReceipt.sha256,
		profile.profileId
	);
	const systemPascalUrl = resolvePinnedAssetUrl(
		request.systemPascalUrl,
		baseUrl,
		SYSTEM_STORAGE_PATH,
		profile.systemPascalReceipt.sha256,
		profile.profileId
	);
	const limits = resolveExecutionLimits(request.limits);
	const maxAssetBytes = Math.min(limits.maxAssetBytes, PASCAL_MAX_ASSET_BYTES);
	if (profile.manifestReceipt.bytes! > Math.min(PASCAL_MAX_MANIFEST_BYTES, maxAssetBytes)) {
		throw new AssetTooLargeError(
			`Pascal runtime manifest exceeds the ${Math.min(PASCAL_MAX_MANIFEST_BYTES, maxAssetBytes)} byte limit`,
			{
				actual: profile.manifestReceipt.bytes,
				limit: Math.min(PASCAL_MAX_MANIFEST_BYTES, maxAssetBytes),
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/pascal-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'PASCAL',
					implementationId: 'pas2js',
					implementationVersion: profile.pas2jsVersion,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: profile.manifestReceipt.sha256,
						protocolVersion: PASCAL_PREFLIGHT_PROTOCOL_VERSION,
						trustProfileId: 'wasm-idle-pascal-preflight-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: {
					stdin: 'streaming',
					workspace: false,
					abort: true,
					artifacts: false,
					streamingOutput: true
				},
				workerLifetime: { mode: 'per-run' },
				requiredBrowserFeatures: ['decompression-stream'],
				assetRoot: '.',
				assets: [
					{
						key: 'manifest',
						path: MANIFEST_PATH,
						compressedSha256: profile.manifestReceipt.sha256,
						uncompressedSha256: profile.manifestReceipt.sha256,
						compressedBytes: profile.manifestReceipt.bytes!,
						uncompressedBytes: profile.manifestReceipt.bytes!,
						mediaType: 'application/json',
						encoding: 'identity'
					},
					{
						key: 'compilerJavaScript',
						path: COMPILER_STORAGE_PATH,
						compressedSha256: profile.compilerJavaScriptReceipt.sha256,
						uncompressedSha256: profile.compilerJavaScriptReceipt.uncompressedSha256!,
						compressedBytes: profile.compilerJavaScriptReceipt.bytes!,
						uncompressedBytes: profile.compilerJavaScriptReceipt.uncompressedBytes!,
						mediaType: 'application/octet-stream',
						encoding: 'gzip'
					},
					{
						key: 'rtlJavaScript',
						path: RTL_STORAGE_PATH,
						compressedSha256: profile.rtlJavaScriptReceipt.sha256,
						uncompressedSha256: profile.rtlJavaScriptReceipt.sha256,
						compressedBytes: profile.rtlJavaScriptReceipt.bytes!,
						uncompressedBytes: profile.rtlJavaScriptReceipt.bytes!,
						mediaType: 'application/octet-stream',
						encoding: 'identity'
					},
					{
						key: 'systemPascal',
						path: SYSTEM_STORAGE_PATH,
						compressedSha256: profile.systemPascalReceipt.sha256,
						uncompressedSha256: profile.systemPascalReceipt.sha256,
						compressedBytes: profile.systemPascalReceipt.bytes!,
						uncompressedBytes: profile.systemPascalReceipt.bytes!,
						mediaType: 'application/octet-stream',
						encoding: 'identity'
					}
				],
				contracts: {
					routeId: 'pascal',
					runtimeAssetKey: 'pascal',
					documentationId: 'PASCAL',
					syncTarget: 'sync:wasm-pascal',
					browserTestId: 'browser:pascal'
				}
			}
		]
	};
	const controller = new AbortController();
	let timedOut = false;
	const abortFromCaller = () => controller.abort(request.signal?.reason);
	request.signal?.addEventListener('abort', abortFromCaller, { once: true });
	if (request.signal?.aborted) abortFromCaller();
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort(new DOMException('Pascal runtime preflight timed out', 'TimeoutError'));
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID,
			rootUrl: baseUrl,
			assetUrls: {
				manifest: manifestUrl,
				compilerJavaScript: compilerJavaScriptUrl,
				rtlJavaScript: rtlJavaScriptUrl,
				systemPascal: systemPascalUrl
			},
			fetch: request.fetch,
			signal: controller.signal,
			limits: { ...limits, maxAssetBytes },
			redirect: 'error',
			maxConcurrentDownloads: 4,
			maxTotalDeliveryBytes: PASCAL_MAX_DELIVERY_BYTES,
			reportProgress: request.reportProgress
		});
		const manifestAsset = preflight.assets.manifest;
		const compilerAsset = preflight.assets.compilerJavaScript;
		const rtlAsset = preflight.assets.rtlJavaScript;
		const systemAsset = preflight.assets.systemPascal;
		if (!manifestAsset || !compilerAsset || !rtlAsset || !systemAsset) {
			throw new RuntimeConfigurationError(
				'Pascal runtime preflight returned an incomplete asset set',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		if (compilerAsset.contentEncoding) {
			throw new AssetIntegrityError(
				`Pascal runtime asset ${compilerAsset.path} must not use HTTP Content-Encoding`,
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		const manifest = await parseAndVerifyManifest(
			manifestAsset.bytes,
			profile,
			controller.signal
		);
		assertManifestMatchesProfile(manifest, profile);
		if (compilerAsset.bytes[0] !== 0x1f || compilerAsset.bytes[1] !== 0x8b) {
			throw new AssetIntegrityError('Pascal runtime compiler storage is not gzip data', {
				profileId: profile.profileId,
				runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
			});
		}
		const compilerJavaScriptBytes = await decompressGzipBounded(
			compilerAsset.bytes,
			profile.compilerJavaScriptReceipt.uncompressedBytes!,
			maxAssetBytes,
			controller.signal,
			request.reportDecompressionProgress
		);
		const payload: PascalRuntimePreflightPayload = Object.freeze({
			protocol: PASCAL_PREFLIGHT_PROTOCOL,
			protocolVersion: PASCAL_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			artifactRevision: profile.artifactRevision,
			pas2jsVersion: profile.pas2jsVersion,
			pas2jsRevision: profile.pas2jsRevision,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			compilerJavaScriptBytes,
			rtlJavaScriptBytes: Uint8Array.from(rtlAsset.bytes),
			systemPascalBytes: Uint8Array.from(systemAsset.bytes)
		});
		return await verifyPascalRuntimePreflightPayload(payload, {
			maxAssetBytes,
			signal: controller.signal
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`Pascal runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('Pascal runtime preflight cancelled', {
				cause: request.signal.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: PASCAL_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
