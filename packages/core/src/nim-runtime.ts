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

export const NIM_PREFLIGHT_PROTOCOL = 'wasm-idle-nim-preflight' as const;
export const NIM_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const NIM_PREFLIGHT_RUNTIME_ID = 'NIM' as const;
export const NIM_MAX_MANIFEST_BYTES = 64 * 1024;
export const NIM_MAX_ASSET_BYTES = 40 * 1024 * 1024;
export const NIM_MAX_DELIVERY_BYTES = 32 * 1024 * 1024;
export const NIM_MAX_LOGICAL_BYTES = 96 * 1024 * 1024;
export const NIM_RUNTIME_PREFLIGHT_CAPABILITIES = Object.freeze({
	stdin: 'streaming' as const,
	workspace: false,
	abort: true,
	artifacts: false,
	streamingOutput: true
});

const MANIFEST_FORMAT = 'wasm-nim-runtime-manifest-v2';
const FINGERPRINT_DOMAIN = 'wasm-idle:nim-runtime-manifest:v2';
const EXPECTED_RUNTIME = 'benagastov-nim-wasm-compiler';
const EXPECTED_LICENSE_EXPRESSION =
	'MIT AND Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND LicenseRef-WASI-Sysroot-Third-Party';
const PROFILE_KEYS = [
	'artifactRevision',
	'clangJavaScriptReceipt',
	'clangWasmReceipt',
	'emscriptenRevision',
	'lldWasmReceipt',
	'llvmRevision',
	'manifestFingerprint',
	'manifestReceipt',
	'memfsRevision',
	'memfsWasmReceipt',
	'nimJavaScriptReceipt',
	'nimRevision',
	'nimWasmReceipt',
	'nimbaseReceipt',
	'profileId',
	'sysrootReceipt'
] as const;
const PAYLOAD_KEYS = [
	'artifactRevision',
	'clangJavaScriptBytes',
	'clangWasmBytes',
	'emscriptenRevision',
	'lldWasmBytes',
	'llvmRevision',
	'manifestBytes',
	'manifestFingerprint',
	'memfsRevision',
	'memfsWasmBytes',
	'nimJavaScriptBytes',
	'nimRevision',
	'nimWasmBytes',
	'nimbaseBytes',
	'profileId',
	'protocol',
	'protocolVersion',
	'sysrootBytes'
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
	'notices',
	'profileId',
	'runtime',
	'storage'
] as const;
const RECEIPT_KEYS = ['mediaType', 'path', 'sha256', 'size'] as const;
const STORAGE_RECEIPT_KEYS = ['encoding', 'logicalPath', 'path', 'sha256', 'size'] as const;
const LICENSE_RECEIPT_KEYS = ['path', 'sha256', 'size', 'spdx'] as const;
const IDENTITY_RECEIPT_KEYS = ['bytes', 'sha256'] as const;
const COMPRESSED_RECEIPT_KEYS = [
	'bytes',
	'sha256',
	'uncompressedBytes',
	'uncompressedSha256'
] as const;
const LOGICAL_ASSETS = Object.freeze({
	'clang/clang.js': 'text/javascript',
	'clang/clang.wasm': 'application/wasm',
	'clang/lld.wasm': 'application/wasm',
	'clang/memfs.wasm': 'application/wasm',
	'clang/sysroot.tar': 'application/x-tar',
	'nim/nim-bundle.js': 'text/javascript',
	'nim/nim.wasm': 'application/wasm',
	'nim/nimbase.h': 'text/x-c-header'
});
const STORAGE_ASSETS = Object.freeze({
	'clang/clang.js.bin': Object.freeze({
		logicalPath: 'clang/clang.js',
		encoding: 'identity'
	}),
	'clang/clang.wasm.gz.bin': Object.freeze({
		logicalPath: 'clang/clang.wasm',
		encoding: 'gzip'
	}),
	'clang/lld.wasm.gz.bin': Object.freeze({
		logicalPath: 'clang/lld.wasm',
		encoding: 'gzip'
	}),
	'clang/memfs.wasm.gz.bin': Object.freeze({
		logicalPath: 'clang/memfs.wasm',
		encoding: 'gzip'
	}),
	'clang/sysroot.tar.gz.bin': Object.freeze({
		logicalPath: 'clang/sysroot.tar',
		encoding: 'gzip'
	}),
	'nim/nim-bundle.js.gz.bin': Object.freeze({
		logicalPath: 'nim/nim-bundle.js',
		encoding: 'gzip'
	}),
	'nim/nim.wasm.gz.bin': Object.freeze({
		logicalPath: 'nim/nim.wasm',
		encoding: 'gzip'
	}),
	'nim/nimbase.h.bin': Object.freeze({
		logicalPath: 'nim/nimbase.h',
		encoding: 'identity'
	})
} as const);
const STORAGE_KEY_BY_PATH: Readonly<Record<StorageAssetPath, string>> = Object.freeze({
	'clang/clang.js.bin': 'clangJavaScript',
	'clang/clang.wasm.gz.bin': 'clangWasm',
	'clang/lld.wasm.gz.bin': 'lldWasm',
	'clang/memfs.wasm.gz.bin': 'memfsWasm',
	'clang/sysroot.tar.gz.bin': 'sysroot',
	'nim/nim-bundle.js.gz.bin': 'nimJavaScript',
	'nim/nim.wasm.gz.bin': 'nimWasm',
	'nim/nimbase.h.bin': 'nimbase'
});
const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

type UnknownRecord = Record<string, unknown>;
type LogicalAssetPath = keyof typeof LOGICAL_ASSETS;
type StorageAssetPath = keyof typeof STORAGE_ASSETS;
type CompressedAssetLabel =
	| 'nimJavaScript'
	| 'nimWasm'
	| 'clangWasm'
	| 'lldWasm'
	| 'memfsWasm'
	| 'sysroot';

export interface NimRuntimePreflightProfile {
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly nimRevision: string;
	readonly llvmRevision: string;
	readonly memfsRevision: string;
	readonly emscriptenRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestReceipt: RuntimeAssetIntegrityEntry;
	readonly nimJavaScriptReceipt: RuntimeAssetIntegrityEntry;
	readonly nimWasmReceipt: RuntimeAssetIntegrityEntry;
	readonly nimbaseReceipt: RuntimeAssetIntegrityEntry;
	readonly clangJavaScriptReceipt: RuntimeAssetIntegrityEntry;
	readonly clangWasmReceipt: RuntimeAssetIntegrityEntry;
	readonly lldWasmReceipt: RuntimeAssetIntegrityEntry;
	readonly memfsWasmReceipt: RuntimeAssetIntegrityEntry;
	readonly sysrootReceipt: RuntimeAssetIntegrityEntry;
}

export interface NimRuntimePreflightPayload {
	readonly protocol: typeof NIM_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof NIM_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly nimRevision: string;
	readonly llvmRevision: string;
	readonly memfsRevision: string;
	readonly emscriptenRevision: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly nimJavaScriptBytes: Uint8Array;
	readonly nimWasmBytes: Uint8Array;
	readonly nimbaseBytes: Uint8Array;
	readonly clangJavaScriptBytes: Uint8Array;
	readonly clangWasmBytes: Uint8Array;
	readonly lldWasmBytes: Uint8Array;
	readonly memfsWasmBytes: Uint8Array;
	readonly sysrootBytes: Uint8Array;
}

export interface NimRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: NimRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (
		asset: CompressedAssetLabel,
		loadedBytes: number,
		totalBytes: number
	) => void;
}

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

interface ParsedNimManifest {
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
		ArrayBuffer.isView(value) &&
		Object.prototype.toString.call(value.buffer) === '[object ArrayBuffer]' &&
		Object.prototype.toString.call(value) === '[object Uint8Array]'
	);
}

function requireSafeString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value || value.length > 512 || /[\0\r\n]/u.test(value)) {
		throw new RuntimeConfigurationError(`Nim runtime ${label} is invalid`, {
			phase: 'asset',
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	return value;
}

function requireReceipt(
	value: unknown,
	label: string,
	compressed: boolean
): RuntimeAssetIntegrityEntry {
	const keys = compressed ? COMPRESSED_RECEIPT_KEYS : IDENTITY_RECEIPT_KEYS;
	if (!isPlainRecord(value) || !hasExactKeys(value, keys)) {
		throw new RuntimeConfigurationError(`Nim runtime preflight profile ${label} is invalid`, {
			phase: 'asset',
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	const bytes = value.bytes;
	const sha256 = value.sha256;
	const uncompressedBytes = value.uncompressedBytes;
	const uncompressedSha256 = value.uncompressedSha256;
	if (
		!Number.isSafeInteger(bytes) ||
		(bytes as number) <= 0 ||
		(bytes as number) > NIM_MAX_ASSET_BYTES ||
		typeof sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(sha256) ||
		(compressed &&
			(!Number.isSafeInteger(uncompressedBytes) ||
				(uncompressedBytes as number) <= 0 ||
				(uncompressedBytes as number) > NIM_MAX_ASSET_BYTES ||
				typeof uncompressedSha256 !== 'string' ||
				!/^[a-f0-9]{64}$/u.test(uncompressedSha256)))
	) {
		throw new RuntimeConfigurationError(`Nim runtime preflight profile ${label} is invalid`, {
			phase: 'asset',
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	return compressed
		? Object.freeze({
				bytes: bytes as number,
				sha256,
				uncompressedBytes: uncompressedBytes as number,
				uncompressedSha256: uncompressedSha256 as string
			})
		: Object.freeze({ bytes: bytes as number, sha256 });
}

function assertProfileBudgets(profile: NimRuntimePreflightProfile, maxAssetBytes: number) {
	const entries = [
		[
			'manifest',
			profile.manifestReceipt.bytes,
			Math.min(NIM_MAX_MANIFEST_BYTES, maxAssetBytes)
		],
		['Nim JavaScript delivery', profile.nimJavaScriptReceipt.bytes, maxAssetBytes],
		['Nim JavaScript logical', profile.nimJavaScriptReceipt.uncompressedBytes, maxAssetBytes],
		['Nim Wasm delivery', profile.nimWasmReceipt.bytes, maxAssetBytes],
		['Nim Wasm logical', profile.nimWasmReceipt.uncompressedBytes, maxAssetBytes],
		['nimbase delivery', profile.nimbaseReceipt.bytes, maxAssetBytes],
		['clang JavaScript delivery', profile.clangJavaScriptReceipt.bytes, maxAssetBytes],
		['clang Wasm delivery', profile.clangWasmReceipt.bytes, maxAssetBytes],
		['clang Wasm logical', profile.clangWasmReceipt.uncompressedBytes, maxAssetBytes],
		['lld Wasm delivery', profile.lldWasmReceipt.bytes, maxAssetBytes],
		['lld Wasm logical', profile.lldWasmReceipt.uncompressedBytes, maxAssetBytes],
		['memfs Wasm delivery', profile.memfsWasmReceipt.bytes, maxAssetBytes],
		['memfs Wasm logical', profile.memfsWasmReceipt.uncompressedBytes, maxAssetBytes],
		['sysroot delivery', profile.sysrootReceipt.bytes, maxAssetBytes],
		['sysroot logical', profile.sysrootReceipt.uncompressedBytes, maxAssetBytes]
	] as const;
	for (const [label, value, limit] of entries) {
		if (!Number.isSafeInteger(value) || value! <= 0 || value! > limit) {
			throw new AssetTooLargeError(`Nim runtime ${label} exceeds its byte limit`, {
				actual: value,
				limit,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	const deliveryTotal = [
		profile.manifestReceipt.bytes!,
		profile.nimJavaScriptReceipt.bytes!,
		profile.nimWasmReceipt.bytes!,
		profile.nimbaseReceipt.bytes!,
		profile.clangJavaScriptReceipt.bytes!,
		profile.clangWasmReceipt.bytes!,
		profile.lldWasmReceipt.bytes!,
		profile.memfsWasmReceipt.bytes!,
		profile.sysrootReceipt.bytes!
	].reduce((total, value) => total + value, 0);
	if (!Number.isSafeInteger(deliveryTotal) || deliveryTotal > NIM_MAX_DELIVERY_BYTES) {
		throw new AssetTooLargeError(
			'Nim runtime delivery graph exceeds its aggregate byte limit',
			{
				actual: deliveryTotal,
				limit: NIM_MAX_DELIVERY_BYTES,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const logicalTotal = [
		profile.nimJavaScriptReceipt.uncompressedBytes!,
		profile.nimWasmReceipt.uncompressedBytes!,
		profile.nimbaseReceipt.bytes!,
		profile.clangJavaScriptReceipt.bytes!,
		profile.clangWasmReceipt.uncompressedBytes!,
		profile.lldWasmReceipt.uncompressedBytes!,
		profile.memfsWasmReceipt.uncompressedBytes!,
		profile.sysrootReceipt.uncompressedBytes!
	].reduce((total, value) => total + value, 0);
	if (!Number.isSafeInteger(logicalTotal) || logicalTotal > NIM_MAX_LOGICAL_BYTES) {
		throw new AssetTooLargeError('Nim runtime logical graph exceeds its aggregate byte limit', {
			actual: logicalTotal,
			limit: NIM_MAX_LOGICAL_BYTES,
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
}

export function snapshotNimRuntimePreflightProfile(value: unknown): NimRuntimePreflightProfile {
	if (!isPlainRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) {
		throw new RuntimeConfigurationError('Nim runtime preflight profile has an invalid shape', {
			phase: 'asset',
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	const manifestFingerprint = requireSafeString(
		value.manifestFingerprint,
		'manifest fingerprint'
	);
	if (!/^[a-f0-9]{64}$/u.test(manifestFingerprint)) {
		throw new RuntimeConfigurationError(
			'Nim runtime preflight profile fingerprint is invalid',
			{
				phase: 'asset',
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const profile = Object.freeze({
		profileId: requireSafeString(value.profileId, 'profile ID'),
		artifactRevision: requireSafeString(value.artifactRevision, 'artifact revision'),
		nimRevision: requireSafeString(value.nimRevision, 'Nim revision'),
		llvmRevision: requireSafeString(value.llvmRevision, 'LLVM revision'),
		memfsRevision: requireSafeString(value.memfsRevision, 'memfs revision'),
		emscriptenRevision: requireSafeString(value.emscriptenRevision, 'Emscripten revision'),
		manifestFingerprint,
		manifestReceipt: requireReceipt(value.manifestReceipt, 'manifest receipt', false),
		nimJavaScriptReceipt: requireReceipt(
			value.nimJavaScriptReceipt,
			'Nim JavaScript receipt',
			true
		),
		nimWasmReceipt: requireReceipt(value.nimWasmReceipt, 'Nim Wasm receipt', true),
		nimbaseReceipt: requireReceipt(value.nimbaseReceipt, 'nimbase receipt', false),
		clangJavaScriptReceipt: requireReceipt(
			value.clangJavaScriptReceipt,
			'clang JavaScript receipt',
			false
		),
		clangWasmReceipt: requireReceipt(value.clangWasmReceipt, 'clang Wasm receipt', true),
		lldWasmReceipt: requireReceipt(value.lldWasmReceipt, 'lld Wasm receipt', true),
		memfsWasmReceipt: requireReceipt(value.memfsWasmReceipt, 'memfs Wasm receipt', true),
		sysrootReceipt: requireReceipt(value.sysrootReceipt, 'sysroot receipt', true)
	});
	assertProfileBudgets(profile, NIM_MAX_ASSET_BYTES);
	return profile;
}

function requireOwnedPayloadBytes(value: unknown, label: string): Uint8Array {
	if (
		!isByteArray(value) ||
		value.byteLength === 0 ||
		value.byteOffset !== 0 ||
		value.byteLength !== value.buffer.byteLength
	) {
		throw new ProtocolError(`Nim runtime preflight payload ${label} is invalid`, {
			phase: 'protocol',
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	return value;
}

export function requireNimRuntimePreflightPayload(value: unknown): NimRuntimePreflightPayload {
	if (!isPlainRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
		throw new ProtocolError('Nim runtime preflight payload has an invalid shape', {
			phase: 'protocol',
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.protocol !== NIM_PREFLIGHT_PROTOCOL ||
		value.protocolVersion !== NIM_PREFLIGHT_PROTOCOL_VERSION
	) {
		throw new ProtocolError('Nim runtime preflight payload protocol is invalid', {
			phase: 'protocol',
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	const payload = value as unknown as NimRuntimePreflightPayload;
	for (const identity of [
		payload.profileId,
		payload.artifactRevision,
		payload.nimRevision,
		payload.llvmRevision,
		payload.memfsRevision,
		payload.emscriptenRevision
	]) {
		requireSafeString(identity, 'payload identity');
	}
	if (!/^[a-f0-9]{64}$/u.test(payload.manifestFingerprint)) {
		throw new ProtocolError('Nim runtime preflight payload fingerprint is invalid', {
			phase: 'protocol',
			profileId: payload.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	const buffers = [
		requireOwnedPayloadBytes(payload.manifestBytes, 'manifest bytes'),
		requireOwnedPayloadBytes(payload.nimJavaScriptBytes, 'Nim JavaScript bytes'),
		requireOwnedPayloadBytes(payload.nimWasmBytes, 'Nim Wasm bytes'),
		requireOwnedPayloadBytes(payload.nimbaseBytes, 'nimbase bytes'),
		requireOwnedPayloadBytes(payload.clangJavaScriptBytes, 'clang JavaScript bytes'),
		requireOwnedPayloadBytes(payload.clangWasmBytes, 'clang Wasm bytes'),
		requireOwnedPayloadBytes(payload.lldWasmBytes, 'lld Wasm bytes'),
		requireOwnedPayloadBytes(payload.memfsWasmBytes, 'memfs Wasm bytes'),
		requireOwnedPayloadBytes(payload.sysrootBytes, 'sysroot bytes')
	];
	if (new Set(buffers.map((bytes) => bytes.buffer)).size !== buffers.length) {
		throw new ProtocolError('Nim runtime preflight payload buffers must be unique', {
			phase: 'protocol',
			profileId: payload.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	if (payload.manifestBytes.byteLength > NIM_MAX_MANIFEST_BYTES) {
		throw new AssetTooLargeError('Nim runtime manifest payload exceeds its byte limit', {
			actual: payload.manifestBytes.byteLength,
			limit: NIM_MAX_MANIFEST_BYTES,
			phase: 'protocol',
			profileId: payload.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const bytes of buffers.slice(1)) {
		if (bytes.byteLength > NIM_MAX_ASSET_BYTES) {
			throw new AssetTooLargeError(
				'Nim runtime logical payload asset exceeds its byte limit',
				{
					actual: bytes.byteLength,
					limit: NIM_MAX_ASSET_BYTES,
					phase: 'protocol',
					profileId: payload.profileId,
					runtimeId: NIM_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}
	const logicalTotal = buffers.slice(1).reduce((total, bytes) => total + bytes.byteLength, 0);
	if (!Number.isSafeInteger(logicalTotal) || logicalTotal > NIM_MAX_LOGICAL_BYTES) {
		throw new AssetTooLargeError(
			'Nim runtime logical payload exceeds its aggregate byte limit',
			{
				actual: logicalTotal,
				limit: NIM_MAX_LOGICAL_BYTES,
				phase: 'protocol',
				profileId: payload.profileId,
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	return payload;
}

export function cloneNimRuntimePreflightPayload(
	value: unknown
): Readonly<NimRuntimePreflightPayload> {
	const payload = requireNimRuntimePreflightPayload(value);
	return Object.freeze({
		protocol: NIM_PREFLIGHT_PROTOCOL,
		protocolVersion: NIM_PREFLIGHT_PROTOCOL_VERSION,
		profileId: payload.profileId,
		artifactRevision: payload.artifactRevision,
		nimRevision: payload.nimRevision,
		llvmRevision: payload.llvmRevision,
		memfsRevision: payload.memfsRevision,
		emscriptenRevision: payload.emscriptenRevision,
		manifestFingerprint: payload.manifestFingerprint,
		manifestBytes: Uint8Array.from(payload.manifestBytes),
		nimJavaScriptBytes: Uint8Array.from(payload.nimJavaScriptBytes),
		nimWasmBytes: Uint8Array.from(payload.nimWasmBytes),
		nimbaseBytes: Uint8Array.from(payload.nimbaseBytes),
		clangJavaScriptBytes: Uint8Array.from(payload.clangJavaScriptBytes),
		clangWasmBytes: Uint8Array.from(payload.clangWasmBytes),
		lldWasmBytes: Uint8Array.from(payload.lldWasmBytes),
		memfsWasmBytes: Uint8Array.from(payload.memfsWasmBytes),
		sysrootBytes: Uint8Array.from(payload.sysrootBytes)
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
		throw new AssetIntegrityError('Nim runtime manifest contains a non-JSON value', {
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
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
		throw new AssetIntegrityError('Nim runtime integrity verification requires Web Crypto', {
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
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
		(value.size as number) > NIM_MAX_ASSET_BYTES ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new AssetIntegrityError(`Nim runtime manifest receipt ${expectedPath} is invalid`, {
			profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
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
		(value.size as number) > NIM_MAX_ASSET_BYTES ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new AssetIntegrityError(`Nim runtime storage receipt ${path} is invalid`, {
			profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
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

function normalizeLegalReceipt(
	value: unknown,
	path: string,
	mediaType: string,
	profileId: string
): ManifestReceipt {
	return normalizeManifestReceipt(value, path, mediaType, profileId);
}

async function computeFingerprint(
	manifest: UnknownRecord,
	assets: readonly ManifestReceipt[],
	storage: readonly ManifestStorageReceipt[],
	signal?: AbortSignal
): Promise<string> {
	const license = manifest.license as UnknownRecord;
	const notices = manifest.notices as UnknownRecord;
	const documentation = manifest.documentation as UnknownRecord;
	const metadata = manifest.metadata as UnknownRecord;
	let canonical = `${FINGERPRINT_DOMAIN}\nformat\0${MANIFEST_FORMAT}\nruntime\0${EXPECTED_RUNTIME}\nprofileId\0${manifest.profileId}\n`;
	canonical += `licenseExpression\0${manifest.licenseExpression}\n`;
	canonical += `artifact\0${canonicalJson(manifest.artifact)}\n`;
	canonical += `components\0${canonicalJson(manifest.components)}\n`;
	canonical += `license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`;
	canonical += `notices\0${notices.path}\0${notices.mediaType}\0${notices.size}\0${notices.sha256}\n`;
	canonical += `documentation\0${documentation.path}\0${documentation.mediaType}\0${documentation.size}\0${documentation.sha256}\n`;
	canonical += `metadata\0${metadata.path}\0${metadata.mediaType}\0${metadata.size}\0${metadata.sha256}\n`;
	for (const asset of [...assets].sort((left, right) => left.path.localeCompare(right.path))) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...storage].sort((left, right) => left.path.localeCompare(right.path))) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return await sha256Hex(textEncoder.encode(canonical), signal);
}

function assertComponentIdentity(components: unknown, profile: NimRuntimePreflightProfile) {
	if (
		!isPlainRecord(components) ||
		!hasExactKeys(components, ['distribution', 'emscripten', 'llvm', 'memfs', 'nim'])
	) {
		throw new AssetIntegrityError('Nim runtime component graph is invalid', {
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const [key, revision] of [
		['distribution', profile.artifactRevision],
		['nim', profile.nimRevision],
		['llvm', profile.llvmRevision],
		['memfs', profile.memfsRevision],
		['emscripten', profile.emscriptenRevision]
	] as const) {
		const component = components[key];
		if (!isPlainRecord(component) || component.revision !== revision) {
			throw new AssetIntegrityError(`Nim runtime ${key} component identity is invalid`, {
				profileId: profile.profileId,
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
			});
		}
		canonicalJson(component);
	}
}

async function parseAndVerifyManifest(
	bytes: Uint8Array,
	profile: NimRuntimePreflightProfile,
	signal?: AbortSignal
): Promise<ParsedNimManifest> {
	let value: unknown;
	try {
		value = JSON.parse(fatalDecoder.decode(bytes));
	} catch (error) {
		throw new AssetIntegrityError('Nim runtime manifest is not valid UTF-8 JSON', {
			cause: error,
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!isPlainRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
		throw new AssetIntegrityError('Nim runtime manifest schema is invalid', {
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.format !== MANIFEST_FORMAT ||
		value.runtime !== EXPECTED_RUNTIME ||
		value.profileId !== profile.profileId ||
		value.fingerprint !== profile.manifestFingerprint ||
		value.licenseExpression !== EXPECTED_LICENSE_EXPRESSION
	) {
		throw new AssetIntegrityError('Nim runtime manifest identity is invalid', {
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!isPlainRecord(value.artifact) || value.artifact.revision !== profile.artifactRevision) {
		throw new AssetIntegrityError('Nim runtime artifact identity is invalid', {
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	canonicalJson(value.artifact);
	assertComponentIdentity(value.components, profile);
	if (
		!isPlainRecord(value.license) ||
		!hasExactKeys(value.license, LICENSE_RECEIPT_KEYS) ||
		value.license.path !== 'LICENSE' ||
		value.license.spdx !== EXPECTED_LICENSE_EXPRESSION ||
		!Number.isSafeInteger(value.license.size) ||
		(value.license.size as number) <= 0 ||
		typeof value.license.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.license.sha256)
	) {
		throw new AssetIntegrityError('Nim runtime license receipt is invalid', {
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	const notices = normalizeLegalReceipt(
		value.notices,
		'THIRD_PARTY_NOTICES.md',
		'text/markdown',
		profile.profileId
	);
	const documentation = normalizeLegalReceipt(
		value.documentation,
		'README.md',
		'text/markdown',
		profile.profileId
	);
	const metadata = normalizeLegalReceipt(
		value.metadata,
		'runtime-build.json',
		'application/json',
		profile.profileId
	);
	if (!Array.isArray(value.assets) || value.assets.length !== 8) {
		throw new AssetIntegrityError('Nim runtime manifest must declare eight logical assets', {
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 8) {
		throw new AssetIntegrityError('Nim runtime manifest must declare eight storage assets', {
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
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
			throw new AssetIntegrityError('Nim runtime manifest has an unexpected logical asset', {
				profileId: profile.profileId,
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
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
	const storageLogicalPaths = new Set<string>();
	for (const candidate of value.storage) {
		const path = isPlainRecord(candidate) ? candidate.path : undefined;
		if (
			typeof path !== 'string' ||
			!Object.prototype.hasOwnProperty.call(STORAGE_ASSETS, path) ||
			storageByPath.has(path as StorageAssetPath)
		) {
			throw new AssetIntegrityError('Nim runtime manifest has an unexpected storage asset', {
				profileId: profile.profileId,
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
			});
		}
		const normalized = normalizeStorageReceipt(
			candidate,
			path as StorageAssetPath,
			profile.profileId
		);
		if (storageLogicalPaths.has(normalized.logicalPath)) {
			throw new AssetIntegrityError('Nim runtime manifest has duplicate storage coverage', {
				profileId: profile.profileId,
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
			});
		}
		storageLogicalPaths.add(normalized.logicalPath);
		storageByPath.set(path as StorageAssetPath, normalized);
	}
	if (
		Object.keys(LOGICAL_ASSETS).some((path) => !assetByPath.has(path as LogicalAssetPath)) ||
		Object.keys(STORAGE_ASSETS).some((path) => !storageByPath.has(path as StorageAssetPath))
	) {
		throw new AssetIntegrityError('Nim runtime manifest omits a required asset receipt', {
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	const fingerprint = await computeFingerprint(
		value,
		[...assetByPath.values()],
		[...storageByPath.values()],
		signal
	);
	if (fingerprint !== profile.manifestFingerprint) {
		throw new AssetIntegrityError('Nim runtime receipt graph failed fingerprint verification', {
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	void notices;
	void documentation;
	void metadata;
	return { assetByPath, storageByPath };
}

function profileReceiptByLogicalPath(
	profile: NimRuntimePreflightProfile,
	logicalPath: LogicalAssetPath
): RuntimeAssetIntegrityEntry {
	switch (logicalPath) {
		case 'nim/nim-bundle.js':
			return profile.nimJavaScriptReceipt;
		case 'nim/nim.wasm':
			return profile.nimWasmReceipt;
		case 'nim/nimbase.h':
			return profile.nimbaseReceipt;
		case 'clang/clang.js':
			return profile.clangJavaScriptReceipt;
		case 'clang/clang.wasm':
			return profile.clangWasmReceipt;
		case 'clang/lld.wasm':
			return profile.lldWasmReceipt;
		case 'clang/memfs.wasm':
			return profile.memfsWasmReceipt;
		case 'clang/sysroot.tar':
			return profile.sysrootReceipt;
	}
}

function assertManifestMatchesProfile(
	manifest: ParsedNimManifest,
	profile: NimRuntimePreflightProfile
) {
	for (const [storagePath, expectedStorage] of Object.entries(STORAGE_ASSETS) as Array<
		[StorageAssetPath, (typeof STORAGE_ASSETS)[StorageAssetPath]]
	>) {
		const storage = manifest.storageByPath.get(storagePath)!;
		const logical = manifest.assetByPath.get(expectedStorage.logicalPath)!;
		const receipt = profileReceiptByLogicalPath(profile, expectedStorage.logicalPath);
		if (
			storage.size !== receipt.bytes ||
			storage.sha256 !== receipt.sha256 ||
			logical.size !== (receipt.uncompressedBytes ?? receipt.bytes) ||
			logical.sha256 !== (receipt.uncompressedSha256 ?? receipt.sha256)
		) {
			throw new AssetIntegrityError(
				`Nim runtime profile receipt mismatch for ${storagePath}`,
				{
					profileId: profile.profileId,
					runtimeId: NIM_PREFLIGHT_RUNTIME_ID
				}
			);
		}
	}
}

async function verifyLogicalBytes(
	manifest: ParsedNimManifest,
	logicalPath: LogicalAssetPath,
	bytes: Uint8Array,
	profileId: string,
	signal?: AbortSignal
) {
	const receipt = manifest.assetByPath.get(logicalPath)!;
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
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		}),
		signal
	);
}

function validateTextMarker(
	bytes: Uint8Array,
	label: string,
	markers: readonly string[],
	profileId: string
) {
	let source: string;
	try {
		source = fatalDecoder.decode(bytes);
	} catch (error) {
		throw new AssetIntegrityError(`Nim runtime ${label} is not valid UTF-8`, {
			cause: error,
			profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const marker of markers) {
		if (!source.includes(marker)) {
			throw new AssetIntegrityError(`Nim runtime ${label} is missing marker ${marker}`, {
				profileId,
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
			});
		}
	}
}

function validateWasmHeader(bytes: Uint8Array, label: string, profileId: string) {
	if (
		bytes.byteLength < 8 ||
		bytes[0] !== 0 ||
		bytes[1] !== 0x61 ||
		bytes[2] !== 0x73 ||
		bytes[3] !== 0x6d
	) {
		throw new AssetIntegrityError(`Nim runtime ${label} header is invalid`, {
			profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
}

function validatePayloadSemantics(payload: NimRuntimePreflightPayload) {
	validateTextMarker(
		payload.nimJavaScriptBytes,
		'Nim JavaScript',
		['__NIM_USER_CODE__', 'callMain'],
		payload.profileId
	);
	validateTextMarker(payload.nimbaseBytes, 'nimbase.h', ['NIM_INTBITS'], payload.profileId);
	validateTextMarker(
		payload.clangJavaScriptBytes,
		'clang JavaScript',
		['payload:{port:c,assets:l}', 'async function p({assets:l})', 'compile-each-link-done'],
		payload.profileId
	);
	for (const [label, bytes] of [
		['Nim Wasm', payload.nimWasmBytes],
		['clang Wasm', payload.clangWasmBytes],
		['lld Wasm', payload.lldWasmBytes],
		['memfs Wasm', payload.memfsWasmBytes]
	] as const) {
		validateWasmHeader(bytes, label, payload.profileId);
	}
	if (
		payload.sysrootBytes.byteLength < 262 ||
		fatalDecoder.decode(payload.sysrootBytes.subarray(257, 262)) !== 'ustar'
	) {
		throw new AssetIntegrityError('Nim runtime sysroot tar header is invalid', {
			profileId: payload.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
}

async function decompressGzipBounded(
	compressedBytes: Uint8Array,
	expectedBytes: number,
	maxBytes: number,
	asset: CompressedAssetLabel,
	profileId: string,
	signal: AbortSignal,
	reportProgress?: (asset: CompressedAssetLabel, loaded: number, total: number) => void
): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError(
			'Nim runtime gzip decompression requires DecompressionStream',
			{ phase: 'asset', profileId, runtimeId: NIM_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > maxBytes) {
		throw new AssetTooLargeError(`Nim runtime ${asset} logical bytes exceed their limit`, {
			actual: expectedBytes,
			limit: maxBytes,
			phase: 'asset',
			profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	let reader: ReadableStreamDefaultReader<Uint8Array>;
	try {
		const body = new Response(Uint8Array.from(compressedBytes)).body;
		if (!body) throw new Error('ReadableStream response bodies are unavailable');
		reader = body.pipeThrough(new DecompressionStream('gzip')).getReader();
	} catch (error) {
		throw new AssetIntegrityError(`Nim runtime ${asset} gzip stream could not be opened`, {
			cause: error,
			profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	const output = new Uint8Array(expectedBytes);
	let offset = 0;
	const cancelOnAbort = () => {
		try {
			void reader.cancel(signal.reason).catch(() => undefined);
		} catch {}
	};
	signal.addEventListener('abort', cancelOnAbort, { once: true });
	try {
		while (true) {
			if (signal.aborted) throw signal.reason;
			const { done, value } = await waitForAbortable(reader.read(), signal);
			if (done) break;
			if (!isByteArray(value)) throw new Error('gzip stream returned invalid bytes');
			const nextOffset = offset + value.byteLength;
			if (!Number.isSafeInteger(nextOffset) || nextOffset > expectedBytes) {
				throw new AssetTooLargeError(
					`Nim runtime ${asset} gzip exceeds its logical receipt`,
					{
						actual: nextOffset,
						limit: expectedBytes,
						phase: 'asset',
						profileId,
						runtimeId: NIM_PREFLIGHT_RUNTIME_ID
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
		} catch {}
		if (signal.aborted || isWasmIdleError(error)) throw error;
		throw new AssetIntegrityError(`Nim runtime ${asset} gzip decompression failed`, {
			cause: error,
			profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	} finally {
		signal.removeEventListener('abort', cancelOnAbort);
		try {
			reader.releaseLock();
		} catch {}
	}
	if (offset !== output.byteLength) {
		throw new AssetIntegrityError(`Nim runtime ${asset} gzip output is truncated`, {
			profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	return output;
}

export async function verifyNimRuntimePreflightPayload(
	value: unknown,
	options: { readonly maxAssetBytes?: number; readonly signal?: AbortSignal } = {}
): Promise<NimRuntimePreflightPayload> {
	const payload = requireNimRuntimePreflightPayload(value);
	const maxAssetBytes = Math.min(
		options.maxAssetBytes ?? NIM_MAX_ASSET_BYTES,
		NIM_MAX_ASSET_BYTES
	);
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new ProtocolError('Nim runtime payload byte limit is invalid', {
			phase: 'protocol',
			profileId: payload.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	if (payload.manifestBytes.byteLength > Math.min(NIM_MAX_MANIFEST_BYTES, maxAssetBytes)) {
		throw new AssetTooLargeError('Nim runtime manifest payload exceeds its active byte limit', {
			actual: payload.manifestBytes.byteLength,
			limit: Math.min(NIM_MAX_MANIFEST_BYTES, maxAssetBytes),
			phase: 'protocol',
			profileId: payload.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	const profile = {
		profileId: payload.profileId,
		artifactRevision: payload.artifactRevision,
		nimRevision: payload.nimRevision,
		llvmRevision: payload.llvmRevision,
		memfsRevision: payload.memfsRevision,
		emscriptenRevision: payload.emscriptenRevision,
		manifestFingerprint: payload.manifestFingerprint
	} as NimRuntimePreflightProfile;
	const manifest = await parseAndVerifyManifest(payload.manifestBytes, profile, options.signal);
	for (const [path, bytes] of [
		['nim/nim-bundle.js', payload.nimJavaScriptBytes],
		['nim/nim.wasm', payload.nimWasmBytes],
		['nim/nimbase.h', payload.nimbaseBytes],
		['clang/clang.js', payload.clangJavaScriptBytes],
		['clang/clang.wasm', payload.clangWasmBytes],
		['clang/lld.wasm', payload.lldWasmBytes],
		['clang/memfs.wasm', payload.memfsWasmBytes],
		['clang/sysroot.tar', payload.sysrootBytes]
	] as const) {
		if (bytes.byteLength > maxAssetBytes) {
			throw new AssetTooLargeError(`Nim runtime ${path} exceeds its active byte limit`, {
				actual: bytes.byteLength,
				limit: maxAssetBytes,
				phase: 'protocol',
				profileId: payload.profileId,
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
			});
		}
		await verifyLogicalBytes(manifest, path, bytes, payload.profileId, options.signal);
	}
	validatePayloadSemantics(payload);
	return payload;
}

export async function preflightNimRuntimeAssets(
	request: NimRuntimePreflightRequest
): Promise<NimRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('Nim runtime preflight request is required', {
			phase: 'asset',
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	const profile = snapshotNimRuntimePreflightProfile(request.profile);
	const limits = resolveExecutionLimits(request.limits);
	const maxAssetBytes = Math.min(limits.maxAssetBytes, NIM_MAX_ASSET_BYTES);
	assertProfileBudgets(profile, maxAssetBytes);
	let baseUrl: URL;
	let manifestUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
		manifestUrl = new URL(request.manifestUrl, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError('Nim runtime asset URLs are invalid', {
			cause: error,
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		(baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') ||
		baseUrl.username ||
		baseUrl.password ||
		baseUrl.search ||
		baseUrl.hash
	) {
		throw new RuntimeConfigurationError('Nim runtime base URL is invalid', {
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID
		});
	}
	const expectedManifestUrl = new URL('runtime-manifest.v2.json', baseUrl);
	expectedManifestUrl.search = `?v=${profile.manifestFingerprint}`;
	if (manifestUrl.href !== expectedManifestUrl.href) {
		throw new RuntimeConfigurationError(
			'Nim runtime manifest URL must be the canonical query-pinned v2 manifest',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: NIM_PREFLIGHT_RUNTIME_ID }
		);
	}
	const requestUrlByKey: Record<string, URL> = { manifest: manifestUrl };
	const receiptByStoragePath = new Map<StorageAssetPath, RuntimeAssetIntegrityEntry>();
	for (const storagePath of Object.keys(STORAGE_ASSETS) as StorageAssetPath[]) {
		const receipt = profileReceiptByLogicalPath(
			profile,
			STORAGE_ASSETS[storagePath].logicalPath
		);
		receiptByStoragePath.set(storagePath, receipt);
		const url = new URL(storagePath, baseUrl);
		url.search = `?v=${receipt.sha256}`;
		requestUrlByKey[STORAGE_KEY_BY_PATH[storagePath]] = url;
	}
	const registryAssets: Array<RuntimeRegistryManifest['runtimes'][number]['assets'][number]> = [
		{
			key: 'manifest',
			path: 'runtime-manifest.v2.json',
			compressedSha256: profile.manifestReceipt.sha256,
			uncompressedSha256: profile.manifestReceipt.sha256,
			compressedBytes: profile.manifestReceipt.bytes!,
			uncompressedBytes: profile.manifestReceipt.bytes!,
			mediaType: 'application/json',
			encoding: 'identity'
		}
	];
	for (const storagePath of Object.keys(STORAGE_ASSETS) as StorageAssetPath[]) {
		const storage = STORAGE_ASSETS[storagePath];
		const receipt = receiptByStoragePath.get(storagePath)!;
		registryAssets.push({
			key: STORAGE_KEY_BY_PATH[storagePath],
			path: storagePath,
			compressedSha256: receipt.sha256,
			uncompressedSha256: receipt.uncompressedSha256 ?? receipt.sha256,
			compressedBytes: receipt.bytes!,
			uncompressedBytes: receipt.uncompressedBytes ?? receipt.bytes!,
			mediaType:
				storage.encoding === 'identity'
					? 'application/octet-stream'
					: LOGICAL_ASSETS[storage.logicalPath],
			encoding: storage.encoding
		});
	}
	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/nim-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'NIM',
					implementationId: EXPECTED_RUNTIME,
					implementationVersion: profile.nimRevision,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: profile.manifestReceipt.sha256,
						protocolVersion: NIM_PREFLIGHT_PROTOCOL_VERSION,
						trustProfileId: 'wasm-idle-static-worker-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: NIM_RUNTIME_PREFLIGHT_CAPABILITIES,
				workerLifetime: { mode: 'per-run' },
				requiredBrowserFeatures: ['wasm', 'decompression-stream'],
				assetRoot: '.',
				assets: registryAssets,
				contracts: {
					routeId: 'nim',
					runtimeAssetKey: 'nim',
					documentationId: 'NIM',
					syncTarget: 'sync:wasm-nim',
					browserTestId: 'browser:nim'
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
		controller.abort(new DOMException('Nim runtime preflight timed out', 'TimeoutError'));
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: NIM_PREFLIGHT_RUNTIME_ID,
			rootUrl: baseUrl,
			assetUrls: requestUrlByKey,
			fetch: request.fetch,
			signal: controller.signal,
			limits: { ...limits, maxAssetBytes },
			redirect: 'error',
			maxConcurrentDownloads: 4,
			maxTotalDeliveryBytes: NIM_MAX_DELIVERY_BYTES,
			reportProgress: request.reportProgress
		});
		const manifestAsset = preflight.assets.manifest;
		if (!manifestAsset) {
			throw new RuntimeConfigurationError('Nim runtime preflight omitted the manifest', {
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
			});
		}
		const manifest = await parseAndVerifyManifest(
			manifestAsset.bytes,
			profile,
			controller.signal
		);
		assertManifestMatchesProfile(manifest, profile);
		const delivery = (path: StorageAssetPath) => {
			const asset = preflight.assets[STORAGE_KEY_BY_PATH[path]];
			if (!asset) {
				throw new RuntimeConfigurationError(`Nim runtime preflight omitted ${path}`, {
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: NIM_PREFLIGHT_RUNTIME_ID
				});
			}
			return asset.bytes;
		};
		for (const path of [
			'nim/nim-bundle.js.gz.bin',
			'nim/nim.wasm.gz.bin',
			'clang/clang.wasm.gz.bin',
			'clang/lld.wasm.gz.bin',
			'clang/memfs.wasm.gz.bin',
			'clang/sysroot.tar.gz.bin'
		] as const) {
			const bytes = delivery(path);
			if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
				throw new AssetIntegrityError(`Nim runtime storage ${path} is not gzip data`, {
					profileId: profile.profileId,
					runtimeId: NIM_PREFLIGHT_RUNTIME_ID
				});
			}
		}
		const nimJavaScriptBytes = await decompressGzipBounded(
			delivery('nim/nim-bundle.js.gz.bin'),
			profile.nimJavaScriptReceipt.uncompressedBytes!,
			maxAssetBytes,
			'nimJavaScript',
			profile.profileId,
			controller.signal,
			request.reportDecompressionProgress
		);
		const nimWasmBytes = await decompressGzipBounded(
			delivery('nim/nim.wasm.gz.bin'),
			profile.nimWasmReceipt.uncompressedBytes!,
			maxAssetBytes,
			'nimWasm',
			profile.profileId,
			controller.signal,
			request.reportDecompressionProgress
		);
		const clangWasmBytes = await decompressGzipBounded(
			delivery('clang/clang.wasm.gz.bin'),
			profile.clangWasmReceipt.uncompressedBytes!,
			maxAssetBytes,
			'clangWasm',
			profile.profileId,
			controller.signal,
			request.reportDecompressionProgress
		);
		const lldWasmBytes = await decompressGzipBounded(
			delivery('clang/lld.wasm.gz.bin'),
			profile.lldWasmReceipt.uncompressedBytes!,
			maxAssetBytes,
			'lldWasm',
			profile.profileId,
			controller.signal,
			request.reportDecompressionProgress
		);
		const memfsWasmBytes = await decompressGzipBounded(
			delivery('clang/memfs.wasm.gz.bin'),
			profile.memfsWasmReceipt.uncompressedBytes!,
			maxAssetBytes,
			'memfsWasm',
			profile.profileId,
			controller.signal,
			request.reportDecompressionProgress
		);
		const sysrootBytes = await decompressGzipBounded(
			delivery('clang/sysroot.tar.gz.bin'),
			profile.sysrootReceipt.uncompressedBytes!,
			maxAssetBytes,
			'sysroot',
			profile.profileId,
			controller.signal,
			request.reportDecompressionProgress
		);
		const payload: NimRuntimePreflightPayload = Object.freeze({
			protocol: NIM_PREFLIGHT_PROTOCOL,
			protocolVersion: NIM_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			artifactRevision: profile.artifactRevision,
			nimRevision: profile.nimRevision,
			llvmRevision: profile.llvmRevision,
			memfsRevision: profile.memfsRevision,
			emscriptenRevision: profile.emscriptenRevision,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			nimJavaScriptBytes,
			nimWasmBytes,
			nimbaseBytes: Uint8Array.from(delivery('nim/nimbase.h.bin')),
			clangJavaScriptBytes: Uint8Array.from(delivery('clang/clang.js.bin')),
			clangWasmBytes,
			lldWasmBytes,
			memfsWasmBytes,
			sysrootBytes
		});
		return await verifyNimRuntimePreflightPayload(payload, {
			maxAssetBytes,
			signal: controller.signal
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(
				`Nim runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: NIM_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (request.signal?.aborted) {
			throw new CancelledError('Nim runtime preflight cancelled', {
				cause: request.signal.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: NIM_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
