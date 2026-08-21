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

export const BASH_PREFLIGHT_PROTOCOL = 'wasm-idle-bash-preflight' as const;
export const BASH_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const BASH_PREFLIGHT_RUNTIME_ID = 'BASH' as const;
export const BASH_MAX_MANIFEST_BYTES = 64 * 1024;
export const BASH_MAX_ASSET_BYTES = 8 * 1024 * 1024;
export const BASH_MAX_DELIVERY_BYTES = 8 * 1024 * 1024;
export const BASH_MAX_LOGICAL_BYTES = 16 * 1024 * 1024;

const MANIFEST_FORMAT = 'wasm-bash-runtime-manifest-v2';
const FINGERPRINT_DOMAIN = 'wasm-idle:bash-runtime-manifest:v2';
const EXPECTED_RUNTIME = 'wasmer-bash-wasix';
const EXPECTED_LICENSE_EXPRESSION = 'GPL-3.0-or-later AND MIT';
const SDK_JAVASCRIPT_PATH = 'sdk/index.mjs';
const SDK_JAVASCRIPT_STORAGE_PATH = 'sdk/index.mjs.bin';
const WASMER_WASM_PATH = 'sdk/wasmer_js_bg.wasm';
const WASMER_WASM_STORAGE_PATH = 'sdk/wasmer_js_bg.wasm.gz.bin';
const WEBC_PATH = 'bash.webc';
const WEBC_STORAGE_PATH = 'bash.webc.gz.bin';
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
const RECEIPT_KEYS = ['mediaType', 'path', 'sha256', 'size'] as const;
const STORAGE_RECEIPT_KEYS = ['encoding', 'logicalPath', 'path', 'sha256', 'size'] as const;
const LOGICAL_ASSETS = Object.freeze({
	[SDK_JAVASCRIPT_PATH]: 'text/javascript',
	[WASMER_WASM_PATH]: 'application/wasm',
	[WEBC_PATH]: 'application/octet-stream'
});
const STORAGE_ASSETS = Object.freeze({
	[SDK_JAVASCRIPT_STORAGE_PATH]: Object.freeze({
		logicalPath: SDK_JAVASCRIPT_PATH,
		encoding: 'identity'
	}),
	[WASMER_WASM_STORAGE_PATH]: Object.freeze({
		logicalPath: WASMER_WASM_PATH,
		encoding: 'gzip'
	}),
	[WEBC_STORAGE_PATH]: Object.freeze({ logicalPath: WEBC_PATH, encoding: 'gzip' })
} as const);
const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

const PROFILE_KEYS = [
	'bashPackageVersion',
	'bashSourceRevision',
	'manifestFingerprint',
	'manifestReceipt',
	'profileId',
	'sdkJavaScriptReceipt',
	'wasmerSdkPackageIntegrity',
	'wasmerSdkVersion',
	'wasmerWasmReceipt',
	'webcReceipt'
] as const;
const PAYLOAD_KEYS = [
	'bashPackageVersion',
	'bashSourceRevision',
	'manifestBytes',
	'manifestFingerprint',
	'profileId',
	'protocol',
	'protocolVersion',
	'sdkJavaScriptBytes',
	'wasmerSdkPackageIntegrity',
	'wasmerSdkVersion',
	'wasmerWasmBytes',
	'webcBytes'
] as const;

export interface BashRuntimePreflightProfile {
	readonly profileId: string;
	readonly bashPackageVersion: string;
	readonly bashSourceRevision: string;
	readonly wasmerSdkVersion: string;
	readonly wasmerSdkPackageIntegrity: string;
	readonly manifestFingerprint: string;
	readonly manifestReceipt: RuntimeAssetIntegrityEntry;
	readonly sdkJavaScriptReceipt: RuntimeAssetIntegrityEntry;
	readonly wasmerWasmReceipt: RuntimeAssetIntegrityEntry;
	readonly webcReceipt: RuntimeAssetIntegrityEntry;
}

export interface BashRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly sdkJavaScriptUrl?: string;
	readonly wasmerWasmUrl?: string;
	readonly webcUrl?: string;
	readonly profile: BashRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (
		asset: 'wasmer-wasm' | 'webc',
		loadedBytes: number,
		totalBytes: number
	) => void;
}

export interface BashRuntimePreflightPayload {
	readonly protocol: typeof BASH_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof BASH_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly bashPackageVersion: string;
	readonly bashSourceRevision: string;
	readonly wasmerSdkVersion: string;
	readonly wasmerSdkPackageIntegrity: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly sdkJavaScriptBytes: Uint8Array;
	readonly wasmerWasmBytes: Uint8Array;
	readonly webcBytes: Uint8Array;
}

type BashRuntimePreflightIdentity = Pick<
	BashRuntimePreflightPayload,
	| 'profileId'
	| 'bashPackageVersion'
	| 'bashSourceRevision'
	| 'wasmerSdkVersion'
	| 'wasmerSdkPackageIntegrity'
	| 'manifestFingerprint'
>;

type UnknownRecord = Record<string, unknown>;
type LogicalAssetPath = keyof typeof LOGICAL_ASSETS;
type StorageAssetPath = keyof typeof STORAGE_ASSETS;

interface ManifestReceipt {
	readonly path: string;
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

interface ParsedBashManifest {
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

function isRevision(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}

function expectedProfileId(
	bashPackageVersion: string,
	wasmerSdkVersion: string,
	bashSourceRevision: string
): string {
	return `bash-${bashPackageVersion}-wasmer-sdk-${wasmerSdkVersion}-${bashSourceRevision.slice(0, 8)}`;
}

function snapshotReceipt(
	value: unknown,
	label: string,
	requireLogical: boolean,
	maxBytes: number,
	profileId?: string
): Readonly<RuntimeAssetIntegrityEntry> {
	if (!isPlainRecord(value)) {
		throw new RuntimeConfigurationError(`Bash runtime ${label} receipt is missing`, {
			phase: 'asset',
			profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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
		throw new RuntimeConfigurationError(`Bash runtime ${label} receipt is invalid`, {
			phase: 'asset',
			profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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

export function snapshotBashRuntimePreflightProfile(
	value: unknown
): Readonly<Required<BashRuntimePreflightProfile>> {
	if (!isPlainRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) {
		throw new RuntimeConfigurationError('Bash runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!isVersion(value.bashPackageVersion) ||
		!isRevision(value.bashSourceRevision) ||
		!isVersion(value.wasmerSdkVersion) ||
		typeof value.wasmerSdkPackageIntegrity !== 'string' ||
		!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(value.wasmerSdkPackageIntegrity) ||
		value.profileId !==
			expectedProfileId(
				value.bashPackageVersion,
				value.wasmerSdkVersion,
				value.bashSourceRevision
			) ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('Bash runtime preflight identity is invalid', {
			phase: 'asset',
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	const profileId = value.profileId as string;
	const snapshot = Object.freeze({
		profileId,
		bashPackageVersion: value.bashPackageVersion as string,
		bashSourceRevision: value.bashSourceRevision as string,
		wasmerSdkVersion: value.wasmerSdkVersion as string,
		wasmerSdkPackageIntegrity: value.wasmerSdkPackageIntegrity as string,
		manifestFingerprint: value.manifestFingerprint as string,
		manifestReceipt: snapshotReceipt(
			value.manifestReceipt,
			'manifest',
			false,
			BASH_MAX_MANIFEST_BYTES,
			profileId
		),
		sdkJavaScriptReceipt: snapshotReceipt(
			value.sdkJavaScriptReceipt,
			'SDK JavaScript',
			false,
			BASH_MAX_ASSET_BYTES,
			profileId
		),
		wasmerWasmReceipt: snapshotReceipt(
			value.wasmerWasmReceipt,
			'Wasmer Wasm',
			true,
			BASH_MAX_ASSET_BYTES,
			profileId
		),
		webcReceipt: snapshotReceipt(
			value.webcReceipt,
			'WEBc',
			true,
			BASH_MAX_ASSET_BYTES,
			profileId
		)
	});
	const deliveryTotal =
		snapshot.manifestReceipt.bytes! +
		snapshot.sdkJavaScriptReceipt.bytes! +
		snapshot.wasmerWasmReceipt.bytes! +
		snapshot.webcReceipt.bytes!;
	const logicalTotal =
		snapshot.sdkJavaScriptReceipt.bytes! +
		snapshot.wasmerWasmReceipt.uncompressedBytes! +
		snapshot.webcReceipt.uncompressedBytes!;
	if (deliveryTotal > BASH_MAX_DELIVERY_BYTES || logicalTotal > BASH_MAX_LOGICAL_BYTES) {
		throw new RuntimeConfigurationError(
			'Bash runtime profile exceeds its aggregate byte budget',
			{
				phase: 'asset',
				profileId,
				runtimeId: BASH_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	return snapshot;
}

export function requireBashRuntimePreflightPayload(value: unknown): BashRuntimePreflightPayload {
	if (!isPlainRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
		throw new ProtocolError('Bash runtime preflight payload has an invalid shape', {
			phase: 'protocol',
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.protocol !== BASH_PREFLIGHT_PROTOCOL ||
		value.protocolVersion !== BASH_PREFLIGHT_PROTOCOL_VERSION ||
		!isVersion(value.bashPackageVersion) ||
		!isRevision(value.bashSourceRevision) ||
		!isVersion(value.wasmerSdkVersion) ||
		typeof value.wasmerSdkPackageIntegrity !== 'string' ||
		!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(value.wasmerSdkPackageIntegrity) ||
		value.profileId !==
			expectedProfileId(
				value.bashPackageVersion,
				value.wasmerSdkVersion,
				value.bashSourceRevision
			) ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint) ||
		!isByteArray(value.manifestBytes) ||
		!isByteArray(value.sdkJavaScriptBytes) ||
		!isByteArray(value.wasmerWasmBytes) ||
		!isByteArray(value.webcBytes)
	) {
		throw new ProtocolError('Bash runtime preflight payload is invalid', {
			phase: 'protocol',
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	return value as unknown as BashRuntimePreflightPayload;
}

export function cloneBashRuntimePreflightPayload(value: unknown): BashRuntimePreflightPayload {
	const payload = requireBashRuntimePreflightPayload(value);
	return Object.freeze({
		protocol: payload.protocol,
		protocolVersion: payload.protocolVersion,
		profileId: payload.profileId,
		bashPackageVersion: payload.bashPackageVersion,
		bashSourceRevision: payload.bashSourceRevision,
		wasmerSdkVersion: payload.wasmerSdkVersion,
		wasmerSdkPackageIntegrity: payload.wasmerSdkPackageIntegrity,
		manifestFingerprint: payload.manifestFingerprint,
		manifestBytes: Uint8Array.from(payload.manifestBytes),
		sdkJavaScriptBytes: Uint8Array.from(payload.sdkJavaScriptBytes),
		wasmerWasmBytes: Uint8Array.from(payload.wasmerWasmBytes),
		webcBytes: Uint8Array.from(payload.webcBytes)
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
		throw new AssetIntegrityError('Bash runtime manifest contains a non-JSON value', {
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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
		throw new AssetIntegrityError('Bash runtime integrity verification requires Web Crypto', {
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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
	return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

function normalizeManifestReceipt(
	value: unknown,
	expectedPath: string,
	expectedMediaType: string,
	profileId: string
): ManifestReceipt {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, RECEIPT_KEYS) ||
		value.path !== expectedPath ||
		value.mediaType !== expectedMediaType ||
		!Number.isSafeInteger(value.size) ||
		(value.size as number) <= 0 ||
		(value.size as number) > BASH_MAX_ASSET_BYTES ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new AssetIntegrityError(`Bash runtime manifest receipt ${expectedPath} is invalid`, {
			profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	return {
		path: expectedPath,
		mediaType: expectedMediaType,
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
		(value.size as number) > BASH_MAX_ASSET_BYTES ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new AssetIntegrityError(`Bash runtime storage receipt ${path} is invalid`, {
			profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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

function requireExactRecord(
	value: unknown,
	keys: readonly string[],
	label: string,
	profileId: string
) {
	if (!isPlainRecord(value) || !hasExactKeys(value, keys)) {
		throw new AssetIntegrityError(`Bash runtime manifest ${label} is invalid`, {
			profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	return value;
}

function validateManifestIdentityGraph(
	manifest: UnknownRecord,
	profile: BashRuntimePreflightIdentity
): void {
	const artifact = requireExactRecord(
		manifest.artifact,
		[
			'kind',
			'package',
			'packageVersion',
			'repository',
			'revision',
			'sourceArchiveSha256',
			'sourceArchiveUrl',
			'verifiedBuildInput'
		],
		'artifact',
		profile.profileId
	);
	if (
		artifact.package !== 'wasmer/bash' ||
		artifact.packageVersion !== profile.bashPackageVersion ||
		artifact.revision !== profile.bashSourceRevision ||
		typeof artifact.kind !== 'string' ||
		typeof artifact.repository !== 'string' ||
		typeof artifact.sourceArchiveUrl !== 'string' ||
		typeof artifact.sourceArchiveSha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(artifact.sourceArchiveSha256) ||
		typeof artifact.verifiedBuildInput !== 'boolean'
	) {
		throw new AssetIntegrityError('Bash runtime artifact identity is invalid', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	const components = requireExactRecord(
		manifest.components,
		['bash', 'wasmerSdk'],
		'components',
		profile.profileId
	);
	const bash = requireExactRecord(
		components.bash,
		['evidence', 'repository', 'revision', 'verifiedBuildInput', 'version'],
		'Bash component',
		profile.profileId
	);
	const sdk = requireExactRecord(
		components.wasmerSdk,
		['evidence', 'package', 'packageIntegrity', 'repository', 'verifiedBuildInput', 'version'],
		'Wasmer SDK component',
		profile.profileId
	);
	if (
		bash.version !== profile.bashPackageVersion ||
		bash.revision !== profile.bashSourceRevision ||
		typeof bash.repository !== 'string' ||
		typeof bash.evidence !== 'string' ||
		typeof bash.verifiedBuildInput !== 'boolean' ||
		sdk.version !== profile.wasmerSdkVersion ||
		sdk.package !== '@wasmer/sdk' ||
		sdk.packageIntegrity !== profile.wasmerSdkPackageIntegrity ||
		typeof sdk.repository !== 'string' ||
		typeof sdk.evidence !== 'string' ||
		typeof sdk.verifiedBuildInput !== 'boolean'
	) {
		throw new AssetIntegrityError('Bash runtime component identity is invalid', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	const build = requireExactRecord(
		manifest.build,
		[
			'abi',
			'binaryen',
			'packager',
			'postprocessArgs',
			'sysroot',
			'target',
			'toolchain',
			'wasmFeatures'
		],
		'build',
		profile.profileId
	);
	const toolchain = requireExactRecord(
		build.toolchain,
		['archiveSha256', 'archiveUrl', 'name'],
		'toolchain',
		profile.profileId
	);
	requireExactRecord(
		build.sysroot,
		['archiveSha256', 'archiveUrl', 'release'],
		'sysroot',
		profile.profileId
	);
	requireExactRecord(
		build.binaryen,
		['archiveSha256', 'archiveUrl', 'version'],
		'Binaryen component',
		profile.profileId
	);
	const packager = requireExactRecord(
		build.packager,
		['archiveSha256', 'archiveUrl', 'name', 'version'],
		'packager',
		profile.profileId
	);
	if (
		typeof toolchain.name !== 'string' ||
		typeof toolchain.archiveUrl !== 'string' ||
		!/^https:\/\/[^@\s/?#]+(?:[/?#][^\s]*)?$/u.test(toolchain.archiveUrl) ||
		typeof toolchain.archiveSha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(toolchain.archiveSha256)
	) {
		throw new AssetIntegrityError('Bash runtime toolchain identity is invalid', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	if (build.target !== 'shell' || build.abi !== 'wasix_32v1') {
		throw new AssetIntegrityError('Bash runtime build target is invalid', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!Array.isArray(build.postprocessArgs) ||
		!build.postprocessArgs.every((entry) => typeof entry === 'string') ||
		!Array.isArray(build.wasmFeatures) ||
		!build.wasmFeatures.every((entry) => typeof entry === 'string')
	) {
		throw new AssetIntegrityError('Bash runtime build arguments are invalid', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	if (packager.name !== 'wasmer' || typeof packager.version !== 'string') {
		throw new AssetIntegrityError('Bash runtime packager identity is invalid', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	const licenses = requireExactRecord(
		manifest.license,
		['bash', 'wasmerSdk'],
		'license graph',
		profile.profileId
	);
	for (const [key, expectedSpdx] of [
		['bash', 'GPL-3.0-or-later'],
		['wasmerSdk', 'MIT']
	] as const) {
		const receipt = requireExactRecord(
			licenses[key],
			['path', 'sha256', 'size', 'sourceUrl', 'spdx'],
			`${key} license`,
			profile.profileId
		);
		if (
			receipt.spdx !== expectedSpdx ||
			typeof receipt.path !== 'string' ||
			typeof receipt.sourceUrl !== 'string' ||
			!Number.isSafeInteger(receipt.size) ||
			(receipt.size as number) <= 0 ||
			typeof receipt.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(receipt.sha256)
		) {
			throw new AssetIntegrityError(`Bash runtime ${key} license receipt is invalid`, {
				profileId: profile.profileId,
				runtimeId: BASH_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	requireExactRecord(
		manifest.metadata,
		['mediaType', 'path', 'sha256', 'size'],
		'metadata receipt',
		profile.profileId
	);
	canonicalJson(artifact);
	canonicalJson(components);
	canonicalJson(build);
	canonicalJson(licenses);
}

async function computeManifestFingerprint(
	manifest: UnknownRecord,
	assets: readonly ManifestReceipt[],
	storage: readonly ManifestStorageReceipt[],
	signal?: AbortSignal
): Promise<string> {
	const metadata = manifest.metadata as UnknownRecord;
	let canonical = `${FINGERPRINT_DOMAIN}\nformat\0${MANIFEST_FORMAT}\nruntime\0${EXPECTED_RUNTIME}\nprofileId\0${manifest.profileId}\n`;
	canonical += `licenseExpression\0${EXPECTED_LICENSE_EXPRESSION}\n`;
	canonical += `artifact\0${canonicalJson(manifest.artifact)}\n`;
	canonical += `components\0${canonicalJson(manifest.components)}\n`;
	canonical += `build\0${canonicalJson(manifest.build)}\n`;
	canonical += `license\0${canonicalJson(manifest.license)}\n`;
	canonical += `metadata\0${String(metadata.path)}\0${String(metadata.mediaType)}\0${String(metadata.size)}\0${String(metadata.sha256)}\n`;
	for (const asset of [...assets].sort((left, right) => left.path.localeCompare(right.path))) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...storage].sort((left, right) => left.path.localeCompare(right.path))) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return await sha256Hex(textEncoder.encode(canonical), signal);
}

async function parseAndVerifyManifest(
	bytes: Uint8Array,
	profile: BashRuntimePreflightIdentity,
	signal?: AbortSignal
): Promise<ParsedBashManifest> {
	let value: unknown;
	try {
		value = JSON.parse(fatalDecoder.decode(bytes));
	} catch (error) {
		throw new AssetIntegrityError('Bash runtime manifest is not valid UTF-8 JSON', {
			cause: error,
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!isPlainRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
		throw new AssetIntegrityError('Bash runtime manifest schema is invalid', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.format !== MANIFEST_FORMAT ||
		value.runtime !== EXPECTED_RUNTIME ||
		value.profileId !== profile.profileId ||
		value.fingerprint !== profile.manifestFingerprint ||
		value.licenseExpression !== EXPECTED_LICENSE_EXPRESSION
	) {
		throw new AssetIntegrityError('Bash runtime manifest identity is invalid', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	validateManifestIdentityGraph(value, profile);
	const metadata = value.metadata as UnknownRecord;
	if (
		metadata.path !== 'runtime-build.json' ||
		metadata.mediaType !== 'application/json' ||
		!Number.isSafeInteger(metadata.size) ||
		(metadata.size as number) <= 0 ||
		typeof metadata.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(metadata.sha256)
	) {
		throw new AssetIntegrityError('Bash runtime metadata receipt is invalid', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!Array.isArray(value.assets) || value.assets.length !== 3) {
		throw new AssetIntegrityError('Bash runtime manifest must declare three logical assets', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 3) {
		throw new AssetIntegrityError('Bash runtime manifest must declare three storage assets', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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
			throw new AssetIntegrityError('Bash runtime manifest has an unexpected logical asset', {
				profileId: profile.profileId,
				runtimeId: BASH_PREFLIGHT_RUNTIME_ID
			});
		}
		assetByPath.set(
			path as LogicalAssetPath,
			normalizeManifestReceipt(
				candidate,
				path,
				LOGICAL_ASSETS[path as LogicalAssetPath],
				profile.profileId
			)
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
			throw new AssetIntegrityError('Bash runtime manifest has an unexpected storage asset', {
				profileId: profile.profileId,
				runtimeId: BASH_PREFLIGHT_RUNTIME_ID
			});
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
		throw new AssetIntegrityError('Bash runtime manifest omits a required asset receipt', {
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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
			'Bash runtime receipt graph failed fingerprint verification',
			{
				profileId: profile.profileId,
				runtimeId: BASH_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	return { assetByPath, storageByPath };
}

function assertManifestMatchesProfile(
	manifest: ParsedBashManifest,
	profile: Readonly<Required<BashRuntimePreflightProfile>>
): void {
	for (const [storagePath, expected] of Object.entries(STORAGE_ASSETS) as Array<
		[StorageAssetPath, (typeof STORAGE_ASSETS)[StorageAssetPath]]
	>) {
		const storage = manifest.storageByPath.get(storagePath)!;
		const logical = manifest.assetByPath.get(expected.logicalPath)!;
		const receipt =
			expected.logicalPath === SDK_JAVASCRIPT_PATH
				? profile.sdkJavaScriptReceipt
				: expected.logicalPath === WASMER_WASM_PATH
					? profile.wasmerWasmReceipt
					: profile.webcReceipt;
		if (
			storage.size !== receipt.bytes ||
			storage.sha256 !== receipt.sha256 ||
			logical.size !== (receipt.uncompressedBytes ?? receipt.bytes) ||
			logical.sha256 !== (receipt.uncompressedSha256 ?? receipt.sha256)
		) {
			throw new AssetIntegrityError(
				`Bash runtime profile receipt mismatch for ${storagePath}`,
				{ profileId: profile.profileId, runtimeId: BASH_PREFLIGHT_RUNTIME_ID }
			);
		}
	}
}

async function verifyLogicalBytes(
	manifest: ParsedBashManifest,
	logicalPath: LogicalAssetPath,
	bytes: Uint8Array,
	profileId: string,
	signal?: AbortSignal
): Promise<void> {
	const receipt = manifest.assetByPath.get(logicalPath)!;
	await waitForAbortable(
		verifyRuntimeAssetIntegrity({
			asset: logicalPath,
			bytes,
			expected: {
				bytes: receipt.size,
				sha256: receipt.sha256,
				uncompressedBytes: receipt.size,
				uncompressedSha256: receipt.sha256
			},
			stage: 'uncompressed',
			profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		}),
		signal
	);
}

function validateWasmHeader(bytes: Uint8Array, profileId: string): void {
	if (
		bytes.byteLength < 8 ||
		bytes[0] !== 0 ||
		bytes[1] !== 0x61 ||
		bytes[2] !== 0x73 ||
		bytes[3] !== 0x6d ||
		bytes[4] !== 1 ||
		bytes[5] !== 0 ||
		bytes[6] !== 0 ||
		bytes[7] !== 0
	) {
		throw new AssetIntegrityError('Bash runtime Wasmer Wasm header is invalid', {
			profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
}

function validateWebcHeader(bytes: Uint8Array, profileId: string): void {
	const header = [0, 0x77, 0x65, 0x62, 0x63, 0x30, 0x30, 0x33];
	if (bytes.byteLength < header.length || header.some((byte, index) => bytes[index] !== byte)) {
		throw new AssetIntegrityError('Bash runtime WEBc header is invalid', {
			profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
}

export async function verifyBashRuntimePreflightPayload(
	value: unknown,
	options: { readonly maxAssetBytes?: number; readonly signal?: AbortSignal } = {}
): Promise<BashRuntimePreflightPayload> {
	const payload = requireBashRuntimePreflightPayload(value);
	const maxAssetBytes = Math.min(
		options.maxAssetBytes ?? BASH_MAX_ASSET_BYTES,
		BASH_MAX_ASSET_BYTES
	);
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new RuntimeConfigurationError('Bash runtime asset byte limit is invalid', {
			phase: 'asset',
			profileId: payload.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const [label, bytes, limit] of [
		['manifest', payload.manifestBytes, Math.min(maxAssetBytes, BASH_MAX_MANIFEST_BYTES)],
		['SDK JavaScript', payload.sdkJavaScriptBytes, maxAssetBytes],
		['Wasmer Wasm', payload.wasmerWasmBytes, maxAssetBytes],
		['WEBc', payload.webcBytes, maxAssetBytes]
	] as const) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new AssetTooLargeError(`Bash runtime ${label} exceeds the ${limit} byte limit`, {
				actual: bytes.byteLength,
				limit,
				phase: 'asset',
				profileId: payload.profileId,
				runtimeId: BASH_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	const logicalTotal =
		payload.sdkJavaScriptBytes.byteLength +
		payload.wasmerWasmBytes.byteLength +
		payload.webcBytes.byteLength;
	if (!Number.isSafeInteger(logicalTotal) || logicalTotal > BASH_MAX_LOGICAL_BYTES) {
		throw new AssetTooLargeError(
			`Bash runtime logical payload exceeds the ${BASH_MAX_LOGICAL_BYTES} byte aggregate limit`,
			{
				actual: logicalTotal,
				limit: BASH_MAX_LOGICAL_BYTES,
				phase: 'asset',
				profileId: payload.profileId,
				runtimeId: BASH_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const manifest = await parseAndVerifyManifest(payload.manifestBytes, payload, options.signal);
	await verifyLogicalBytes(
		manifest,
		SDK_JAVASCRIPT_PATH,
		payload.sdkJavaScriptBytes,
		payload.profileId,
		options.signal
	);
	await verifyLogicalBytes(
		manifest,
		WASMER_WASM_PATH,
		payload.wasmerWasmBytes,
		payload.profileId,
		options.signal
	);
	await verifyLogicalBytes(
		manifest,
		WEBC_PATH,
		payload.webcBytes,
		payload.profileId,
		options.signal
	);
	try {
		fatalDecoder.decode(payload.sdkJavaScriptBytes);
	} catch (error) {
		throw new AssetIntegrityError('Bash runtime SDK JavaScript is not valid UTF-8', {
			cause: error,
			profileId: payload.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	validateWasmHeader(payload.wasmerWasmBytes, payload.profileId);
	validateWebcHeader(payload.webcBytes, payload.profileId);
	return payload;
}

async function decompressGzipBounded(
	label: 'Wasmer Wasm' | 'WEBc',
	compressedBytes: Uint8Array,
	expectedBytes: number,
	maxAssetBytes: number,
	signal: AbortSignal,
	reportProgress?: (
		asset: 'wasmer-wasm' | 'webc',
		loadedBytes: number,
		totalBytes: number
	) => void
): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			phase: 'asset',
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!Number.isSafeInteger(expectedBytes) ||
		expectedBytes <= 0 ||
		expectedBytes > maxAssetBytes
	) {
		throw new AssetTooLargeError(
			`Bash runtime ${label} logical bytes exceed the ${maxAssetBytes} byte limit`,
			{
				actual: expectedBytes,
				limit: maxAssetBytes,
				phase: 'asset',
				runtimeId: BASH_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const body = new Response(Uint8Array.from(compressedBytes)).body;
	if (!body) {
		throw new UnsupportedBrowserFeatureError('ReadableStream response bodies', {
			phase: 'asset',
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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
					`Bash runtime ${label} gzip output exceeds its logical receipt`,
					{ runtimeId: BASH_PREFLIGHT_RUNTIME_ID }
				);
			}
			output.set(value, offset);
			offset += value.byteLength;
			reportProgress?.(label === 'WEBc' ? 'webc' : 'wasmer-wasm', offset, output.length);
		}
	} catch (error) {
		try {
			await reader.cancel(error);
		} catch {
			// Preserve the decompression failure.
		}
		if (signal.aborted || isWasmIdleError(error)) throw error;
		throw new AssetIntegrityError(`Bash runtime ${label} gzip decompression failed`, {
			cause: error,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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
		throw new AssetIntegrityError(`Bash runtime ${label} gzip output is truncated`, {
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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
		throw new RuntimeConfigurationError(`Bash runtime ${path} URL is invalid`, {
			cause: error,
			phase: 'asset',
			profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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
			`Bash runtime ${path} URL must match its query-pinned canonical storage path`,
			{ phase: 'asset', profileId, runtimeId: BASH_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (!url.search) url.searchParams.set('v', sha256);
	return url;
}

export async function preflightBashRuntimeAssets(
	request: BashRuntimePreflightRequest
): Promise<BashRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('Bash runtime preflight request is required', {
			phase: 'asset',
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
		});
	}
	const profile = snapshotBashRuntimePreflightProfile(request.profile);
	let baseUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
	} catch (error) {
		throw new RuntimeConfigurationError('Bash runtime asset base URL is invalid', {
			cause: error,
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID
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
			'Bash runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: BASH_PREFLIGHT_RUNTIME_ID }
		);
	}
	const manifestUrl = resolvePinnedAssetUrl(
		request.manifestUrl,
		baseUrl,
		'runtime-manifest.v2.json',
		profile.manifestFingerprint,
		profile.profileId
	);
	const sdkJavaScriptUrl = resolvePinnedAssetUrl(
		request.sdkJavaScriptUrl,
		baseUrl,
		SDK_JAVASCRIPT_STORAGE_PATH,
		profile.sdkJavaScriptReceipt.sha256,
		profile.profileId
	);
	const wasmerWasmUrl = resolvePinnedAssetUrl(
		request.wasmerWasmUrl,
		baseUrl,
		WASMER_WASM_STORAGE_PATH,
		profile.wasmerWasmReceipt.sha256,
		profile.profileId
	);
	const webcUrl = resolvePinnedAssetUrl(
		request.webcUrl,
		baseUrl,
		WEBC_STORAGE_PATH,
		profile.webcReceipt.sha256,
		profile.profileId
	);
	const limits = resolveExecutionLimits(request.limits);
	const maxAssetBytes = Math.min(limits.maxAssetBytes, BASH_MAX_ASSET_BYTES);
	if (profile.manifestReceipt.bytes! > Math.min(BASH_MAX_MANIFEST_BYTES, maxAssetBytes)) {
		throw new AssetTooLargeError(
			`Bash runtime manifest exceeds the ${Math.min(BASH_MAX_MANIFEST_BYTES, maxAssetBytes)} byte limit`,
			{
				actual: profile.manifestReceipt.bytes,
				limit: Math.min(BASH_MAX_MANIFEST_BYTES, maxAssetBytes),
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: BASH_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/bash-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: BASH_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'BASH',
					implementationId: 'wasmer-bash-wasix',
					implementationVersion: profile.bashPackageVersion,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: profile.manifestReceipt.sha256,
						protocolVersion: BASH_PREFLIGHT_PROTOCOL_VERSION,
						trustProfileId: 'wasm-idle-bash-preflight-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: {
					stdin: 'streaming',
					workspace: true,
					abort: true,
					artifacts: false,
					streamingOutput: true
				},
				workerLifetime: {
					mode: 'persistent',
					idleTimeoutMs: 300_000,
					evictOnMemoryPressure: true
				},
				requiredBrowserFeatures: ['wasm', 'decompression-stream'],
				assetRoot: '.',
				assets: [
					{
						key: 'manifest',
						path: 'runtime-manifest.v2.json',
						compressedSha256: profile.manifestReceipt.sha256,
						uncompressedSha256: profile.manifestReceipt.sha256,
						compressedBytes: profile.manifestReceipt.bytes!,
						uncompressedBytes: profile.manifestReceipt.bytes!,
						mediaType: 'application/json',
						encoding: 'identity'
					},
					{
						key: 'sdkJavaScript',
						path: SDK_JAVASCRIPT_STORAGE_PATH,
						compressedSha256: profile.sdkJavaScriptReceipt.sha256,
						uncompressedSha256: profile.sdkJavaScriptReceipt.sha256,
						compressedBytes: profile.sdkJavaScriptReceipt.bytes!,
						uncompressedBytes: profile.sdkJavaScriptReceipt.bytes!,
						mediaType: 'application/octet-stream',
						encoding: 'identity'
					},
					{
						key: 'wasmerWasm',
						path: WASMER_WASM_STORAGE_PATH,
						compressedSha256: profile.wasmerWasmReceipt.sha256,
						uncompressedSha256: profile.wasmerWasmReceipt.uncompressedSha256!,
						compressedBytes: profile.wasmerWasmReceipt.bytes!,
						uncompressedBytes: profile.wasmerWasmReceipt.uncompressedBytes!,
						mediaType: 'application/wasm',
						encoding: 'gzip'
					},
					{
						key: 'webc',
						path: WEBC_STORAGE_PATH,
						compressedSha256: profile.webcReceipt.sha256,
						uncompressedSha256: profile.webcReceipt.uncompressedSha256!,
						compressedBytes: profile.webcReceipt.bytes!,
						uncompressedBytes: profile.webcReceipt.uncompressedBytes!,
						mediaType: 'application/octet-stream',
						encoding: 'gzip'
					}
				],
				contracts: {
					routeId: 'bash',
					runtimeAssetKey: 'bash',
					documentationId: 'BASH',
					syncTarget: 'sync:wasm-bash',
					browserTestId: 'browser:bash'
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
		controller.abort(new DOMException('Bash runtime preflight timed out', 'TimeoutError'));
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: BASH_PREFLIGHT_RUNTIME_ID,
			rootUrl: baseUrl,
			assetUrls: {
				manifest: manifestUrl,
				sdkJavaScript: sdkJavaScriptUrl,
				wasmerWasm: wasmerWasmUrl,
				webc: webcUrl
			},
			fetch: request.fetch,
			signal: controller.signal,
			limits: { ...limits, maxAssetBytes },
			redirect: 'error',
			maxConcurrentDownloads: 4,
			maxTotalDeliveryBytes: BASH_MAX_DELIVERY_BYTES,
			reportProgress: request.reportProgress
		});
		for (const key of ['wasmerWasm', 'webc'] as const) {
			const asset = preflight.assets[key];
			if (!asset?.contentEncoding) continue;
			throw new AssetIntegrityError(
				`Bash runtime asset ${asset.path} must not use HTTP Content-Encoding`,
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: BASH_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		const manifestAsset = preflight.assets.manifest;
		const sdkJavaScriptAsset = preflight.assets.sdkJavaScript;
		const wasmerWasmAsset = preflight.assets.wasmerWasm;
		const webcAsset = preflight.assets.webc;
		if (!manifestAsset || !sdkJavaScriptAsset || !wasmerWasmAsset || !webcAsset) {
			throw new RuntimeConfigurationError(
				'Bash runtime preflight returned an incomplete asset set',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: BASH_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		const manifest = await parseAndVerifyManifest(
			manifestAsset.bytes,
			profile,
			controller.signal
		);
		assertManifestMatchesProfile(manifest, profile);
		for (const [label, bytes] of [
			['Wasmer Wasm', wasmerWasmAsset.bytes],
			['WEBc', webcAsset.bytes]
		] as const) {
			if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
				throw new AssetIntegrityError(`Bash runtime ${label} storage is not gzip data`, {
					profileId: profile.profileId,
					runtimeId: BASH_PREFLIGHT_RUNTIME_ID
				});
			}
		}
		const decompress = async (
			label: 'Wasmer Wasm' | 'WEBc',
			bytes: Uint8Array,
			expectedBytes: number
		) => {
			try {
				return await decompressGzipBounded(
					label,
					bytes,
					expectedBytes,
					maxAssetBytes,
					controller.signal,
					request.reportDecompressionProgress
				);
			} catch (error) {
				controller.abort(error);
				throw error;
			}
		};
		const [wasmerWasmBytes, webcBytes] = await Promise.all([
			decompress(
				'Wasmer Wasm',
				wasmerWasmAsset.bytes,
				profile.wasmerWasmReceipt.uncompressedBytes!
			),
			decompress('WEBc', webcAsset.bytes, profile.webcReceipt.uncompressedBytes!)
		]);
		const payload: BashRuntimePreflightPayload = Object.freeze({
			protocol: BASH_PREFLIGHT_PROTOCOL,
			protocolVersion: BASH_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			bashPackageVersion: profile.bashPackageVersion,
			bashSourceRevision: profile.bashSourceRevision,
			wasmerSdkVersion: profile.wasmerSdkVersion,
			wasmerSdkPackageIntegrity: profile.wasmerSdkPackageIntegrity,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			sdkJavaScriptBytes: Uint8Array.from(sdkJavaScriptAsset.bytes),
			wasmerWasmBytes,
			webcBytes
		});
		return await verifyBashRuntimePreflightPayload(payload, {
			maxAssetBytes,
			signal: controller.signal
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`Bash runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: BASH_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('Bash runtime preflight cancelled', {
				cause: request.signal.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: BASH_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
