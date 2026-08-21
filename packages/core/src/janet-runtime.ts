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

export const JANET_PREFLIGHT_PROTOCOL = 'wasm-idle-janet-preflight' as const;
export const JANET_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const JANET_PREFLIGHT_RUNTIME_ID = 'JANET' as const;
export const JANET_MAX_ASSET_BYTES = 8 * 1024 * 1024;

const JANET_MAX_TOTAL_LOGICAL_BYTES = 16 * 1024 * 1024;
const JANET_MANIFEST_FORMAT = 'wasm-janet-runtime-manifest-v2';
const JANET_FINGERPRINT_DOMAIN = 'wasm-idle:janet-runtime-manifest:v2';
const MAX_MANIFEST_BYTES = 64 * 1024;
const JAVASCRIPT_PATH = 'janet.js';
const WASM_PATH = 'janet.wasm';
const WASM_STORAGE_PATH = 'janet.wasm.gz.bin';
const EXPECTED_LICENSE_EXPRESSION = 'MIT';
const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

const PROFILE_KEYS = [
	'artifactRevision',
	'emscriptenVersion',
	'janetVersion',
	'javascriptReceipt',
	'manifestFingerprint',
	'manifestReceipt',
	'profileId',
	'wasmReceipt'
] as const;
const PAYLOAD_KEYS = [
	'artifactRevision',
	'emscriptenVersion',
	'janetVersion',
	'javascriptBytes',
	'manifestBytes',
	'manifestFingerprint',
	'profileId',
	'protocol',
	'protocolVersion',
	'wasmBytes'
] as const;
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
const LICENSE_RECEIPT_KEYS = ['path', 'sha256', 'size', 'spdx'] as const;
const EXPECTED_LOGICAL_ASSETS = Object.freeze({
	[JAVASCRIPT_PATH]: 'text/javascript',
	[WASM_PATH]: 'application/wasm'
});
const EXPECTED_STORAGE = Object.freeze({
	[JAVASCRIPT_PATH]: Object.freeze({ logicalPath: JAVASCRIPT_PATH, encoding: 'identity' }),
	[WASM_STORAGE_PATH]: Object.freeze({ logicalPath: WASM_PATH, encoding: 'gzip' })
});
const EXPECTED_BUILD_OPTIONS = Object.freeze([
	'ENVIRONMENT=worker',
	'MODULARIZE=1',
	'EXPORT_ES6=1',
	'FORCE_FILESYSTEM=1',
	'INVOKE_RUN=0',
	'EXIT_RUNTIME=1',
	'JANET_REDUCED_OS'
]);
const EXPECTED_BUILD = Object.freeze({
	options: EXPECTED_BUILD_OPTIONS,
	runner: Object.freeze({
		path: 'scripts/runtime-build/wasm-janet-runner.c',
		verifiedBuildInput: false,
		bytes: 1378,
		sha256: '1a2f357f16e250ed64260a77bd11435837ae033647fb23166eb924a42b4036ee'
	})
});

export interface JanetRuntimePreflightProfile {
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly janetVersion: string;
	readonly emscriptenVersion: string;
	readonly manifestFingerprint: string;
	readonly manifestReceipt: RuntimeAssetIntegrityEntry;
	readonly javascriptReceipt: RuntimeAssetIntegrityEntry;
	readonly wasmReceipt: RuntimeAssetIntegrityEntry;
}

export interface JanetRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: JanetRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (
		asset: 'wasm',
		loadedBytes: number,
		totalBytes: number
	) => void;
}

export interface JanetRuntimePreflightPayload {
	readonly protocol: typeof JANET_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof JANET_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly janetVersion: string;
	readonly emscriptenVersion: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly javascriptBytes: Uint8Array;
	readonly wasmBytes: Uint8Array;
}

type UnknownRecord = Record<string, unknown>;
type LogicalAssetPath = typeof JAVASCRIPT_PATH | typeof WASM_PATH;
type StorageAssetPath = typeof JAVASCRIPT_PATH | typeof WASM_STORAGE_PATH;

function isPlainRecord(value: unknown): value is UnknownRecord {
	return !!value && typeof value === 'object' && !Array.isArray(value);
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

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (isPlainRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function isVersion(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(value);
}

function isRevision(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}

function expectedProfileId(
	artifactRevision: string,
	janetVersion: string,
	emscriptenVersion: string
): string {
	return `janet-${janetVersion}-emscripten-${emscriptenVersion}-wasm-idle-${artifactRevision.slice(0, 8)}`;
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
				signal.reason ?? new DOMException('Janet runtime operation aborted', 'AbortError')
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
		throw new RuntimeConfigurationError(`Janet runtime ${label} receipt is missing`, {
			phase: 'asset',
			profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	const expectedKeys = requireLogical
		? ['bytes', 'sha256', 'uncompressedBytes', 'uncompressedSha256']
		: ['bytes', 'sha256'];
	if (
		!hasExactKeys(value, expectedKeys) ||
		!Number.isSafeInteger(value.bytes) ||
		(value.bytes as number) <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256) ||
		(requireLogical &&
			(!Number.isSafeInteger(value.uncompressedBytes) ||
				(value.uncompressedBytes as number) <= 0 ||
				typeof value.uncompressedSha256 !== 'string' ||
				!/^[a-f0-9]{64}$/u.test(value.uncompressedSha256)))
	) {
		throw new RuntimeConfigurationError(`Janet runtime ${label} receipt is invalid`, {
			phase: 'asset',
			profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
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

export function snapshotJanetRuntimePreflightProfile(
	value: unknown
): Readonly<Required<JanetRuntimePreflightProfile>> {
	if (!isPlainRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) {
		throw new RuntimeConfigurationError('Janet runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!isRevision(value.artifactRevision) ||
		!isVersion(value.janetVersion) ||
		!isVersion(value.emscriptenVersion) ||
		value.profileId !==
			expectedProfileId(
				value.artifactRevision,
				value.janetVersion,
				value.emscriptenVersion
			) ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('Janet runtime preflight identity is invalid', {
			phase: 'asset',
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	return Object.freeze({
		profileId: value.profileId,
		artifactRevision: value.artifactRevision,
		janetVersion: value.janetVersion,
		emscriptenVersion: value.emscriptenVersion,
		manifestFingerprint: value.manifestFingerprint,
		manifestReceipt: snapshotReceipt(value.manifestReceipt, 'manifest', false, value.profileId),
		javascriptReceipt: snapshotReceipt(
			value.javascriptReceipt,
			'JavaScript',
			false,
			value.profileId
		),
		wasmReceipt: snapshotReceipt(value.wasmReceipt, 'Wasm', true, value.profileId)
	});
}

export function requireJanetRuntimePreflightPayload(value: unknown): JanetRuntimePreflightPayload {
	if (!isPlainRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
		throw new ProtocolError('Janet runtime preflight payload has an invalid shape', {
			phase: 'protocol',
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.protocol !== JANET_PREFLIGHT_PROTOCOL ||
		value.protocolVersion !== JANET_PREFLIGHT_PROTOCOL_VERSION ||
		typeof value.profileId !== 'string' ||
		!/^janet-[A-Za-z0-9._+-]+-emscripten-[A-Za-z0-9._+-]+-wasm-idle-[a-f0-9]{8}$/u.test(
			value.profileId
		) ||
		!isRevision(value.artifactRevision) ||
		!isVersion(value.janetVersion) ||
		!isVersion(value.emscriptenVersion) ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint) ||
		!isByteArray(value.manifestBytes) ||
		!isByteArray(value.javascriptBytes) ||
		!isByteArray(value.wasmBytes)
	) {
		throw new ProtocolError('Janet runtime preflight payload is invalid', {
			phase: 'protocol',
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	return value as unknown as JanetRuntimePreflightPayload;
}

export function cloneJanetRuntimePreflightPayload(value: unknown): JanetRuntimePreflightPayload {
	const payload = requireJanetRuntimePreflightPayload(value);
	return Object.freeze({
		protocol: payload.protocol,
		protocolVersion: payload.protocolVersion,
		profileId: payload.profileId,
		artifactRevision: payload.artifactRevision,
		janetVersion: payload.janetVersion,
		emscriptenVersion: payload.emscriptenVersion,
		manifestFingerprint: payload.manifestFingerprint,
		manifestBytes: Uint8Array.from(payload.manifestBytes),
		javascriptBytes: Uint8Array.from(payload.javascriptBytes),
		wasmBytes: Uint8Array.from(payload.wasmBytes)
	});
}

function expectedArtifact(revision: string): UnknownRecord {
	return {
		kind: 'opaque-vendored',
		repository: 'https://github.com/seo-rii/wasm-idle.git',
		revision,
		path: 'static/wasm-janet',
		provenance: 'legacy-import-unrecorded',
		verifiedBuildInput: false
	};
}

function expectedComponents(payload: JanetRuntimePreflightPayload): UnknownRecord {
	return {
		janet: {
			version: payload.janetVersion,
			repository: 'https://github.com/janet-lang/janet.git',
			revision: 'unrecorded',
			verifiedBuildInput: false,
			evidence: 'embedded runtime version string'
		},
		emscripten: {
			version: payload.emscriptenVersion,
			repository: 'https://github.com/emscripten-core/emscripten.git',
			revision: 'unrecorded',
			verifiedBuildInput: false,
			evidence: 'unverified metadata copied from the initial vendored runtime manifest'
		}
	};
}

function normalizeReceipt(
	value: unknown,
	expectedPath: string,
	expectedMediaType: string,
	maxAssetBytes: number,
	profileId: string
): UnknownRecord {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, RECEIPT_KEYS) ||
		value.path !== expectedPath ||
		value.mediaType !== expectedMediaType ||
		!Number.isSafeInteger(value.size) ||
		(value.size as number) <= 0 ||
		(value.size as number) > maxAssetBytes ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new AssetIntegrityError(`Janet runtime receipt is invalid for ${expectedPath}`, {
			profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	return value;
}

function normalizeManifest(
	manifest: unknown,
	payload: JanetRuntimePreflightPayload,
	maxAssetBytes: number
): {
	assetByPath: ReadonlyMap<LogicalAssetPath, UnknownRecord>;
	storageByPath: ReadonlyMap<StorageAssetPath, UnknownRecord>;
	canonical: string;
} {
	if (
		!isPlainRecord(manifest) ||
		!hasExactKeys(manifest, MANIFEST_KEYS) ||
		manifest.format !== JANET_MANIFEST_FORMAT ||
		manifest.runtime !== 'janet-lang-janet' ||
		manifest.profileId !== payload.profileId ||
		manifest.fingerprint !== payload.manifestFingerprint ||
		manifest.licenseExpression !== EXPECTED_LICENSE_EXPRESSION ||
		payload.profileId !==
			expectedProfileId(
				payload.artifactRevision,
				payload.janetVersion,
				payload.emscriptenVersion
			) ||
		canonicalJson(manifest.artifact) !==
			canonicalJson(expectedArtifact(payload.artifactRevision)) ||
		canonicalJson(manifest.components) !== canonicalJson(expectedComponents(payload)) ||
		canonicalJson(manifest.build) !== canonicalJson(EXPECTED_BUILD)
	) {
		throw new AssetIntegrityError('Janet runtime manifest identity or provenance is invalid', {
			profileId: payload.profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!isPlainRecord(manifest.license) ||
		!hasExactKeys(manifest.license, LICENSE_RECEIPT_KEYS) ||
		manifest.license.path !== 'LICENSE.txt' ||
		manifest.license.spdx !== 'MIT' ||
		!Number.isSafeInteger(manifest.license.size) ||
		(manifest.license.size as number) <= 0 ||
		(manifest.license.size as number) > maxAssetBytes ||
		typeof manifest.license.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(manifest.license.sha256)
	) {
		throw new AssetIntegrityError('Janet runtime manifest license receipt is invalid', {
			profileId: payload.profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	const metadata = normalizeReceipt(
		manifest.metadata,
		'runtime-build.json',
		'application/json',
		maxAssetBytes,
		payload.profileId
	);
	if (!Array.isArray(manifest.assets) || manifest.assets.length !== 2) {
		throw new AssetIntegrityError(
			'Janet runtime manifest must declare exactly two logical assets',
			{ profileId: payload.profileId, runtimeId: JANET_PREFLIGHT_RUNTIME_ID }
		);
	}
	const assetByPath = new Map<LogicalAssetPath, UnknownRecord>();
	for (const candidate of manifest.assets) {
		const path = isPlainRecord(candidate) ? candidate.path : undefined;
		const mediaType =
			typeof path === 'string'
				? EXPECTED_LOGICAL_ASSETS[path as keyof typeof EXPECTED_LOGICAL_ASSETS]
				: undefined;
		if (!mediaType || assetByPath.has(path as LogicalAssetPath)) {
			throw new AssetIntegrityError(
				'Janet runtime manifest has an unexpected or duplicate logical asset',
				{ profileId: payload.profileId, runtimeId: JANET_PREFLIGHT_RUNTIME_ID }
			);
		}
		assetByPath.set(
			path as LogicalAssetPath,
			normalizeReceipt(candidate, path as string, mediaType, maxAssetBytes, payload.profileId)
		);
	}
	if (!Array.isArray(manifest.storage) || manifest.storage.length !== 2) {
		throw new AssetIntegrityError(
			'Janet runtime manifest must declare exactly two storage assets',
			{ profileId: payload.profileId, runtimeId: JANET_PREFLIGHT_RUNTIME_ID }
		);
	}
	const storageByPath = new Map<StorageAssetPath, UnknownRecord>();
	for (const candidate of manifest.storage) {
		const path = isPlainRecord(candidate) ? candidate.path : undefined;
		const expected =
			typeof path === 'string'
				? EXPECTED_STORAGE[path as keyof typeof EXPECTED_STORAGE]
				: undefined;
		if (
			!isPlainRecord(candidate) ||
			!expected ||
			storageByPath.has(path as StorageAssetPath) ||
			!hasExactKeys(candidate, STORAGE_RECEIPT_KEYS) ||
			candidate.logicalPath !== expected.logicalPath ||
			candidate.encoding !== expected.encoding ||
			!Number.isSafeInteger(candidate.size) ||
			(candidate.size as number) <= 0 ||
			(candidate.size as number) > maxAssetBytes ||
			typeof candidate.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(candidate.sha256)
		) {
			throw new AssetIntegrityError(
				'Janet runtime manifest has an invalid or duplicate storage asset',
				{ profileId: payload.profileId, runtimeId: JANET_PREFLIGHT_RUNTIME_ID }
			);
		}
		storageByPath.set(path as StorageAssetPath, candidate);
	}
	if (
		Object.keys(EXPECTED_LOGICAL_ASSETS).some(
			(path) => !assetByPath.has(path as LogicalAssetPath)
		) ||
		Object.keys(EXPECTED_STORAGE).some((path) => !storageByPath.has(path as StorageAssetPath))
	) {
		throw new AssetIntegrityError('Janet runtime manifest is missing a required asset', {
			profileId: payload.profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	let canonical = `${JANET_FINGERPRINT_DOMAIN}\nformat\0${JANET_MANIFEST_FORMAT}\nruntime\0janet-lang-janet\nprofileId\0${payload.profileId}\n`;
	canonical += `licenseExpression\0${EXPECTED_LICENSE_EXPRESSION}\n`;
	canonical += `artifact\0${canonicalJson(manifest.artifact)}\n`;
	canonical += `components\0${canonicalJson(manifest.components)}\n`;
	canonical += `build\0${canonicalJson(manifest.build)}\n`;
	canonical += `license\0${String(manifest.license.path)}\0${String(manifest.license.spdx)}\0${String(manifest.license.size)}\0${String(manifest.license.sha256)}\n`;
	canonical += `metadata\0${String(metadata.path)}\0${String(metadata.mediaType)}\0${String(metadata.size)}\0${String(metadata.sha256)}\n`;
	for (const asset of [...assetByPath.values()].sort((left, right) =>
		String(left.path) < String(right.path) ? -1 : String(left.path) > String(right.path) ? 1 : 0
	)) {
		canonical += `asset\0${String(asset.path)}\0${String(asset.mediaType)}\0${String(asset.size)}\0${String(asset.sha256)}\n`;
	}
	for (const asset of [...storageByPath.values()].sort((left, right) =>
		String(left.path) < String(right.path) ? -1 : String(left.path) > String(right.path) ? 1 : 0
	)) {
		canonical += `storage\0${String(asset.path)}\0${String(asset.logicalPath)}\0${String(asset.encoding)}\0${String(asset.size)}\0${String(asset.sha256)}\n`;
	}
	return { assetByPath, storageByPath, canonical };
}

function assertLogicalTotal(entries: ReadonlyArray<number | undefined>, profileId: string): void {
	const total = entries.reduce<number>((sum, bytes) => sum + (bytes ?? 0), 0);
	if (!Number.isSafeInteger(total) || total > JANET_MAX_TOTAL_LOGICAL_BYTES) {
		throw new AssetTooLargeError(
			`Janet runtime logical assets exceed the ${JANET_MAX_TOTAL_LOGICAL_BYTES} byte aggregate limit`,
			{
				actual: total,
				limit: JANET_MAX_TOTAL_LOGICAL_BYTES,
				phase: 'asset',
				profileId,
				runtimeId: JANET_PREFLIGHT_RUNTIME_ID
			}
		);
	}
}

function includesUtf8(bytes: Uint8Array, value: string): boolean {
	const expected = textEncoder.encode(value);
	outer: for (let offset = 0; offset <= bytes.byteLength - expected.byteLength; offset += 1) {
		for (let index = 0; index < expected.byteLength; index += 1) {
			if (bytes[offset + index] !== expected[index]) continue outer;
		}
		return true;
	}
	return false;
}

export async function verifyJanetRuntimePreflightPayload(
	value: unknown,
	options: { readonly maxAssetBytes?: number; readonly signal?: AbortSignal } = {}
): Promise<JanetRuntimePreflightPayload> {
	const payload = requireJanetRuntimePreflightPayload(value);
	const maxAssetBytes = Math.min(
		options.maxAssetBytes ?? JANET_MAX_ASSET_BYTES,
		JANET_MAX_ASSET_BYTES
	);
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new RuntimeConfigurationError('Janet runtime asset byte limit is invalid', {
			phase: 'asset',
			profileId: payload.profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const [label, bytes, limit] of [
		['manifest', payload.manifestBytes, Math.min(MAX_MANIFEST_BYTES, maxAssetBytes)],
		['JavaScript', payload.javascriptBytes, maxAssetBytes],
		['Wasm', payload.wasmBytes, maxAssetBytes]
	] as const) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new AssetTooLargeError(
				`Janet runtime ${label} bytes exceed the ${limit} byte limit`,
				{
					actual: bytes.byteLength,
					limit,
					phase: 'asset',
					profileId: payload.profileId,
					runtimeId: JANET_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}
	assertLogicalTotal(
		[payload.javascriptBytes.byteLength, payload.wasmBytes.byteLength],
		payload.profileId
	);
	let manifest: unknown;
	try {
		manifest = JSON.parse(fatalDecoder.decode(payload.manifestBytes));
	} catch (error) {
		throw new AssetIntegrityError('Janet runtime manifest is not valid UTF-8 JSON', {
			cause: error,
			profileId: payload.profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	const normalized = normalizeManifest(manifest, payload, maxAssetBytes);
	await waitForAbortable(
		verifyRuntimeAssetIntegrity({
			asset: 'runtime-manifest.v2 fingerprint',
			bytes: textEncoder.encode(normalized.canonical),
			expected: payload.manifestFingerprint,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		}),
		options.signal
	);
	for (const [path, bytes] of [
		[JAVASCRIPT_PATH, payload.javascriptBytes],
		[WASM_PATH, payload.wasmBytes]
	] as const) {
		const receipt = normalized.assetByPath.get(path)!;
		await waitForAbortable(
			verifyRuntimeAssetIntegrity({
				asset: path,
				bytes,
				expected: { bytes: receipt.size as number, sha256: receipt.sha256 as string },
				runtimeId: JANET_PREFLIGHT_RUNTIME_ID,
				profileId: payload.profileId
			}),
			options.signal
		);
	}
	let javascript: string;
	try {
		javascript = fatalDecoder.decode(payload.javascriptBytes);
	} catch (error) {
		throw new AssetIntegrityError('Janet runtime JavaScript is not valid UTF-8', {
			cause: error,
			profileId: payload.profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!javascript.includes('export default Module') ||
		!javascript.includes('callMain') ||
		!javascript.includes('FS.init') ||
		!javascript.includes('Module["wasmBinary"]')
	) {
		throw new AssetIntegrityError(
			'Janet runtime JavaScript is missing the verified Emscripten module contract',
			{ profileId: payload.profileId, runtimeId: JANET_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (
		payload.wasmBytes.byteLength < 8 ||
		payload.wasmBytes[0] !== 0 ||
		payload.wasmBytes[1] !== 97 ||
		payload.wasmBytes[2] !== 115 ||
		payload.wasmBytes[3] !== 109
	) {
		throw new AssetIntegrityError('Janet runtime Wasm has an invalid module header', {
			profileId: payload.profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!includesUtf8(payload.wasmBytes, payload.janetVersion)) {
		throw new AssetIntegrityError('Janet runtime Wasm is missing its pinned version evidence', {
			profileId: payload.profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	return payload;
}

function assertManifestMatchesPreflightProfile(
	manifestBytes: Uint8Array,
	profile: Readonly<Required<JanetRuntimePreflightProfile>>
): void {
	let manifest: UnknownRecord;
	try {
		manifest = JSON.parse(fatalDecoder.decode(manifestBytes)) as UnknownRecord;
	} catch (error) {
		throw new AssetIntegrityError('Janet runtime manifest is not valid UTF-8 JSON', {
			cause: error,
			profileId: profile.profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	const logicalReceipts = new Map<string, RuntimeAssetIntegrityEntry>([
		[JAVASCRIPT_PATH, profile.javascriptReceipt],
		[
			WASM_PATH,
			{
				bytes: profile.wasmReceipt.uncompressedBytes,
				sha256: profile.wasmReceipt.uncompressedSha256!
			}
		]
	]);
	const storageReceipts = new Map<string, RuntimeAssetIntegrityEntry>([
		[JAVASCRIPT_PATH, profile.javascriptReceipt],
		[WASM_STORAGE_PATH, profile.wasmReceipt]
	]);
	const matchesReceipts = (
		entries: unknown,
		expected: ReadonlyMap<string, RuntimeAssetIntegrityEntry>
	) =>
		Array.isArray(entries) &&
		entries.length === expected.size &&
		[...expected].every(([path, receipt]) => {
			const matches = entries.filter(
				(entry) => isPlainRecord(entry) && entry.path === path
			) as UnknownRecord[];
			return (
				matches.length === 1 &&
				matches[0]!.size === receipt.bytes &&
				matches[0]!.sha256 === receipt.sha256
			);
		});
	if (
		!isPlainRecord(manifest) ||
		!matchesReceipts(manifest.assets, logicalReceipts) ||
		!matchesReceipts(manifest.storage, storageReceipts)
	) {
		throw new AssetIntegrityError(
			'Janet runtime manifest receipts do not match the selected preflight profile',
			{ profileId: profile.profileId, runtimeId: JANET_PREFLIGHT_RUNTIME_ID }
		);
	}
}

async function decompressGzipBounded(
	compressedBytes: Uint8Array,
	expectedBytes: number,
	maxAssetBytes: number,
	signal: AbortSignal,
	reportProgress?: (asset: 'wasm', loadedBytes: number, totalBytes: number) => void
): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			phase: 'asset',
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!Number.isSafeInteger(expectedBytes) ||
		expectedBytes <= 0 ||
		expectedBytes > maxAssetBytes
	) {
		throw new AssetTooLargeError(
			`Janet runtime Wasm logical bytes exceed the ${maxAssetBytes} byte limit`,
			{
				actual: expectedBytes,
				limit: maxAssetBytes,
				phase: 'asset',
				runtimeId: JANET_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const body = new Response(Uint8Array.from(compressedBytes)).body;
	if (!body) {
		throw new UnsupportedBrowserFeatureError('ReadableStream response bodies', {
			phase: 'asset',
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
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
					'Janet runtime Wasm gzip output exceeds its logical receipt',
					{ runtimeId: JANET_PREFLIGHT_RUNTIME_ID }
				);
			}
			output.set(value, offset);
			offset += value.byteLength;
			reportProgress?.('wasm', offset, output.byteLength);
		}
	} catch (error) {
		try {
			await reader.cancel(error);
		} catch {
			// Preserve the decompression failure.
		}
		if (signal.aborted || isWasmIdleError(error)) throw error;
		throw new AssetIntegrityError('Janet runtime Wasm gzip decompression failed', {
			cause: error,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
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
		throw new AssetIntegrityError('Janet runtime Wasm gzip output is truncated', {
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	return output;
}

export async function preflightJanetRuntimeAssets(
	request: JanetRuntimePreflightRequest
): Promise<JanetRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('Janet runtime preflight request is required', {
			phase: 'asset',
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
		});
	}
	const profile = snapshotJanetRuntimePreflightProfile(request.profile);
	let baseUrl: URL;
	let manifestUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
		manifestUrl = new URL(request.manifestUrl, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError('Janet runtime asset URLs are invalid', {
			cause: error,
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID
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
			'Janet runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: JANET_PREFLIGHT_RUNTIME_ID }
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
			'Janet runtime manifest must be an HTTP(S) asset beneath the configured runtime base',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: JANET_PREFLIGHT_RUNTIME_ID }
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
		[JAVASCRIPT_PATH, WASM_STORAGE_PATH].includes(manifestPath)
	) {
		throw new RuntimeConfigurationError(
			'Janet runtime manifest path must be a distinct normalized file beneath the runtime base',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: JANET_PREFLIGHT_RUNTIME_ID }
		);
	}
	const expectedManifestQuery = `?v=${profile.manifestFingerprint}`;
	if (manifestUrl.search && manifestUrl.search !== expectedManifestQuery) {
		throw new RuntimeConfigurationError(
			'Janet runtime manifest query must be the pinned fingerprint cache-buster',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: JANET_PREFLIGHT_RUNTIME_ID }
		);
	}
	const limits = resolveExecutionLimits(request.limits);
	const maxAssetBytes = Math.min(limits.maxAssetBytes, JANET_MAX_ASSET_BYTES);
	for (const [label, bytes, limit] of [
		['manifest', profile.manifestReceipt.bytes, Math.min(MAX_MANIFEST_BYTES, maxAssetBytes)],
		['JavaScript', profile.javascriptReceipt.bytes, maxAssetBytes],
		['compressed Wasm', profile.wasmReceipt.bytes, maxAssetBytes],
		['logical Wasm', profile.wasmReceipt.uncompressedBytes, maxAssetBytes]
	] as const) {
		if ((bytes ?? 0) > limit) {
			throw new AssetTooLargeError(`Janet runtime ${label} exceeds the ${limit} byte limit`, {
				actual: bytes,
				limit,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: JANET_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	assertLogicalTotal(
		[profile.javascriptReceipt.bytes, profile.wasmReceipt.uncompressedBytes],
		profile.profileId
	);
	const manifestRequestUrl = new URL(manifestUrl);
	if (!manifestRequestUrl.search) {
		manifestRequestUrl.searchParams.set('v', profile.manifestFingerprint);
	}
	const javascriptRequestUrl = new URL(JAVASCRIPT_PATH, baseUrl);
	javascriptRequestUrl.searchParams.set('v', profile.javascriptReceipt.sha256);
	const wasmRequestUrl = new URL(WASM_STORAGE_PATH, baseUrl);
	wasmRequestUrl.searchParams.set('v', profile.wasmReceipt.sha256);
	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/janet-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: JANET_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'JANET',
					implementationId: 'janet-lang-janet',
					implementationVersion: profile.janetVersion,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: profile.manifestReceipt.sha256,
						protocolVersion: JANET_PREFLIGHT_PROTOCOL_VERSION,
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
						key: 'javascript',
						path: JAVASCRIPT_PATH,
						compressedSha256: profile.javascriptReceipt.sha256,
						uncompressedSha256: profile.javascriptReceipt.sha256,
						compressedBytes: profile.javascriptReceipt.bytes!,
						uncompressedBytes: profile.javascriptReceipt.bytes!,
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
					routeId: 'janet',
					runtimeAssetKey: 'janet',
					documentationId: 'JANET',
					syncTarget: 'sync:wasm-janet',
					browserTestId: 'browser:janet'
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
		controller.abort(new DOMException('Janet runtime preflight timed out', 'TimeoutError'));
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: JANET_PREFLIGHT_RUNTIME_ID,
			rootUrl: baseUrl,
			assetUrls: {
				manifest: manifestRequestUrl,
				javascript: javascriptRequestUrl,
				wasm: wasmRequestUrl
			},
			fetch: request.fetch,
			signal: controller.signal,
			limits: { ...limits, maxAssetBytes },
			redirect: 'error',
			maxConcurrentDownloads: 3,
			reportProgress: request.reportProgress
		});
		const manifestAsset = preflight.assets.manifest;
		const javascriptAsset = preflight.assets.javascript;
		const wasmAsset = preflight.assets.wasm;
		if (!manifestAsset || !javascriptAsset || !wasmAsset) {
			throw new RuntimeConfigurationError(
				'Janet runtime preflight returned an incomplete asset set',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: JANET_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		assertManifestMatchesPreflightProfile(manifestAsset.bytes, profile);
		if (wasmAsset.bytes[0] !== 0x1f || wasmAsset.bytes[1] !== 0x8b) {
			throw new AssetIntegrityError('Janet runtime Wasm storage is not gzip data', {
				profileId: profile.profileId,
				runtimeId: JANET_PREFLIGHT_RUNTIME_ID
			});
		}
		const wasmBytes = await decompressGzipBounded(
			wasmAsset.bytes,
			profile.wasmReceipt.uncompressedBytes!,
			maxAssetBytes,
			controller.signal,
			request.reportDecompressionProgress
		);
		const payload: JanetRuntimePreflightPayload = Object.freeze({
			protocol: JANET_PREFLIGHT_PROTOCOL,
			protocolVersion: JANET_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			artifactRevision: profile.artifactRevision,
			janetVersion: profile.janetVersion,
			emscriptenVersion: profile.emscriptenVersion,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			javascriptBytes: Uint8Array.from(javascriptAsset.bytes),
			wasmBytes
		});
		return await verifyJanetRuntimePreflightPayload(payload, {
			maxAssetBytes,
			signal: controller.signal
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`Janet runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: JANET_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('Janet runtime preflight cancelled', {
				cause: request.signal.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: JANET_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
