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

export const PERL_PREFLIGHT_PROTOCOL = 'wasm-idle-perl-preflight' as const;
export const PERL_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const PERL_PREFLIGHT_RUNTIME_ID = 'PERL' as const;
export const PERL_MAX_ASSET_BYTES = 16 * 1024 * 1024;

const PERL_MAX_TOTAL_LOGICAL_BYTES = 32 * 1024 * 1024;
const PERL_MANIFEST_FORMAT = 'wasm-perl-runtime-manifest-v2';
const PERL_FINGERPRINT_DOMAIN = 'wasm-idle:perl-runtime-manifest:v2';
const MAX_MANIFEST_BYTES = 64 * 1024;
const JAVASCRIPT_PATH = 'emperl.js';
const WASM_PATH = 'emperl.wasm';
const DATA_PATH = 'emperl.data';
const JAVASCRIPT_STORAGE_PATH = 'emperl.js.gz.bin';
const WASM_STORAGE_PATH = 'emperl.wasm.gz.bin';
const DATA_STORAGE_PATH = 'emperl.data.gz.bin';
const EXPECTED_PROFILE_ID = 'webperl-v0.09-beta-perl-5.28.1-emscripten-1.38.28';
const EXPECTED_LICENSE_EXPRESSION = 'Artistic-1.0-Perl OR GPL-1.0-or-later';
const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

const PROFILE_KEYS = [
	'artifactRevision',
	'dataReceipt',
	'emscriptenRevision',
	'javascriptReceipt',
	'manifestFingerprint',
	'manifestReceipt',
	'perlRevision',
	'profileId',
	'wasmReceipt',
	'webperlRevision'
] as const;
const PAYLOAD_KEYS = [
	'artifactRevision',
	'dataBytes',
	'emscriptenRevision',
	'javascriptBytes',
	'manifestBytes',
	'manifestFingerprint',
	'perlRevision',
	'profileId',
	'protocol',
	'protocolVersion',
	'wasmBytes',
	'webperlRevision'
] as const;
const MANIFEST_KEYS = [
	'artifact',
	'assets',
	'components',
	'fingerprint',
	'format',
	'licenseExpression',
	'licenses',
	'metadata',
	'profileId',
	'runtime',
	'storage'
] as const;
const RECEIPT_KEYS = ['mediaType', 'path', 'sha256', 'size'] as const;
const STORAGE_RECEIPT_KEYS = ['encoding', 'logicalPath', 'path', 'sha256', 'size'] as const;
const LICENSE_RECEIPT_KEYS = ['path', 'sha256', 'size', 'spdx'] as const;
const EXPECTED_LICENSES = Object.freeze({
	'licenses/LICENSE_artistic.txt': 'Artistic-1.0-Perl',
	'licenses/LICENSE_gpl.txt': 'GPL-1.0-or-later'
});
const EXPECTED_LOGICAL_ASSETS = Object.freeze({
	[JAVASCRIPT_PATH]: 'text/javascript',
	[WASM_PATH]: 'application/wasm',
	[DATA_PATH]: 'application/octet-stream'
});
const EXPECTED_STORAGE = Object.freeze({
	[JAVASCRIPT_STORAGE_PATH]: Object.freeze({
		logicalPath: JAVASCRIPT_PATH,
		encoding: 'gzip'
	}),
	[WASM_STORAGE_PATH]: Object.freeze({ logicalPath: WASM_PATH, encoding: 'gzip' }),
	[DATA_STORAGE_PATH]: Object.freeze({ logicalPath: DATA_PATH, encoding: 'gzip' })
});

export interface PerlRuntimePreflightProfile {
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly webperlRevision: string;
	readonly perlRevision: string;
	readonly emscriptenRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestReceipt: RuntimeAssetIntegrityEntry;
	readonly javascriptReceipt: RuntimeAssetIntegrityEntry;
	readonly wasmReceipt: RuntimeAssetIntegrityEntry;
	readonly dataReceipt: RuntimeAssetIntegrityEntry;
}

export interface PerlRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: PerlRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (
		asset: 'javascript' | 'wasm' | 'data',
		loadedBytes: number,
		totalBytes: number
	) => void;
}

export interface PerlRuntimePreflightPayload {
	readonly protocol: typeof PERL_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof PERL_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly webperlRevision: string;
	readonly perlRevision: string;
	readonly emscriptenRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly javascriptBytes: Uint8Array;
	readonly wasmBytes: Uint8Array;
	readonly dataBytes: Uint8Array;
}

type UnknownRecord = Record<string, unknown>;
type LogicalAssetPath = typeof JAVASCRIPT_PATH | typeof WASM_PATH | typeof DATA_PATH;
type StorageAssetPath =
	| typeof JAVASCRIPT_STORAGE_PATH
	| typeof WASM_STORAGE_PATH
	| typeof DATA_STORAGE_PATH;

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

function waitForAbortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return operation;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const rejectOnAbort = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', rejectOnAbort);
			reject(
				signal.reason ?? new DOMException('WebPerl runtime operation aborted', 'AbortError')
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
		throw new RuntimeConfigurationError(`WebPerl runtime ${label} receipt is missing`, {
			phase: 'asset',
			profileId,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
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
		throw new RuntimeConfigurationError(`WebPerl runtime ${label} receipt is invalid`, {
			phase: 'asset',
			profileId,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
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

export function snapshotPerlRuntimePreflightProfile(
	value: unknown
): Readonly<Required<PerlRuntimePreflightProfile>> {
	if (!isPlainRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) {
		throw new RuntimeConfigurationError('WebPerl runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.profileId !== EXPECTED_PROFILE_ID ||
		typeof value.artifactRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.artifactRevision) ||
		typeof value.webperlRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.webperlRevision) ||
		typeof value.perlRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.perlRevision) ||
		typeof value.emscriptenRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.emscriptenRevision) ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('WebPerl runtime preflight identity is invalid', {
			phase: 'asset',
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	return Object.freeze({
		profileId: value.profileId,
		artifactRevision: value.artifactRevision,
		webperlRevision: value.webperlRevision,
		perlRevision: value.perlRevision,
		emscriptenRevision: value.emscriptenRevision,
		manifestFingerprint: value.manifestFingerprint,
		manifestReceipt: snapshotReceipt(value.manifestReceipt, 'manifest', false, value.profileId),
		javascriptReceipt: snapshotReceipt(
			value.javascriptReceipt,
			'JavaScript',
			true,
			value.profileId
		),
		wasmReceipt: snapshotReceipt(value.wasmReceipt, 'Wasm', true, value.profileId),
		dataReceipt: snapshotReceipt(value.dataReceipt, 'data', true, value.profileId)
	});
}

export function requirePerlRuntimePreflightPayload(value: unknown): PerlRuntimePreflightPayload {
	if (!isPlainRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
		throw new ProtocolError('WebPerl runtime preflight payload has an invalid shape', {
			phase: 'protocol',
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.protocol !== PERL_PREFLIGHT_PROTOCOL ||
		value.protocolVersion !== PERL_PREFLIGHT_PROTOCOL_VERSION ||
		value.profileId !== EXPECTED_PROFILE_ID ||
		typeof value.artifactRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.artifactRevision) ||
		typeof value.webperlRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.webperlRevision) ||
		typeof value.perlRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.perlRevision) ||
		typeof value.emscriptenRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.emscriptenRevision) ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint) ||
		!isByteArray(value.manifestBytes) ||
		!isByteArray(value.javascriptBytes) ||
		!isByteArray(value.wasmBytes) ||
		!isByteArray(value.dataBytes)
	) {
		throw new ProtocolError('WebPerl runtime preflight payload is invalid', {
			phase: 'protocol',
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	return value as unknown as PerlRuntimePreflightPayload;
}

export function clonePerlRuntimePreflightPayload(value: unknown): PerlRuntimePreflightPayload {
	const payload = requirePerlRuntimePreflightPayload(value);
	return Object.freeze({
		protocol: payload.protocol,
		protocolVersion: payload.protocolVersion,
		profileId: payload.profileId,
		artifactRevision: payload.artifactRevision,
		webperlRevision: payload.webperlRevision,
		perlRevision: payload.perlRevision,
		emscriptenRevision: payload.emscriptenRevision,
		manifestFingerprint: payload.manifestFingerprint,
		manifestBytes: Uint8Array.from(payload.manifestBytes),
		javascriptBytes: Uint8Array.from(payload.javascriptBytes),
		wasmBytes: Uint8Array.from(payload.wasmBytes),
		dataBytes: Uint8Array.from(payload.dataBytes)
	});
}

function expectedArtifact(revision: string): UnknownRecord {
	return {
		kind: 'opaque-prebuilt',
		repository: 'https://github.com/haukex/webperl.git',
		revision,
		tag: 'v0.09-beta',
		doi: '10.5281/zenodo.2582586',
		path: 'webperl_prebuilt_v0.09-beta.zip',
		url: 'https://zenodo.org/api/records/2582586/files/webperl_prebuilt_v0.09-beta.zip/content',
		size: 3_936_557,
		sha256: '5f441249217e90ab378c666f473d4206ab4f44907f6bb0aa8d70834bc38c40dc'
	};
}

function expectedComponents(payload: PerlRuntimePreflightPayload): UnknownRecord {
	return {
		webperl: {
			version: 'v0.09-beta',
			repository: 'https://github.com/haukex/webperl.git',
			revision: payload.webperlRevision,
			verifiedBuildInput: false,
			evidence: 'release tag and opaque prebuilt archive'
		},
		perl: {
			version: '5.28.1',
			repository: 'https://github.com/haukex/emperl5.git',
			revision: payload.perlRevision,
			verifiedBuildInput: false,
			evidence: 'embedded runtime version string and versioned WebPerl build configuration'
		},
		emscripten: {
			version: '1.38.28',
			repository: 'https://github.com/emscripten-core/emscripten.git',
			revision: payload.emscriptenRevision,
			verifiedBuildInput: false,
			evidence: 'versioned WebPerl build configuration'
		},
		cpanExtensions: {
			modules: ['Cpanel::JSON::XS', 'Devel::StackTrace', 'Future'],
			verifiedBuildInput: false,
			evidence: 'versioned WebPerl build configuration without transitive artifact locks'
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
		throw new AssetIntegrityError(`WebPerl runtime receipt is invalid for ${expectedPath}`, {
			profileId,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	return value;
}

function normalizeManifest(
	manifest: unknown,
	payload: PerlRuntimePreflightPayload,
	maxAssetBytes: number
): {
	manifest: UnknownRecord;
	assetByPath: ReadonlyMap<LogicalAssetPath, UnknownRecord>;
	storageByPath: ReadonlyMap<StorageAssetPath, UnknownRecord>;
	canonical: string;
} {
	if (
		!isPlainRecord(manifest) ||
		!hasExactKeys(manifest, MANIFEST_KEYS) ||
		manifest.format !== PERL_MANIFEST_FORMAT ||
		manifest.runtime !== 'webperl' ||
		manifest.profileId !== payload.profileId ||
		manifest.fingerprint !== payload.manifestFingerprint ||
		manifest.licenseExpression !== EXPECTED_LICENSE_EXPRESSION ||
		canonicalJson(manifest.artifact) !==
			canonicalJson(expectedArtifact(payload.artifactRevision)) ||
		canonicalJson(manifest.components) !== canonicalJson(expectedComponents(payload))
	) {
		throw new AssetIntegrityError(
			'WebPerl runtime manifest identity or provenance is invalid',
			{
				profileId: payload.profileId,
				runtimeId: PERL_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	if (!Array.isArray(manifest.licenses) || manifest.licenses.length !== 2) {
		throw new AssetIntegrityError(
			'WebPerl runtime manifest must declare exactly two licenses',
			{
				profileId: payload.profileId,
				runtimeId: PERL_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const licenses: UnknownRecord[] = [];
	const licensePaths = new Set<string>();
	for (const candidate of manifest.licenses) {
		const expectedSpdx = isPlainRecord(candidate)
			? EXPECTED_LICENSES[candidate.path as keyof typeof EXPECTED_LICENSES]
			: undefined;
		if (
			!isPlainRecord(candidate) ||
			!hasExactKeys(candidate, LICENSE_RECEIPT_KEYS) ||
			typeof candidate.path !== 'string' ||
			!expectedSpdx ||
			licensePaths.has(candidate.path) ||
			candidate.spdx !== expectedSpdx ||
			!Number.isSafeInteger(candidate.size) ||
			(candidate.size as number) <= 0 ||
			(candidate.size as number) > maxAssetBytes ||
			typeof candidate.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(candidate.sha256)
		) {
			throw new AssetIntegrityError('WebPerl runtime manifest license receipt is invalid', {
				profileId: payload.profileId,
				runtimeId: PERL_PREFLIGHT_RUNTIME_ID
			});
		}
		licensePaths.add(candidate.path);
		licenses.push(candidate);
	}
	if (Object.keys(EXPECTED_LICENSES).some((path) => !licensePaths.has(path))) {
		throw new AssetIntegrityError('WebPerl runtime manifest is missing a required license', {
			profileId: payload.profileId,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	const metadata = normalizeReceipt(
		manifest.metadata,
		'runtime-build.json',
		'application/json',
		maxAssetBytes,
		payload.profileId
	);
	if (!Array.isArray(manifest.assets) || manifest.assets.length !== 3) {
		throw new AssetIntegrityError(
			'WebPerl runtime manifest must declare exactly three logical assets',
			{ profileId: payload.profileId, runtimeId: PERL_PREFLIGHT_RUNTIME_ID }
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
				'WebPerl runtime manifest has an unexpected or duplicate logical asset',
				{ profileId: payload.profileId, runtimeId: PERL_PREFLIGHT_RUNTIME_ID }
			);
		}
		assetByPath.set(
			path as LogicalAssetPath,
			normalizeReceipt(candidate, path as string, mediaType, maxAssetBytes, payload.profileId)
		);
	}
	if (!Array.isArray(manifest.storage) || manifest.storage.length !== 3) {
		throw new AssetIntegrityError(
			'WebPerl runtime manifest must declare exactly three storage assets',
			{ profileId: payload.profileId, runtimeId: PERL_PREFLIGHT_RUNTIME_ID }
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
				'WebPerl runtime manifest has an invalid or duplicate storage asset',
				{ profileId: payload.profileId, runtimeId: PERL_PREFLIGHT_RUNTIME_ID }
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
		throw new AssetIntegrityError('WebPerl runtime manifest is missing a required asset', {
			profileId: payload.profileId,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	let canonical = `${PERL_FINGERPRINT_DOMAIN}\nformat\0${PERL_MANIFEST_FORMAT}\nruntime\0webperl\nprofileId\0${payload.profileId}\n`;
	canonical += `licenseExpression\0${EXPECTED_LICENSE_EXPRESSION}\n`;
	canonical += `artifact\0${canonicalJson(manifest.artifact)}\n`;
	canonical += `components\0${canonicalJson(manifest.components)}\n`;
	for (const license of [...licenses].sort((left, right) =>
		String(left.path) < String(right.path) ? -1 : String(left.path) > String(right.path) ? 1 : 0
	)) {
		canonical += `license\0${String(license.path)}\0${String(license.spdx)}\0${String(license.size)}\0${String(license.sha256)}\n`;
	}
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
	return { manifest, assetByPath, storageByPath, canonical };
}

function assertLogicalTotal(entries: ReadonlyArray<number | undefined>, profileId: string): void {
	const total = entries.reduce<number>((sum, bytes) => sum + (bytes ?? 0), 0);
	if (!Number.isSafeInteger(total) || total > PERL_MAX_TOTAL_LOGICAL_BYTES) {
		throw new AssetTooLargeError(
			`WebPerl runtime logical assets exceed the ${PERL_MAX_TOTAL_LOGICAL_BYTES} byte aggregate limit`,
			{
				actual: total,
				limit: PERL_MAX_TOTAL_LOGICAL_BYTES,
				phase: 'asset',
				profileId,
				runtimeId: PERL_PREFLIGHT_RUNTIME_ID
			}
		);
	}
}

export async function verifyPerlRuntimePreflightPayload(
	value: unknown,
	options: { readonly maxAssetBytes?: number; readonly signal?: AbortSignal } = {}
): Promise<PerlRuntimePreflightPayload> {
	const payload = requirePerlRuntimePreflightPayload(value);
	const maxAssetBytes = Math.min(
		options.maxAssetBytes ?? PERL_MAX_ASSET_BYTES,
		PERL_MAX_ASSET_BYTES
	);
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new RuntimeConfigurationError('WebPerl runtime asset byte limit is invalid', {
			phase: 'asset',
			profileId: payload.profileId,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const [label, bytes, limit] of [
		['manifest', payload.manifestBytes, Math.min(MAX_MANIFEST_BYTES, maxAssetBytes)],
		['JavaScript', payload.javascriptBytes, maxAssetBytes],
		['Wasm', payload.wasmBytes, maxAssetBytes],
		['data', payload.dataBytes, maxAssetBytes]
	] as const) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new AssetTooLargeError(
				`WebPerl runtime ${label} bytes exceed the ${limit} byte limit`,
				{
					actual: bytes.byteLength,
					limit,
					phase: 'asset',
					profileId: payload.profileId,
					runtimeId: PERL_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}
	assertLogicalTotal(
		[
			payload.javascriptBytes.byteLength,
			payload.wasmBytes.byteLength,
			payload.dataBytes.byteLength
		],
		payload.profileId
	);
	let manifest: unknown;
	try {
		manifest = JSON.parse(fatalDecoder.decode(payload.manifestBytes));
	} catch (error) {
		throw new AssetIntegrityError('WebPerl runtime manifest is not valid UTF-8 JSON', {
			cause: error,
			profileId: payload.profileId,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	const normalized = normalizeManifest(manifest, payload, maxAssetBytes);
	await waitForAbortable(
		verifyRuntimeAssetIntegrity({
			asset: 'runtime-manifest.v2 fingerprint',
			bytes: textEncoder.encode(normalized.canonical),
			expected: payload.manifestFingerprint,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		}),
		options.signal
	);
	for (const [path, bytes] of [
		[JAVASCRIPT_PATH, payload.javascriptBytes],
		[WASM_PATH, payload.wasmBytes],
		[DATA_PATH, payload.dataBytes]
	] as const) {
		const receipt = normalized.assetByPath.get(path)!;
		await waitForAbortable(
			verifyRuntimeAssetIntegrity({
				asset: path,
				bytes,
				expected: { bytes: receipt.size as number, sha256: receipt.sha256 as string },
				runtimeId: PERL_PREFLIGHT_RUNTIME_ID,
				profileId: payload.profileId
			}),
			options.signal
		);
	}
	let javascript: string;
	try {
		javascript = fatalDecoder.decode(payload.javascriptBytes);
	} catch (error) {
		throw new AssetIntegrityError('WebPerl runtime JavaScript is not valid UTF-8', {
			cause: error,
			profileId: payload.profileId,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!javascript.includes('Module["getPreloadedPackage"]') ||
		!javascript.includes('Module["wasmBinary"]') ||
		!javascript.includes('var Module=typeof Module!=="undefined"?Module:{}')
	) {
		throw new AssetIntegrityError(
			'WebPerl runtime JavaScript is missing the verified asset injection contract',
			{ profileId: payload.profileId, runtimeId: PERL_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (
		payload.wasmBytes.byteLength < 8 ||
		payload.wasmBytes[0] !== 0 ||
		payload.wasmBytes[1] !== 97 ||
		payload.wasmBytes[2] !== 115 ||
		payload.wasmBytes[3] !== 109
	) {
		throw new AssetIntegrityError('WebPerl runtime Wasm has an invalid module header', {
			profileId: payload.profileId,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	return payload;
}

function assertManifestMatchesPreflightProfile(
	manifestBytes: Uint8Array,
	profile: Readonly<Required<PerlRuntimePreflightProfile>>
): void {
	let manifest: UnknownRecord;
	try {
		manifest = JSON.parse(fatalDecoder.decode(manifestBytes)) as UnknownRecord;
	} catch (error) {
		throw new AssetIntegrityError('WebPerl runtime manifest is not valid UTF-8 JSON', {
			cause: error,
			profileId: profile.profileId,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	const logicalReceipts = new Map<string, RuntimeAssetIntegrityEntry>([
		[
			JAVASCRIPT_PATH,
			{
				bytes: profile.javascriptReceipt.uncompressedBytes,
				sha256: profile.javascriptReceipt.uncompressedSha256!
			}
		],
		[
			WASM_PATH,
			{
				bytes: profile.wasmReceipt.uncompressedBytes,
				sha256: profile.wasmReceipt.uncompressedSha256!
			}
		],
		[
			DATA_PATH,
			{
				bytes: profile.dataReceipt.uncompressedBytes,
				sha256: profile.dataReceipt.uncompressedSha256!
			}
		]
	]);
	const storageReceipts = new Map<string, RuntimeAssetIntegrityEntry>([
		[JAVASCRIPT_STORAGE_PATH, profile.javascriptReceipt],
		[WASM_STORAGE_PATH, profile.wasmReceipt],
		[DATA_STORAGE_PATH, profile.dataReceipt]
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
			'WebPerl runtime manifest receipts do not match the selected preflight profile',
			{ profileId: profile.profileId, runtimeId: PERL_PREFLIGHT_RUNTIME_ID }
		);
	}
}

async function decompressGzipBounded(
	compressedBytes: Uint8Array,
	expectedBytes: number,
	maxAssetBytes: number,
	label: 'javascript' | 'wasm' | 'data',
	signal: AbortSignal,
	reportProgress?: (
		asset: 'javascript' | 'wasm' | 'data',
		loadedBytes: number,
		totalBytes: number
	) => void
): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			phase: 'asset',
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!Number.isSafeInteger(expectedBytes) ||
		expectedBytes <= 0 ||
		expectedBytes > maxAssetBytes
	) {
		throw new AssetTooLargeError(
			`WebPerl runtime ${label} logical bytes exceed the ${maxAssetBytes} byte limit`,
			{
				actual: expectedBytes,
				limit: maxAssetBytes,
				phase: 'asset',
				runtimeId: PERL_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const body = new Response(Uint8Array.from(compressedBytes)).body;
	if (!body) {
		throw new UnsupportedBrowserFeatureError('ReadableStream response bodies', {
			phase: 'asset',
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
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
					`WebPerl runtime ${label} gzip output exceeds its logical receipt`,
					{ runtimeId: PERL_PREFLIGHT_RUNTIME_ID }
				);
			}
			output.set(value, offset);
			offset += value.byteLength;
			reportProgress?.(label, offset, output.byteLength);
		}
	} catch (error) {
		try {
			await reader.cancel(error);
		} catch {
			// Preserve the decompression failure.
		}
		if (signal.aborted || isWasmIdleError(error)) throw error;
		throw new AssetIntegrityError(`WebPerl runtime ${label} gzip decompression failed`, {
			cause: error,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
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
		throw new AssetIntegrityError(`WebPerl runtime ${label} gzip output is truncated`, {
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	return output;
}

export async function preflightPerlRuntimeAssets(
	request: PerlRuntimePreflightRequest
): Promise<PerlRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('WebPerl runtime preflight request is required', {
			phase: 'asset',
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
		});
	}
	const profile = snapshotPerlRuntimePreflightProfile(request.profile);
	let baseUrl: URL;
	let manifestUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
		manifestUrl = new URL(request.manifestUrl, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError('WebPerl runtime asset URLs are invalid', {
			cause: error,
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID
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
			'WebPerl runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: PERL_PREFLIGHT_RUNTIME_ID }
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
			'WebPerl runtime manifest must be an HTTP(S) asset beneath the configured runtime base',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: PERL_PREFLIGHT_RUNTIME_ID }
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
		[JAVASCRIPT_STORAGE_PATH, WASM_STORAGE_PATH, DATA_STORAGE_PATH].includes(manifestPath)
	) {
		throw new RuntimeConfigurationError(
			'WebPerl runtime manifest path must be a distinct normalized file beneath the runtime base',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: PERL_PREFLIGHT_RUNTIME_ID }
		);
	}
	const expectedManifestQuery = `?v=${profile.manifestFingerprint}`;
	if (manifestUrl.search && manifestUrl.search !== expectedManifestQuery) {
		throw new RuntimeConfigurationError(
			'WebPerl runtime manifest query must be the pinned fingerprint cache-buster',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: PERL_PREFLIGHT_RUNTIME_ID }
		);
	}
	const limits = resolveExecutionLimits(request.limits);
	const maxAssetBytes = Math.min(limits.maxAssetBytes, PERL_MAX_ASSET_BYTES);
	for (const [label, bytes, limit] of [
		['manifest', profile.manifestReceipt.bytes, Math.min(MAX_MANIFEST_BYTES, maxAssetBytes)],
		['compressed JavaScript', profile.javascriptReceipt.bytes, maxAssetBytes],
		['logical JavaScript', profile.javascriptReceipt.uncompressedBytes, maxAssetBytes],
		['compressed Wasm', profile.wasmReceipt.bytes, maxAssetBytes],
		['logical Wasm', profile.wasmReceipt.uncompressedBytes, maxAssetBytes],
		['compressed data', profile.dataReceipt.bytes, maxAssetBytes],
		['logical data', profile.dataReceipt.uncompressedBytes, maxAssetBytes]
	] as const) {
		if ((bytes ?? 0) > limit) {
			throw new AssetTooLargeError(
				`WebPerl runtime ${label} exceeds the ${limit} byte limit`,
				{
					actual: bytes,
					limit,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: PERL_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}
	assertLogicalTotal(
		[
			profile.javascriptReceipt.uncompressedBytes,
			profile.wasmReceipt.uncompressedBytes,
			profile.dataReceipt.uncompressedBytes
		],
		profile.profileId
	);
	const manifestRequestUrl = new URL(manifestUrl);
	if (!manifestRequestUrl.search) {
		manifestRequestUrl.searchParams.set('v', profile.manifestFingerprint);
	}
	const javascriptRequestUrl = new URL(JAVASCRIPT_STORAGE_PATH, baseUrl);
	javascriptRequestUrl.searchParams.set('v', profile.javascriptReceipt.sha256);
	const wasmRequestUrl = new URL(WASM_STORAGE_PATH, baseUrl);
	wasmRequestUrl.searchParams.set('v', profile.wasmReceipt.sha256);
	const dataRequestUrl = new URL(DATA_STORAGE_PATH, baseUrl);
	dataRequestUrl.searchParams.set('v', profile.dataReceipt.sha256);
	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/perl-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: PERL_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'PERL',
					implementationId: 'WebPerl',
					implementationVersion: profile.profileId,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: profile.manifestReceipt.sha256,
						protocolVersion: PERL_PREFLIGHT_PROTOCOL_VERSION,
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
						path: JAVASCRIPT_STORAGE_PATH,
						compressedSha256: profile.javascriptReceipt.sha256,
						uncompressedSha256: profile.javascriptReceipt.uncompressedSha256!,
						compressedBytes: profile.javascriptReceipt.bytes!,
						uncompressedBytes: profile.javascriptReceipt.uncompressedBytes!,
						mediaType: 'text/javascript',
						encoding: 'gzip'
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
					},
					{
						key: 'data',
						path: DATA_STORAGE_PATH,
						compressedSha256: profile.dataReceipt.sha256,
						uncompressedSha256: profile.dataReceipt.uncompressedSha256!,
						compressedBytes: profile.dataReceipt.bytes!,
						uncompressedBytes: profile.dataReceipt.uncompressedBytes!,
						mediaType: 'application/octet-stream',
						encoding: 'gzip'
					}
				],
				contracts: {
					routeId: 'perl',
					runtimeAssetKey: 'perl',
					documentationId: 'PERL',
					syncTarget: 'sync:wasm-perl',
					browserTestId: 'browser:perl'
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
		controller.abort(new DOMException('WebPerl runtime preflight timed out', 'TimeoutError'));
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: PERL_PREFLIGHT_RUNTIME_ID,
			rootUrl: baseUrl,
			assetUrls: {
				manifest: manifestRequestUrl,
				javascript: javascriptRequestUrl,
				wasm: wasmRequestUrl,
				data: dataRequestUrl
			},
			fetch: request.fetch,
			signal: controller.signal,
			limits: { ...limits, maxAssetBytes },
			redirect: 'error',
			maxConcurrentDownloads: 4,
			reportProgress: request.reportProgress
		});
		const manifestAsset = preflight.assets.manifest;
		const javascriptAsset = preflight.assets.javascript;
		const wasmAsset = preflight.assets.wasm;
		const dataAsset = preflight.assets.data;
		if (!manifestAsset || !javascriptAsset || !wasmAsset || !dataAsset) {
			throw new RuntimeConfigurationError(
				'WebPerl runtime preflight returned an incomplete asset set',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: PERL_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		assertManifestMatchesPreflightProfile(manifestAsset.bytes, profile);
		for (const [label, asset] of [
			['JavaScript', javascriptAsset],
			['Wasm', wasmAsset],
			['data', dataAsset]
		] as const) {
			if (asset.bytes[0] !== 0x1f || asset.bytes[1] !== 0x8b) {
				throw new AssetIntegrityError(`WebPerl runtime ${label} storage is not gzip data`, {
					profileId: profile.profileId,
					runtimeId: PERL_PREFLIGHT_RUNTIME_ID
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
		const [javascriptBytes, wasmBytes, dataBytes] = await Promise.all([
			abortOnDecompressionFailure(
				decompressGzipBounded(
					javascriptAsset.bytes,
					profile.javascriptReceipt.uncompressedBytes!,
					maxAssetBytes,
					'javascript',
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
			),
			abortOnDecompressionFailure(
				decompressGzipBounded(
					dataAsset.bytes,
					profile.dataReceipt.uncompressedBytes!,
					maxAssetBytes,
					'data',
					controller.signal,
					request.reportDecompressionProgress
				)
			)
		]);
		const payload: PerlRuntimePreflightPayload = Object.freeze({
			protocol: PERL_PREFLIGHT_PROTOCOL,
			protocolVersion: PERL_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			artifactRevision: profile.artifactRevision,
			webperlRevision: profile.webperlRevision,
			perlRevision: profile.perlRevision,
			emscriptenRevision: profile.emscriptenRevision,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			javascriptBytes,
			wasmBytes,
			dataBytes
		});
		return await verifyPerlRuntimePreflightPayload(payload, {
			maxAssetBytes,
			signal: controller.signal
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`WebPerl runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: PERL_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('WebPerl runtime preflight cancelled', {
				cause: request.signal.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: PERL_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
