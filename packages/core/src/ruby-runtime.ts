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
import {
	RUBY_RUNTIME_GENERATED_ASSET_PATH,
	RUBY_RUNTIME_GENERATED_ASSET_RECEIPTS,
	RUBY_RUNTIME_GENERATED_ASSET_VERSION,
	RUBY_RUNTIME_GENERATED_BUNDLE,
	RUBY_RUNTIME_GENERATED_PROFILE
} from './ruby-runtime.generated.js';

export const RUBY_PREFLIGHT_PROTOCOL = 'wasm-idle-ruby-preflight' as const;
export const RUBY_PREFLIGHT_PROTOCOL_VERSION = 1 as const;
export const RUBY_PREFLIGHT_RUNTIME_ID = 'RUBY' as const;
export const RUBY_MAX_MANIFEST_BYTES = 64 * 1024;
export const RUBY_MAX_MODULE_BYTES = 1024 * 1024;
export const RUBY_MAX_ASSET_BYTES = 40 * 1024 * 1024;
export const RUBY_MAX_DELIVERY_BYTES = 16 * 1024 * 1024;
export const RUBY_MAX_LOGICAL_BYTES = 40 * 1024 * 1024;
export const RUBY_RUNTIME_MODULE_PATH = 'runtime.mjs' as const;
export const RUBY_RUNTIME_MODULE_STORAGE_PATH = 'runtime.mjs.bin' as const;
export const RUBY_RUNTIME_MANIFEST_PATH = 'runtime-manifest.v2.json' as const;
export const RUBY_RUNTIME_VERIFIED_WASM_URL =
	'wasm-idle-verified:ruby/assets/ruby-stdlib.wasm' as const;

export const RUBY_RUNTIME_ASSET_PATH = RUBY_RUNTIME_GENERATED_ASSET_PATH;
export const RUBY_RUNTIME_WASM_STORAGE_PATH = `${RUBY_RUNTIME_ASSET_PATH}.gz.bin` as const;

export interface RubyRuntimePreflightProfile {
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly rubyVersion: string;
	readonly rubyRevision: string;
	readonly rubyWasmVersion: string;
	readonly rubyWasmRevision: string;
	readonly wasiSdkVersion: string;
	readonly manifestFingerprint: string;
	readonly manifestReceipt: RuntimeAssetIntegrityEntry;
	readonly moduleJavaScriptReceipt: RuntimeAssetIntegrityEntry;
	readonly wasmReceipt: RuntimeAssetIntegrityEntry;
}

export interface RubyRuntimePreflightRequest {
	readonly baseUrl: string;
	readonly manifestUrl: string;
	readonly moduleUrl: string;
	readonly wasmUrl: string;
	readonly profile: RubyRuntimePreflightProfile;
	readonly limits?: Partial<ExecutionLimits>;
	readonly timeoutMs?: number;
	readonly maxAssetBytes?: number;
	readonly signal?: AbortSignal;
	readonly fetch?: typeof globalThis.fetch;
	readonly progress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
	readonly reportDecompressionProgress?: (loadedBytes: number, totalBytes: number) => void;
}

export interface RubyRuntimePreflightPayload {
	readonly protocol: typeof RUBY_PREFLIGHT_PROTOCOL;
	readonly protocolVersion: typeof RUBY_PREFLIGHT_PROTOCOL_VERSION;
	readonly profileId: string;
	readonly artifactRevision: string;
	readonly rubyVersion: string;
	readonly rubyRevision: string;
	readonly rubyWasmVersion: string;
	readonly rubyWasmRevision: string;
	readonly wasiSdkVersion: string;
	readonly manifestFingerprint: string;
	readonly manifestBytes: Uint8Array;
	readonly moduleJavaScriptBytes: Uint8Array;
	readonly wasmBytes: Uint8Array;
}

export const RUBY_RUNTIME_PROFILE = RUBY_RUNTIME_GENERATED_PROFILE;
export const RUBY_RUNTIME_BUNDLE = RUBY_RUNTIME_GENERATED_BUNDLE;

export const RUBY_RUNTIME_ASSET_NAMES = ['runtime.mjs', RUBY_RUNTIME_ASSET_PATH] as const;

export type RubyRuntimeAssetName = (typeof RUBY_RUNTIME_ASSET_NAMES)[number];
export interface RubyRuntimeAssetReceipt {
	bytes: number;
	sha256: string;
}
export type RubyRuntimeAssetReceipts = Readonly<
	Record<RubyRuntimeAssetName, Readonly<RubyRuntimeAssetReceipt>>
>;

export const RUBY_RUNTIME_ASSET_VERSION = RUBY_RUNTIME_GENERATED_ASSET_VERSION;

export const RUBY_RUNTIME_ASSET_RECEIPTS =
	RUBY_RUNTIME_GENERATED_ASSET_RECEIPTS satisfies RubyRuntimeAssetReceipts;

const snapshotRubyRuntimeAssetReceipt = (
	asset: RubyRuntimeAssetName,
	value: unknown
): Readonly<RubyRuntimeAssetReceipt> => {
	if (!value || typeof value !== 'object') {
		throw new TypeError(`Ruby runtime receipt is invalid for ${asset}`);
	}
	const receipt = value as Partial<RubyRuntimeAssetReceipt>;
	const bytes = receipt.bytes;
	const sha256 = receipt.sha256;
	if (
		!Number.isSafeInteger(bytes) ||
		(bytes as number) <= 0 ||
		typeof sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(sha256)
	) {
		throw new TypeError(`Ruby runtime receipt is invalid for ${asset}`);
	}
	return Object.freeze({ bytes: bytes as number, sha256 });
};

export function snapshotRubyRuntimeAssetReceipts(
	value: unknown = RUBY_RUNTIME_ASSET_RECEIPTS
): RubyRuntimeAssetReceipts {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Ruby runtime integrity must describe exactly two assets');
	}
	const receivedNames = Object.keys(value).sort();
	const expectedNames = [...RUBY_RUNTIME_ASSET_NAMES].sort();
	if (
		receivedNames.length !== expectedNames.length ||
		receivedNames.some((name, index) => name !== expectedNames[index])
	) {
		throw new TypeError('Ruby runtime integrity must describe exactly two assets');
	}
	const receipts = value as Record<RubyRuntimeAssetName, unknown>;
	const moduleReceipt = receipts['runtime.mjs'];
	const wasmReceipt = receipts[RUBY_RUNTIME_ASSET_PATH];
	return Object.freeze({
		'runtime.mjs': snapshotRubyRuntimeAssetReceipt('runtime.mjs', moduleReceipt),
		[RUBY_RUNTIME_ASSET_PATH]: snapshotRubyRuntimeAssetReceipt(
			RUBY_RUNTIME_ASSET_PATH,
			wasmReceipt
		)
	});
}

export function deriveRubyRuntimeWasmUrl(moduleUrl: string, currentUrl = '') {
	const configuredModuleUrl = moduleUrl.trim();
	if (!configuredModuleUrl) {
		throw new TypeError('Ruby runtime module URL is required');
	}
	try {
		const module = currentUrl
			? new URL(configuredModuleUrl, currentUrl)
			: new URL(configuredModuleUrl);
		const wasm = new URL(RUBY_RUNTIME_ASSET_PATH, module);
		wasm.search = module.search;
		return wasm.href;
	} catch (error) {
		if (
			currentUrl ||
			(!configuredModuleUrl.startsWith('/') && !configuredModuleUrl.startsWith('./'))
		) {
			throw new TypeError('Ruby runtime module URL must be absolute or root-relative', {
				cause: error
			});
		}
		const hashIndex = configuredModuleUrl.indexOf('#');
		if (hashIndex !== -1) {
			throw new TypeError('Ruby runtime module URL must not include a fragment');
		}
		const queryIndex = configuredModuleUrl.indexOf('?');
		const modulePath =
			queryIndex === -1 ? configuredModuleUrl : configuredModuleUrl.slice(0, queryIndex);
		const query = queryIndex === -1 ? '' : configuredModuleUrl.slice(queryIndex);
		const separator = modulePath.lastIndexOf('/');
		return `${modulePath.slice(0, separator + 1)}${RUBY_RUNTIME_ASSET_PATH}${query}`;
	}
}

const MANIFEST_FORMAT = 'wasm-ruby-runtime-manifest-v2';
const FINGERPRINT_DOMAIN = 'wasm-idle:ruby-runtime-manifest:v2';
const EXPECTED_RUNTIME = 'ruby-wasm-wasi';
const EXPECTED_PROVENANCE_LEVEL = 'npm-attested-source-and-receipted-derived-output';
const EXPECTED_LICENSE_EXPRESSION =
	'MIT AND (Ruby OR BSD-2-Clause) AND (MIT OR Apache-2.0) AND LicenseRef-Ruby-Wasm-Third-Party-Notices';
const EXPECTED_ARTIFACT_REPOSITORY = 'https://github.com/ruby/ruby.wasm';
const EXPECTED_RUBY_REPOSITORY = 'https://github.com/ruby/ruby';
const EXPECTED_RUBY_WASM_REPOSITORY = 'https://github.com/ruby/ruby.wasm';
const EXPECTED_WASI_SDK_REPOSITORY = 'https://github.com/WebAssembly/wasi-sdk';
const EXPECTED_PACKAGES = Object.freeze([
	Object.freeze({
		name: '@bjorn3/browser_wasi_shim',
		version: '0.4.2',
		requestedRange: '^0.4.2',
		tarballUrl:
			'https://registry.npmjs.org/@bjorn3/browser_wasi_shim/-/browser_wasi_shim-0.4.2.tgz',
		tarballBytes: 31373,
		tarballSha256: '9c0281520d0e99f027ec7c1c79b4036c0f8168ed9bf98aba19db4737a1333782',
		integrity:
			'sha512-/iHkCVUG3VbcbmEHn5iIUpIrh7a7WPiwZ3sHy4HZKZzBdSadwdddYDZAII2zBvQYV0Lfi8naZngPCN7WPHI/hA==',
		attestationUrl: null,
		repository: 'https://github.com/bjorn3/browser_wasi_shim',
		revision: '4a55f2a519d0ddfa7e4609c42e0c9769c37c9ae8',
		license: 'MIT OR Apache-2.0',
		files: 26,
		bytes: 114555,
		treeSha256: '4454a5e0d68941440b947fdb705f8aa8fca789c5a3d040902bfe2cda8ffde248'
	}),
	Object.freeze({
		name: '@ruby/3.4-wasm-wasi',
		version: '2.9.3-2.9.4',
		requestedRange: '2.9.3-2.9.4',
		tarballUrl:
			'https://registry.npmjs.org/@ruby/3.4-wasm-wasi/-/3.4-wasm-wasi-2.9.3-2.9.4.tgz',
		tarballBytes: 29998123,
		tarballSha256: '92c1821dd2f03e20d23a3ca86e1d844571722eab88bc168dd659fff1bc987ad4',
		integrity:
			'sha512-Ze2grGTnyT6meSI1j5NHKIpeadecOsMuKAjPFeyU5K85MSeHJWZdNXS7QLF0a0E1kIwQcYHafU10Gz5fPqECsw==',
		attestationUrl:
			'https://registry.npmjs.org/-/npm/v1/attestations/@ruby%2f3.4-wasm-wasi@2.9.3-2.9.4',
		repository: 'https://github.com/ruby/ruby.wasm',
		revision: '3318796e2c9f0f75c98c669cabdc422cf8218ec2',
		license: 'MIT',
		files: 20,
		bytes: 97451582,
		treeSha256: 'b3e9c5a8939d5fe7b7af968ada4f04020846915536f331a4c87f953778ce3778'
	}),
	Object.freeze({
		name: '@ruby/wasm-wasi',
		version: '2.9.3-2.9.4',
		requestedRange: '2.9.3-2.9.4',
		tarballUrl: 'https://registry.npmjs.org/@ruby/wasm-wasi/-/wasm-wasi-2.9.3-2.9.4.tgz',
		tarballBytes: 84917,
		tarballSha256: '47487299c5be0e32cd6d761b6a11afd63d01b60da8362849fda5e0e007242997',
		integrity:
			'sha512-WxW9wON/TIf+8Ktng8qDJeV/6iH8kw+YwxOsOyXdAdLJgfYDPAXOqpIVd/96y2C9V8VJ2yqZm/IRv6nLeV6EKg==',
		attestationUrl:
			'https://registry.npmjs.org/-/npm/v1/attestations/@ruby%2fwasm-wasi@2.9.3-2.9.4',
		repository: 'https://github.com/ruby/ruby.wasm',
		revision: '3318796e2c9f0f75c98c669cabdc422cf8218ec2',
		license: 'MIT',
		files: 50,
		bytes: 472758,
		treeSha256: '9971e5cbb59e695715351d31c4c7079de5a678de63de87b814e4ee76b0adddf3'
	})
]);
const EXPECTED_PRODUCER = Object.freeze({
	entry: Object.freeze({
		path: 'scripts/runtime-modules/ruby.ts',
		bytes: 257,
		sha256: '501625656ed69b9876ddd6320e08f45bf8e0c236d791ba04458c64f3864d9812'
	}),
	script: Object.freeze({
		path: 'scripts/sync-wasm-ruby.mjs',
		bytes: 46815,
		sha256: '2805cc5794231142c9ef6f0843b31c64e8169064a106a807f08742e521de6b54'
	}),
	tool: Object.freeze({
		name: 'vite',
		version: '8.0.8',
		requestedRange: '^8.0.8',
		tarballUrl: 'https://registry.npmjs.org/vite/-/vite-8.0.8.tgz',
		integrity:
			'sha512-dbU7/iLVa8KZALJyLOBOQ88nOXtNG8vxKuOT4I2mD+Ya70KPceF4IAmDsmU0h1Qsn5bPrvsY9HJstCRh3hG6Uw==',
		license: 'MIT',
		files: 42,
		bytes: 2185148,
		treeSha256: '63becb5aef9c86b925810f4298df7c05905aa0ff74e6b8ee3b98991ca6a25a25'
	}),
	packageTreeReceiptFormat: 'sha256-json-sorted-path-bytes-sha256-v2-excludes-package-manager-bin'
});
const EXPECTED_TRANSFORMATIONS = Object.freeze([
	Object.freeze({
		id: 'vite-8-es2022-single-module-bundle',
		input: 'scripts/runtime-modules/ruby.ts',
		output: RUBY_RUNTIME_MODULE_PATH
	}),
	Object.freeze({
		id: 'node-zlib-gzip-level-9',
		input: RUBY_RUNTIME_ASSET_PATH,
		output: RUBY_RUNTIME_WASM_STORAGE_PATH
	})
]);
const EXPECTED_LEGAL_FILES = Object.freeze([
	Object.freeze({
		targetPath: 'LICENSE',
		mediaType: 'text/plain',
		spdx: 'MIT',
		size: 1067,
		sha256: '90357d3794c968704914d42a52354a83f2d8b10cb43df3b63ef1ca0e5bbc0bf2'
	}),
	Object.freeze({
		targetPath: 'NOTICE',
		mediaType: 'text/markdown',
		spdx: 'LicenseRef-Ruby-Wasm-Third-Party-Notices',
		size: 51134,
		sha256: '343c246a6e1f1234e29e51707a54799ea82b50d3a2a41c5221fa12058b2395b2'
	}),
	Object.freeze({
		targetPath: 'THIRD_PARTY_NOTICES.md',
		mediaType: 'text/markdown',
		spdx: 'LicenseRef-Provenance-Notice',
		size: 1248,
		sha256: 'e3550c79802a5bf13dc140df11843182131a4b3aac069f0e5824e3cc0378fc68'
	}),
	Object.freeze({
		targetPath: 'licenses/browser-wasi-shim/LICENSE-MIT',
		mediaType: 'text/plain',
		spdx: 'MIT',
		size: 1023,
		sha256: '23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3'
	}),
	Object.freeze({
		targetPath: 'licenses/browser-wasi-shim/LICENSE-APACHE',
		mediaType: 'text/plain',
		spdx: 'Apache-2.0',
		size: 11357,
		sha256: 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4'
	})
]);
const PROFILE_KEYS = [
	'artifactRevision',
	'manifestFingerprint',
	'manifestReceipt',
	'moduleJavaScriptReceipt',
	'profileId',
	'rubyRevision',
	'rubyVersion',
	'rubyWasmRevision',
	'rubyWasmVersion',
	'wasiSdkVersion',
	'wasmReceipt'
] as const;
const PAYLOAD_KEYS = [
	'artifactRevision',
	'manifestBytes',
	'manifestFingerprint',
	'moduleJavaScriptBytes',
	'profileId',
	'protocol',
	'protocolVersion',
	'rubyRevision',
	'rubyVersion',
	'rubyWasmRevision',
	'rubyWasmVersion',
	'wasiSdkVersion',
	'wasmBytes'
] as const;
const MANIFEST_KEYS = [
	'artifact',
	'assets',
	'components',
	'fingerprint',
	'format',
	'legalFiles',
	'licenseExpression',
	'metadata',
	'packages',
	'producer',
	'profileId',
	'provenanceLevel',
	'runtime',
	'storage',
	'transformations'
] as const;
const RECEIPT_KEYS = ['mediaType', 'path', 'sha256', 'size'] as const;
const STORAGE_RECEIPT_KEYS = ['encoding', 'logicalPath', 'path', 'sha256', 'size'] as const;
const textEncoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

type UnknownRecord = Record<string, unknown>;
type RubyRuntimePreflightIdentity = Pick<
	RubyRuntimePreflightPayload,
	| 'profileId'
	| 'artifactRevision'
	| 'rubyVersion'
	| 'rubyRevision'
	| 'rubyWasmVersion'
	| 'rubyWasmRevision'
	| 'wasiSdkVersion'
	| 'manifestFingerprint'
>;

interface ManifestReceipt {
	readonly path: string;
	readonly mediaType: string;
	readonly size: number;
	readonly sha256: string;
}

interface ManifestStorageReceipt {
	readonly path: string;
	readonly logicalPath: string;
	readonly encoding: 'gzip' | 'identity';
	readonly size: number;
	readonly sha256: string;
}

interface ParsedRubyManifest {
	readonly moduleReceipt: ManifestReceipt;
	readonly wasmReceipt: ManifestReceipt;
	readonly moduleStorageReceipt: ManifestStorageReceipt;
	readonly wasmStorageReceipt: ManifestStorageReceipt;
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

function isSha256(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function expectedProfileId(rubyVersion: string, rubyWasmVersion: string): string {
	return `ruby-${rubyVersion}-ruby-wasm-${rubyWasmVersion}`;
}

function snapshotReceipt(
	value: unknown,
	label: string,
	requireLogical: boolean,
	maxBytes: number,
	profileId?: string
): Readonly<RuntimeAssetIntegrityEntry> {
	if (!isPlainRecord(value)) {
		throw new RuntimeConfigurationError(`Ruby runtime ${label} receipt is missing`, {
			phase: 'asset',
			profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
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
		!isSha256(value.sha256) ||
		(requireLogical &&
			(!Number.isSafeInteger(value.uncompressedBytes) ||
				(value.uncompressedBytes as number) <= 0 ||
				(value.uncompressedBytes as number) > RUBY_MAX_ASSET_BYTES ||
				!isSha256(value.uncompressedSha256)))
	) {
		throw new RuntimeConfigurationError(`Ruby runtime ${label} receipt is invalid`, {
			phase: 'asset',
			profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
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

export function snapshotRubyRuntimePreflightProfile(
	value: unknown = RUBY_RUNTIME_PROFILE
): Readonly<Required<RubyRuntimePreflightProfile>> {
	if (!isPlainRecord(value) || !hasExactKeys(value, PROFILE_KEYS)) {
		throw new RuntimeConfigurationError('Ruby runtime preflight profile is invalid', {
			phase: 'asset',
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!isRevision(value.artifactRevision) ||
		!isVersion(value.rubyVersion) ||
		!isRevision(value.rubyRevision) ||
		!isVersion(value.rubyWasmVersion) ||
		!isRevision(value.rubyWasmRevision) ||
		value.artifactRevision !== value.rubyWasmRevision ||
		!isVersion(value.wasiSdkVersion) ||
		value.profileId !== expectedProfileId(value.rubyVersion, value.rubyWasmVersion) ||
		!isSha256(value.manifestFingerprint)
	) {
		throw new RuntimeConfigurationError('Ruby runtime preflight identity is invalid', {
			phase: 'asset',
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	const profileId = value.profileId as string;
	const snapshot = Object.freeze({
		profileId,
		artifactRevision: value.artifactRevision as string,
		rubyVersion: value.rubyVersion as string,
		rubyRevision: value.rubyRevision as string,
		rubyWasmVersion: value.rubyWasmVersion as string,
		rubyWasmRevision: value.rubyWasmRevision as string,
		wasiSdkVersion: value.wasiSdkVersion as string,
		manifestFingerprint: value.manifestFingerprint as string,
		manifestReceipt: snapshotReceipt(
			value.manifestReceipt,
			'manifest',
			false,
			RUBY_MAX_MANIFEST_BYTES,
			profileId
		),
		moduleJavaScriptReceipt: snapshotReceipt(
			value.moduleJavaScriptReceipt,
			'module JavaScript',
			false,
			RUBY_MAX_MODULE_BYTES,
			profileId
		),
		wasmReceipt: snapshotReceipt(
			value.wasmReceipt,
			'Wasm',
			true,
			RUBY_MAX_ASSET_BYTES,
			profileId
		)
	});
	const deliveryTotal =
		snapshot.manifestReceipt.bytes! +
		snapshot.moduleJavaScriptReceipt.bytes! +
		snapshot.wasmReceipt.bytes!;
	const logicalTotal =
		snapshot.moduleJavaScriptReceipt.bytes! + snapshot.wasmReceipt.uncompressedBytes!;
	if (deliveryTotal > RUBY_MAX_DELIVERY_BYTES || logicalTotal > RUBY_MAX_LOGICAL_BYTES) {
		throw new RuntimeConfigurationError(
			'Ruby runtime profile exceeds its aggregate byte budget',
			{
				phase: 'asset',
				profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	return snapshot;
}

export function requireRubyRuntimePreflightPayload(value: unknown): RubyRuntimePreflightPayload {
	if (!isPlainRecord(value) || !hasExactKeys(value, PAYLOAD_KEYS)) {
		throw new ProtocolError('Ruby runtime preflight payload has an invalid shape', {
			phase: 'protocol',
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.protocol !== RUBY_PREFLIGHT_PROTOCOL ||
		value.protocolVersion !== RUBY_PREFLIGHT_PROTOCOL_VERSION ||
		!isRevision(value.artifactRevision) ||
		!isVersion(value.rubyVersion) ||
		!isRevision(value.rubyRevision) ||
		!isVersion(value.rubyWasmVersion) ||
		!isRevision(value.rubyWasmRevision) ||
		value.artifactRevision !== value.rubyWasmRevision ||
		!isVersion(value.wasiSdkVersion) ||
		value.profileId !== expectedProfileId(value.rubyVersion, value.rubyWasmVersion) ||
		!isSha256(value.manifestFingerprint) ||
		!isByteArray(value.manifestBytes) ||
		!isByteArray(value.moduleJavaScriptBytes) ||
		!isByteArray(value.wasmBytes)
	) {
		throw new ProtocolError('Ruby runtime preflight payload is invalid', {
			phase: 'protocol',
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	return value as unknown as RubyRuntimePreflightPayload;
}

export function cloneRubyRuntimePreflightPayload(value: unknown): RubyRuntimePreflightPayload {
	const payload = requireRubyRuntimePreflightPayload(value);
	return Object.freeze({
		protocol: payload.protocol,
		protocolVersion: payload.protocolVersion,
		profileId: payload.profileId,
		artifactRevision: payload.artifactRevision,
		rubyVersion: payload.rubyVersion,
		rubyRevision: payload.rubyRevision,
		rubyWasmVersion: payload.rubyWasmVersion,
		rubyWasmRevision: payload.rubyWasmRevision,
		wasiSdkVersion: payload.wasiSdkVersion,
		manifestFingerprint: payload.manifestFingerprint,
		manifestBytes: Uint8Array.from(payload.manifestBytes),
		moduleJavaScriptBytes: Uint8Array.from(payload.moduleJavaScriptBytes),
		wasmBytes: Uint8Array.from(payload.wasmBytes)
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
		throw new AssetIntegrityError('Ruby runtime manifest contains a non-JSON value', {
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	return primitive;
}

async function waitForAbortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return await operation;
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
		throw new AssetIntegrityError('Ruby runtime integrity verification requires Web Crypto', {
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
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
		throw new AssetIntegrityError(`Ruby runtime manifest ${label} is invalid`, {
			profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	return value;
}

function validateHttpsUrl(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
	} catch {
		return false;
	}
}

function validateManifestIdentityGraph(
	manifest: UnknownRecord,
	profile: RubyRuntimePreflightIdentity
): void {
	const artifact = requireExactRecord(
		manifest.artifact,
		[
			'evidence',
			'kind',
			'repository',
			'revision',
			'verifiedBuildInput',
			'workflow',
			'workflowRun'
		],
		'artifact',
		profile.profileId
	);
	if (
		artifact.kind !== 'npm-provenance-attested-package-set' ||
		artifact.repository !== EXPECTED_ARTIFACT_REPOSITORY ||
		artifact.revision !== profile.artifactRevision ||
		artifact.workflow !== '.github/workflows/release.yml' ||
		!validateHttpsUrl(artifact.workflowRun) ||
		artifact.verifiedBuildInput !== false ||
		typeof artifact.evidence !== 'string' ||
		!artifact.evidence
	) {
		throw new AssetIntegrityError('Ruby runtime artifact identity is invalid', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	const components = requireExactRecord(
		manifest.components,
		['ruby', 'rubyWasm', 'wasiSdk'],
		'components',
		profile.profileId
	);
	for (const [name, version, revision, repository] of [
		['ruby', profile.rubyVersion, profile.rubyRevision, EXPECTED_RUBY_REPOSITORY],
		[
			'rubyWasm',
			profile.rubyWasmVersion,
			profile.rubyWasmRevision,
			EXPECTED_RUBY_WASM_REPOSITORY
		],
		['wasiSdk', profile.wasiSdkVersion, 'unrecorded', EXPECTED_WASI_SDK_REPOSITORY]
	] as const) {
		const component = requireExactRecord(
			components[name],
			['evidence', 'repository', 'revision', 'verifiedBuildInput', 'version'],
			`${name} component`,
			profile.profileId
		);
		if (
			component.version !== version ||
			component.revision !== revision ||
			component.repository !== repository ||
			component.verifiedBuildInput !== false ||
			typeof component.evidence !== 'string' ||
			!component.evidence
		) {
			throw new AssetIntegrityError(`Ruby runtime ${name} component identity is invalid`, {
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	if (!Array.isArray(manifest.packages) || manifest.packages.length !== 3) {
		throw new AssetIntegrityError('Ruby runtime package provenance is invalid', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	const packageNames = new Set<string>();
	for (const candidate of manifest.packages) {
		const entry = requireExactRecord(
			candidate,
			[
				'attestationUrl',
				'bytes',
				'files',
				'integrity',
				'license',
				'name',
				'repository',
				'requestedRange',
				'revision',
				'tarballBytes',
				'tarballSha256',
				'tarballUrl',
				'treeSha256',
				'version'
			],
			'package provenance entry',
			profile.profileId
		);
		if (
			typeof entry.name !== 'string' ||
			packageNames.has(entry.name) ||
			!isVersion(entry.version) ||
			typeof entry.requestedRange !== 'string' ||
			!validateHttpsUrl(entry.tarballUrl) ||
			!Number.isSafeInteger(entry.tarballBytes) ||
			(entry.tarballBytes as number) <= 0 ||
			!isSha256(entry.tarballSha256) ||
			typeof entry.integrity !== 'string' ||
			(entry.attestationUrl !== null && !validateHttpsUrl(entry.attestationUrl)) ||
			!validateHttpsUrl(entry.repository) ||
			!isRevision(entry.revision) ||
			typeof entry.license !== 'string' ||
			!Number.isSafeInteger(entry.files) ||
			(entry.files as number) <= 0 ||
			!Number.isSafeInteger(entry.bytes) ||
			(entry.bytes as number) <= 0 ||
			!isSha256(entry.treeSha256)
		) {
			throw new AssetIntegrityError('Ruby runtime package provenance entry is invalid', {
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
		packageNames.add(entry.name);
	}
	for (const name of ['@bjorn3/browser_wasi_shim', '@ruby/3.4-wasm-wasi', '@ruby/wasm-wasi']) {
		if (!packageNames.has(name)) {
			throw new AssetIntegrityError('Ruby runtime package provenance is incomplete', {
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	const producer = requireExactRecord(
		manifest.producer,
		['entry', 'packageTreeReceiptFormat', 'script', 'tool'],
		'producer',
		profile.profileId
	);
	for (const key of ['entry', 'script'] as const) {
		const source = requireExactRecord(
			producer[key],
			['bytes', 'path', 'sha256'],
			`producer ${key}`,
			profile.profileId
		);
		if (
			typeof source.path !== 'string' ||
			!Number.isSafeInteger(source.bytes) ||
			(source.bytes as number) <= 0 ||
			!isSha256(source.sha256)
		) {
			throw new AssetIntegrityError(`Ruby runtime producer ${key} is invalid`, {
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	const tool = requireExactRecord(
		producer.tool,
		[
			'bytes',
			'files',
			'integrity',
			'license',
			'name',
			'requestedRange',
			'tarballUrl',
			'treeSha256',
			'version'
		],
		'producer tool',
		profile.profileId
	);
	if (
		tool.name !== 'vite' ||
		!isVersion(tool.version) ||
		typeof tool.requestedRange !== 'string' ||
		!validateHttpsUrl(tool.tarballUrl) ||
		typeof tool.integrity !== 'string' ||
		tool.license !== 'MIT' ||
		!Number.isSafeInteger(tool.files) ||
		(tool.files as number) <= 0 ||
		!Number.isSafeInteger(tool.bytes) ||
		(tool.bytes as number) <= 0 ||
		!isSha256(tool.treeSha256) ||
		producer.packageTreeReceiptFormat !==
			'sha256-json-sorted-path-bytes-sha256-v2-excludes-package-manager-bin'
	) {
		throw new AssetIntegrityError('Ruby runtime producer identity is invalid', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!Array.isArray(manifest.transformations) || manifest.transformations.length !== 2) {
		throw new AssetIntegrityError('Ruby runtime transformations are invalid', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const candidate of manifest.transformations) {
		const transformation = requireExactRecord(
			candidate,
			['id', 'input', 'output'],
			'transformation',
			profile.profileId
		);
		if (
			typeof transformation.id !== 'string' ||
			typeof transformation.input !== 'string' ||
			typeof transformation.output !== 'string'
		) {
			throw new AssetIntegrityError('Ruby runtime transformation is invalid', {
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	if (!Array.isArray(manifest.legalFiles) || manifest.legalFiles.length === 0) {
		throw new AssetIntegrityError('Ruby runtime legal provenance is invalid', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	const legalPaths = new Set<string>();
	for (const candidate of manifest.legalFiles) {
		const legal = requireExactRecord(
			candidate,
			['mediaType', 'sha256', 'size', 'spdx', 'targetPath'],
			'legal file',
			profile.profileId
		);
		if (
			typeof legal.targetPath !== 'string' ||
			legalPaths.has(legal.targetPath) ||
			typeof legal.mediaType !== 'string' ||
			typeof legal.spdx !== 'string' ||
			!Number.isSafeInteger(legal.size) ||
			(legal.size as number) <= 0 ||
			!isSha256(legal.sha256)
		) {
			throw new AssetIntegrityError('Ruby runtime legal file receipt is invalid', {
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
		legalPaths.add(legal.targetPath);
	}
	if (
		canonicalJson(manifest.packages) !== canonicalJson(EXPECTED_PACKAGES) ||
		canonicalJson(manifest.producer) !== canonicalJson(EXPECTED_PRODUCER) ||
		canonicalJson(manifest.transformations) !== canonicalJson(EXPECTED_TRANSFORMATIONS) ||
		canonicalJson(manifest.legalFiles) !== canonicalJson(EXPECTED_LEGAL_FILES)
	) {
		throw new AssetIntegrityError('Ruby runtime pinned provenance graph is invalid', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
}

function normalizeManifestReceipt(
	value: unknown,
	path: string,
	mediaType: string,
	maxBytes: number,
	profileId: string
): ManifestReceipt {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, RECEIPT_KEYS) ||
		value.path !== path ||
		value.mediaType !== mediaType ||
		!Number.isSafeInteger(value.size) ||
		(value.size as number) <= 0 ||
		(value.size as number) > maxBytes ||
		!isSha256(value.sha256)
	) {
		throw new AssetIntegrityError(`Ruby runtime manifest receipt ${path} is invalid`, {
			profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	return { path, mediaType, size: value.size as number, sha256: value.sha256 };
}

function normalizeStorageReceipt(
	value: unknown,
	path: string,
	logicalPath: string,
	encoding: 'gzip' | 'identity',
	maxBytes: number,
	profileId: string
): ManifestStorageReceipt {
	if (
		!isPlainRecord(value) ||
		!hasExactKeys(value, STORAGE_RECEIPT_KEYS) ||
		value.path !== path ||
		value.logicalPath !== logicalPath ||
		value.encoding !== encoding ||
		!Number.isSafeInteger(value.size) ||
		(value.size as number) <= 0 ||
		(value.size as number) > maxBytes ||
		!isSha256(value.sha256)
	) {
		throw new AssetIntegrityError(`Ruby runtime storage receipt ${path} is invalid`, {
			profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	return {
		path,
		logicalPath,
		encoding,
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
		`provenanceLevel\0${EXPECTED_PROVENANCE_LEVEL}\n` +
		`licenseExpression\0${EXPECTED_LICENSE_EXPRESSION}\n`;
	for (const key of ['artifact', 'components', 'packages', 'producer', 'transformations']) {
		canonical += `${key}\0${canonicalJson(manifest[key])}\n`;
	}
	for (const legal of [...(manifest.legalFiles as UnknownRecord[])].sort((left, right) =>
		String(left.targetPath) < String(right.targetPath)
			? -1
			: String(left.targetPath) > String(right.targetPath)
				? 1
				: 0
	)) {
		canonical += `legal\0${String(legal.targetPath)}\0${String(legal.mediaType)}\0${String(legal.spdx)}\0${String(legal.size)}\0${String(legal.sha256)}\n`;
	}
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
	profile: RubyRuntimePreflightIdentity,
	signal?: AbortSignal
): Promise<ParsedRubyManifest> {
	let value: unknown;
	try {
		value = JSON.parse(fatalDecoder.decode(bytes));
	} catch (error) {
		throw new AssetIntegrityError('Ruby runtime manifest is not valid UTF-8 JSON', {
			cause: error,
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!isPlainRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
		throw new AssetIntegrityError('Ruby runtime manifest schema is invalid', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		value.format !== MANIFEST_FORMAT ||
		value.runtime !== EXPECTED_RUNTIME ||
		value.profileId !== profile.profileId ||
		value.provenanceLevel !== EXPECTED_PROVENANCE_LEVEL ||
		value.licenseExpression !== EXPECTED_LICENSE_EXPRESSION ||
		value.fingerprint !== profile.manifestFingerprint
	) {
		throw new AssetIntegrityError('Ruby runtime manifest identity is invalid', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
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
		!isSha256(metadata.sha256)
	) {
		throw new AssetIntegrityError('Ruby runtime metadata receipt is invalid', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!Array.isArray(value.assets) || value.assets.length !== 2) {
		throw new AssetIntegrityError('Ruby runtime manifest must declare two logical assets', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 2) {
		throw new AssetIntegrityError('Ruby runtime manifest must declare two storage assets', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	const assetByPath = new Map<string, ManifestReceipt>();
	for (const candidate of value.assets) {
		const path = isPlainRecord(candidate) ? candidate.path : undefined;
		if (
			(path !== RUBY_RUNTIME_MODULE_PATH && path !== RUBY_RUNTIME_ASSET_PATH) ||
			assetByPath.has(path)
		) {
			throw new AssetIntegrityError('Ruby runtime manifest has an unexpected logical asset', {
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
		assetByPath.set(
			path,
			normalizeManifestReceipt(
				candidate,
				path,
				path === RUBY_RUNTIME_MODULE_PATH ? 'text/javascript' : 'application/wasm',
				path === RUBY_RUNTIME_MODULE_PATH ? RUBY_MAX_MODULE_BYTES : RUBY_MAX_ASSET_BYTES,
				profile.profileId
			)
		);
	}
	const storageByPath = new Map<string, ManifestStorageReceipt>();
	for (const candidate of value.storage) {
		const path = isPlainRecord(candidate) ? candidate.path : undefined;
		if (
			(path !== RUBY_RUNTIME_MODULE_STORAGE_PATH &&
				path !== RUBY_RUNTIME_WASM_STORAGE_PATH) ||
			storageByPath.has(path)
		) {
			throw new AssetIntegrityError('Ruby runtime manifest has an unexpected storage asset', {
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
		storageByPath.set(
			path,
			normalizeStorageReceipt(
				candidate,
				path,
				path === RUBY_RUNTIME_MODULE_STORAGE_PATH
					? RUBY_RUNTIME_MODULE_PATH
					: RUBY_RUNTIME_ASSET_PATH,
				path === RUBY_RUNTIME_MODULE_STORAGE_PATH ? 'identity' : 'gzip',
				path === RUBY_RUNTIME_MODULE_STORAGE_PATH
					? RUBY_MAX_MODULE_BYTES
					: RUBY_MAX_ASSET_BYTES,
				profile.profileId
			)
		);
	}
	const moduleReceipt = assetByPath.get(RUBY_RUNTIME_MODULE_PATH);
	const wasmReceipt = assetByPath.get(RUBY_RUNTIME_ASSET_PATH);
	const moduleStorageReceipt = storageByPath.get(RUBY_RUNTIME_MODULE_STORAGE_PATH);
	const wasmStorageReceipt = storageByPath.get(RUBY_RUNTIME_WASM_STORAGE_PATH);
	if (!moduleReceipt || !wasmReceipt || !moduleStorageReceipt || !wasmStorageReceipt) {
		throw new AssetIntegrityError('Ruby runtime manifest omits a required asset receipt', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	const fingerprint = await computeManifestFingerprint(
		value,
		[moduleReceipt, wasmReceipt],
		[moduleStorageReceipt, wasmStorageReceipt],
		signal
	);
	if (fingerprint !== profile.manifestFingerprint) {
		throw new AssetIntegrityError(
			'Ruby runtime receipt graph failed fingerprint verification',
			{
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	return { moduleReceipt, wasmReceipt, moduleStorageReceipt, wasmStorageReceipt };
}

function assertManifestMatchesProfile(
	manifest: ParsedRubyManifest,
	profile: Readonly<Required<RubyRuntimePreflightProfile>>
): void {
	if (
		manifest.moduleReceipt.size !== profile.moduleJavaScriptReceipt.bytes ||
		manifest.moduleReceipt.sha256 !== profile.moduleJavaScriptReceipt.sha256 ||
		manifest.moduleStorageReceipt.size !== profile.moduleJavaScriptReceipt.bytes ||
		manifest.moduleStorageReceipt.sha256 !== profile.moduleJavaScriptReceipt.sha256 ||
		manifest.wasmReceipt.size !== profile.wasmReceipt.uncompressedBytes ||
		manifest.wasmReceipt.sha256 !== profile.wasmReceipt.uncompressedSha256 ||
		manifest.wasmStorageReceipt.size !== profile.wasmReceipt.bytes ||
		manifest.wasmStorageReceipt.sha256 !== profile.wasmReceipt.sha256
	) {
		throw new AssetIntegrityError('Ruby runtime manifest asset graph mismatches its profile', {
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
}

async function verifyLogicalBytes(
	manifest: ParsedRubyManifest,
	path: typeof RUBY_RUNTIME_MODULE_PATH | typeof RUBY_RUNTIME_ASSET_PATH,
	bytes: Uint8Array,
	profileId: string,
	signal?: AbortSignal
): Promise<void> {
	const receipt =
		path === RUBY_RUNTIME_MODULE_PATH ? manifest.moduleReceipt : manifest.wasmReceipt;
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
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		}),
		signal
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function rewriteRubyModuleAssetSpecifier(bytes: Uint8Array): string {
	let source: string;
	try {
		source = fatalDecoder.decode(bytes);
	} catch (error) {
		throw new AssetIntegrityError('Ruby runtime module is not valid UTF-8 JavaScript', {
			cause: error,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	const quotedPath = JSON.stringify(RUBY_RUNTIME_ASSET_PATH);
	const pattern = new RegExp(
		`new\\s+URL\\(\\s*${escapeRegExp(quotedPath)}\\s*,\\s*import\\.meta\\.url\\s*\\)`,
		'gu'
	);
	const matches = [...source.matchAll(pattern)];
	if (matches.length !== 1) {
		throw new AssetIntegrityError(
			'Ruby runtime module must contain exactly one locked Wasm URL expression',
			{ runtimeId: RUBY_PREFLIGHT_RUNTIME_ID }
		);
	}
	const match = matches[0];
	const expression = match[0];
	const rewritten = expression.replace(
		quotedPath,
		JSON.stringify(RUBY_RUNTIME_VERIFIED_WASM_URL)
	);
	return `${source.slice(0, match.index)}${rewritten}${source.slice(
		(match.index ?? 0) + expression.length
	)}`;
}

export async function verifyRubyRuntimePreflightPayload(
	value: unknown,
	options: { readonly maxAssetBytes?: number; readonly signal?: AbortSignal } = {}
): Promise<RubyRuntimePreflightPayload> {
	const payload = requireRubyRuntimePreflightPayload(value);
	const maxAssetBytes = Math.min(
		options.maxAssetBytes ?? RUBY_MAX_ASSET_BYTES,
		RUBY_MAX_ASSET_BYTES
	);
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
		throw new RuntimeConfigurationError('Ruby runtime asset byte limit is invalid', {
			phase: 'asset',
			profileId: payload.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const [label, bytes, limit] of [
		['manifest', payload.manifestBytes, Math.min(maxAssetBytes, RUBY_MAX_MANIFEST_BYTES)],
		[
			'module JavaScript',
			payload.moduleJavaScriptBytes,
			Math.min(maxAssetBytes, RUBY_MAX_MODULE_BYTES)
		],
		['Wasm', payload.wasmBytes, maxAssetBytes]
	] as const) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new AssetTooLargeError(`Ruby runtime ${label} exceeds the ${limit} byte limit`, {
				actual: bytes.byteLength,
				limit,
				phase: 'asset',
				profileId: payload.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	const logicalTotal = payload.moduleJavaScriptBytes.byteLength + payload.wasmBytes.byteLength;
	if (!Number.isSafeInteger(logicalTotal) || logicalTotal > RUBY_MAX_LOGICAL_BYTES) {
		throw new AssetTooLargeError(
			`Ruby runtime logical payload exceeds the ${RUBY_MAX_LOGICAL_BYTES} byte aggregate limit`,
			{
				actual: logicalTotal,
				limit: RUBY_MAX_LOGICAL_BYTES,
				phase: 'asset',
				profileId: payload.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const manifest = await parseAndVerifyManifest(payload.manifestBytes, payload, options.signal);
	await verifyLogicalBytes(
		manifest,
		RUBY_RUNTIME_MODULE_PATH,
		payload.moduleJavaScriptBytes,
		payload.profileId,
		options.signal
	);
	await verifyLogicalBytes(
		manifest,
		RUBY_RUNTIME_ASSET_PATH,
		payload.wasmBytes,
		payload.profileId,
		options.signal
	);
	try {
		rewriteRubyModuleAssetSpecifier(payload.moduleJavaScriptBytes);
	} catch (error) {
		throw new AssetIntegrityError('Ruby runtime module asset reference is invalid', {
			cause: error,
			profileId: payload.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		payload.wasmBytes.byteLength < 8 ||
		payload.wasmBytes[0] !== 0x00 ||
		payload.wasmBytes[1] !== 0x61 ||
		payload.wasmBytes[2] !== 0x73 ||
		payload.wasmBytes[3] !== 0x6d ||
		payload.wasmBytes[4] !== 0x01 ||
		payload.wasmBytes[5] !== 0x00 ||
		payload.wasmBytes[6] !== 0x00 ||
		payload.wasmBytes[7] !== 0x00
	) {
		throw new AssetIntegrityError('Ruby runtime Wasm has an invalid magic header or version', {
			profileId: payload.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	return payload;
}

export function rewriteVerifiedRubyRuntimeModule(value: unknown): string {
	const payload = requireRubyRuntimePreflightPayload(value);
	return rewriteRubyModuleAssetSpecifier(payload.moduleJavaScriptBytes);
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
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	if (
		!Number.isSafeInteger(expectedBytes) ||
		expectedBytes <= 0 ||
		expectedBytes > maxAssetBytes
	) {
		throw new AssetTooLargeError(
			`Ruby runtime Wasm logical bytes exceed the ${maxAssetBytes} byte limit`,
			{
				actual: expectedBytes,
				limit: maxAssetBytes,
				phase: 'asset',
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			}
		);
	}
	const body = new Response(Uint8Array.from(compressedBytes)).body;
	if (!body) {
		throw new UnsupportedBrowserFeatureError('ReadableStream response bodies', {
			phase: 'asset',
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
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
					'Ruby runtime Wasm gzip output exceeds its logical receipt',
					{ runtimeId: RUBY_PREFLIGHT_RUNTIME_ID }
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
		throw new AssetIntegrityError('Ruby runtime Wasm gzip decompression failed', {
			cause: error,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
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
		throw new AssetIntegrityError('Ruby runtime Wasm gzip output is truncated', {
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	return output;
}

function resolvePinnedAssetUrl(
	configured: string,
	baseUrl: URL,
	path: string,
	sha256: string,
	profileId: string
): URL {
	let url: URL;
	try {
		url = new URL(configured, baseUrl);
	} catch (error) {
		throw new RuntimeConfigurationError(`Ruby runtime ${path} URL is invalid`, {
			cause: error,
			phase: 'asset',
			profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
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
			`Ruby runtime ${path} URL must match its query-pinned canonical storage path`,
			{ phase: 'asset', profileId, runtimeId: RUBY_PREFLIGHT_RUNTIME_ID }
		);
	}
	if (!url.search) url.searchParams.set('v', sha256);
	return url;
}

export async function preflightRubyRuntimeAssets(
	request: RubyRuntimePreflightRequest
): Promise<RubyRuntimePreflightPayload> {
	if (!request || typeof request !== 'object') {
		throw new RuntimeConfigurationError('Ruby runtime preflight request is required', {
			phase: 'asset',
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	const profile = snapshotRubyRuntimePreflightProfile(request.profile);
	let baseUrl: URL;
	try {
		baseUrl = new URL(request.baseUrl);
		if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
	} catch (error) {
		throw new RuntimeConfigurationError('Ruby runtime asset base URL is invalid', {
			cause: error,
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
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
			'Ruby runtime base must be a credential-free HTTP(S) directory URL without a query or fragment',
			{ phase: 'asset', profileId: profile.profileId, runtimeId: RUBY_PREFLIGHT_RUNTIME_ID }
		);
	}
	const manifestUrl = resolvePinnedAssetUrl(
		request.manifestUrl,
		baseUrl,
		RUBY_RUNTIME_MANIFEST_PATH,
		profile.manifestFingerprint,
		profile.profileId
	);
	const moduleUrl = resolvePinnedAssetUrl(
		request.moduleUrl,
		baseUrl,
		RUBY_RUNTIME_MODULE_STORAGE_PATH,
		profile.moduleJavaScriptReceipt.sha256,
		profile.profileId
	);
	const wasmUrl = resolvePinnedAssetUrl(
		request.wasmUrl,
		baseUrl,
		RUBY_RUNTIME_WASM_STORAGE_PATH,
		profile.wasmReceipt.sha256,
		profile.profileId
	);
	const resolvedLimits = resolveExecutionLimits(request.limits);
	const configuredMax = request.maxAssetBytes ?? resolvedLimits.maxAssetBytes;
	if (!Number.isSafeInteger(configuredMax) || configuredMax <= 0) {
		throw new RuntimeConfigurationError('Ruby runtime maxAssetBytes is invalid', {
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	const maxAssetBytes = Math.min(configuredMax, RUBY_MAX_ASSET_BYTES);
	const timeoutMs = request.timeoutMs ?? resolvedLimits.assetTimeoutMs;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new RuntimeConfigurationError('Ruby runtime asset timeout is invalid', {
			phase: 'asset',
			profileId: profile.profileId,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
		});
	}
	for (const [label, receipt, limit] of [
		['manifest', profile.manifestReceipt, Math.min(RUBY_MAX_MANIFEST_BYTES, maxAssetBytes)],
		[
			'module JavaScript',
			profile.moduleJavaScriptReceipt,
			Math.min(RUBY_MAX_MODULE_BYTES, maxAssetBytes)
		],
		['Wasm storage', profile.wasmReceipt, maxAssetBytes],
		['Wasm logical', { bytes: profile.wasmReceipt.uncompressedBytes }, maxAssetBytes]
	] as const) {
		if ((receipt.bytes ?? 0) > limit) {
			throw new AssetTooLargeError(`Ruby runtime ${label} exceeds the ${limit} byte limit`, {
				actual: receipt.bytes,
				limit,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
	}
	const registry: RuntimeRegistryManifest = {
		schemaVersion: 2,
		manifestId: 'wasm-idle/ruby-preflight',
		revision: profile.manifestFingerprint,
		runtimes: [
			{
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID,
				identity: {
					languageId: 'RUBY',
					implementationId: 'ruby-wasm-wasi',
					implementationVersion: profile.rubyVersion,
					profile: {
						profileId: profile.profileId,
						manifestSchemaVersion: 2,
						manifestSha256: profile.manifestReceipt.sha256,
						protocolVersion: RUBY_PREFLIGHT_PROTOCOL_VERSION,
						trustProfileId: 'wasm-idle-ruby-preflight-v1',
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
				requiredBrowserFeatures: ['decompression-stream'],
				assetRoot: '.',
				assets: [
					{
						key: 'manifest',
						path: RUBY_RUNTIME_MANIFEST_PATH,
						compressedSha256: profile.manifestReceipt.sha256,
						uncompressedSha256: profile.manifestReceipt.sha256,
						compressedBytes: profile.manifestReceipt.bytes!,
						uncompressedBytes: profile.manifestReceipt.bytes!,
						mediaType: 'application/json',
						encoding: 'identity'
					},
					{
						key: 'moduleJavaScript',
						path: RUBY_RUNTIME_MODULE_STORAGE_PATH,
						compressedSha256: profile.moduleJavaScriptReceipt.sha256,
						uncompressedSha256: profile.moduleJavaScriptReceipt.sha256,
						compressedBytes: profile.moduleJavaScriptReceipt.bytes!,
						uncompressedBytes: profile.moduleJavaScriptReceipt.bytes!,
						mediaType: 'application/octet-stream',
						encoding: 'identity'
					},
					{
						key: 'wasm',
						path: RUBY_RUNTIME_WASM_STORAGE_PATH,
						compressedSha256: profile.wasmReceipt.sha256,
						uncompressedSha256: profile.wasmReceipt.uncompressedSha256!,
						compressedBytes: profile.wasmReceipt.bytes!,
						uncompressedBytes: profile.wasmReceipt.uncompressedBytes!,
						mediaType: 'application/octet-stream',
						encoding: 'gzip'
					}
				],
				contracts: {
					routeId: 'ruby',
					runtimeAssetKey: 'ruby',
					documentationId: 'RUBY',
					syncTarget: 'sync:wasm-ruby',
					browserTestId: 'browser:ruby'
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
		controller.abort(new DOMException('Ruby runtime preflight timed out', 'TimeoutError'));
	}, timeoutMs);
	try {
		const preflight = await preflightRuntimeAssets({
			manifest: registry,
			runtimeId: RUBY_PREFLIGHT_RUNTIME_ID,
			rootUrl: baseUrl,
			assetUrls: { manifest: manifestUrl, moduleJavaScript: moduleUrl, wasm: wasmUrl },
			fetch: request.fetch,
			signal: controller.signal,
			limits: { ...resolvedLimits, maxAssetBytes },
			cache: 'no-store',
			redirect: 'error',
			maxConcurrentDownloads: 3,
			maxTotalDeliveryBytes: RUBY_MAX_DELIVERY_BYTES,
			reportProgress: request.reportProgress ?? request.progress
		});
		const manifestAsset = preflight.assets.manifest;
		const moduleAsset = preflight.assets.moduleJavaScript;
		const wasmAsset = preflight.assets.wasm;
		if (!manifestAsset || !moduleAsset || !wasmAsset) {
			throw new RuntimeConfigurationError(
				'Ruby runtime preflight returned an incomplete asset set',
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		if (wasmAsset.contentEncoding) {
			throw new AssetIntegrityError(
				`Ruby runtime asset ${wasmAsset.path} must not use HTTP Content-Encoding`,
				{
					phase: 'asset',
					profileId: profile.profileId,
					runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
				}
			);
		}
		const manifest = await parseAndVerifyManifest(
			manifestAsset.bytes,
			profile,
			controller.signal
		);
		assertManifestMatchesProfile(manifest, profile);
		if (wasmAsset.bytes[0] !== 0x1f || wasmAsset.bytes[1] !== 0x8b) {
			throw new AssetIntegrityError('Ruby runtime Wasm storage is not gzip data', {
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
		const wasmBytes = await decompressGzipBounded(
			wasmAsset.bytes,
			profile.wasmReceipt.uncompressedBytes!,
			maxAssetBytes,
			controller.signal,
			request.reportDecompressionProgress
		);
		const payload: RubyRuntimePreflightPayload = Object.freeze({
			protocol: RUBY_PREFLIGHT_PROTOCOL,
			protocolVersion: RUBY_PREFLIGHT_PROTOCOL_VERSION,
			profileId: profile.profileId,
			artifactRevision: profile.artifactRevision,
			rubyVersion: profile.rubyVersion,
			rubyRevision: profile.rubyRevision,
			rubyWasmVersion: profile.rubyWasmVersion,
			rubyWasmRevision: profile.rubyWasmRevision,
			wasiSdkVersion: profile.wasiSdkVersion,
			manifestFingerprint: profile.manifestFingerprint,
			manifestBytes: Uint8Array.from(manifestAsset.bytes),
			moduleJavaScriptBytes: Uint8Array.from(moduleAsset.bytes),
			wasmBytes
		});
		return await verifyRubyRuntimePreflightPayload(payload, {
			maxAssetBytes,
			signal: controller.signal
		});
	} catch (error) {
		if (timedOut) {
			throw new TimeoutError(`Ruby runtime preflight timed out after ${timeoutMs} ms`, {
				cause: error,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID,
				timeoutMs
			});
		}
		if (controller.signal.aborted) {
			throw new CancelledError('Ruby runtime preflight was cancelled', {
				cause: error,
				phase: 'asset',
				profileId: profile.profileId,
				runtimeId: RUBY_PREFLIGHT_RUNTIME_ID
			});
		}
		throw error;
	} finally {
		clearTimeout(timeout);
		request.signal?.removeEventListener('abort', abortFromCaller);
	}
}
