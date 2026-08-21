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

export const JULIA_PREFLIGHT_PROTOCOL = 'wasm-idle-julia-preflight' as const;
export const JULIA_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const JULIA_PREFLIGHT_RUNTIME_ID = 'JULIA' as const;
export const JULIA_MAX_ASSET_BYTES = 64 * 1024 * 1024;
export const JULIA_RUNTIME_PREFLIGHT_CAPABILITIES = Object.freeze({
	stdin: 'streaming' as const,
	workspace: false,
	abort: true,
	artifacts: false,
	streamingOutput: true
});

const JULIA_MAX_TOTAL_LOGICAL_BYTES = 64 * 1024 * 1024;
const JULIA_MAX_TOTAL_DELIVERY_BYTES = 64 * 1024 * 1024;
const JULIA_MANIFEST_FORMAT = 'wasm-julia-runtime-manifest-v2';
const JULIA_FINGERPRINT_DOMAIN = 'wasm-idle:julia-runtime-manifest:v2';
const MAX_MANIFEST_BYTES = 64 * 1024;
const EXPECTED_LICENSE_EXPRESSION = 'MIT AND LicenseRef-Julia-Third-Party';
const EXPECTED_PACKAGE_VERSION = '1.0.4';
const EXPECTED_RUNTIME = 'chriskoch-julia-wasm';
const PROFILE_ID_PREFIX = 'julia-';
const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

const PROFILE_KEYS = [
	'dataReceipt',
	'emscriptenVersion',
	'importedByCommit',
	'javascriptReceipt',
	'juliaVersion',
	'manifestFingerprint',
	'manifestReceipt',
	'packageRevision',
	'profileId',
	'wasmReceipt'
] as const;
const PAYLOAD_KEYS = [
	'dataBytes',
	'emscriptenVersion',
	'importedByCommit',
	'javascriptBytes',
	'juliaVersion',
	'manifestBytes',
	'manifestFingerprint',
	'packageRevision',
	'profileId',
	'protocol',
	'protocolVersion',
	'wasmBytes'
] as const;
const MANIFEST_KEYS = [
	'artifact',
	'assets',
	'components',
	'documentation',
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
const LOGICAL_ASSETS = Object.freeze({
	'julia.data': 'application/octet-stream',
	'julia.js': 'text/javascript',
	'julia.wasm': 'application/wasm'
});
const STORAGE_ASSETS = Object.freeze({
	'julia.data.gz.bin': Object.freeze({ logicalPath: 'julia.data', encoding: 'gzip' }),
	'julia.js.gz.bin': Object.freeze({ logicalPath: 'julia.js', encoding: 'gzip' }),
	'julia.wasm.gz.bin': Object.freeze({ logicalPath: 'julia.wasm', encoding: 'gzip' })
});

export interface JuliaRuntimePreflightProfile {
	readonly profileId: string;
	readonly packageRevision: string;
	readonly importedByCommit: string;
	readonly juliaVersion: string;
	readonly emscriptenVersion: string;
	readonly manifestFingerprint: string;
	readonly manifestReceipt: RuntimeAssetIntegrityEntry;
	readonly javascriptReceipt: RuntimeAssetIntegrityEntry;
	readonly wasmReceipt: RuntimeAssetIntegrityEntry;
	readonly dataReceipt: RuntimeAssetIntegrityEntry;
}

export interface JuliaRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: JuliaRuntimePreflightProfile;
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

export interface JuliaRuntimePreflightPayload {
	readonly protocol: typeof JULIA_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof JULIA_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly packageRevision: string;
	readonly importedByCommit: string;
	readonly juliaVersion: string;
	readonly emscriptenVersion: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly javascriptBytes: Uint8Array;
	readonly wasmBytes: Uint8Array;
	readonly dataBytes: Uint8Array;
}

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
	readonly path: string;
	readonly logicalPath: string;
	readonly encoding: string;
	readonly size: number;
	readonly sha256: string;
}

interface ParsedJuliaManifest {
	readonly assetByPath: ReadonlyMap<LogicalAssetPath, ManifestReceipt>;
	readonly storageByPath: ReadonlyMap<StorageAssetPath, ManifestStorageReceipt>;
	readonly canonical: UnknownRecord;
}

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
	const primitive = JSON.stringify(value);
	if (primitive === undefined) {
		throw new AssetIntegrityError('Julia runtime manifest contains a non-JSON value', {
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	return primitive;
}

function isRevision(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
}

function isVersion(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(value);
}

function expectedProfileId(packageRevision: string, juliaVersion: string): string {
	return `${PROFILE_ID_PREFIX}${juliaVersion.toLowerCase()}-chriskoch-npm-${EXPECTED_PACKAGE_VERSION}-${packageRevision.slice(0, 8)}`;
}

function snapshotReceipt(
	value: unknown,
	label: string,
	requireLogical: boolean,
	profileId?: string
): Readonly<RuntimeAssetIntegrityEntry> {
	if (!isPlainRecord(value)) {
		throw new RuntimeConfigurationError(`Julia runtime ${label} receipt is missing`, {
			phase: 'asset',
			profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
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
		throw new RuntimeConfigurationError(`Julia runtime ${label} receipt is invalid`, {
			phase: 'asset',
			profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
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

export function snapshotJuliaRuntimePreflightProfile(
	value: unknown
): Readonly<JuliaRuntimePreflightProfile> {
	if (!isPlainRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) {
		throw new RuntimeConfigurationError('Julia runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	const profileId = typeof value.profileId === 'string' ? value.profileId.trim() : '';
	const packageRevision = typeof value.packageRevision === 'string' ? value.packageRevision : '';
	const importedByCommit =
		typeof value.importedByCommit === 'string' ? value.importedByCommit : '';
	const juliaVersion = typeof value.juliaVersion === 'string' ? value.juliaVersion : '';
	const emscriptenVersion =
		typeof value.emscriptenVersion === 'string' ? value.emscriptenVersion : '';
	const manifestFingerprint =
		typeof value.manifestFingerprint === 'string' ? value.manifestFingerprint : '';
	if (
		!isRevision(packageRevision) ||
		!isRevision(importedByCommit) ||
		!isVersion(juliaVersion) ||
		!isVersion(emscriptenVersion) ||
		!/^[a-f0-9]{64}$/u.test(manifestFingerprint) ||
		profileId !== expectedProfileId(packageRevision, juliaVersion)
	) {
		throw new RuntimeConfigurationError('Julia runtime preflight identity is invalid', {
			phase: 'asset',
			profileId: profileId || undefined,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	return Object.freeze({
		profileId,
		packageRevision,
		importedByCommit,
		juliaVersion,
		emscriptenVersion,
		manifestFingerprint,
		manifestReceipt: snapshotReceipt(value.manifestReceipt, 'manifest', false, profileId),
		javascriptReceipt: snapshotReceipt(value.javascriptReceipt, 'JavaScript', true, profileId),
		wasmReceipt: snapshotReceipt(value.wasmReceipt, 'Wasm', true, profileId),
		dataReceipt: snapshotReceipt(value.dataReceipt, 'data', true, profileId)
	});
}

export function requireJuliaRuntimePreflightPayload(value: unknown): JuliaRuntimePreflightPayload {
	if (!isPlainRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
		throw new ProtocolError('Julia runtime preflight payload has an invalid shape', {
			phase: 'protocol',
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.protocol !== JULIA_PREFLIGHT_PROTOCOL ||
		value.protocolVersion !== JULIA_PREFLIGHT_PROTOCOL_VERSION ||
		typeof value.profileId !== 'string' ||
		!isRevision(value.packageRevision) ||
		!isRevision(value.importedByCommit) ||
		!isVersion(value.juliaVersion) ||
		!isVersion(value.emscriptenVersion) ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint) ||
		value.profileId !== expectedProfileId(value.packageRevision, value.juliaVersion) ||
		!isByteArray(value.manifestBytes) ||
		!isByteArray(value.javascriptBytes) ||
		!isByteArray(value.wasmBytes) ||
		!isByteArray(value.dataBytes)
	) {
		throw new ProtocolError('Julia runtime preflight payload is invalid', {
			phase: 'protocol',
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const [label, bytes, limit] of [
		['manifest', value.manifestBytes, MAX_MANIFEST_BYTES],
		['JavaScript', value.javascriptBytes, JULIA_MAX_ASSET_BYTES],
		['Wasm', value.wasmBytes, JULIA_MAX_ASSET_BYTES],
		['data', value.dataBytes, JULIA_MAX_ASSET_BYTES]
	] as const) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new ProtocolError(`Julia runtime preflight ${label} bytes exceed their limit`, {
				phase: 'protocol',
				profileId: value.profileId,
				runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	assertLogicalTotal(
		[value.javascriptBytes.byteLength, value.wasmBytes.byteLength, value.dataBytes.byteLength],
		value.profileId,
		ProtocolError
	);
	return value as unknown as JuliaRuntimePreflightPayload;
}

export function cloneJuliaRuntimePreflightPayload(
	value: unknown
): Readonly<JuliaRuntimePreflightPayload> {
	const payload = requireJuliaRuntimePreflightPayload(value);
	return Object.freeze({
		protocol: payload.protocol,
		protocolVersion: payload.protocolVersion,
		profileId: payload.profileId,
		packageRevision: payload.packageRevision,
		importedByCommit: payload.importedByCommit,
		juliaVersion: payload.juliaVersion,
		emscriptenVersion: payload.emscriptenVersion,
		manifestFingerprint: payload.manifestFingerprint,
		manifestBytes: Uint8Array.from(payload.manifestBytes),
		javascriptBytes: Uint8Array.from(payload.javascriptBytes),
		wasmBytes: Uint8Array.from(payload.wasmBytes),
		dataBytes: Uint8Array.from(payload.dataBytes)
	});
}

function assertLogicalTotal(
	values: readonly number[],
	profileId: string,
	ErrorType: typeof AssetTooLargeError | typeof ProtocolError = AssetTooLargeError
) {
	const total = values.reduce((sum, value) => sum + value, 0);
	if (!Number.isSafeInteger(total) || total > JULIA_MAX_TOTAL_LOGICAL_BYTES) {
		throw new ErrorType(
			`Julia runtime logical assets exceed the ${JULIA_MAX_TOTAL_LOGICAL_BYTES} byte aggregate limit`,
			{
				actual: total,
				limit: JULIA_MAX_TOTAL_LOGICAL_BYTES,
				phase: 'asset',
				profileId,
				runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
			}
		);
	}
}

function expectedArtifact(profile: {
	readonly packageRevision: string;
	readonly importedByCommit: string;
}) {
	return Object.freeze({
		kind: 'opaque-npm-prebuilt',
		packageName: '@chriskoch/julia-wasm',
		packageVersion: EXPECTED_PACKAGE_VERSION,
		packageSpec: '@chriskoch/julia-wasm@1.0.4',
		registryUrl: 'https://registry.npmjs.org/',
		tarballUrl: 'https://registry.npmjs.org/@chriskoch/julia-wasm/-/julia-wasm-1.0.4.tgz',
		publishedAt: '2020-12-05T19:33:59.354Z',
		repository: 'https://github.com/chris-koch-penn/polylang.git',
		sourceRevision: 'unrecorded',
		importedByCommit: profile.importedByCommit,
		npmGitHead: 'unrecorded',
		verifiedBuildInput: false,
		bytes: 12_406_918,
		sha256: '03d0e93196dbeec55946bbe447d4c9b2d244dba15fdd882c750fb33598bf640f',
		sha512: '86b957b1b800430c76542eae9959c528f540ad94fbaa34c9edaecc245497216b9cbc353f56aac392db4ddba81aa78a354383a3a11924688b0df40307ce146fc4',
		npmIntegrity:
			'sha512-hrlXsbgAQwx2VC6umVnFKPVArZT7qjTJ7a7MJFSXIWucvDU/VqrDkttN26gap4o1Q4OjoRkkaIsN9AMHzhRvxA==',
		npmShasum: profile.packageRevision
	});
}

function expectedComponents(profile: {
	readonly juliaVersion: string;
	readonly emscriptenVersion: string;
}) {
	return Object.freeze({
		distribution: Object.freeze({
			version: EXPECTED_PACKAGE_VERSION,
			repository: 'https://github.com/chris-koch-penn/polylang.git',
			revision: 'unrecorded',
			verifiedBuildInput: false,
			evidence:
				'content-locked npm package; source revision and build recipe are not published in package metadata'
		}),
		julia: Object.freeze({
			version: profile.juliaVersion,
			repository: 'https://github.com/JuliaLang/julia.git',
			revision: 'unrecorded',
			verifiedBuildInput: false,
			evidence:
				'exact VERSION observed in the real Chromium runtime; the binary embeds the matching 1.3.0-DEV family string; binary-to-source attestation is unavailable'
		}),
		emscripten: Object.freeze({
			version: profile.emscriptenVersion,
			repository: 'https://github.com/emscripten-core/emscripten.git',
			revision: 'unrecorded',
			verifiedBuildInput: false,
			evidence: 'opaque prebuilt Emscripten loader without recorded toolchain revision'
		})
	});
}

function normalizeManifestReceipt(
	value: unknown,
	expected: { readonly path: string; readonly mediaType: string },
	maxBytes: number,
	label: string,
	profileId: string
): ManifestReceipt {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, RECEIPT_KEYS) ||
		value.path !== expected.path ||
		value.mediaType !== expected.mediaType ||
		!Number.isSafeInteger(value.size) ||
		(value.size as number) <= 0 ||
		(value.size as number) > maxBytes ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new AssetIntegrityError(`${label} receipt is invalid`, {
			profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	return {
		path: expected.path,
		mediaType: expected.mediaType,
		size: value.size as number,
		sha256: value.sha256
	};
}

function normalizeStorageReceipt(
	value: unknown,
	expected: {
		readonly path: StorageAssetPath;
		readonly logicalPath: LogicalAssetPath;
		readonly encoding: 'gzip';
	},
	maxBytes: number,
	profileId: string
): ManifestStorageReceipt {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, STORAGE_RECEIPT_KEYS) ||
		value.path !== expected.path ||
		value.logicalPath !== expected.logicalPath ||
		value.encoding !== expected.encoding ||
		!Number.isSafeInteger(value.size) ||
		(value.size as number) <= 0 ||
		(value.size as number) > maxBytes ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new AssetIntegrityError(
			`Julia runtime storage receipt is invalid for ${expected.path}`,
			{ profileId, runtimeId: JULIA_PREFLIGHT_RUNTIME_ID }
		);
	}
	return {
		path: expected.path,
		logicalPath: expected.logicalPath,
		encoding: expected.encoding,
		size: value.size as number,
		sha256: value.sha256
	};
}

async function sha256Hex(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new UnsupportedBrowserFeatureError(
			'Julia runtime integrity verification requires Web Crypto',
			{ phase: 'asset', runtimeId: JULIA_PREFLIGHT_RUNTIME_ID }
		);
	}
	const operation = globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
	const digest = new Uint8Array(await waitForAbortable(operation, signal));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function waitForAbortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return await operation;
	return await new Promise<T>((resolve, reject) => {
		let settled = false;
		const rejectOnAbort = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', rejectOnAbort);
			reject(
				signal.reason ?? new DOMException('Julia runtime operation aborted', 'AbortError')
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

async function computeManifestFingerprint(
	manifest: {
		readonly profileId: string;
		readonly licenseExpression: string;
		readonly artifact: unknown;
		readonly components: unknown;
		readonly license: { path: string; spdx: string; size: number; sha256: string };
		readonly documentation: ManifestReceipt;
		readonly metadata: ManifestReceipt;
		readonly assets: readonly ManifestReceipt[];
		readonly storage: readonly ManifestStorageReceipt[];
	},
	signal?: AbortSignal
): Promise<string> {
	let canonical = `${JULIA_FINGERPRINT_DOMAIN}\nformat\0${JULIA_MANIFEST_FORMAT}\nruntime\0${EXPECTED_RUNTIME}\nprofileId\0${manifest.profileId}\n`;
	canonical += `licenseExpression\0${manifest.licenseExpression}\n`;
	canonical += `artifact\0${canonicalJson(manifest.artifact)}\n`;
	canonical += `components\0${canonicalJson(manifest.components)}\n`;
	canonical += `license\0${manifest.license.path}\0${manifest.license.spdx}\0${manifest.license.size}\0${manifest.license.sha256}\n`;
	canonical += `documentation\0${manifest.documentation.path}\0${manifest.documentation.mediaType}\0${manifest.documentation.size}\0${manifest.documentation.sha256}\n`;
	canonical += `metadata\0${manifest.metadata.path}\0${manifest.metadata.mediaType}\0${manifest.metadata.size}\0${manifest.metadata.sha256}\n`;
	for (const asset of [...manifest.assets].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...manifest.storage].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return await sha256Hex(textEncoder.encode(canonical), signal);
}

async function parseAndVerifyManifest(
	bytes: Uint8Array,
	identity: Pick<
		JuliaRuntimePreflightProfile,
		| 'profileId'
		| 'packageRevision'
		| 'importedByCommit'
		| 'juliaVersion'
		| 'emscriptenVersion'
		| 'manifestFingerprint'
	>,
	maxAssetBytes: number,
	signal?: AbortSignal
): Promise<ParsedJuliaManifest> {
	let value: unknown;
	try {
		value = JSON.parse(fatalDecoder.decode(bytes));
	} catch (error) {
		throw new AssetIntegrityError('Julia runtime manifest is not valid UTF-8 JSON', {
			cause: error,
			profileId: identity.profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!isPlainRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
		throw new AssetIntegrityError('Julia runtime manifest schema is invalid', {
			profileId: identity.profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.format !== JULIA_MANIFEST_FORMAT ||
		value.runtime !== EXPECTED_RUNTIME ||
		value.profileId !== identity.profileId ||
		value.fingerprint !== identity.manifestFingerprint ||
		value.licenseExpression !== EXPECTED_LICENSE_EXPRESSION ||
		canonicalJson(value.artifact) !== canonicalJson(expectedArtifact(identity)) ||
		canonicalJson(value.components) !== canonicalJson(expectedComponents(identity))
	) {
		throw new AssetIntegrityError('Julia runtime manifest identity is invalid', {
			profileId: identity.profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!isPlainRecord(value.license) ||
		!hasExactKeys(value.license, LICENSE_RECEIPT_KEYS) ||
		value.license.path !== 'LICENSE.md' ||
		value.license.spdx !== EXPECTED_LICENSE_EXPRESSION ||
		!Number.isSafeInteger(value.license.size) ||
		(value.license.size as number) <= 0 ||
		(value.license.size as number) > maxAssetBytes ||
		typeof value.license.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.license.sha256)
	) {
		throw new AssetIntegrityError('Julia runtime license receipt is invalid', {
			profileId: identity.profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	const license = {
		path: 'LICENSE.md',
		spdx: EXPECTED_LICENSE_EXPRESSION,
		size: value.license.size as number,
		sha256: value.license.sha256
	};
	const documentation = normalizeManifestReceipt(
		value.documentation,
		{ path: 'readme.md', mediaType: 'text/markdown' },
		maxAssetBytes,
		'Julia runtime documentation',
		identity.profileId
	);
	const metadata = normalizeManifestReceipt(
		value.metadata,
		{ path: 'runtime-build.json', mediaType: 'application/json' },
		maxAssetBytes,
		'Julia runtime metadata',
		identity.profileId
	);
	if (!Array.isArray(value.assets) || value.assets.length !== 3) {
		throw new AssetIntegrityError('Julia runtime manifest must declare three logical assets', {
			profileId: identity.profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 3) {
		throw new AssetIntegrityError('Julia runtime manifest must declare three storage assets', {
			profileId: identity.profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
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
				'Julia runtime manifest has an unexpected or duplicate logical asset',
				{ profileId: identity.profileId, runtimeId: JULIA_PREFLIGHT_RUNTIME_ID }
			);
		}
		const logicalPath = path as LogicalAssetPath;
		assetByPath.set(
			logicalPath,
			normalizeManifestReceipt(
				candidate,
				{ path: logicalPath, mediaType: LOGICAL_ASSETS[logicalPath] },
				maxAssetBytes,
				`Julia runtime asset ${logicalPath}`,
				identity.profileId
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
			throw new AssetIntegrityError(
				'Julia runtime manifest has an unexpected or duplicate storage asset',
				{ profileId: identity.profileId, runtimeId: JULIA_PREFLIGHT_RUNTIME_ID }
			);
		}
		const storagePath = path as StorageAssetPath;
		storageByPath.set(
			storagePath,
			normalizeStorageReceipt(
				candidate,
				{ path: storagePath, ...STORAGE_ASSETS[storagePath] },
				maxAssetBytes,
				identity.profileId
			)
		);
	}
	if (
		Object.keys(LOGICAL_ASSETS).some((path) => !assetByPath.has(path as LogicalAssetPath)) ||
		Object.keys(STORAGE_ASSETS).some((path) => !storageByPath.has(path as StorageAssetPath))
	) {
		throw new AssetIntegrityError('Julia runtime manifest is missing a required receipt', {
			profileId: identity.profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	const assets = [...assetByPath.values()];
	const storage = [...storageByPath.values()];
	const fingerprint = await computeManifestFingerprint(
		{
			profileId: identity.profileId,
			licenseExpression: EXPECTED_LICENSE_EXPRESSION,
			artifact: value.artifact,
			components: value.components,
			license,
			documentation,
			metadata,
			assets,
			storage
		},
		signal
	);
	if (fingerprint !== identity.manifestFingerprint) {
		throw new AssetIntegrityError(
			'Julia runtime receipt graph failed fingerprint verification',
			{
				profileId: identity.profileId,
				runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	return {
		assetByPath,
		storageByPath,
		canonical: value
	};
}

function assertManifestMatchesProfile(
	manifest: ParsedJuliaManifest,
	profile: JuliaRuntimePreflightProfile
) {
	for (const [logicalPath, storagePath, receipt] of [
		['julia.js', 'julia.js.gz.bin', profile.javascriptReceipt],
		['julia.wasm', 'julia.wasm.gz.bin', profile.wasmReceipt],
		['julia.data', 'julia.data.gz.bin', profile.dataReceipt]
	] as const) {
		const logical = manifest.assetByPath.get(logicalPath);
		const storage = manifest.storageByPath.get(storagePath);
		if (
			!logical ||
			!storage ||
			logical.size !== receipt.uncompressedBytes ||
			logical.sha256 !== receipt.uncompressedSha256 ||
			storage.size !== receipt.bytes ||
			storage.sha256 !== receipt.sha256 ||
			storage.logicalPath !== logicalPath
		) {
			throw new AssetIntegrityError(
				`Julia runtime ${logicalPath} receipt does not match its preflight profile`,
				{ profileId: profile.profileId, runtimeId: JULIA_PREFLIGHT_RUNTIME_ID }
			);
		}
	}
}

function validateLogicalJavaScript(bytes: Uint8Array, profileId: string) {
	let source: string;
	try {
		source = fatalDecoder.decode(bytes);
	} catch (error) {
		throw new AssetIntegrityError('Julia runtime JavaScript is not valid UTF-8', {
			cause: error,
			profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const marker of [
		'_jl_eval_string',
		'WebAssembly.instantiate',
		'getPreloadedPackage',
		'julia-wasm/julia.wasm',
		'/npm/@chriskoch/julia-wasm/julia.data'
	]) {
		if (!source.includes(marker)) {
			throw new AssetIntegrityError(
				`Julia runtime JavaScript is missing required marker ${marker}`,
				{ profileId, runtimeId: JULIA_PREFLIGHT_RUNTIME_ID }
			);
		}
	}
}

function validateLogicalWasm(bytes: Uint8Array, profileId: string) {
	if (
		bytes.byteLength < 8 ||
		bytes[0] !== 0x00 ||
		bytes[1] !== 0x61 ||
		bytes[2] !== 0x73 ||
		bytes[3] !== 0x6d
	) {
		throw new AssetIntegrityError('Julia runtime Wasm header is invalid', {
			profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
}

async function decompressGzipBounded(
	compressedBytes: Uint8Array,
	expectedBytes: number,
	maxBytes: number,
	asset: 'javascript' | 'wasm' | 'data',
	profileId: string,
	signal: AbortSignal,
	reportProgress?: (asset: 'javascript' | 'wasm' | 'data', loaded: number, total: number) => void
): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError(
			'Julia runtime gzip decompression requires DecompressionStream',
			{ phase: 'asset', profileId, runtimeId: JULIA_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > maxBytes) {
		throw new AssetTooLargeError(
			`Julia runtime ${asset} logical bytes exceed the ${maxBytes} byte limit`,
			{
				actual: expectedBytes,
				limit: maxBytes,
				phase: 'asset',
				profileId,
				runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	let reader: ReadableStreamDefaultReader<Uint8Array>;
	try {
		const body = new Response(Uint8Array.from(compressedBytes)).body;
		if (!body) {
			throw new UnsupportedBrowserFeatureError('ReadableStream response bodies', {
				phase: 'asset',
				profileId,
				runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
			});
		}
		reader = body.pipeThrough(new DecompressionStream('gzip')).getReader();
	} catch (error) {
		throw new AssetIntegrityError(`Julia runtime ${asset} gzip stream could not be opened`, {
			cause: error,
			profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	const output = new Uint8Array(expectedBytes);
	let offset = 0;
	const cancelOnAbort = () => {
		try {
			void reader.cancel(signal.reason).catch(() => undefined);
		} catch {
			// Preserve the caller abort reason.
		}
	};
	signal.addEventListener('abort', cancelOnAbort, { once: true });
	try {
		while (true) {
			if (signal.aborted) throw signal.reason;
			const { done, value } = await waitForAbortable(reader.read(), signal);
			if (done) break;
			if (!isByteArray(value)) {
				throw new AssetIntegrityError(
					`Julia runtime ${asset} gzip returned invalid bytes`,
					{
						profileId,
						runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
					}
				);
			}
			const nextOffset = offset + value.byteLength;
			if (!Number.isSafeInteger(nextOffset) || nextOffset > expectedBytes) {
				throw new AssetTooLargeError(
					`Julia runtime ${asset} gzip exceeds its logical receipt`,
					{
						actual: nextOffset,
						limit: expectedBytes,
						phase: 'asset',
						profileId,
						runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
					}
				);
			}
			output.set(value, offset);
			offset = nextOffset;
			reportProgress?.(asset, offset, expectedBytes);
		}
	} catch (error) {
		try {
			await reader.cancel(error);
		} catch {
			// Preserve the primary boundary failure.
		}
		if (signal.aborted || isWasmIdleError(error)) throw error;
		throw new AssetIntegrityError(`Julia runtime ${asset} gzip decompression failed`, {
			cause: error,
			profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
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
		throw new AssetIntegrityError(`Julia runtime ${asset} gzip output is truncated`, {
			profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	return output;
}

async function verifyLogicalBytes(
	manifest: ParsedJuliaManifest,
	logicalPath: LogicalAssetPath,
	bytes: Uint8Array,
	profileId: string,
	signal?: AbortSignal
) {
	const receipt = manifest.assetByPath.get(logicalPath);
	if (!receipt) {
		throw new AssetIntegrityError(`Julia runtime manifest omits ${logicalPath}`, {
			profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	await waitForAbortable(
		verifyRuntimeAssetIntegrity({
			asset: logicalPath,
			bytes,
			expected: {
				sha256: receipt.sha256,
				bytes: receipt.size,
				uncompressedSha256: receipt.sha256,
				uncompressedBytes: receipt.size
			},
			stage: 'uncompressed',
			profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		}),
		signal
	);
}

export async function verifyJuliaRuntimePreflightPayload(
	value: unknown,
	options: { readonly maxAssetBytes?: number; readonly signal?: AbortSignal } = {}
): Promise<JuliaRuntimePreflightPayload> {
	const payload = requireJuliaRuntimePreflightPayload(value);
	const maxAssetBytes = Math.min(
		options.maxAssetBytes ?? JULIA_MAX_ASSET_BYTES,
		JULIA_MAX_ASSET_BYTES
	);
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new ProtocolError('Julia runtime payload byte limit is invalid', {
			phase: 'protocol',
			profileId: payload.profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const [label, bytes, limit] of [
		['manifest', payload.manifestBytes, Math.min(MAX_MANIFEST_BYTES, maxAssetBytes)],
		['JavaScript', payload.javascriptBytes, maxAssetBytes],
		['Wasm', payload.wasmBytes, maxAssetBytes],
		['data', payload.dataBytes, maxAssetBytes]
	] as const) {
		if (bytes.byteLength > limit) {
			throw new AssetTooLargeError(`Julia runtime ${label} exceeds its payload limit`, {
				actual: bytes.byteLength,
				limit,
				phase: 'protocol',
				profileId: payload.profileId,
				runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	const manifest = await parseAndVerifyManifest(
		payload.manifestBytes,
		payload,
		maxAssetBytes,
		options.signal
	);
	await verifyLogicalBytes(
		manifest,
		'julia.js',
		payload.javascriptBytes,
		payload.profileId,
		options.signal
	);
	await verifyLogicalBytes(
		manifest,
		'julia.wasm',
		payload.wasmBytes,
		payload.profileId,
		options.signal
	);
	await verifyLogicalBytes(
		manifest,
		'julia.data',
		payload.dataBytes,
		payload.profileId,
		options.signal
	);
	validateLogicalJavaScript(payload.javascriptBytes, payload.profileId);
	validateLogicalWasm(payload.wasmBytes, payload.profileId);
	return payload;
}

export async function preflightJuliaRuntimeAssets(
	request: JuliaRuntimePreflightRequest
): Promise<JuliaRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('Julia runtime preflight request is required', {
			phase: 'asset',
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
		});
	}
	const profile = snapshotJuliaRuntimePreflightProfile(request.profile);
	let baseUrl: URL;
	let manifestUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
		manifestUrl = new URL(request.manifestUrl, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError('Julia runtime asset URLs are invalid', {
			cause: error,
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
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
			'Julia runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: JULIA_PREFLIGHT_RUNTIME_ID }
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
			'Julia runtime manifest must be an HTTP(S) asset beneath the configured runtime base',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: JULIA_PREFLIGHT_RUNTIME_ID }
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
		Object.prototype.hasOwnProperty.call(STORAGE_ASSETS, manifestPath)
	) {
		throw new RuntimeConfigurationError(
			'Julia runtime manifest path must be a distinct normalized file beneath the runtime base',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: JULIA_PREFLIGHT_RUNTIME_ID }
		);
	}
	const expectedManifestQuery = `?v=${profile.manifestFingerprint}`;
	if (manifestUrl.search && manifestUrl.search !== expectedManifestQuery) {
		throw new RuntimeConfigurationError(
			'Julia runtime manifest query must be the pinned fingerprint cache-buster',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: JULIA_PREFLIGHT_RUNTIME_ID }
		);
	}
	const limits = resolveExecutionLimits(request.limits);
	const maxAssetBytes = Math.min(limits.maxAssetBytes, JULIA_MAX_ASSET_BYTES);
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
			throw new AssetTooLargeError(`Julia runtime ${label} exceeds the ${limit} byte limit`, {
				actual: bytes,
				limit,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	const deliveryTotalBytes =
		profile.manifestReceipt.bytes! +
		profile.javascriptReceipt.bytes! +
		profile.wasmReceipt.bytes! +
		profile.dataReceipt.bytes!;
	if (
		!Number.isSafeInteger(deliveryTotalBytes) ||
		deliveryTotalBytes > JULIA_MAX_TOTAL_DELIVERY_BYTES
	) {
		throw new AssetTooLargeError(
			`Julia runtime delivery receipts exceed the ${JULIA_MAX_TOTAL_DELIVERY_BYTES} byte aggregate limit`,
			{
				actual: deliveryTotalBytes,
				limit: JULIA_MAX_TOTAL_DELIVERY_BYTES,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	assertLogicalTotal(
		[
			profile.javascriptReceipt.uncompressedBytes!,
			profile.wasmReceipt.uncompressedBytes!,
			profile.dataReceipt.uncompressedBytes!
		],
		profile.profileId
	);
	const manifestRequestUrl = new URL(manifestUrl);
	if (!manifestRequestUrl.search) {
		manifestRequestUrl.searchParams.set('v', profile.manifestFingerprint);
	}
	const javascriptRequestUrl = new URL('julia.js.gz.bin', baseUrl);
	javascriptRequestUrl.searchParams.set('v', profile.javascriptReceipt.sha256);
	const wasmRequestUrl = new URL('julia.wasm.gz.bin', baseUrl);
	wasmRequestUrl.searchParams.set('v', profile.wasmReceipt.sha256);
	const dataRequestUrl = new URL('julia.data.gz.bin', baseUrl);
	dataRequestUrl.searchParams.set('v', profile.dataReceipt.sha256);
	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/julia-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: JULIA_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'JULIA',
					implementationId: EXPECTED_RUNTIME,
					implementationVersion: profile.juliaVersion,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: profile.manifestReceipt.sha256,
						protocolVersion: JULIA_PREFLIGHT_PROTOCOL_VERSION,
						trustProfileId: 'wasm-idle-static-worker-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: JULIA_RUNTIME_PREFLIGHT_CAPABILITIES,
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
						path: 'julia.js.gz.bin',
						compressedSha256: profile.javascriptReceipt.sha256,
						uncompressedSha256: profile.javascriptReceipt.uncompressedSha256!,
						compressedBytes: profile.javascriptReceipt.bytes!,
						uncompressedBytes: profile.javascriptReceipt.uncompressedBytes!,
						mediaType: 'text/javascript',
						encoding: 'gzip'
					},
					{
						key: 'wasm',
						path: 'julia.wasm.gz.bin',
						compressedSha256: profile.wasmReceipt.sha256,
						uncompressedSha256: profile.wasmReceipt.uncompressedSha256!,
						compressedBytes: profile.wasmReceipt.bytes!,
						uncompressedBytes: profile.wasmReceipt.uncompressedBytes!,
						mediaType: 'application/wasm',
						encoding: 'gzip'
					},
					{
						key: 'data',
						path: 'julia.data.gz.bin',
						compressedSha256: profile.dataReceipt.sha256,
						uncompressedSha256: profile.dataReceipt.uncompressedSha256!,
						compressedBytes: profile.dataReceipt.bytes!,
						uncompressedBytes: profile.dataReceipt.uncompressedBytes!,
						mediaType: 'application/octet-stream',
						encoding: 'gzip'
					}
				],
				contracts: {
					routeId: 'julia',
					runtimeAssetKey: 'julia',
					documentationId: 'JULIA',
					syncTarget: 'sync:wasm-julia',
					browserTestId: 'browser:julia'
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
		controller.abort(new DOMException('Julia runtime preflight timed out', 'TimeoutError'));
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: JULIA_PREFLIGHT_RUNTIME_ID,
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
				'Julia runtime preflight returned an incomplete asset set',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		const manifest = await parseAndVerifyManifest(
			manifestAsset.bytes,
			profile,
			maxAssetBytes,
			controller.signal
		);
		assertManifestMatchesProfile(manifest, profile);
		for (const [label, asset] of [
			['JavaScript', javascriptAsset],
			['Wasm', wasmAsset],
			['data', dataAsset]
		] as const) {
			if (asset.bytes[0] !== 0x1f || asset.bytes[1] !== 0x8b) {
				throw new AssetIntegrityError(`Julia runtime ${label} storage is not gzip data`, {
					profileId: profile.profileId,
					runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
				});
			}
		}
		const javascriptBytes = await decompressGzipBounded(
			javascriptAsset.bytes,
			profile.javascriptReceipt.uncompressedBytes!,
			maxAssetBytes,
			'javascript',
			profile.profileId,
			controller.signal,
			request.reportDecompressionProgress
		);
		const wasmBytes = await decompressGzipBounded(
			wasmAsset.bytes,
			profile.wasmReceipt.uncompressedBytes!,
			maxAssetBytes,
			'wasm',
			profile.profileId,
			controller.signal,
			request.reportDecompressionProgress
		);
		const dataBytes = await decompressGzipBounded(
			dataAsset.bytes,
			profile.dataReceipt.uncompressedBytes!,
			maxAssetBytes,
			'data',
			profile.profileId,
			controller.signal,
			request.reportDecompressionProgress
		);
		const payload: JuliaRuntimePreflightPayload = Object.freeze({
			protocol: JULIA_PREFLIGHT_PROTOCOL,
			protocolVersion: JULIA_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			packageRevision: profile.packageRevision,
			importedByCommit: profile.importedByCommit,
			juliaVersion: profile.juliaVersion,
			emscriptenVersion: profile.emscriptenVersion,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			javascriptBytes,
			wasmBytes,
			dataBytes
		});
		return await verifyJuliaRuntimePreflightPayload(payload, {
			maxAssetBytes,
			signal: controller.signal
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`Julia runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: JULIA_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('Julia runtime preflight cancelled', {
				cause: request.signal.reason ?? error,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: JULIA_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
