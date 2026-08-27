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
import type { RuntimeRegistryManifest } from './runtime-manifest.js';

export const AWK_PREFLIGHT_PROTOCOL = 'wasm-idle-awk-runtime-v2' as const;
export const AWK_PREFLIGHT_PROTOCOL_VERSION = 2 as const;
export const AWK_PREFLIGHT_RUNTIME_ID = 'AWK' as const;
export const AWK_MAX_MANIFEST_BYTES = 32 * 1024;
export const AWK_MAX_ASSET_BYTES = 16 * 1024 * 1024;
export const AWK_MAX_DELIVERY_BYTES = 8 * 1024 * 1024;
export const AWK_MAX_LOGICAL_BYTES = 16 * 1024 * 1024;
export const AWK_RUNTIME_MANIFEST_PATH = 'runtime-manifest.v2.json' as const;
export const AWK_RUNTIME_WORKER_PATH = 'runner-worker.v2.js' as const;
export const AWK_RUNTIME_GO_SHIM_PATH = 'wasm_exec.js' as const;
export const AWK_RUNTIME_WASM_STORAGE_PATH = 'goawk.wasm.gz.bin' as const;
export const AWK_RUNTIME_PREFLIGHT_CAPABILITIES = Object.freeze({
	stdin: 'streaming' as const,
	workspace: false,
	abort: true,
	artifacts: false,
	streamingOutput: true
});

const MANIFEST_FORMAT = 'wasm-awk-runtime-manifest-v2';
const MANIFEST_RUNTIME = 'GoAWK';
const FINGERPRINT_DOMAIN = 'wasm-idle:awk-runtime-manifest:v2';
const PROFILE_KEYS = [
	'goShimReceipt',
	'goVersion',
	'goawkVersion',
	'manifestFingerprint',
	'manifestReceipt',
	'profileId',
	'wasmReceipt',
	'workerReceipt'
] as const;
const PAYLOAD_KEYS = ['goShimBytes', 'protocol', 'wasmBytes'] as const;
const MANIFEST_KEYS = [
	'assets',
	'fingerprint',
	'format',
	'goVersion',
	'goawkVersion',
	'profileId',
	'runtime'
] as const;
const ASSET_KEYS = ['goShim', 'wasm', 'worker'] as const;
const IDENTITY_RECEIPT_KEYS = ['bytes', 'path', 'sha256'] as const;
const COMPRESSED_RECEIPT_KEYS = [
	'bytes',
	'path',
	'sha256',
	'uncompressedBytes',
	'uncompressedSha256'
] as const;
const PROFILE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(
	Object.getPrototypeOf(Uint8Array.prototype),
	Symbol.toStringTag
)?.get;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
	ArrayBuffer.prototype,
	'byteLength'
)?.get;

type UnknownRecord = Record<string, unknown>;

interface AwkManifestIdentityAsset {
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
}

interface AwkManifestWasmAsset extends AwkManifestIdentityAsset {
	readonly uncompressedBytes: number;
	readonly uncompressedSha256: string;
}

interface ParsedAwkRuntimeManifest {
	readonly format: typeof MANIFEST_FORMAT;
	readonly runtime: typeof MANIFEST_RUNTIME;
	readonly profileId: string;
	readonly goVersion: string;
	readonly goawkVersion: string;
	readonly fingerprint: string;
	readonly assets: Readonly<{
		worker: AwkManifestIdentityAsset;
		goShim: AwkManifestIdentityAsset;
		wasm: AwkManifestWasmAsset;
	}>;
}

export interface AwkRuntimePreflightProfile {
	readonly profileId: string;
	readonly goVersion: string;
	readonly goawkVersion: string;
	readonly manifestFingerprint: string;
	readonly manifestReceipt: AwkRuntimeIdentityReceipt;
	readonly workerReceipt: AwkRuntimeIdentityReceipt;
	readonly goShimReceipt: AwkRuntimeIdentityReceipt;
	readonly wasmReceipt: AwkRuntimeWasmReceipt;
}

export interface AwkRuntimeIdentityReceipt {
	readonly bytes: number;
	readonly sha256: string;
}

export interface AwkRuntimeWasmReceipt extends AwkRuntimeIdentityReceipt {
	readonly uncompressedBytes: number;
	readonly uncompressedSha256: string;
}

export interface AwkRuntimePreflightPayload {
	readonly protocol: typeof AWK_PREFLIGHT_PROTOCOL;
	readonly goShimBytes: Uint8Array;
	readonly wasmBytes: Uint8Array;
}

export interface AwkRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly profile: AwkRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (loadedBytes: number, totalBytes: number) => void;
}

function isPlainRecord(value: unknown): value is UnknownRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.some((key) => typeof key !== 'string')) return false;
	const actual = (ownKeys as string[]).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index]) &&
		actual.every((key) => {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			return !!descriptor && descriptor.enumerable && 'value' in descriptor;
		})
	);
}

function isByteArray(value: unknown): value is Uint8Array {
	if (!ArrayBuffer.isView(value) || !typedArrayTagGetter || !arrayBufferByteLengthGetter) {
		return false;
	}
	try {
		return (
			typedArrayTagGetter.call(value) === 'Uint8Array' &&
			arrayBufferByteLengthGetter.call(value.buffer) === value.buffer.byteLength
		);
	} catch {
		return false;
	}
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
				signal.reason ?? new DOMException('AWK runtime operation aborted', 'AbortError')
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

function requireSafeString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value || value.length > 128 || /[\0\r\n]/u.test(value)) {
		throw new RuntimeConfigurationError(`AWK runtime ${label} is invalid`, {
			phase: 'asset',
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	return value;
}

function snapshotReceipt(
	value: unknown,
	label: string,
	requireLogical: false,
	maxBytes: number
): Readonly<AwkRuntimeIdentityReceipt>;
function snapshotReceipt(
	value: unknown,
	label: string,
	requireLogical: true,
	maxBytes: number
): Readonly<AwkRuntimeWasmReceipt>;
function snapshotReceipt(
	value: unknown,
	label: string,
	requireLogical: boolean,
	maxBytes: number
): Readonly<AwkRuntimeIdentityReceipt | AwkRuntimeWasmReceipt> {
	const expectedKeys = requireLogical
		? ['bytes', 'sha256', 'uncompressedBytes', 'uncompressedSha256']
		: ['bytes', 'sha256'];
	if (!isPlainRecord(value) || !hasExactKeys(value, expectedKeys)) {
		throw new RuntimeConfigurationError(`AWK runtime ${label} receipt is invalid`, {
			phase: 'asset',
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!Number.isSafeInteger(value.bytes) ||
		(value.bytes as number) <= 0 ||
		(value.bytes as number) > maxBytes ||
		typeof value.sha256 !== 'string' ||
		!SHA256_PATTERN.test(value.sha256) ||
		(requireLogical &&
			(!Number.isSafeInteger(value.uncompressedBytes) ||
				(value.uncompressedBytes as number) <= 0 ||
				(value.uncompressedBytes as number) > AWK_MAX_LOGICAL_BYTES ||
				typeof value.uncompressedSha256 !== 'string' ||
				!SHA256_PATTERN.test(value.uncompressedSha256)))
	) {
		throw new RuntimeConfigurationError(`AWK runtime ${label} receipt is invalid`, {
			phase: 'asset',
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
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

export function snapshotAwkRuntimePreflightProfile(
	value: unknown
): Readonly<AwkRuntimePreflightProfile> {
	if (!isPlainRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) {
		throw new RuntimeConfigurationError('AWK runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	const profileId = requireSafeString(value.profileId, 'profile ID');
	const goVersion = requireSafeString(value.goVersion, 'Go version');
	const goawkVersion = requireSafeString(value.goawkVersion, 'GoAWK version');
	if (
		!PROFILE_ID_PATTERN.test(profileId) ||
		typeof value.manifestFingerprint !== 'string' ||
		!SHA256_PATTERN.test(value.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('AWK runtime preflight identity is invalid', {
			phase: 'asset',
			profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	return Object.freeze({
		profileId,
		goVersion,
		goawkVersion,
		manifestFingerprint: value.manifestFingerprint,
		manifestReceipt: snapshotReceipt(
			value.manifestReceipt,
			'manifest',
			false,
			AWK_MAX_MANIFEST_BYTES
		),
		workerReceipt: snapshotReceipt(value.workerReceipt, 'worker', false, AWK_MAX_ASSET_BYTES),
		goShimReceipt: snapshotReceipt(value.goShimReceipt, 'Go shim', false, AWK_MAX_ASSET_BYTES),
		wasmReceipt: snapshotReceipt(value.wasmReceipt, 'Wasm', true, AWK_MAX_ASSET_BYTES)
	});
}

function requireOwnedPayloadBytes(value: unknown, label: string): Uint8Array {
	if (
		!isByteArray(value) ||
		value.byteLength <= 0 ||
		value.byteOffset !== 0 ||
		value.byteLength !== value.buffer.byteLength
	) {
		throw new ProtocolError(`AWK runtime preflight ${label} must own a non-empty ArrayBuffer`, {
			phase: 'protocol',
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	return value;
}

export function requireAwkRuntimePreflightPayload(value: unknown): AwkRuntimePreflightPayload {
	if (!isPlainRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
		throw new ProtocolError('AWK runtime preflight payload has an invalid shape', {
			phase: 'protocol',
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	if (value.protocol !== AWK_PREFLIGHT_PROTOCOL) {
		throw new ProtocolError('AWK runtime preflight protocol is invalid', {
			phase: 'protocol',
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	const goShimBytes = requireOwnedPayloadBytes(value.goShimBytes, 'Go shim bytes');
	const wasmBytes = requireOwnedPayloadBytes(value.wasmBytes, 'Wasm bytes');
	if (goShimBytes.buffer === wasmBytes.buffer) {
		throw new ProtocolError('AWK runtime preflight assets must own distinct ArrayBuffers', {
			phase: 'protocol',
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	return value as unknown as AwkRuntimePreflightPayload;
}

export function cloneAwkRuntimePreflightPayload(value: unknown): AwkRuntimePreflightPayload {
	const payload = requireAwkRuntimePreflightPayload(value);
	return Object.freeze({
		protocol: AWK_PREFLIGHT_PROTOCOL,
		goShimBytes: Uint8Array.from(payload.goShimBytes),
		wasmBytes: Uint8Array.from(payload.wasmBytes)
	});
}

export function awkRuntimePreflightTransferables(value: unknown): readonly ArrayBuffer[] {
	const payload = requireAwkRuntimePreflightPayload(value);
	return Object.freeze([
		payload.goShimBytes.buffer as ArrayBuffer,
		payload.wasmBytes.buffer as ArrayBuffer
	]);
}

function rejectDuplicateJsonKeys(source: string) {
	let index = 0;
	let valueCount = 0;
	const fail = (message: string): never => {
		throw new AssetIntegrityError(`AWK runtime manifest JSON is invalid: ${message}`, {
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	};
	const skipWhitespace = () => {
		while (index < source.length && /[\u0009\u000a\u000d\u0020]/u.test(source[index]!)) {
			index += 1;
		}
	};
	const parseStringToken = () => {
		if (source[index] !== '"') fail('expected a string');
		const start = index;
		index += 1;
		while (index < source.length) {
			const character = source[index]!;
			if (character === '"') {
				index += 1;
				try {
					return JSON.parse(source.slice(start, index)) as string;
				} catch {
					return fail('invalid string escape');
				}
			}
			if (character === '\\') {
				index += 1;
				if (index >= source.length) fail('unterminated string escape');
				if (source[index] === 'u') {
					if (!/^[a-f0-9]{4}$/iu.test(source.slice(index + 1, index + 5))) {
						fail('invalid Unicode escape');
					}
					index += 5;
				} else {
					index += 1;
				}
				continue;
			}
			if (character.charCodeAt(0) < 0x20) fail('unescaped control character');
			index += 1;
		}
		return fail('unterminated string');
	};
	const parseValue = (depth: number): void => {
		valueCount += 1;
		if (valueCount > 10_000) fail('too many values');
		if (depth > 32) fail('nesting is too deep');
		skipWhitespace();
		const character = source[index];
		if (character === '{') {
			index += 1;
			const keys = new Set<string>();
			skipWhitespace();
			if (source[index] === '}') {
				index += 1;
				return;
			}
			while (index < source.length) {
				skipWhitespace();
				const key = parseStringToken();
				if (keys.has(key)) fail(`duplicate object key ${JSON.stringify(key)}`);
				keys.add(key);
				skipWhitespace();
				if (source[index] !== ':') fail('expected a colon');
				index += 1;
				parseValue(depth + 1);
				skipWhitespace();
				if (source[index] === '}') {
					index += 1;
					return;
				}
				if (source[index] !== ',') fail('expected a comma');
				index += 1;
			}
			fail('unterminated object');
		}
		if (character === '[') {
			index += 1;
			skipWhitespace();
			if (source[index] === ']') {
				index += 1;
				return;
			}
			while (index < source.length) {
				parseValue(depth + 1);
				skipWhitespace();
				if (source[index] === ']') {
					index += 1;
					return;
				}
				if (source[index] !== ',') fail('expected a comma');
				index += 1;
			}
			fail('unterminated array');
		}
		if (character === '"') {
			parseStringToken();
			return;
		}
		for (const literal of ['true', 'false', 'null']) {
			if (source.startsWith(literal, index)) {
				index += literal.length;
				return;
			}
		}
		const number = source
			.slice(index)
			.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?/iu)?.[0];
		if (!number) return fail('expected a JSON value');
		index += number.length;
	};
	parseValue(0);
	skipWhitespace();
	if (index !== source.length) fail('unexpected trailing data');
}

function normalizeManifestAsset(
	value: unknown,
	key: (typeof ASSET_KEYS)[number],
	path: string,
	compressed: boolean,
	profileId: string
): AwkManifestIdentityAsset | AwkManifestWasmAsset {
	const expectedKeys = compressed ? COMPRESSED_RECEIPT_KEYS : IDENTITY_RECEIPT_KEYS;
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, expectedKeys) ||
		value.path !== path ||
		!Number.isSafeInteger(value.bytes) ||
		(value.bytes as number) <= 0 ||
		(value.bytes as number) > AWK_MAX_ASSET_BYTES ||
		typeof value.sha256 !== 'string' ||
		!SHA256_PATTERN.test(value.sha256) ||
		(compressed &&
			(!Number.isSafeInteger(value.uncompressedBytes) ||
				(value.uncompressedBytes as number) <= 0 ||
				(value.uncompressedBytes as number) > AWK_MAX_LOGICAL_BYTES ||
				typeof value.uncompressedSha256 !== 'string' ||
				!SHA256_PATTERN.test(value.uncompressedSha256)))
	) {
		throw new AssetIntegrityError(`AWK runtime manifest ${key} receipt is invalid`, {
			profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	return Object.freeze({
		path,
		bytes: value.bytes as number,
		sha256: value.sha256,
		...(compressed
			? {
					uncompressedBytes: value.uncompressedBytes as number,
					uncompressedSha256: value.uncompressedSha256 as string
				}
			: {})
	});
}

export function canonicalizeAwkRuntimeManifestFingerprint(
	manifest: Pick<
		ParsedAwkRuntimeManifest,
		'format' | 'runtime' | 'profileId' | 'goVersion' | 'goawkVersion' | 'assets'
	>
): string {
	return (
		`${FINGERPRINT_DOMAIN}\n` +
		`format\0${manifest.format}\n` +
		`runtime\0${manifest.runtime}\n` +
		`profileId\0${manifest.profileId}\n` +
		`goVersion\0${manifest.goVersion}\n` +
		`goawkVersion\0${manifest.goawkVersion}\n` +
		`asset\0worker\0${manifest.assets.worker.path}\0${manifest.assets.worker.bytes}\0${manifest.assets.worker.sha256}\n` +
		`asset\0goShim\0${manifest.assets.goShim.path}\0${manifest.assets.goShim.bytes}\0${manifest.assets.goShim.sha256}\n` +
		`asset\0wasm\0${manifest.assets.wasm.path}\0${manifest.assets.wasm.bytes}\0${manifest.assets.wasm.sha256}\0${manifest.assets.wasm.uncompressedBytes}\0${manifest.assets.wasm.uncompressedSha256}\n`
	);
}

async function parseAndVerifyManifest(
	manifestBytes: Uint8Array,
	profile: Readonly<AwkRuntimePreflightProfile>,
	signal?: AbortSignal
): Promise<ParsedAwkRuntimeManifest> {
	let source: string;
	try {
		source = fatalDecoder.decode(manifestBytes);
	} catch (error) {
		throw new AssetIntegrityError('AWK runtime manifest is not valid UTF-8', {
			cause: error,
			profileId: profile.profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	rejectDuplicateJsonKeys(source);
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch (error) {
		throw new AssetIntegrityError('AWK runtime manifest is not valid JSON', {
			cause: error,
			profileId: profile.profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, MANIFEST_KEYS) ||
		value.format !== MANIFEST_FORMAT ||
		value.runtime !== MANIFEST_RUNTIME ||
		value.profileId !== profile.profileId ||
		value.goVersion !== profile.goVersion ||
		value.goawkVersion !== profile.goawkVersion ||
		value.fingerprint !== profile.manifestFingerprint ||
		!isPlainRecord(value.assets) ||
		!hasExactKeys(value.assets, ASSET_KEYS)
	) {
		throw new AssetIntegrityError('AWK runtime manifest identity or shape is invalid', {
			profileId: profile.profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	const manifest: ParsedAwkRuntimeManifest = Object.freeze({
		format: MANIFEST_FORMAT,
		runtime: MANIFEST_RUNTIME,
		profileId: profile.profileId,
		goVersion: profile.goVersion,
		goawkVersion: profile.goawkVersion,
		fingerprint: profile.manifestFingerprint,
		assets: Object.freeze({
			worker: normalizeManifestAsset(
				value.assets.worker,
				'worker',
				AWK_RUNTIME_WORKER_PATH,
				false,
				profile.profileId
			) as AwkManifestIdentityAsset,
			goShim: normalizeManifestAsset(
				value.assets.goShim,
				'goShim',
				AWK_RUNTIME_GO_SHIM_PATH,
				false,
				profile.profileId
			) as AwkManifestIdentityAsset,
			wasm: normalizeManifestAsset(
				value.assets.wasm,
				'wasm',
				AWK_RUNTIME_WASM_STORAGE_PATH,
				true,
				profile.profileId
			) as AwkManifestWasmAsset
		})
	});
	const receiptMatches = (
		asset: AwkManifestIdentityAsset | AwkManifestWasmAsset,
		receipt: AwkRuntimeIdentityReceipt | AwkRuntimeWasmReceipt,
		logical: boolean
	) =>
		asset.bytes === receipt.bytes &&
		asset.sha256 === receipt.sha256 &&
		(!logical ||
			('uncompressedBytes' in receipt &&
				(asset as AwkManifestWasmAsset).uncompressedBytes === receipt.uncompressedBytes &&
				(asset as AwkManifestWasmAsset).uncompressedSha256 === receipt.uncompressedSha256));
	if (
		!receiptMatches(manifest.assets.worker, profile.workerReceipt, false) ||
		!receiptMatches(manifest.assets.goShim, profile.goShimReceipt, false) ||
		!receiptMatches(manifest.assets.wasm, profile.wasmReceipt, true)
	) {
		throw new AssetIntegrityError(
			'AWK runtime manifest receipts do not match the selected profile',
			{ profileId: profile.profileId, runtimeId: AWK_PREFLIGHT_RUNTIME_ID }
		);
	}
	await waitForAbortable(
		verifyRuntimeAssetIntegrity({
			asset: 'runtime-manifest.v2 fingerprint',
			bytes: textEncoder.encode(canonicalizeAwkRuntimeManifestFingerprint(manifest)),
			expected: profile.manifestFingerprint,
			profileId: profile.profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		}),
		signal
	);
	return manifest;
}

async function decompressGzipBounded(
	compressedBytes: Uint8Array,
	expectedBytes: number,
	maxAssetBytes: number,
	profileId: string,
	signal: AbortSignal,
	reportProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<Uint8Array> {
	if (typeof DecompressionStream !== 'function') {
		throw new UnsupportedBrowserFeatureError('DecompressionStream(gzip)', {
			phase: 'asset',
			profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!Number.isSafeInteger(expectedBytes) ||
		expectedBytes <= 0 ||
		expectedBytes > Math.min(maxAssetBytes, AWK_MAX_LOGICAL_BYTES)
	) {
		throw new AssetTooLargeError(
			`AWK runtime logical Wasm exceeds the ${Math.min(maxAssetBytes, AWK_MAX_LOGICAL_BYTES)} byte limit`,
			{
				actual: expectedBytes,
				limit: Math.min(maxAssetBytes, AWK_MAX_LOGICAL_BYTES),
				phase: 'asset',
				profileId,
				runtimeId: AWK_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const body = new Response(Uint8Array.from(compressedBytes)).body;
	if (!body) {
		throw new UnsupportedBrowserFeatureError('ReadableStream response bodies', {
			phase: 'asset',
			profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
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
					'AWK runtime gzip output exceeds its logical receipt',
					{ profileId, runtimeId: AWK_PREFLIGHT_RUNTIME_ID }
				);
			}
			output.set(value, offset);
			offset += value.byteLength;
			reportProgress?.(offset, output.byteLength);
		}
	} catch (error) {
		try {
			void reader.cancel(error).catch(() => undefined);
		} catch {
			// Preserve the decompression failure.
		}
		if (signal.aborted || isWasmIdleError(error)) throw error;
		throw new AssetIntegrityError('AWK runtime gzip decompression failed', {
			cause: error,
			profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
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
		throw new AssetIntegrityError('AWK runtime gzip output is truncated', {
			profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	return output;
}

export async function verifyAwkRuntimePreflightPayload(
	value: unknown,
	profileValue: unknown,
	options: { readonly maxAssetBytes?: number; readonly signal?: AbortSignal } = {}
): Promise<AwkRuntimePreflightPayload> {
	const payload = requireAwkRuntimePreflightPayload(value);
	const profile = snapshotAwkRuntimePreflightProfile(profileValue);
	const signal = options.signal;
	const maxAssetBytes = Math.min(
		options.maxAssetBytes ?? AWK_MAX_ASSET_BYTES,
		AWK_MAX_ASSET_BYTES
	);
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new RuntimeConfigurationError('AWK runtime asset byte limit is invalid', {
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		payload.goShimBytes.byteLength > maxAssetBytes ||
		payload.wasmBytes.byteLength > Math.min(maxAssetBytes, AWK_MAX_LOGICAL_BYTES)
	) {
		throw new AssetTooLargeError(
			`AWK runtime payload exceeds the ${maxAssetBytes} byte limit`,
			{
				actual: Math.max(payload.goShimBytes.byteLength, payload.wasmBytes.byteLength),
				limit: maxAssetBytes,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: AWK_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	await Promise.all([
		waitForAbortable(
			verifyRuntimeAssetIntegrity({
				asset: AWK_RUNTIME_GO_SHIM_PATH,
				bytes: payload.goShimBytes,
				expected: profile.goShimReceipt,
				profileId: profile.profileId,
				runtimeId: AWK_PREFLIGHT_RUNTIME_ID
			}),
			signal
		),
		waitForAbortable(
			verifyRuntimeAssetIntegrity({
				asset: 'goawk.wasm',
				bytes: payload.wasmBytes,
				expected: profile.wasmReceipt,
				stage: 'uncompressed',
				profileId: profile.profileId,
				runtimeId: AWK_PREFLIGHT_RUNTIME_ID
			}),
			signal
		)
	]);
	try {
		fatalDecoder.decode(payload.goShimBytes);
	} catch (error) {
		throw new AssetIntegrityError('AWK runtime Go shim is not valid UTF-8', {
			cause: error,
			profileId: profile.profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		payload.wasmBytes.byteLength < 8 ||
		payload.wasmBytes[0] !== 0 ||
		payload.wasmBytes[1] !== 0x61 ||
		payload.wasmBytes[2] !== 0x73 ||
		payload.wasmBytes[3] !== 0x6d
	) {
		throw new AssetIntegrityError('AWK runtime Wasm header is invalid', {
			profileId: profile.profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	return payload;
}

function normalizeBaseAndManifestUrls(
	baseValue: string,
	manifestValue: string,
	profile: Readonly<AwkRuntimePreflightProfile>
): { baseUrl: URL; manifestUrl: URL } {
	let baseUrl: URL;
	let manifestUrl: URL;
	try {
		baseUrl = new URL(baseValue);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
		manifestUrl = new URL(manifestValue, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError('AWK runtime asset URLs are invalid', {
			cause: error,
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
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
			'AWK runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: AWK_PREFLIGHT_RUNTIME_ID }
		);
	}
	const expectedManifest = new URL(AWK_RUNTIME_MANIFEST_PATH, baseUrl);
	if (
		manifestUrl.protocol !== expectedManifest.protocol ||
		manifestUrl.username ||
		manifestUrl.password ||
		manifestUrl.hash ||
		manifestUrl.origin !== expectedManifest.origin ||
		manifestUrl.pathname !== expectedManifest.pathname ||
		(manifestUrl.search !== '' && manifestUrl.search !== `?v=${profile.manifestFingerprint}`)
	) {
		throw new RuntimeConfigurationError(
			'AWK runtime manifest URL must be the exact pinned v2 manifest beneath the runtime base',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: AWK_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (!manifestUrl.search) manifestUrl.search = `?v=${profile.manifestFingerprint}`;
	return { baseUrl, manifestUrl };
}

export async function preflightAwkRuntimeAssets(
	request: AwkRuntimePreflightRequest
): Promise<AwkRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('AWK runtime preflight request is required', {
			phase: 'asset',
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID
		});
	}
	const callerSignal = request.signal;
	const profile = snapshotAwkRuntimePreflightProfile(request.profile);
	const { baseUrl, manifestUrl } = normalizeBaseAndManifestUrls(
		request.baseUrl,
		request.manifestUrl,
		profile
	);
	const limits = resolveExecutionLimits(request.limits);
	const maxAssetBytes = Math.min(limits.maxAssetBytes, AWK_MAX_ASSET_BYTES);
	for (const [label, bytes, limit] of [
		[
			'manifest',
			profile.manifestReceipt.bytes,
			Math.min(maxAssetBytes, AWK_MAX_MANIFEST_BYTES)
		],
		['worker', profile.workerReceipt.bytes, maxAssetBytes],
		['Go shim', profile.goShimReceipt.bytes, maxAssetBytes],
		['Wasm delivery', profile.wasmReceipt.bytes, maxAssetBytes],
		[
			'Wasm logical',
			profile.wasmReceipt.uncompressedBytes,
			Math.min(maxAssetBytes, AWK_MAX_LOGICAL_BYTES)
		]
	] as const) {
		if ((bytes ?? 0) > limit) {
			throw new AssetTooLargeError(`AWK runtime ${label} exceeds the ${limit} byte limit`, {
				actual: bytes,
				limit,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: AWK_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	const goShimUrl = new URL(AWK_RUNTIME_GO_SHIM_PATH, baseUrl);
	goShimUrl.search = `?v=${profile.goShimReceipt.sha256}`;
	const wasmUrl = new URL(AWK_RUNTIME_WASM_STORAGE_PATH, baseUrl);
	wasmUrl.search = `?v=${profile.wasmReceipt.sha256}`;
	const fetchImpl = request.fetch ?? globalThis.fetch;
	const strictFetch =
		typeof fetchImpl === 'function'
			? async (input: RequestInfo | URL, init?: RequestInit) => {
					const requestedUrl = new URL(
						typeof input === 'string' || input instanceof URL
							? String(input)
							: input.url
					);
					const response = await fetchImpl(input, init);
					const cancelResponse = (reason: unknown) => {
						try {
							void Promise.resolve(response?.body?.cancel(reason)).catch(
								() => undefined
							);
						} catch {
							// Preserve the transport validation failure without awaiting cleanup.
						}
					};
					try {
						if (
							!response ||
							typeof response.url !== 'string' ||
							!response.url ||
							response.redirected ||
							response.type === 'opaque' ||
							response.type === 'opaqueredirect' ||
							response.type === 'error' ||
							response.status === 0
						) {
							throw new ProtocolError(
								'AWK runtime asset response must expose a non-opaque exact final URL',
								{
									phase: 'asset',
									profileId: profile.profileId,
									runtimeId: AWK_PREFLIGHT_RUNTIME_ID
								}
							);
						}
						let responseUrl: URL;
						try {
							responseUrl = new URL(response.url);
						} catch (error) {
							throw new ProtocolError('AWK runtime asset response URL is invalid', {
								cause: error,
								phase: 'asset',
								profileId: profile.profileId,
								runtimeId: AWK_PREFLIGHT_RUNTIME_ID
							});
						}
						if (responseUrl.href !== requestedUrl.href) {
							throw new ProtocolError(
								'AWK runtime asset response URL does not match its exact request URL',
								{
									phase: 'asset',
									profileId: profile.profileId,
									runtimeId: AWK_PREFLIGHT_RUNTIME_ID
								}
							);
						}
						const contentEncoding = response.headers.get('content-encoding');
						if (
							requestedUrl.pathname.endsWith(`/${AWK_RUNTIME_WASM_STORAGE_PATH}`) &&
							contentEncoding &&
							contentEncoding
								.toLowerCase()
								.split(',')
								.map((encoding) => encoding.trim())
								.some((encoding) => encoding !== 'identity')
						) {
							throw new AssetIntegrityError(
								'AWK runtime stored-form Wasm must be delivered without transparent content decoding',
								{
									profileId: profile.profileId,
									runtimeId: AWK_PREFLIGHT_RUNTIME_ID
								}
							);
						}
						return response;
					} catch (error) {
						cancelResponse(error);
						throw error;
					}
				}
			: undefined;
	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/awk-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: AWK_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'AWK',
					implementationId: MANIFEST_RUNTIME,
					implementationVersion: profile.goawkVersion,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: profile.manifestReceipt.sha256,
						protocolVersion: AWK_PREFLIGHT_PROTOCOL_VERSION,
						trustProfileId: 'wasm-idle-static-worker-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: AWK_RUNTIME_PREFLIGHT_CAPABILITIES,
				workerLifetime: { mode: 'per-run' },
				requiredBrowserFeatures: ['wasm', 'decompression-stream'],
				assetRoot: '.',
				assets: [
					{
						key: 'manifest',
						path: AWK_RUNTIME_MANIFEST_PATH,
						compressedSha256: profile.manifestReceipt.sha256,
						uncompressedSha256: profile.manifestReceipt.sha256,
						compressedBytes: profile.manifestReceipt.bytes!,
						uncompressedBytes: profile.manifestReceipt.bytes!,
						mediaType: 'application/json',
						encoding: 'identity'
					},
					{
						key: 'goShim',
						path: AWK_RUNTIME_GO_SHIM_PATH,
						compressedSha256: profile.goShimReceipt.sha256,
						uncompressedSha256: profile.goShimReceipt.sha256,
						compressedBytes: profile.goShimReceipt.bytes!,
						uncompressedBytes: profile.goShimReceipt.bytes!,
						mediaType: 'text/javascript',
						encoding: 'identity'
					},
					{
						key: 'wasm',
						path: AWK_RUNTIME_WASM_STORAGE_PATH,
						compressedSha256: profile.wasmReceipt.sha256,
						uncompressedSha256: profile.wasmReceipt.uncompressedSha256!,
						compressedBytes: profile.wasmReceipt.bytes!,
						uncompressedBytes: profile.wasmReceipt.uncompressedBytes!,
						mediaType: 'application/wasm',
						encoding: 'gzip'
					}
				],
				contracts: {
					routeId: 'awk',
					runtimeAssetKey: 'awk',
					documentationId: 'AWK',
					syncTarget: 'sync:wasm-awk',
					browserTestId: 'browser:awk'
				}
			}
		]
	};
	const controller = new AbortController();
	let termination: 'caller' | 'timeout' | undefined;
	const abortFromCaller = () => {
		if (controller.signal.aborted) return;
		termination = 'caller';
		controller.abort(callerSignal?.reason);
	};
	callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
	if (callerSignal?.aborted) abortFromCaller();
	const timeout = setTimeout(() => {
		if (controller.signal.aborted) return;
		termination = 'timeout';
		controller.abort(new DOMException('AWK runtime preflight timed out', 'TimeoutError'));
	}, limits.assetTimeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: AWK_PREFLIGHT_RUNTIME_ID,
			rootUrl: baseUrl,
			assetUrls: { manifest: manifestUrl, goShim: goShimUrl, wasm: wasmUrl },
			fetch: strictFetch,
			signal: controller.signal,
			limits: { ...limits, maxAssetBytes },
			cache: 'no-store',
			redirect: 'error',
			maxConcurrentDownloads: 3,
			maxTotalDeliveryBytes: AWK_MAX_DELIVERY_BYTES,
			reportProgress: request.reportProgress
		});
		const manifestAsset = preflight.assets.manifest;
		const goShimAsset = preflight.assets.goShim;
		const wasmAsset = preflight.assets.wasm;
		if (!manifestAsset || !goShimAsset || !wasmAsset) {
			throw new RuntimeConfigurationError(
				'AWK runtime preflight returned an incomplete asset graph',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: AWK_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		await parseAndVerifyManifest(manifestAsset.bytes, profile, controller.signal);
		if (wasmAsset.bytes[0] !== 0x1f || wasmAsset.bytes[1] !== 0x8b) {
			throw new AssetIntegrityError('AWK runtime Wasm storage is not gzip data', {
				profileId: profile.profileId,
				runtimeId: AWK_PREFLIGHT_RUNTIME_ID
			});
		}
		const wasmBytes = await decompressGzipBounded(
			wasmAsset.bytes,
			profile.wasmReceipt.uncompressedBytes!,
			maxAssetBytes,
			profile.profileId,
			controller.signal,
			request.reportDecompressionProgress
		);
		const payload: AwkRuntimePreflightPayload = Object.freeze({
			protocol: AWK_PREFLIGHT_PROTOCOL,
			goShimBytes: Uint8Array.from(goShimAsset.bytes),
			wasmBytes
		});
		return await verifyAwkRuntimePreflightPayload(payload, profile, {
			maxAssetBytes,
			signal: controller.signal
		});
	} catch (error) {
		if (termination === 'caller') {
			throw new CancelledError('AWK runtime preflight cancelled', {
				cause: callerSignal?.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: AWK_PREFLIGHT_RUNTIME_ID
			});
		}
		if (termination === 'timeout') {
			throw new TimeoutError(
				`AWK runtime preflight timed out after ${limits.assetTimeoutMs} ms`,
				{
					cause: error,
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: AWK_PREFLIGHT_RUNTIME_ID,
					timeoutMs: limits.assetTimeoutMs
				}
			);
		}
		if (callerSignal?.aborted) {
			throw new CancelledError('AWK runtime preflight cancelled', {
				cause: callerSignal.reason,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: AWK_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		callerSignal?.removeEventListener('abort', abortFromCaller);
	}
}
