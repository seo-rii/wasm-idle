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
import { verifyRuntimeAssetIntegrity } from './asset-integrity.js';
import { preflightRuntimeAssets, type RuntimeAssetPreflightProgress } from './runtime-preflight.js';
import type { RuntimeAssetIntegrityEntry } from './runtime-assets.js';
import type { RuntimeRegistryManifest } from './runtime-manifest.js';

export const TCL_PREFLIGHT_PROTOCOL = 'wasm-idle-tcl-preflight' as const;
export const TCL_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const TCL_PREFLIGHT_RUNTIME_ID = 'TCL' as const;
export const TCL_MAX_ASSET_BYTES = 16 * 1024 * 1024;

const TCL_MAX_TOTAL_LOGICAL_BYTES = 32 * 1024 * 1024;
const TCL_MANIFEST_FORMAT = 'wasm-tcl-runtime-manifest-v2';
const TCL_FINGERPRINT_DOMAIN = 'wasm-idle:tcl-runtime-manifest:v2';
const MAX_MANIFEST_BYTES = 64 * 1024;
const REQUIRE_JS_PATH = 'require.js';
const CUSTOM_DATA_PATH = 'tcl/wacl-custom.data';
const CUSTOM_DATA_STORAGE_PATH = 'tcl/wacl-custom.data.bin';
const LIBRARY_DATA_PATH = 'tcl/wacl-library.data';
const LIBRARY_DATA_STORAGE_PATH = 'tcl/wacl-library.data.gz.bin';
const GLUE_PATH = 'tcl/wacl.js';
const WASM_PATH = 'tcl/wacl.wasm';
const WASM_STORAGE_PATH = 'tcl/wacl.wasm.gz.bin';
const VERIFIED_WASM_GLUE_PATCH =
	'var _wasmbly=Promise.resolve(typeof self!=="undefined"&&self.Module&&self.Module["wasmBinary"]||(function(){throw new Error("Verified Wacl Wasm was not provided.")})());';
const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

const PROFILE_KEYS = [
	'artifactRevision',
	'customDataReceipt',
	'emscriptenRevision',
	'glueReceipt',
	'libraryDataReceipt',
	'manifestFingerprint',
	'manifestReceipt',
	'profileId',
	'requireJsReceipt',
	'requireJsRevision',
	'tclRevision',
	'waclRevision',
	'wasmReceipt'
] as const;
const PAYLOAD_KEYS = [
	'artifactRevision',
	'customDataBytes',
	'emscriptenRevision',
	'glueBytes',
	'libraryDataBytes',
	'manifestBytes',
	'manifestFingerprint',
	'profileId',
	'protocol',
	'protocolVersion',
	'requireJsBytes',
	'requireJsRevision',
	'tclRevision',
	'waclRevision',
	'wasmBytes'
] as const;
const MANIFEST_KEYS = [
	'artifact',
	'assets',
	'components',
	'fingerprint',
	'format',
	'licenses',
	'metadata',
	'patches',
	'profileId',
	'runtime',
	'storage'
] as const;
const EXPECTED_COMPONENTS = [
	'emscripten',
	'requirejs',
	'rlJson',
	'tcl',
	'tcllib',
	'tdom',
	'wacl'
] as const;
const EXPECTED_PATCHES = [
	'guard-window-cleanup',
	'inject-host-module',
	'inject-verified-wasm',
	'preserve-host-error-output',
	'preserve-host-output'
] as const;
const EXPECTED_LICENSES = Object.freeze({
	'licenses/REQUIREJS.txt': 'MIT',
	'licenses/TCL.txt': 'TCL',
	'licenses/WACL.txt': 'BSD-3-Clause'
});
const EXPECTED_LOGICAL_ASSETS = Object.freeze({
	[REQUIRE_JS_PATH]: 'text/javascript',
	[CUSTOM_DATA_PATH]: 'application/octet-stream',
	[LIBRARY_DATA_PATH]: 'application/octet-stream',
	[GLUE_PATH]: 'text/javascript',
	[WASM_PATH]: 'application/wasm'
});
const EXPECTED_STORAGE = Object.freeze({
	[REQUIRE_JS_PATH]: Object.freeze({ logicalPath: REQUIRE_JS_PATH, encoding: 'identity' }),
	[CUSTOM_DATA_STORAGE_PATH]: Object.freeze({
		logicalPath: CUSTOM_DATA_PATH,
		encoding: 'identity'
	}),
	[LIBRARY_DATA_STORAGE_PATH]: Object.freeze({
		logicalPath: LIBRARY_DATA_PATH,
		encoding: 'gzip'
	}),
	[GLUE_PATH]: Object.freeze({ logicalPath: GLUE_PATH, encoding: 'identity' }),
	[WASM_STORAGE_PATH]: Object.freeze({ logicalPath: WASM_PATH, encoding: 'gzip' })
});

export interface TclRuntimePreflightProfile {
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly waclRevision: string;
	readonly tclRevision: string;
	readonly requireJsRevision: string;
	readonly emscriptenRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestReceipt: RuntimeAssetIntegrityEntry;
	readonly requireJsReceipt: RuntimeAssetIntegrityEntry;
	readonly customDataReceipt: RuntimeAssetIntegrityEntry;
	readonly libraryDataReceipt: RuntimeAssetIntegrityEntry;
	readonly glueReceipt: RuntimeAssetIntegrityEntry;
	readonly wasmReceipt: RuntimeAssetIntegrityEntry;
}

export interface TclRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: TclRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (
		asset: 'libraryData' | 'wasm',
		loadedBytes: number,
		totalBytes: number
	) => void;
}

export interface TclRuntimePreflightPayload {
	readonly protocol: typeof TCL_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof TCL_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly waclRevision: string;
	readonly tclRevision: string;
	readonly requireJsRevision: string;
	readonly emscriptenRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly requireJsBytes: Uint8Array;
	readonly customDataBytes: Uint8Array;
	readonly libraryDataBytes: Uint8Array;
	readonly glueBytes: Uint8Array;
	readonly wasmBytes: Uint8Array;
}

type UnknownRecord = Record<string, unknown>;
type ManifestReceipt = Readonly<{
	path: string;
	mediaType: string;
	size: number;
	sha256: string;
}>;
type ManifestStorageReceipt = Readonly<{
	path: string;
	logicalPath: string;
	encoding: 'gzip' | 'identity';
	size: number;
	sha256: string;
}>;
type NormalizedManifest = Readonly<{
	value: UnknownRecord;
	assetByPath: ReadonlyMap<string, ManifestReceipt>;
	storageByPath: ReadonlyMap<string, ManifestStorageReceipt>;
}>;

function isPlainRecord(value: unknown): value is UnknownRecord {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isByteArray(value: unknown): value is Uint8Array {
	return (
		ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]'
	);
}

function isOwnedByteArray(value: unknown): value is Uint8Array {
	return (
		isByteArray(value) &&
		value.buffer instanceof ArrayBuffer &&
		value.byteOffset === 0 &&
		value.byteLength === value.buffer.byteLength
	);
}

function isRevision(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}

function isSha256(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function compareNames(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function waitForAbortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return operation;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const rejectOnAbort = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', rejectOnAbort);
			reject(
				signal.reason ?? new DOMException('Tcl runtime operation aborted', 'AbortError')
			);
		};
		signal.addEventListener('abort', rejectOnAbort, { once: true });
		operation.then(
			(value) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', rejectOnAbort);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', rejectOnAbort);
				reject(error);
			}
		);
		if (signal.aborted) rejectOnAbort();
	});
}

function snapshotReceipt(
	value: unknown,
	label: string,
	requireLogical: boolean,
	profileId?: string
): Readonly<RuntimeAssetIntegrityEntry> {
	if (!isPlainRecord(value)) {
		throw new RuntimeConfigurationError(`Tcl runtime ${label} receipt is missing`, {
			phase: 'asset',
			profileId,
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
		});
	}
	const expectedKeys = requireLogical
		? ['bytes', 'sha256', 'uncompressedBytes', 'uncompressedSha256']
		: ['bytes', 'sha256'];
	if (
		!hasExactKeys(value, expectedKeys) ||
		!Number.isSafeInteger(value.bytes) ||
		(value.bytes as number) <= 0 ||
		!isSha256(value.sha256) ||
		(requireLogical &&
			(!Number.isSafeInteger(value.uncompressedBytes) ||
				(value.uncompressedBytes as number) <= 0 ||
				!isSha256(value.uncompressedSha256)))
	) {
		throw new RuntimeConfigurationError(`Tcl runtime ${label} receipt is invalid`, {
			phase: 'asset',
			profileId,
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
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

export function snapshotTclRuntimePreflightProfile(
	value: unknown
): Readonly<Required<TclRuntimePreflightProfile>> {
	if (!isPlainRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) {
		throw new RuntimeConfigurationError('Tcl runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		typeof value.profileId !== 'string' ||
		!/^wacl-[A-Za-z0-9._+-]+$/u.test(value.profileId) ||
		!isRevision(value.artifactRevision) ||
		!isRevision(value.waclRevision) ||
		!isRevision(value.tclRevision) ||
		!isRevision(value.requireJsRevision) ||
		!isRevision(value.emscriptenRevision) ||
		!isSha256(value.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('Tcl runtime preflight identity is invalid', {
			phase: 'asset',
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
		});
	}
	return Object.freeze({
		profileId: value.profileId,
		artifactRevision: value.artifactRevision,
		waclRevision: value.waclRevision,
		tclRevision: value.tclRevision,
		requireJsRevision: value.requireJsRevision,
		emscriptenRevision: value.emscriptenRevision,
		manifestFingerprint: value.manifestFingerprint,
		manifestReceipt: snapshotReceipt(value.manifestReceipt, 'manifest', false, value.profileId),
		requireJsReceipt: snapshotReceipt(
			value.requireJsReceipt,
			'RequireJS',
			false,
			value.profileId
		),
		customDataReceipt: snapshotReceipt(
			value.customDataReceipt,
			'custom data',
			false,
			value.profileId
		),
		libraryDataReceipt: snapshotReceipt(
			value.libraryDataReceipt,
			'library data',
			true,
			value.profileId
		),
		glueReceipt: snapshotReceipt(value.glueReceipt, 'glue', false, value.profileId),
		wasmReceipt: snapshotReceipt(value.wasmReceipt, 'Wasm', true, value.profileId)
	});
}

export function requireTclRuntimePreflightPayload(value: unknown): TclRuntimePreflightPayload {
	if (!isPlainRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
		throw new ProtocolError('Tcl runtime preflight payload has an invalid shape', {
			phase: 'protocol',
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.protocol !== TCL_PREFLIGHT_PROTOCOL ||
		value.protocolVersion !== TCL_PREFLIGHT_PROTOCOL_VERSION ||
		typeof value.profileId !== 'string' ||
		!/^wacl-[A-Za-z0-9._+-]+$/u.test(value.profileId) ||
		!isRevision(value.artifactRevision) ||
		!isRevision(value.waclRevision) ||
		!isRevision(value.tclRevision) ||
		!isRevision(value.requireJsRevision) ||
		!isRevision(value.emscriptenRevision) ||
		!isSha256(value.manifestFingerprint) ||
		!isOwnedByteArray(value.manifestBytes) ||
		!isOwnedByteArray(value.requireJsBytes) ||
		!isOwnedByteArray(value.customDataBytes) ||
		!isOwnedByteArray(value.libraryDataBytes) ||
		!isOwnedByteArray(value.glueBytes) ||
		!isOwnedByteArray(value.wasmBytes)
	) {
		throw new ProtocolError('Tcl runtime preflight payload is invalid', {
			phase: 'protocol',
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
		});
	}
	return value as unknown as TclRuntimePreflightPayload;
}

export function cloneTclRuntimePreflightPayload(value: unknown): TclRuntimePreflightPayload {
	const payload = requireTclRuntimePreflightPayload(value);
	return Object.freeze({
		protocol: payload.protocol,
		protocolVersion: payload.protocolVersion,
		profileId: payload.profileId,
		artifactRevision: payload.artifactRevision,
		waclRevision: payload.waclRevision,
		tclRevision: payload.tclRevision,
		requireJsRevision: payload.requireJsRevision,
		emscriptenRevision: payload.emscriptenRevision,
		manifestFingerprint: payload.manifestFingerprint,
		manifestBytes: Uint8Array.from(payload.manifestBytes),
		requireJsBytes: Uint8Array.from(payload.requireJsBytes),
		customDataBytes: Uint8Array.from(payload.customDataBytes),
		libraryDataBytes: Uint8Array.from(payload.libraryDataBytes),
		glueBytes: Uint8Array.from(payload.glueBytes),
		wasmBytes: Uint8Array.from(payload.wasmBytes)
	});
}

function normalizeReceipt(
	value: unknown,
	expectedPath: string,
	expectedMediaType: string,
	maxAssetBytes: number
): ManifestReceipt {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, ['mediaType', 'path', 'sha256', 'size']) ||
		value.path !== expectedPath ||
		value.mediaType !== expectedMediaType ||
		!Number.isSafeInteger(value.size) ||
		(value.size as number) <= 0 ||
		(value.size as number) > maxAssetBytes ||
		!isSha256(value.sha256)
	) {
		throw new AssetIntegrityError(`Tcl runtime asset receipt is invalid for ${expectedPath}`, {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
		});
	}
	return Object.freeze({
		path: expectedPath,
		mediaType: expectedMediaType,
		size: value.size as number,
		sha256: value.sha256
	});
}

function normalizeStorageReceipt(
	value: unknown,
	expectedPath: string,
	expectedLogicalPath: string,
	expectedEncoding: 'gzip' | 'identity',
	maxAssetBytes: number
): ManifestStorageReceipt {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, ['encoding', 'logicalPath', 'path', 'sha256', 'size']) ||
		value.path !== expectedPath ||
		value.logicalPath !== expectedLogicalPath ||
		value.encoding !== expectedEncoding ||
		!Number.isSafeInteger(value.size) ||
		(value.size as number) <= 0 ||
		(value.size as number) > maxAssetBytes ||
		!isSha256(value.sha256)
	) {
		throw new AssetIntegrityError(
			`Tcl runtime storage receipt is invalid for ${expectedPath}`,
			{
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	return Object.freeze({
		path: expectedPath,
		logicalPath: expectedLogicalPath,
		encoding: expectedEncoding,
		size: value.size as number,
		sha256: value.sha256
	});
}

function requireNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function normalizeArtifact(value: unknown, payload: TclRuntimePreflightPayload): UnknownRecord {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, ['kind', 'path', 'repository', 'revision', 'sha256', 'size', 'url']) ||
		value.kind !== 'opaque-prebuilt' ||
		value.path !== 'wacl/releases/wacl.zip' ||
		value.repository !== 'https://github.com/ecky-l/ecky-l.github.io.git' ||
		value.revision !== payload.artifactRevision ||
		!isSha256(value.sha256) ||
		!Number.isSafeInteger(value.size) ||
		(value.size as number) <= 0 ||
		(value.size as number) > TCL_MAX_ASSET_BYTES ||
		value.url !==
			`https://raw.githubusercontent.com/ecky-l/ecky-l.github.io/${payload.artifactRevision}/wacl/releases/wacl.zip`
	) {
		throw new AssetIntegrityError('Tcl runtime artifact metadata is invalid', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		});
	}
	return { ...value };
}

function normalizeComponents(value: unknown, payload: TclRuntimePreflightPayload): UnknownRecord {
	if (!isPlainRecord(value) || !hasExactKeys(value, EXPECTED_COMPONENTS)) {
		throw new AssetIntegrityError('Tcl runtime component metadata is invalid', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		});
	}
	const normalized: UnknownRecord = {};
	for (const componentName of EXPECTED_COMPONENTS) {
		const component = value[componentName];
		const keys =
			componentName === 'wacl'
				? ['repository', 'revision', 'verifiedBuildInput', 'version']
				: ['revision', 'verifiedBuildInput', 'version'];
		if (
			!isPlainRecord(component) ||
			!hasExactKeys(component, keys) ||
			!isRevision(component.revision) ||
			component.verifiedBuildInput !== false ||
			!requireNonEmptyString(component.version) ||
			(componentName === 'wacl' &&
				component.repository !== 'https://github.com/ecky-l/wacl.git')
		) {
			throw new AssetIntegrityError(
				`Tcl runtime component ${componentName} metadata is invalid`,
				{
					runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
					profileId: payload.profileId
				}
			);
		}
		normalized[componentName] = { ...component };
	}
	const revisions = {
		wacl: payload.waclRevision,
		tcl: payload.tclRevision,
		requirejs: payload.requireJsRevision,
		emscripten: payload.emscriptenRevision
	};
	for (const [componentName, expectedRevision] of Object.entries(revisions)) {
		if ((normalized[componentName] as UnknownRecord).revision !== expectedRevision) {
			throw new AssetIntegrityError(`Tcl runtime ${componentName} revision is invalid`, {
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
				profileId: payload.profileId
			});
		}
	}
	return normalized;
}

function normalizePatches(value: unknown, payload: TclRuntimePreflightPayload): UnknownRecord[] {
	if (!Array.isArray(value) || value.length !== EXPECTED_PATCHES.length) {
		throw new AssetIntegrityError('Tcl runtime patch metadata is invalid', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		});
	}
	const ids = value.map((entry) => {
		if (
			!isPlainRecord(entry) ||
			!hasExactKeys(entry, ['id']) ||
			!requireNonEmptyString(entry.id)
		) {
			throw new AssetIntegrityError('Tcl runtime patch metadata is invalid', {
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
				profileId: payload.profileId
			});
		}
		return entry.id;
	});
	if (
		ids
			.slice()
			.sort()
			.some((id, index) => id !== EXPECTED_PATCHES[index])
	) {
		throw new AssetIntegrityError('Tcl runtime patch metadata is invalid', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		});
	}
	return ids.map((id) => ({ id }));
}

function normalizeLicenses(
	value: unknown,
	payload: TclRuntimePreflightPayload,
	maxAssetBytes: number
): UnknownRecord[] {
	if (!Array.isArray(value) || value.length !== Object.keys(EXPECTED_LICENSES).length) {
		throw new AssetIntegrityError('Tcl runtime license metadata is invalid', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		});
	}
	const seen = new Set<string>();
	return value.map((entry) => {
		if (
			!isPlainRecord(entry) ||
			!hasExactKeys(entry, ['path', 'sha256', 'size', 'spdx']) ||
			!requireNonEmptyString(entry.path) ||
			seen.has(entry.path) ||
			EXPECTED_LICENSES[entry.path as keyof typeof EXPECTED_LICENSES] !== entry.spdx ||
			!Number.isSafeInteger(entry.size) ||
			(entry.size as number) <= 0 ||
			(entry.size as number) > maxAssetBytes ||
			!isSha256(entry.sha256)
		) {
			throw new AssetIntegrityError('Tcl runtime license metadata is invalid', {
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
				profileId: payload.profileId
			});
		}
		seen.add(entry.path);
		return {
			path: entry.path,
			spdx: entry.spdx,
			size: entry.size,
			sha256: entry.sha256
		};
	});
}

function canonicalValue(kind: string, value: UnknownRecord | UnknownRecord[]): string {
	if (Array.isArray(value)) {
		return [...value]
			.sort((left, right) => compareNames(JSON.stringify(left), JSON.stringify(right)))
			.map((entry) => `${kind}\0${JSON.stringify(entry)}\n`)
			.join('');
	}
	return Object.entries(value)
		.sort(([left], [right]) => compareNames(left, right))
		.map(([name, entry]) => `${kind}\0${name}\0${JSON.stringify(entry)}\n`)
		.join('');
}

async function sha256Hex(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
	if (!globalThis.crypto?.subtle) {
		throw new AssetIntegrityError('Web Crypto SHA-256 is unavailable', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
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

async function normalizeManifest(
	value: unknown,
	payload: TclRuntimePreflightPayload,
	maxAssetBytes: number,
	signal?: AbortSignal
): Promise<NormalizedManifest> {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, MANIFEST_KEYS) ||
		value.format !== TCL_MANIFEST_FORMAT ||
		value.runtime !== 'wacl' ||
		value.profileId !== payload.profileId ||
		value.fingerprint !== payload.manifestFingerprint
	) {
		throw new AssetIntegrityError('Tcl runtime manifest identity is invalid', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		});
	}
	const artifact = normalizeArtifact(value.artifact, payload);
	const components = normalizeComponents(value.components, payload);
	const patches = normalizePatches(value.patches, payload);
	const licenses = normalizeLicenses(value.licenses, payload, maxAssetBytes);
	const metadata = normalizeReceipt(
		value.metadata,
		'runtime-build.json',
		'application/json',
		maxAssetBytes
	);
	if (!Array.isArray(value.assets) || value.assets.length !== 5) {
		throw new AssetIntegrityError(
			'Tcl runtime manifest must declare exactly five logical assets',
			{
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
				profileId: payload.profileId
			}
		);
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 5) {
		throw new AssetIntegrityError(
			'Tcl runtime manifest must declare exactly five storage assets',
			{
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
				profileId: payload.profileId
			}
		);
	}
	const assetByPath = new Map<string, ManifestReceipt>();
	for (const candidate of value.assets) {
		const path =
			isPlainRecord(candidate) && typeof candidate.path === 'string' ? candidate.path : '';
		const mediaType = EXPECTED_LOGICAL_ASSETS[path as keyof typeof EXPECTED_LOGICAL_ASSETS];
		if (!mediaType || assetByPath.has(path)) {
			throw new AssetIntegrityError(
				'Tcl runtime manifest has an unexpected or duplicate logical asset',
				{ runtimeId: TCL_PREFLIGHT_RUNTIME_ID, profileId: payload.profileId }
			);
		}
		assetByPath.set(path, normalizeReceipt(candidate, path, mediaType, maxAssetBytes));
	}
	const storageByPath = new Map<string, ManifestStorageReceipt>();
	for (const candidate of value.storage) {
		const path =
			isPlainRecord(candidate) && typeof candidate.path === 'string' ? candidate.path : '';
		const expected = EXPECTED_STORAGE[path as keyof typeof EXPECTED_STORAGE];
		if (!expected || storageByPath.has(path)) {
			throw new AssetIntegrityError(
				'Tcl runtime manifest has an unexpected or duplicate storage asset',
				{ runtimeId: TCL_PREFLIGHT_RUNTIME_ID, profileId: payload.profileId }
			);
		}
		storageByPath.set(
			path,
			normalizeStorageReceipt(
				candidate,
				path,
				expected.logicalPath,
				expected.encoding as 'gzip' | 'identity',
				maxAssetBytes
			)
		);
	}
	if (
		Object.keys(EXPECTED_LOGICAL_ASSETS).some((path) => !assetByPath.has(path)) ||
		Object.keys(EXPECTED_STORAGE).some((path) => !storageByPath.has(path))
	) {
		throw new AssetIntegrityError('Tcl runtime manifest is missing a required asset', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		});
	}
	for (const receipt of storageByPath.values()) {
		const logicalReceipt = assetByPath.get(receipt.logicalPath);
		if (
			receipt.encoding === 'identity' &&
			(receipt.size !== logicalReceipt?.size || receipt.sha256 !== logicalReceipt.sha256)
		) {
			throw new AssetIntegrityError(
				`Tcl runtime identity storage receipt does not match ${receipt.logicalPath}`,
				{ runtimeId: TCL_PREFLIGHT_RUNTIME_ID, profileId: payload.profileId }
			);
		}
	}
	let canonical = `${TCL_FINGERPRINT_DOMAIN}\nformat\0${TCL_MANIFEST_FORMAT}\nruntime\0wacl\nprofileId\0${payload.profileId}\n`;
	canonical += canonicalValue('artifact', artifact);
	canonical += canonicalValue('component', components);
	canonical += canonicalValue('patch', patches);
	for (const license of [...licenses].sort((left, right) =>
		compareNames(String(left.path), String(right.path))
	)) {
		canonical += `license\0${String(license.path)}\0${String(license.spdx)}\0${String(license.size)}\0${String(license.sha256)}\n`;
	}
	canonical += `metadata\0${metadata.path}\0${metadata.mediaType}\0${metadata.size}\0${metadata.sha256}\n`;
	for (const asset of [...assetByPath.values()].sort((left, right) =>
		compareNames(left.path, right.path)
	)) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const storage of [...storageByPath.values()].sort((left, right) =>
		compareNames(left.path, right.path)
	)) {
		canonical += `storage\0${storage.path}\0${storage.logicalPath}\0${storage.encoding}\0${storage.size}\0${storage.sha256}\n`;
	}
	if ((await sha256Hex(textEncoder.encode(canonical), signal)) !== payload.manifestFingerprint) {
		throw new AssetIntegrityError('Tcl runtime receipt graph failed fingerprint verification', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		});
	}
	return Object.freeze({ value, assetByPath, storageByPath });
}

function decodeManifest(bytes: Uint8Array, profileId?: string): unknown {
	try {
		return JSON.parse(fatalDecoder.decode(bytes));
	} catch {
		throw new AssetIntegrityError('Tcl runtime manifest is not valid UTF-8 JSON', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId
		});
	}
}

function identityPayload(profile: Readonly<Required<TclRuntimePreflightProfile>>) {
	return {
		protocol: TCL_PREFLIGHT_PROTOCOL,
		protocolVersion: TCL_PREFLIGHT_PROTOCOL_VERSION,
		profileId: profile.profileId,
		artifactRevision: profile.artifactRevision,
		waclRevision: profile.waclRevision,
		tclRevision: profile.tclRevision,
		requireJsRevision: profile.requireJsRevision,
		emscriptenRevision: profile.emscriptenRevision,
		manifestFingerprint: profile.manifestFingerprint
	} as const;
}

function matchesReceipt(
	receipt: ManifestReceipt | ManifestStorageReceipt | undefined,
	expected: RuntimeAssetIntegrityEntry,
	logical: boolean
): boolean {
	return (
		!!receipt &&
		receipt.size === (logical ? expected.uncompressedBytes : expected.bytes) &&
		receipt.sha256 === (logical ? expected.uncompressedSha256 : expected.sha256)
	);
}

async function assertManifestMatchesProfile(
	manifestBytes: Uint8Array,
	profile: Readonly<Required<TclRuntimePreflightProfile>>,
	maxAssetBytes: number,
	signal?: AbortSignal
): Promise<void> {
	const payload = {
		...identityPayload(profile),
		manifestBytes,
		requireJsBytes: new Uint8Array(),
		customDataBytes: new Uint8Array(),
		libraryDataBytes: new Uint8Array(),
		glueBytes: new Uint8Array(),
		wasmBytes: new Uint8Array()
	} satisfies TclRuntimePreflightPayload;
	const manifest = await normalizeManifest(
		decodeManifest(manifestBytes, profile.profileId),
		payload,
		maxAssetBytes,
		signal
	);
	const matches =
		matchesReceipt(
			manifest.assetByPath.get(REQUIRE_JS_PATH),
			profile.requireJsReceipt,
			false
		) &&
		matchesReceipt(
			manifest.storageByPath.get(REQUIRE_JS_PATH),
			profile.requireJsReceipt,
			false
		) &&
		matchesReceipt(
			manifest.assetByPath.get(CUSTOM_DATA_PATH),
			profile.customDataReceipt,
			false
		) &&
		matchesReceipt(
			manifest.storageByPath.get(CUSTOM_DATA_STORAGE_PATH),
			profile.customDataReceipt,
			false
		) &&
		matchesReceipt(
			manifest.assetByPath.get(LIBRARY_DATA_PATH),
			profile.libraryDataReceipt,
			true
		) &&
		matchesReceipt(
			manifest.storageByPath.get(LIBRARY_DATA_STORAGE_PATH),
			profile.libraryDataReceipt,
			false
		) &&
		matchesReceipt(manifest.assetByPath.get(GLUE_PATH), profile.glueReceipt, false) &&
		matchesReceipt(manifest.storageByPath.get(GLUE_PATH), profile.glueReceipt, false) &&
		matchesReceipt(manifest.assetByPath.get(WASM_PATH), profile.wasmReceipt, true) &&
		matchesReceipt(manifest.storageByPath.get(WASM_STORAGE_PATH), profile.wasmReceipt, false);
	if (!matches) {
		throw new AssetIntegrityError(
			'Tcl runtime manifest receipts do not match the selected preflight profile',
			{ runtimeId: TCL_PREFLIGHT_RUNTIME_ID, profileId: profile.profileId }
		);
	}
}

async function verifyLogicalBytes(
	asset: string,
	bytes: Uint8Array,
	receipt: ManifestReceipt,
	profileId: string,
	signal?: AbortSignal
): Promise<void> {
	await waitForAbortable(
		verifyRuntimeAssetIntegrity({
			asset,
			bytes,
			expected: {
				sha256: receipt.sha256,
				bytes: receipt.size
			},
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId
		}),
		signal
	);
}

export async function verifyTclRuntimePreflightPayload(
	value: unknown,
	options: { readonly maxAssetBytes?: number; readonly signal?: AbortSignal } = {}
): Promise<TclRuntimePreflightPayload> {
	const payload = requireTclRuntimePreflightPayload(value);
	const maxAssetBytes = Math.min(
		options.maxAssetBytes ?? TCL_MAX_ASSET_BYTES,
		TCL_MAX_ASSET_BYTES
	);
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new RuntimeConfigurationError('Tcl runtime asset byte limit is invalid', {
			phase: 'asset',
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		});
	}
	const byteEntries = [
		['manifest', payload.manifestBytes, Math.min(MAX_MANIFEST_BYTES, maxAssetBytes)],
		['RequireJS', payload.requireJsBytes, maxAssetBytes],
		['custom data', payload.customDataBytes, maxAssetBytes],
		['library data', payload.libraryDataBytes, maxAssetBytes],
		['glue', payload.glueBytes, maxAssetBytes],
		['Wasm', payload.wasmBytes, maxAssetBytes]
	] as const;
	for (const [label, bytes, limit] of byteEntries) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new AssetTooLargeError(`Tcl runtime ${label} exceeds the ${limit} byte limit`, {
				actual: bytes.byteLength,
				limit,
				phase: 'asset',
				profileId: payload.profileId,
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	const totalLogicalBytes = byteEntries
		.slice(1)
		.reduce((total, [, bytes]) => total + bytes.byteLength, 0);
	if (totalLogicalBytes > TCL_MAX_TOTAL_LOGICAL_BYTES) {
		throw new AssetTooLargeError(
			`Tcl runtime logical payload exceeds the ${TCL_MAX_TOTAL_LOGICAL_BYTES} byte limit`,
			{
				actual: totalLogicalBytes,
				limit: TCL_MAX_TOTAL_LOGICAL_BYTES,
				phase: 'asset',
				profileId: payload.profileId,
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const manifest = await normalizeManifest(
		decodeManifest(payload.manifestBytes, payload.profileId),
		payload,
		maxAssetBytes,
		options.signal
	);
	await Promise.all([
		verifyLogicalBytes(
			REQUIRE_JS_PATH,
			payload.requireJsBytes,
			manifest.assetByPath.get(REQUIRE_JS_PATH)!,
			payload.profileId,
			options.signal
		),
		verifyLogicalBytes(
			CUSTOM_DATA_PATH,
			payload.customDataBytes,
			manifest.assetByPath.get(CUSTOM_DATA_PATH)!,
			payload.profileId,
			options.signal
		),
		verifyLogicalBytes(
			LIBRARY_DATA_PATH,
			payload.libraryDataBytes,
			manifest.assetByPath.get(LIBRARY_DATA_PATH)!,
			payload.profileId,
			options.signal
		),
		verifyLogicalBytes(
			GLUE_PATH,
			payload.glueBytes,
			manifest.assetByPath.get(GLUE_PATH)!,
			payload.profileId,
			options.signal
		),
		verifyLogicalBytes(
			WASM_PATH,
			payload.wasmBytes,
			manifest.assetByPath.get(WASM_PATH)!,
			payload.profileId,
			options.signal
		)
	]);
	let glueSource: string;
	try {
		fatalDecoder.decode(payload.requireJsBytes);
		glueSource = fatalDecoder.decode(payload.glueBytes);
	} catch {
		throw new AssetIntegrityError('Tcl runtime scripts are not valid UTF-8 JavaScript', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		});
	}
	if (
		!glueSource.startsWith('define("tcl/wacl",') ||
		!glueSource.includes(VERIFIED_WASM_GLUE_PATCH)
	) {
		throw new AssetIntegrityError(
			'Tcl runtime glue is missing the verified Wasm bootstrap patch',
			{
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
				profileId: payload.profileId
			}
		);
	}
	return payload;
}

async function decompressGzipBounded(
	compressedBytes: Uint8Array,
	expectedBytes: number,
	maxAssetBytes: number,
	label: 'libraryData' | 'wasm',
	signal: AbortSignal,
	reportProgress?: (
		asset: 'libraryData' | 'wasm',
		loadedBytes: number,
		totalBytes: number
	) => void
): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!Number.isSafeInteger(expectedBytes) ||
		expectedBytes <= 0 ||
		expectedBytes > maxAssetBytes
	) {
		throw new AssetTooLargeError(
			`Tcl runtime ${label} logical bytes exceed the ${maxAssetBytes} byte limit`,
			{ actual: expectedBytes, limit: maxAssetBytes, runtimeId: TCL_PREFLIGHT_RUNTIME_ID }
		);
	}
	let reader: ReadableStreamDefaultReader<Uint8Array>;
	try {
		reader = new ReadableStream<BufferSource>({
			start(controller) {
				controller.enqueue(Uint8Array.from(compressedBytes));
				controller.close();
			}
		})
			.pipeThrough(new DecompressionStream('gzip'))
			.getReader();
	} catch (error) {
		throw new AssetIntegrityError(`Tcl runtime ${label} gzip stream could not be opened`, {
			cause: error,
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
		});
	}
	const output = new Uint8Array(expectedBytes);
	let offset = 0;
	const cancelReader = (reason: unknown) => {
		try {
			void reader.cancel(reason).catch(() => undefined);
		} catch {
			// Preserve the failure that triggered cancellation.
		}
	};
	const cancelOnAbort = () => cancelReader(signal.reason);
	signal.addEventListener('abort', cancelOnAbort, { once: true });
	try {
		while (true) {
			if (signal.aborted) {
				throw (
					signal.reason ??
					new DOMException('Tcl runtime decompression aborted', 'AbortError')
				);
			}
			const { done, value } = await waitForAbortable(reader.read(), signal);
			if (done) break;
			if (!isByteArray(value)) {
				throw new AssetIntegrityError(`Tcl runtime ${label} gzip returned invalid bytes`, {
					runtimeId: TCL_PREFLIGHT_RUNTIME_ID
				});
			}
			const nextOffset = offset + value.byteLength;
			if (!Number.isSafeInteger(nextOffset) || nextOffset > output.byteLength) {
				throw new AssetTooLargeError(
					`Tcl runtime ${label} gzip exceeds its logical receipt size`,
					{
						actual: nextOffset,
						limit: output.byteLength,
						runtimeId: TCL_PREFLIGHT_RUNTIME_ID
					}
				);
			}
			output.set(value, offset);
			offset = nextOffset;
			reportProgress?.(label, offset, output.byteLength);
		}
	} catch (error) {
		cancelReader(error);
		if (!signal.aborted && !isWasmIdleError(error)) {
			throw new AssetIntegrityError(`Tcl runtime ${label} gzip decompression failed`, {
				cause: error,
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		signal.removeEventListener('abort', cancelOnAbort);
		try {
			reader.releaseLock();
		} catch {
			// Preserve the decompression outcome.
		}
	}
	if (offset !== output.byteLength) {
		throw new AssetIntegrityError(`Tcl runtime ${label} gzip output is truncated`, {
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
		});
	}
	return output;
}

export async function preflightTclRuntimeAssets(
	request: TclRuntimePreflightRequest
): Promise<TclRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('Tcl runtime preflight request is required', {
			phase: 'asset',
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
		});
	}
	const profile = snapshotTclRuntimePreflightProfile(request.profile);
	let baseUrl: URL;
	let manifestUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
		manifestUrl = new URL(request.manifestUrl, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError('Tcl runtime asset URLs are invalid', {
			cause: error,
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID
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
			'Tcl runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: TCL_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (
		(manifestUrl.protocol !== 'http:' && manifestUrl.protocol !== 'https:') ||
		manifestUrl.username ||
		manifestUrl.password ||
		manifestUrl.hash ||
		manifestUrl.origin !== baseUrl.origin ||
		!manifestUrl.pathname.startsWith(baseUrl.pathname)
	) {
		throw new RuntimeConfigurationError(
			'Tcl runtime manifest must be an HTTP(S) asset beneath the configured runtime base',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: TCL_PREFLIGHT_RUNTIME_ID }
		);
	}
	const manifestPath = manifestUrl.pathname.slice(baseUrl.pathname.length);
	if (
		!manifestPath ||
		manifestPath.includes('\\') ||
		manifestPath.includes('\0') ||
		manifestPath
			.split('/')
			.some((segment) => !segment || segment === '.' || segment === '..') ||
		Object.keys(EXPECTED_STORAGE).includes(manifestPath)
	) {
		throw new RuntimeConfigurationError(
			'Tcl runtime manifest path must be a distinct normalized file beneath the runtime base',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: TCL_PREFLIGHT_RUNTIME_ID }
		);
	}
	const expectedManifestQuery = `?v=${profile.manifestFingerprint}`;
	if (manifestUrl.search && manifestUrl.search !== expectedManifestQuery) {
		throw new RuntimeConfigurationError(
			'Tcl runtime manifest query must be the pinned fingerprint cache-buster',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: TCL_PREFLIGHT_RUNTIME_ID }
		);
	}
	const limits = resolveExecutionLimits(request.limits);
	const maxAssetBytes = Math.min(limits.maxAssetBytes, TCL_MAX_ASSET_BYTES);
	const declaredSizes = [
		['manifest', profile.manifestReceipt.bytes, Math.min(MAX_MANIFEST_BYTES, maxAssetBytes)],
		['RequireJS', profile.requireJsReceipt.bytes, maxAssetBytes],
		['custom data', profile.customDataReceipt.bytes, maxAssetBytes],
		['library storage', profile.libraryDataReceipt.bytes, maxAssetBytes],
		['library data', profile.libraryDataReceipt.uncompressedBytes, maxAssetBytes],
		['glue', profile.glueReceipt.bytes, maxAssetBytes],
		['Wasm storage', profile.wasmReceipt.bytes, maxAssetBytes],
		['Wasm', profile.wasmReceipt.uncompressedBytes, maxAssetBytes]
	] as const;
	for (const [label, bytes, limit] of declaredSizes) {
		if ((bytes ?? 0) > limit) {
			throw new AssetTooLargeError(`Tcl runtime ${label} exceeds the ${limit} byte limit`, {
				actual: bytes,
				limit,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	const totalLogicalBytes =
		profile.requireJsReceipt.bytes! +
		profile.customDataReceipt.bytes! +
		profile.libraryDataReceipt.uncompressedBytes! +
		profile.glueReceipt.bytes! +
		profile.wasmReceipt.uncompressedBytes!;
	if (totalLogicalBytes > TCL_MAX_TOTAL_LOGICAL_BYTES) {
		throw new AssetTooLargeError(
			`Tcl runtime logical payload exceeds the ${TCL_MAX_TOTAL_LOGICAL_BYTES} byte limit`,
			{
				actual: totalLogicalBytes,
				limit: TCL_MAX_TOTAL_LOGICAL_BYTES,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const manifestRequestUrl = new URL(manifestUrl);
	if (!manifestRequestUrl.search)
		manifestRequestUrl.searchParams.set('v', profile.manifestFingerprint);
	const assetRequestUrl = (path: string, receipt: RuntimeAssetIntegrityEntry) => {
		const url = new URL(path, baseUrl);
		url.searchParams.set('v', receipt.sha256);
		return url;
	};
	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/tcl-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'TCL',
					implementationId: 'Wacl',
					implementationVersion: profile.profileId,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: profile.manifestReceipt.sha256,
						protocolVersion: TCL_PREFLIGHT_PROTOCOL_VERSION,
						trustProfileId: 'wasm-idle-static-worker-v1',
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
				workerLifetime: { mode: 'per-run' },
				requiredBrowserFeatures: ['wasm', 'decompression-stream'],
				assetRoot: '.',
				assets: [
					{
						key: 'manifest',
						path: manifestPath,
						compressedSha256: profile.manifestReceipt.sha256,
						uncompressedSha256: profile.manifestReceipt.sha256,
						compressedBytes: profile.manifestReceipt.bytes!,
						uncompressedBytes: profile.manifestReceipt.bytes!,
						mediaType: 'application/json',
						encoding: 'identity'
					},
					{
						key: 'requireJs',
						path: REQUIRE_JS_PATH,
						compressedSha256: profile.requireJsReceipt.sha256,
						uncompressedSha256: profile.requireJsReceipt.sha256,
						compressedBytes: profile.requireJsReceipt.bytes!,
						uncompressedBytes: profile.requireJsReceipt.bytes!,
						mediaType: 'text/javascript',
						encoding: 'identity'
					},
					{
						key: 'customData',
						path: CUSTOM_DATA_STORAGE_PATH,
						compressedSha256: profile.customDataReceipt.sha256,
						uncompressedSha256: profile.customDataReceipt.sha256,
						compressedBytes: profile.customDataReceipt.bytes!,
						uncompressedBytes: profile.customDataReceipt.bytes!,
						mediaType: 'application/octet-stream',
						encoding: 'identity'
					},
					{
						key: 'libraryData',
						path: LIBRARY_DATA_STORAGE_PATH,
						compressedSha256: profile.libraryDataReceipt.sha256,
						uncompressedSha256: profile.libraryDataReceipt.uncompressedSha256!,
						compressedBytes: profile.libraryDataReceipt.bytes!,
						uncompressedBytes: profile.libraryDataReceipt.uncompressedBytes!,
						mediaType: 'application/octet-stream',
						encoding: 'gzip'
					},
					{
						key: 'glue',
						path: GLUE_PATH,
						compressedSha256: profile.glueReceipt.sha256,
						uncompressedSha256: profile.glueReceipt.sha256,
						compressedBytes: profile.glueReceipt.bytes!,
						uncompressedBytes: profile.glueReceipt.bytes!,
						mediaType: 'text/javascript',
						encoding: 'identity'
					},
					{
						key: 'wasm',
						path: WASM_STORAGE_PATH,
						compressedSha256: profile.wasmReceipt.sha256,
						uncompressedSha256: profile.wasmReceipt.uncompressedSha256!,
						compressedBytes: profile.wasmReceipt.bytes!,
						uncompressedBytes: profile.wasmReceipt.uncompressedBytes!,
						mediaType: 'application/wasm',
						encoding: 'gzip'
					}
				],
				contracts: {
					routeId: 'tcl',
					runtimeAssetKey: 'tcl',
					documentationId: 'TCL',
					syncTarget: 'sync:wasm-tcl',
					browserTestId: 'browser:tcl'
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
		controller.abort(new DOMException('Tcl runtime preflight timed out', 'TimeoutError'));
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
			rootUrl: baseUrl,
			assetUrls: {
				manifest: manifestRequestUrl,
				requireJs: assetRequestUrl(REQUIRE_JS_PATH, profile.requireJsReceipt),
				customData: assetRequestUrl(CUSTOM_DATA_STORAGE_PATH, profile.customDataReceipt),
				libraryData: assetRequestUrl(LIBRARY_DATA_STORAGE_PATH, profile.libraryDataReceipt),
				glue: assetRequestUrl(GLUE_PATH, profile.glueReceipt),
				wasm: assetRequestUrl(WASM_STORAGE_PATH, profile.wasmReceipt)
			},
			fetch: request.fetch,
			signal: controller.signal,
			limits: { ...limits, maxAssetBytes },
			redirect: 'error',
			maxConcurrentDownloads: 6,
			reportProgress: request.reportProgress
		});
		const manifestAsset = preflight.assets.manifest;
		const requireJsAsset = preflight.assets.requireJs;
		const customDataAsset = preflight.assets.customData;
		const libraryDataAsset = preflight.assets.libraryData;
		const glueAsset = preflight.assets.glue;
		const wasmAsset = preflight.assets.wasm;
		if (
			!manifestAsset ||
			!requireJsAsset ||
			!customDataAsset ||
			!libraryDataAsset ||
			!glueAsset ||
			!wasmAsset
		) {
			throw new RuntimeConfigurationError(
				'Tcl runtime preflight returned an incomplete asset set',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: TCL_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		await assertManifestMatchesProfile(
			manifestAsset.bytes,
			profile,
			maxAssetBytes,
			controller.signal
		);
		for (const [label, asset] of [
			['libraryData', libraryDataAsset],
			['wasm', wasmAsset]
		] as const) {
			if (asset.bytes[0] !== 0x1f || asset.bytes[1] !== 0x8b) {
				throw new AssetIntegrityError(`Tcl runtime ${label} storage is not gzip data`, {
					profileId: profile.profileId,
					runtimeId: TCL_PREFLIGHT_RUNTIME_ID
				});
			}
		}
		const abortOnDecompressionFailure = async (operation: Promise<Uint8Array>) => {
			try {
				return await operation;
			} catch (error) {
				controller.abort(error);
				throw error;
			}
		};
		const [libraryDataBytes, wasmBytes] = await Promise.all([
			abortOnDecompressionFailure(
				decompressGzipBounded(
					libraryDataAsset.bytes,
					profile.libraryDataReceipt.uncompressedBytes!,
					maxAssetBytes,
					'libraryData',
					controller.signal,
					request.reportDecompressionProgress
				)
			),
			abortOnDecompressionFailure(
				decompressGzipBounded(
					wasmAsset.bytes,
					profile.wasmReceipt.uncompressedBytes!,
					maxAssetBytes,
					'wasm',
					controller.signal,
					request.reportDecompressionProgress
				)
			)
		]);
		const payload: TclRuntimePreflightPayload = Object.freeze({
			...identityPayload(profile),
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			requireJsBytes: Uint8Array.from(requireJsAsset.bytes),
			customDataBytes: Uint8Array.from(customDataAsset.bytes),
			libraryDataBytes,
			glueBytes: Uint8Array.from(glueAsset.bytes),
			wasmBytes
		});
		return await verifyTclRuntimePreflightPayload(payload, {
			maxAssetBytes,
			signal: controller.signal
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`Tcl runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: TCL_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('Tcl runtime preflight cancelled', {
				cause: request.signal.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: TCL_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
