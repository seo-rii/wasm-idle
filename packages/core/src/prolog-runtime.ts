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

export const PROLOG_PREFLIGHT_PROTOCOL = 'wasm-idle-prolog-preflight' as const;
export const PROLOG_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const PROLOG_PREFLIGHT_RUNTIME_ID = 'PROLOG' as const;
export const PROLOG_MAX_ASSET_BYTES = 32 * 1024 * 1024;

const PROLOG_MANIFEST_FORMAT = 'wasm-prolog-runtime-manifest-v2';
const PROLOG_FINGERPRINT_DOMAIN = 'wasm-idle:prolog-runtime-manifest:v2';
const MAX_MANIFEST_BYTES = 64 * 1024;
const JAVASCRIPT_PATH = 'swipl-web.js';
const WASM_PATH = 'swipl-web.wasm';
const DATA_PATH = 'swipl-web.data';
const WASM_STORAGE_PATH = 'swipl-web.wasm.gz.bin';
const DATA_STORAGE_PATH = 'swipl-web.data.gz.bin';
const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

const PROFILE_KEYS = [
	'dataReceipt',
	'javascriptReceipt',
	'manifestFingerprint',
	'manifestReceipt',
	'packageRevision',
	'profileId',
	'swiplRevision',
	'wasmReceipt'
] as const;
const PAYLOAD_KEYS = [
	'dataBytes',
	'javascriptBytes',
	'manifestBytes',
	'manifestFingerprint',
	'packageRevision',
	'profileId',
	'protocol',
	'protocolVersion',
	'swiplRevision',
	'wasmBytes'
] as const;

export interface PrologRuntimePreflightProfile {
	readonly profileId: string;
	readonly packageRevision: string;
	readonly swiplRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestReceipt: RuntimeAssetIntegrityEntry;
	readonly javascriptReceipt: RuntimeAssetIntegrityEntry;
	readonly wasmReceipt: RuntimeAssetIntegrityEntry;
	readonly dataReceipt: RuntimeAssetIntegrityEntry;
}

export interface PrologRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: PrologRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (
		asset: 'wasm' | 'data',
		loadedBytes: number,
		totalBytes: number
	) => void;
}

export interface PrologRuntimePreflightPayload {
	readonly protocol: typeof PROLOG_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof PROLOG_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly packageRevision: string;
	readonly swiplRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly javascriptBytes: Uint8Array;
	readonly wasmBytes: Uint8Array;
	readonly dataBytes: Uint8Array;
}

type UnknownRecord = Record<string, unknown>;

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

function waitForAbortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return operation;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const rejectOnAbort = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', rejectOnAbort);
			reject(
				signal.reason ?? new DOMException('Prolog runtime operation aborted', 'AbortError')
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
		throw new RuntimeConfigurationError(`Prolog runtime ${label} receipt is missing`, {
			phase: 'asset',
			profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
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
		throw new RuntimeConfigurationError(`Prolog runtime ${label} receipt is invalid`, {
			phase: 'asset',
			profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
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

export function snapshotPrologRuntimePreflightProfile(
	value: unknown
): Readonly<Required<PrologRuntimePreflightProfile>> {
	if (!isPlainRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) {
		throw new RuntimeConfigurationError('Prolog runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		typeof value.profileId !== 'string' ||
		!/^swipl-wasm-[A-Za-z0-9._+-]+$/u.test(value.profileId) ||
		typeof value.packageRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.packageRevision) ||
		typeof value.swiplRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.swiplRevision) ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('Prolog runtime preflight identity is invalid', {
			phase: 'asset',
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	return Object.freeze({
		profileId: value.profileId,
		packageRevision: value.packageRevision,
		swiplRevision: value.swiplRevision,
		manifestFingerprint: value.manifestFingerprint,
		manifestReceipt: snapshotReceipt(value.manifestReceipt, 'manifest', false, value.profileId),
		javascriptReceipt: snapshotReceipt(
			value.javascriptReceipt,
			'JavaScript',
			false,
			value.profileId
		),
		wasmReceipt: snapshotReceipt(value.wasmReceipt, 'Wasm', true, value.profileId),
		dataReceipt: snapshotReceipt(value.dataReceipt, 'data', true, value.profileId)
	});
}

export function requirePrologRuntimePreflightPayload(
	value: unknown
): PrologRuntimePreflightPayload {
	if (!isPlainRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
		throw new ProtocolError('Prolog runtime preflight payload has an invalid shape', {
			phase: 'protocol',
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.protocol !== PROLOG_PREFLIGHT_PROTOCOL ||
		value.protocolVersion !== PROLOG_PREFLIGHT_PROTOCOL_VERSION ||
		typeof value.profileId !== 'string' ||
		!/^swipl-wasm-[A-Za-z0-9._+-]+$/u.test(value.profileId) ||
		typeof value.packageRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.packageRevision) ||
		typeof value.swiplRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(value.swiplRevision) ||
		typeof value.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.manifestFingerprint) ||
		!isByteArray(value.manifestBytes) ||
		!isByteArray(value.javascriptBytes) ||
		!isByteArray(value.wasmBytes) ||
		!isByteArray(value.dataBytes)
	) {
		throw new ProtocolError('Prolog runtime preflight payload is invalid', {
			phase: 'protocol',
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	return value as unknown as PrologRuntimePreflightPayload;
}

export function clonePrologRuntimePreflightPayload(value: unknown): PrologRuntimePreflightPayload {
	const payload = requirePrologRuntimePreflightPayload(value);
	return Object.freeze({
		protocol: payload.protocol,
		protocolVersion: payload.protocolVersion,
		profileId: payload.profileId,
		packageRevision: payload.packageRevision,
		swiplRevision: payload.swiplRevision,
		manifestFingerprint: payload.manifestFingerprint,
		manifestBytes: Uint8Array.from(payload.manifestBytes),
		javascriptBytes: Uint8Array.from(payload.javascriptBytes),
		wasmBytes: Uint8Array.from(payload.wasmBytes),
		dataBytes: Uint8Array.from(payload.dataBytes)
	});
}

export async function verifyPrologRuntimePreflightPayload(
	value: unknown,
	options: { readonly maxAssetBytes?: number; readonly signal?: AbortSignal } = {}
): Promise<PrologRuntimePreflightPayload> {
	const payload = requirePrologRuntimePreflightPayload(value);
	const maxAssetBytes = Math.min(
		options.maxAssetBytes ?? PROLOG_MAX_ASSET_BYTES,
		PROLOG_MAX_ASSET_BYTES
	);
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new RuntimeConfigurationError('Prolog runtime asset byte limit is invalid', {
			phase: 'asset',
			profileId: payload.profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
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
				`Prolog runtime ${label} bytes exceed the ${limit} byte limit`,
				{
					actual: bytes.byteLength,
					limit,
					phase: 'asset',
					profileId: payload.profileId,
					runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}

	let manifest: UnknownRecord;
	try {
		manifest = JSON.parse(fatalDecoder.decode(payload.manifestBytes)) as UnknownRecord;
	} catch (error) {
		throw new AssetIntegrityError('Prolog runtime manifest is not valid UTF-8 JSON', {
			cause: error,
			profileId: payload.profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	const manifestKeys = [
		'assets',
		'fingerprint',
		'format',
		'license',
		'metadata',
		'package',
		'profileId',
		'runtime',
		'storage',
		'toolchain'
	];
	if (
		!isPlainRecord(manifest) ||
		!hasExactKeys(manifest, manifestKeys) ||
		manifest.format !== PROLOG_MANIFEST_FORMAT ||
		manifest.runtime !== 'swipl-wasm' ||
		manifest.profileId !== payload.profileId ||
		manifest.fingerprint !== payload.manifestFingerprint
	) {
		throw new AssetIntegrityError('Prolog runtime manifest identity is invalid', {
			profileId: payload.profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!isPlainRecord(manifest.package) ||
		!hasExactKeys(manifest.package, [
			'integrity',
			'name',
			'repository',
			'revision',
			'tarball',
			'version'
		]) ||
		!isPlainRecord(manifest.toolchain) ||
		!hasExactKeys(manifest.toolchain, [
			'emsdkRevision',
			'emsdkVersion',
			'pcre2Revision',
			'pcre2Version',
			'swiplRevision',
			'swiplVersion',
			'zlibVersion'
		]) ||
		manifest.package.revision !== payload.packageRevision ||
		manifest.toolchain.swiplRevision !== payload.swiplRevision ||
		Object.values(manifest.package).some((entry) => typeof entry !== 'string') ||
		Object.values(manifest.toolchain).some((entry) => typeof entry !== 'string')
	) {
		throw new AssetIntegrityError('Prolog runtime provenance identity is invalid', {
			profileId: payload.profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!isPlainRecord(manifest.license) ||
		!hasExactKeys(manifest.license, ['path', 'sha256', 'size', 'spdx']) ||
		manifest.license.path !== 'LICENSE.txt' ||
		manifest.license.spdx !== 'BSD-2-Clause' ||
		!Number.isSafeInteger(manifest.license.size) ||
		(manifest.license.size as number) <= 0 ||
		(manifest.license.size as number) > maxAssetBytes ||
		typeof manifest.license.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(manifest.license.sha256) ||
		!isPlainRecord(manifest.metadata) ||
		!hasExactKeys(manifest.metadata, ['mediaType', 'path', 'sha256', 'size']) ||
		manifest.metadata.path !== 'runtime-build.json' ||
		manifest.metadata.mediaType !== 'application/json' ||
		!Number.isSafeInteger(manifest.metadata.size) ||
		(manifest.metadata.size as number) <= 0 ||
		(manifest.metadata.size as number) > maxAssetBytes ||
		typeof manifest.metadata.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(manifest.metadata.sha256)
	) {
		throw new AssetIntegrityError('Prolog runtime provenance receipts are invalid', {
			profileId: payload.profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!Array.isArray(manifest.assets) || manifest.assets.length !== 3) {
		throw new AssetIntegrityError('Prolog runtime manifest must declare exactly three assets', {
			profileId: payload.profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!Array.isArray(manifest.storage) || manifest.storage.length !== 3) {
		throw new AssetIntegrityError(
			'Prolog runtime manifest must declare exactly three storage assets',
			{ profileId: payload.profileId, runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID }
		);
	}
	const expectedAssets = new Map<string, { mediaType: string; bytes: Uint8Array }>([
		[DATA_PATH, { mediaType: 'application/octet-stream', bytes: payload.dataBytes }],
		[JAVASCRIPT_PATH, { mediaType: 'text/javascript', bytes: payload.javascriptBytes }],
		[WASM_PATH, { mediaType: 'application/wasm', bytes: payload.wasmBytes }]
	]);
	const assetByPath = new Map<string, UnknownRecord>();
	for (const candidate of manifest.assets) {
		if (
			!isPlainRecord(candidate) ||
			!hasExactKeys(candidate, ['mediaType', 'path', 'sha256', 'size']) ||
			typeof candidate.path !== 'string' ||
			!expectedAssets.has(candidate.path) ||
			assetByPath.has(candidate.path) ||
			candidate.mediaType !== expectedAssets.get(candidate.path)!.mediaType ||
			!Number.isSafeInteger(candidate.size) ||
			(candidate.size as number) <= 0 ||
			(candidate.size as number) > maxAssetBytes ||
			typeof candidate.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(candidate.sha256)
		) {
			throw new AssetIntegrityError('Prolog runtime manifest has an invalid logical asset', {
				profileId: payload.profileId,
				runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
			});
		}
		assetByPath.set(candidate.path, candidate);
	}
	const expectedStorage = new Map<string, { logicalPath: string; encoding: string }>([
		[DATA_STORAGE_PATH, { logicalPath: DATA_PATH, encoding: 'gzip' }],
		[JAVASCRIPT_PATH, { logicalPath: JAVASCRIPT_PATH, encoding: 'identity' }],
		[WASM_STORAGE_PATH, { logicalPath: WASM_PATH, encoding: 'gzip' }]
	]);
	const storageByPath = new Map<string, UnknownRecord>();
	for (const candidate of manifest.storage) {
		if (
			!isPlainRecord(candidate) ||
			!hasExactKeys(candidate, ['encoding', 'logicalPath', 'path', 'sha256', 'size']) ||
			typeof candidate.path !== 'string' ||
			!expectedStorage.has(candidate.path) ||
			storageByPath.has(candidate.path) ||
			candidate.logicalPath !== expectedStorage.get(candidate.path)!.logicalPath ||
			candidate.encoding !== expectedStorage.get(candidate.path)!.encoding ||
			!Number.isSafeInteger(candidate.size) ||
			(candidate.size as number) <= 0 ||
			(candidate.size as number) > maxAssetBytes ||
			typeof candidate.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(candidate.sha256)
		) {
			throw new AssetIntegrityError('Prolog runtime manifest has an invalid storage asset', {
				profileId: payload.profileId,
				runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
			});
		}
		storageByPath.set(candidate.path, candidate);
	}
	if (
		[...expectedAssets.keys()].some((path) => !assetByPath.has(path)) ||
		[...expectedStorage.keys()].some((path) => !storageByPath.has(path))
	) {
		throw new AssetIntegrityError('Prolog runtime manifest is missing a required asset', {
			profileId: payload.profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}

	let canonical = `${PROLOG_FINGERPRINT_DOMAIN}\nformat\0${PROLOG_MANIFEST_FORMAT}\nruntime\0swipl-wasm\nprofileId\0${payload.profileId}\n`;
	const compareNames = ([left]: [string, unknown], [right]: [string, unknown]) =>
		left < right ? -1 : left > right ? 1 : 0;
	for (const [name, entry] of Object.entries(manifest.package).sort(compareNames)) {
		canonical += `package\0${name}\0${String(entry)}\n`;
	}
	for (const [name, entry] of Object.entries(manifest.toolchain).sort(compareNames)) {
		canonical += `toolchain\0${name}\0${String(entry)}\n`;
	}
	canonical += `license\0${String(manifest.license.path)}\0${String(manifest.license.spdx)}\0${String(manifest.license.size)}\0${String(manifest.license.sha256)}\n`;
	canonical += `metadata\0${String(manifest.metadata.path)}\0${String(manifest.metadata.mediaType)}\0${String(manifest.metadata.size)}\0${String(manifest.metadata.sha256)}\n`;
	for (const asset of [...assetByPath.values()].sort((left, right) => {
		const leftPath = String(left.path);
		const rightPath = String(right.path);
		return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
	})) {
		canonical += `asset\0${String(asset.path)}\0${String(asset.mediaType)}\0${String(asset.size)}\0${String(asset.sha256)}\n`;
	}
	for (const asset of [...storageByPath.values()].sort((left, right) => {
		const leftPath = String(left.path);
		const rightPath = String(right.path);
		return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
	})) {
		canonical += `storage\0${String(asset.path)}\0${String(asset.logicalPath)}\0${String(asset.encoding)}\0${String(asset.size)}\0${String(asset.sha256)}\n`;
	}
	await waitForAbortable(
		verifyRuntimeAssetIntegrity({
			asset: 'runtime-manifest.v2 fingerprint',
			bytes: textEncoder.encode(canonical),
			expected: payload.manifestFingerprint,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID,
			profileId: payload.profileId
		}),
		options.signal
	);
	for (const [path, expected] of expectedAssets) {
		const receipt = assetByPath.get(path)!;
		await waitForAbortable(
			verifyRuntimeAssetIntegrity({
				asset: path,
				bytes: expected.bytes,
				expected: {
					bytes: receipt.size as number,
					sha256: receipt.sha256 as string
				},
				runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID,
				profileId: payload.profileId
			}),
			options.signal
		);
	}
	try {
		fatalDecoder.decode(payload.javascriptBytes);
	} catch (error) {
		throw new AssetIntegrityError('Prolog runtime JavaScript is not valid UTF-8', {
			cause: error,
			profileId: payload.profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	return payload;
}

function assertManifestMatchesPreflightProfile(
	manifestBytes: Uint8Array,
	profile: Readonly<Required<PrologRuntimePreflightProfile>>
) {
	let manifest: UnknownRecord;
	try {
		manifest = JSON.parse(fatalDecoder.decode(manifestBytes)) as UnknownRecord;
	} catch (error) {
		throw new AssetIntegrityError('Prolog runtime manifest is not valid UTF-8 JSON', {
			cause: error,
			profileId: profile.profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
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
		[JAVASCRIPT_PATH, profile.javascriptReceipt],
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
			'Prolog runtime manifest receipts do not match the selected preflight profile',
			{ profileId: profile.profileId, runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID }
		);
	}
}

async function decompressGzipBounded(
	compressedBytes: Uint8Array,
	expectedBytes: number,
	maxAssetBytes: number,
	label: 'wasm' | 'data',
	signal: AbortSignal,
	reportProgress?: (asset: 'wasm' | 'data', loadedBytes: number, totalBytes: number) => void
): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			phase: 'asset',
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!Number.isSafeInteger(expectedBytes) ||
		expectedBytes <= 0 ||
		expectedBytes > maxAssetBytes
	) {
		throw new AssetTooLargeError(
			`Prolog runtime ${label} logical bytes exceed the ${maxAssetBytes} byte limit`,
			{
				actual: expectedBytes,
				limit: maxAssetBytes,
				phase: 'asset',
				runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const body = new Response(Uint8Array.from(compressedBytes)).body;
	if (!body) {
		throw new UnsupportedBrowserFeatureError('ReadableStream response bodies', {
			phase: 'asset',
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
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
					`Prolog runtime ${label} gzip output exceeds its logical receipt`,
					{ runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID }
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
		throw new AssetIntegrityError(`Prolog runtime ${label} gzip decompression failed`, {
			cause: error,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
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
		throw new AssetIntegrityError(`Prolog runtime ${label} gzip output is truncated`, {
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	return output;
}

export async function preflightPrologRuntimeAssets(
	request: PrologRuntimePreflightRequest
): Promise<PrologRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('Prolog runtime preflight request is required', {
			phase: 'asset',
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
		});
	}
	const profile = snapshotPrologRuntimePreflightProfile(request.profile);
	let baseUrl: URL;
	let manifestUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
		manifestUrl = new URL(request.manifestUrl, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError('Prolog runtime asset URLs are invalid', {
			cause: error,
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
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
			'Prolog runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID }
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
			'Prolog runtime manifest must be an HTTP(S) asset beneath the configured runtime base',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID }
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
		[JAVASCRIPT_PATH, WASM_STORAGE_PATH, DATA_STORAGE_PATH].includes(manifestPath)
	) {
		throw new RuntimeConfigurationError(
			'Prolog runtime manifest path must be a distinct normalized file beneath the runtime base',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID }
		);
	}
	const expectedManifestQuery = `?v=${profile.manifestFingerprint}`;
	if (manifestUrl.search && manifestUrl.search !== expectedManifestQuery) {
		throw new RuntimeConfigurationError(
			'Prolog runtime manifest query must be the pinned fingerprint cache-buster',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID }
		);
	}
	const limits = resolveExecutionLimits(request.limits);
	const maxAssetBytes = Math.min(limits.maxAssetBytes, PROLOG_MAX_ASSET_BYTES);
	for (const [label, bytes, limit] of [
		['manifest', profile.manifestReceipt.bytes, Math.min(MAX_MANIFEST_BYTES, maxAssetBytes)],
		['JavaScript', profile.javascriptReceipt.bytes, maxAssetBytes],
		['compressed Wasm', profile.wasmReceipt.bytes, maxAssetBytes],
		['logical Wasm', profile.wasmReceipt.uncompressedBytes, maxAssetBytes],
		['compressed data', profile.dataReceipt.bytes, maxAssetBytes],
		['logical data', profile.dataReceipt.uncompressedBytes, maxAssetBytes]
	] as const) {
		if ((bytes ?? 0) > limit) {
			throw new AssetTooLargeError(
				`Prolog runtime ${label} exceeds the ${limit} byte limit`,
				{
					actual: bytes,
					limit,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}
	const manifestRequestUrl = new URL(manifestUrl);
	if (!manifestRequestUrl.search) {
		manifestRequestUrl.searchParams.set('v', profile.manifestFingerprint);
	}
	const javascriptRequestUrl = new URL(JAVASCRIPT_PATH, baseUrl);
	javascriptRequestUrl.searchParams.set('v', profile.javascriptReceipt.sha256);
	const wasmRequestUrl = new URL(WASM_STORAGE_PATH, baseUrl);
	wasmRequestUrl.searchParams.set('v', profile.wasmReceipt.sha256);
	const dataRequestUrl = new URL(DATA_STORAGE_PATH, baseUrl);
	dataRequestUrl.searchParams.set('v', profile.dataReceipt.sha256);
	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/prolog-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'PROLOG',
					implementationId: 'SWI-Prolog',
					implementationVersion: profile.profileId,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: profile.manifestReceipt.sha256,
						protocolVersion: PROLOG_PREFLIGHT_PROTOCOL_VERSION,
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
				workerLifetime: {
					mode: 'persistent',
					idleTimeoutMs: 60_000,
					evictOnMemoryPressure: true
				},
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
					routeId: 'prolog',
					runtimeAssetKey: 'prolog',
					documentationId: 'PROLOG',
					syncTarget: 'sync:wasm-prolog',
					browserTestId: 'browser:prolog'
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
		controller.abort(new DOMException('Prolog runtime preflight timed out', 'TimeoutError'));
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID,
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
				'Prolog runtime preflight returned an incomplete asset set',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		assertManifestMatchesPreflightProfile(manifestAsset.bytes, profile);
		for (const [label, asset] of [
			['Wasm', wasmAsset],
			['data', dataAsset]
		] as const) {
			if (asset.bytes[0] !== 0x1f || asset.bytes[1] !== 0x8b) {
				throw new AssetIntegrityError(`Prolog runtime ${label} storage is not gzip data`, {
					profileId: profile.profileId,
					runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
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
		const [wasmBytes, dataBytes] = await Promise.all([
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
		const payload: PrologRuntimePreflightPayload = Object.freeze({
			protocol: PROLOG_PREFLIGHT_PROTOCOL,
			protocolVersion: PROLOG_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			packageRevision: profile.packageRevision,
			swiplRevision: profile.swiplRevision,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			javascriptBytes: Uint8Array.from(javascriptAsset.bytes),
			wasmBytes,
			dataBytes
		});
		return await verifyPrologRuntimePreflightPayload(payload, {
			maxAssetBytes,
			signal: controller.signal
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`Prolog runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('Prolog runtime preflight cancelled', {
				cause: request.signal.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: PROLOG_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
