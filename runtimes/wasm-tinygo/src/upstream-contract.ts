import type { TinyGoWasiDirectoryContents } from './upstream-vfs.ts';
import { hasTinyGoVfsPath } from './upstream-vfs.ts';

export const TINYGO_UPSTREAM_ASSET_MANIFEST_FORMAT = 'wasm-idle-tinygo-upstream-assets-v2' as const;
export const TINYGO_RUNTIME_PROFILE_FORMAT = 'wasm-idle-tinygo-runtime-profile-v1' as const;
export const TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V1 =
	'wasm-llvm-tinygo-browser-compiler-v1' as const;
export const TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V2 =
	'wasm-llvm-tinygo-browser-compiler-v2' as const;
export const TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V3 =
	'wasm-llvm-tinygo-browser-compiler-v3' as const;
export const TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V4 =
	'wasm-llvm-tinygo-browser-compiler-v4' as const;
export const TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V5 =
	'wasm-llvm-tinygo-browser-compiler-v5' as const;
export const TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V6 =
	'wasm-llvm-tinygo-browser-compiler-v6' as const;
export const TINYGO_UPSTREAM_PACKAGE_GRAPH_RECEIPT_FORMAT_V1 =
	'wasm-llvm-tinygo-package-graph-provider-v1' as const;
export const TINYGO_UPSTREAM_PACKAGE_GRAPH_RECEIPT_FORMAT =
	'wasm-llvm-tinygo-package-graph-provider-v2' as const;
export const TINYGO_RUNTIME_CLOSURE_FORMAT_V1 = 'wasm-llvm-tinygo-runtime-closure-v1' as const;
export const TINYGO_RUNTIME_CLOSURE_FORMAT = 'wasm-llvm-tinygo-runtime-closure-v2' as const;
export const TINYGO_RUNTIME_PROFILE_ID = 'wasip1-asyncify-precise-o1' as const;
export const TINYGO_ROOT_PATH = '/tinygo-root' as const;
export const TINYGO_WORKSPACE_PATH = '/workspace' as const;
export const TINYGO_WORK_PATH = '/work' as const;
export const TINYGO_GO_VERSION = 'go1.24.6' as const;
export const TINYGO_BINARYEN_VERSION = '129.0.0' as const;

export const TINYGO_UPSTREAM_COMPILER_PACKAGES = [
	'github.com/tinygo-org/tinygo/builder',
	'github.com/tinygo-org/tinygo/cgo',
	'github.com/tinygo-org/tinygo/compiler',
	'github.com/tinygo-org/tinygo/interp',
	'github.com/tinygo-org/tinygo/loader',
	'github.com/tinygo-org/tinygo/transform',
	'tinygo.org/x/go-llvm'
] as const;

export const TINYGO_UPSTREAM_PACKAGE_GRAPH_PACKAGES = [
	'go/build',
	'go/build/constraint',
	'cmd/go/internal/list',
	'cmd/go/internal/load',
	'cmd/go/internal/modload'
] as const;

export const TINYGO_UPSTREAM_PACKAGE_GRAPH_FIELDS = [
	'Dir',
	'ImportPath',
	'Name',
	'Root',
	'Module',
	'Goroot',
	'Standard',
	'DepOnly',
	'GoFiles',
	'CgoFiles',
	'CFiles',
	'CXXFiles',
	'SFiles',
	'CgoCXXFLAGS',
	'CgoLDFLAGS',
	'EmbedFiles',
	'Imports',
	'ImportMap',
	'Error'
] as const;

export const TINYGO_UPSTREAM_PACKAGE_GRAPH_TAGS = [
	'tinygo.wasm',
	'tinygo',
	'purego',
	'osusergo',
	'math_big_pure_go',
	'gc.precise',
	'scheduler.asyncify',
	'serial.none',
	'tinygo.unicore',
	...Array.from({ length: 24 }, (_, index) => `go1.${index + 1}`)
] as const;

const SOURCE_FILE_FIELDS = [
	'GoFiles',
	'CgoFiles',
	'CFiles',
	'CXXFiles',
	'SFiles',
	'EmbedFiles'
] as const;
const PACKAGE_FLAG_FIELDS = ['CgoCXXFLAGS', 'CgoLDFLAGS'] as const;
const MAX_PACKAGE_JSON_BYTES = 64 * 1024 * 1024;
const MAX_PACKAGE_COUNT = 16_384;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

type JsonObject = Record<string, unknown>;

export type TinyGoCompileProtocolVersion = 1 | 2 | 3 | 4 | 5 | 6;

export interface TinyGoUpstreamAssetEvidence {
	path: string;
	bytes: number;
	sha256: string;
}

export interface TinyGoUpstreamAssetManifest {
	schemaVersion: 2;
	format: typeof TINYGO_UPSTREAM_ASSET_MANIFEST_FORMAT;
	producerReceipt: TinyGoUpstreamAssetEvidence;
	packageGraphReceipt: TinyGoUpstreamAssetEvidence;
	assets: {
		compiler: TinyGoUpstreamAssetEvidence;
		packageGraph: TinyGoUpstreamAssetEvidence;
		rootArchive: TinyGoUpstreamAssetEvidence;
		lld: TinyGoUpstreamAssetEvidence & {
			sourceArchiveSha256?: string;
		};
	};
}

export interface TinyGoRuntimeAssetReceipt {
	bytes: number;
	sha256: string;
	uncompressedBytes?: number;
	uncompressedSha256?: string;
}

export interface TinyGoUpstreamRuntimeProfile {
	profileId: string;
	protocolVersion: TinyGoCompileProtocolVersion;
	manifestPath: string;
	manifestFingerprint: string;
	manifestReceipt: TinyGoRuntimeAssetReceipt;
	assetReceipts: Readonly<Record<string, TinyGoRuntimeAssetReceipt>>;
}

export interface TinyGoRuntimeClosureAsset extends TinyGoUpstreamAssetEvidence {
	id: string;
	format: string;
	source?: string;
}

export interface TinyGoRuntimeClosure {
	schemaVersion: 1;
	format: typeof TINYGO_RUNTIME_CLOSURE_FORMAT | typeof TINYGO_RUNTIME_CLOSURE_FORMAT_V1;
	compilerSha256: string;
	profile: {
		id: typeof TINYGO_RUNTIME_PROFILE_ID;
		target: 'wasip1';
		opt: '1';
		gc: 'precise';
		panicStrategy: 'print';
		scheduler: 'asyncify';
		debug: false;
		parallelism: 1;
	};
	compilerRT: TinyGoRuntimeClosureAsset;
	wasiLibc: TinyGoRuntimeClosureAsset;
	libCxx?: TinyGoRuntimeClosureAsset;
	libCxxAbi?: TinyGoRuntimeClosureAsset;
	extraFiles: Record<string, TinyGoRuntimeClosureAsset>;
}

function expectObject(value: unknown, label: string): JsonObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonObject;
}

function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

function expectSha256(value: unknown, label: string) {
	const hash = expectString(value, label);
	if (!SHA256_PATTERN.test(hash)) throw new Error(`${label} must be a lowercase SHA-256`);
	return hash;
}

function expectBytes(value: unknown, label: string) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative safe integer`);
	}
	return value;
}

function expectExactKeys(value: JsonObject, expected: readonly string[], label: string) {
	const actual = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	if (
		actual.length !== sortedExpected.length ||
		actual.some((key, index) => key !== sortedExpected[index])
	) {
		throw new Error(`${label} must contain exactly ${sortedExpected.join(', ')}`);
	}
}

function parseRuntimeAssetReceipt(value: unknown, label: string): TinyGoRuntimeAssetReceipt {
	const receipt = expectObject(value, label);
	const hasUncompressedBytes = receipt.uncompressedBytes !== undefined;
	const hasUncompressedSha256 = receipt.uncompressedSha256 !== undefined;
	if (hasUncompressedBytes !== hasUncompressedSha256) {
		throw new Error(`${label} requires both uncompressedBytes and uncompressedSha256`);
	}
	expectExactKeys(
		receipt,
		hasUncompressedBytes
			? ['bytes', 'sha256', 'uncompressedBytes', 'uncompressedSha256']
			: ['bytes', 'sha256'],
		label
	);
	return {
		bytes: expectBytes(receipt.bytes, `${label}.bytes`),
		sha256: expectSha256(receipt.sha256, `${label}.sha256`),
		...(hasUncompressedBytes
			? {
					uncompressedBytes: expectBytes(
						receipt.uncompressedBytes,
						`${label}.uncompressedBytes`
					),
					uncompressedSha256: expectSha256(
						receipt.uncompressedSha256,
						`${label}.uncompressedSha256`
					)
				}
			: {})
	};
}

export function parseTinyGoUpstreamRuntimeProfile(value: unknown): TinyGoUpstreamRuntimeProfile {
	const profile = expectObject(value, 'TinyGo upstream runtime profile');
	expectExactKeys(
		profile,
		[
			'profileId',
			'protocolVersion',
			'manifestPath',
			'manifestFingerprint',
			'manifestReceipt',
			'assetReceipts'
		],
		'TinyGo upstream runtime profile'
	);
	const profileId = expectString(profile.profileId, 'TinyGo upstream runtime profile.profileId');
	if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(profileId)) {
		throw new Error('TinyGo upstream runtime profile.profileId is invalid');
	}
	const protocolVersion = profile.protocolVersion;
	if (
		typeof protocolVersion !== 'number' ||
		!Number.isInteger(protocolVersion) ||
		protocolVersion < 1 ||
		protocolVersion > 6
	) {
		throw new Error('TinyGo upstream runtime profile.protocolVersion is unsupported');
	}
	const manifestPath = parseAssetEvidence(
		{
			path: profile.manifestPath,
			bytes: 0,
			sha256: '0'.repeat(64)
		},
		'TinyGo upstream runtime profile.manifest'
	).path;
	const assetReceiptsValue = expectObject(
		profile.assetReceipts,
		'TinyGo upstream runtime profile.assetReceipts'
	);
	const assetReceipts: Record<string, TinyGoRuntimeAssetReceipt> = {};
	for (const [assetPath, receiptValue] of Object.entries(assetReceiptsValue)) {
		const safePath = parseAssetEvidence(
			{ path: assetPath, bytes: 0, sha256: '0'.repeat(64) },
			`TinyGo upstream runtime profile.assetReceipts[${assetPath}]`
		).path;
		assetReceipts[safePath] = Object.freeze(
			parseRuntimeAssetReceipt(
				receiptValue,
				`TinyGo upstream runtime profile.assetReceipts[${assetPath}]`
			)
		);
	}
	if (Object.keys(assetReceipts).length === 0) {
		throw new Error('TinyGo upstream runtime profile.assetReceipts must not be empty');
	}
	return Object.freeze({
		profileId,
		protocolVersion: protocolVersion as TinyGoCompileProtocolVersion,
		manifestPath,
		manifestFingerprint: expectSha256(
			profile.manifestFingerprint,
			'TinyGo upstream runtime profile.manifestFingerprint'
		),
		manifestReceipt: Object.freeze(
			parseRuntimeAssetReceipt(
				profile.manifestReceipt,
				'TinyGo upstream runtime profile.manifestReceipt'
			)
		),
		assetReceipts: Object.freeze(assetReceipts)
	});
}

function runtimeProfileCanonicalBytes(profile: TinyGoUpstreamRuntimeProfile) {
	let canonical = `${TINYGO_RUNTIME_PROFILE_FORMAT}\n`;
	canonical += `profile\0${profile.profileId}\0${profile.protocolVersion}\n`;
	canonical += `manifest\0${profile.manifestPath}\0${profile.manifestReceipt.bytes}\0${profile.manifestReceipt.sha256}\n`;
	for (const assetPath of Object.keys(profile.assetReceipts).sort()) {
		const receipt = profile.assetReceipts[assetPath];
		const logicalBytes = receipt.uncompressedBytes ?? receipt.bytes;
		const logicalSha256 = receipt.uncompressedSha256 ?? receipt.sha256;
		const storagePath = receipt.uncompressedSha256 ? `${assetPath}.gz` : assetPath;
		canonical += `asset\0${assetPath}\0${storagePath}\0${receipt.bytes}\0${receipt.sha256}\0${logicalBytes}\0${logicalSha256}\n`;
	}
	return new TextEncoder().encode(canonical);
}

export async function computeTinyGoRuntimeProfileFingerprint(profile: unknown) {
	return await sha256TinyGoBytes(
		runtimeProfileCanonicalBytes(parseTinyGoUpstreamRuntimeProfile(profile))
	);
}

function resolveManifestEvidencePath(manifestPath: string, evidencePath: string) {
	const separator = manifestPath.lastIndexOf('/');
	const directory = separator === -1 ? '' : manifestPath.slice(0, separator + 1);
	return `${directory}${evidencePath}`;
}

export async function verifyTinyGoUpstreamRuntimeProfile(options: {
	profile: unknown;
	manifestBytes: Uint8Array;
	manifest: unknown;
}) {
	const profile = parseTinyGoUpstreamRuntimeProfile(options.profile);
	if (options.manifestBytes.byteLength !== profile.manifestReceipt.bytes) {
		throw new Error('TinyGo upstream manifest byte length differs from its runtime profile');
	}
	if ((await sha256TinyGoBytes(options.manifestBytes)) !== profile.manifestReceipt.sha256) {
		throw new Error('TinyGo upstream manifest SHA-256 differs from its runtime profile');
	}
	if ((await computeTinyGoRuntimeProfileFingerprint(profile)) !== profile.manifestFingerprint) {
		throw new Error('TinyGo upstream runtime profile fingerprint differs from its receipts');
	}
	const manifest = parseTinyGoUpstreamAssetManifest(options.manifest);
	const evidence = [
		manifest.producerReceipt,
		manifest.packageGraphReceipt,
		manifest.assets.compiler,
		manifest.assets.packageGraph,
		manifest.assets.rootArchive,
		manifest.assets.lld
	];
	const expectedPaths = new Set<string>();
	for (const entry of evidence) {
		const assetPath = resolveManifestEvidencePath(profile.manifestPath, entry.path);
		if (expectedPaths.has(assetPath)) {
			throw new Error(`TinyGo upstream manifest repeats ${assetPath}`);
		}
		expectedPaths.add(assetPath);
		const receipt = profile.assetReceipts[assetPath];
		if (!receipt) {
			throw new Error(`TinyGo upstream runtime profile does not declare ${assetPath}`);
		}
		if (
			(receipt.uncompressedBytes ?? receipt.bytes) !== entry.bytes ||
			(receipt.uncompressedSha256 ?? receipt.sha256) !== entry.sha256
		) {
			throw new Error(
				`TinyGo upstream runtime profile differs from the manifest for ${assetPath}`
			);
		}
	}
	for (const assetPath of Object.keys(profile.assetReceipts)) {
		if (!expectedPaths.has(assetPath)) {
			throw new Error(
				`TinyGo upstream runtime profile contains unexpected asset ${assetPath}`
			);
		}
	}
	return { profile, manifest };
}

function parseAssetEvidence(value: unknown, label: string): TinyGoUpstreamAssetEvidence {
	const object = expectObject(value, label);
	const assetPath = expectString(object.path, `${label}.path`);
	if (
		assetPath.startsWith('/') ||
		assetPath.includes('\\') ||
		assetPath.includes('\0') ||
		assetPath.split('/').some((part) => part === '' || part === '.' || part === '..')
	) {
		throw new Error(`${label}.path must be a safe relative path`);
	}
	return {
		path: assetPath,
		bytes: expectBytes(object.bytes, `${label}.bytes`),
		sha256: expectSha256(object.sha256, `${label}.sha256`)
	};
}

export async function sha256TinyGoBytes(bytes: Uint8Array) {
	if (!globalThis.crypto?.subtle)
		throw new Error('upstream TinyGo verification requires Web Crypto');
	const digestInput =
		bytes.buffer instanceof ArrayBuffer
			? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
			: Uint8Array.from(bytes);
	const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput);
	return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function parseTinyGoUpstreamAssetManifest(value: unknown): TinyGoUpstreamAssetManifest {
	const root = expectObject(value, 'TinyGo upstream asset manifest');
	if (root.schemaVersion !== 2)
		throw new Error('unsupported TinyGo upstream asset schema version');
	if (root.format !== TINYGO_UPSTREAM_ASSET_MANIFEST_FORMAT) {
		throw new Error('unexpected TinyGo upstream asset manifest format');
	}
	const assets = expectObject(root.assets, 'TinyGo upstream asset manifest.assets');
	const lldObject = expectObject(assets.lld, 'TinyGo upstream asset manifest.assets.lld');
	const lld = parseAssetEvidence(lldObject, 'TinyGo upstream asset manifest.assets.lld');
	const sourceArchiveSha256 =
		lldObject.sourceArchiveSha256 === undefined
			? undefined
			: expectSha256(
					lldObject.sourceArchiveSha256,
					'TinyGo upstream asset manifest.assets.lld.sourceArchiveSha256'
				);
	return {
		schemaVersion: 2,
		format: TINYGO_UPSTREAM_ASSET_MANIFEST_FORMAT,
		producerReceipt: parseAssetEvidence(
			root.producerReceipt,
			'TinyGo upstream asset manifest.producerReceipt'
		),
		packageGraphReceipt: parseAssetEvidence(
			root.packageGraphReceipt,
			'TinyGo upstream asset manifest.packageGraphReceipt'
		),
		assets: {
			compiler: parseAssetEvidence(
				assets.compiler,
				'TinyGo upstream asset manifest.assets.compiler'
			),
			packageGraph: parseAssetEvidence(
				assets.packageGraph,
				'TinyGo upstream asset manifest.assets.packageGraph'
			),
			rootArchive: parseAssetEvidence(
				assets.rootArchive,
				'TinyGo upstream asset manifest.assets.rootArchive'
			),
			lld: { ...lld, ...(sourceArchiveSha256 ? { sourceArchiveSha256 } : {}) }
		}
	};
}

async function verifyAsset(
	label: string,
	evidence: TinyGoUpstreamAssetEvidence,
	bytes: Uint8Array
) {
	if (bytes.byteLength !== evidence.bytes) {
		throw new Error(`${label} byte length differs from its manifest`);
	}
	if ((await sha256TinyGoBytes(bytes)) !== evidence.sha256) {
		throw new Error(`${label} SHA-256 differs from its manifest`);
	}
}

export async function verifyTinyGoUpstreamAssetSet(options: {
	manifest: unknown;
	producerReceipt: Uint8Array;
	packageGraphReceipt: Uint8Array;
	compiler: Uint8Array;
	packageGraph: Uint8Array;
	rootArchive: Uint8Array;
	lld: Uint8Array;
}) {
	const manifest = parseTinyGoUpstreamAssetManifest(options.manifest);
	await Promise.all([
		verifyAsset('TinyGo producer receipt', manifest.producerReceipt, options.producerReceipt),
		verifyAsset(
			'TinyGo package-graph producer receipt',
			manifest.packageGraphReceipt,
			options.packageGraphReceipt
		),
		verifyAsset('TinyGo compiler', manifest.assets.compiler, options.compiler),
		verifyAsset(
			'TinyGo package-graph provider',
			manifest.assets.packageGraph,
			options.packageGraph
		),
		verifyAsset('TinyGo root archive', manifest.assets.rootArchive, options.rootArchive),
		verifyAsset('raw WASI LLD', manifest.assets.lld, options.lld)
	]);

	let receiptValue: unknown;
	try {
		receiptValue = JSON.parse(new TextDecoder().decode(options.producerReceipt));
	} catch (error) {
		throw new Error('TinyGo producer receipt is not valid JSON', { cause: error });
	}
	const receipt = expectObject(receiptValue, 'TinyGo producer receipt');
	let compileProtocolVersion: TinyGoCompileProtocolVersion;
	if (
		receipt.schemaVersion === 1 &&
		receipt.format === TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V1
	) {
		compileProtocolVersion = 1;
	} else if (
		receipt.schemaVersion === 2 &&
		receipt.format === TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V2
	) {
		compileProtocolVersion = 2;
	} else if (
		receipt.schemaVersion === 3 &&
		receipt.format === TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V3
	) {
		compileProtocolVersion = 3;
	} else if (
		receipt.schemaVersion === 4 &&
		receipt.format === TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V4
	) {
		compileProtocolVersion = 4;
	} else if (
		receipt.schemaVersion === 5 &&
		receipt.format === TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V5
	) {
		compileProtocolVersion = 5;
	} else if (
		receipt.schemaVersion === 6 &&
		receipt.format === TINYGO_UPSTREAM_COMPILER_RECEIPT_FORMAT_V6
	) {
		compileProtocolVersion = 6;
	} else {
		throw new Error('unexpected TinyGo producer receipt format');
	}
	if (receipt.producerId !== 'wasm-llvm/tinygo-browser') {
		throw new Error('unexpected TinyGo producer identity');
	}
	const verification = expectObject(receipt.verification, 'TinyGo producer receipt.verification');
	if (
		verification.status !== 'passed' ||
		verification.identityMode !== 'upstream-package-graph'
	) {
		throw new Error(
			'TinyGo producer receipt has not passed upstream-package-graph verification'
		);
	}
	const acceptance = expectObject(verification.acceptance, 'TinyGo producer acceptance');
	if (acceptance.status !== 'passed')
		throw new Error('TinyGo producer acceptance has not passed');
	const build = expectObject(receipt.build, 'TinyGo producer receipt.build');
	if (compileProtocolVersion >= 2) {
		const compileProtocol = expectObject(
			build.compileProtocol,
			'TinyGo producer receipt.build.compileProtocol'
		);
		const expectedCapabilities =
			compileProtocolVersion === 2
				? ['go-embed-objects']
				: compileProtocolVersion === 3
					? ['go-embed-objects', 'target-cgo-c']
					: compileProtocolVersion === 4
						? [
								'go-embed-objects',
								'target-cgo-c',
								'target-cxx-freestanding',
								'target-clang-assembly'
							]
						: compileProtocolVersion === 5
							? [
									'go-embed-objects',
									'target-cgo-c',
									'target-cxx-hosted-noeh',
									'target-clang-assembly'
								]
							: [
									'go-embed-objects',
									'target-cgo-c',
									'target-cxx-hosted-noeh',
									'target-clang-assembly',
									'target-cgo-cxxflags',
									'target-cgo-linker-flags'
								];
		if (
			compileProtocol.version !== compileProtocolVersion ||
			compileProtocol.format !== `wasm-llvm-tinygo-link-plan-v${compileProtocolVersion}` ||
			JSON.stringify(compileProtocol.capabilities) !== JSON.stringify(expectedCapabilities) ||
			JSON.stringify(build.compileOutputs) !== JSON.stringify(['objects', 'link-plan.json'])
		) {
			throw new Error(
				`TinyGo producer receipt compile protocol differs from v${compileProtocolVersion}`
			);
		}
		if (compileProtocolVersion >= 5) {
			const rootArchive = expectObject(
				build.rootArchive,
				'TinyGo producer receipt.build.rootArchive'
			);
			if (rootArchive.runtimeClosureFormat !== TINYGO_RUNTIME_CLOSURE_FORMAT) {
				throw new Error('TinyGo producer receipt does not bind runtime closure v2');
			}
		}
	}
	if (
		build.hostTarget !== 'wasm32-wasip1' ||
		build.cgoEnabled !== true ||
		build.llvmLinkage !== 'in-process-c-api' ||
		build.hostCompileFallback !== false
	) {
		throw new Error(
			'TinyGo producer build identity is not the upstream WASI compiler contract'
		);
	}
	const entrypoint = expectObject(build.entrypoint, 'TinyGo producer receipt.build.entrypoint');
	if (
		entrypoint.mode !== 'upstream-compiler-adapter' ||
		entrypoint.upstreamModule !== 'github.com/tinygo-org/tinygo'
	) {
		throw new Error('TinyGo producer entrypoint is not the upstream compiler adapter');
	}
	const packageGraph = build.packageGraph;
	if (
		!Array.isArray(packageGraph) ||
		TINYGO_UPSTREAM_COMPILER_PACKAGES.some((name) => !packageGraph.includes(name))
	) {
		throw new Error('TinyGo producer receipt is missing required upstream compiler packages');
	}
	const serializedReceipt = JSON.stringify(receipt);
	for (const forbidden of [
		'/wasmbridge/',
		'cmd/tinygo-wasi',
		'tinygobackend',
		'tinygofrontend'
	]) {
		if (serializedReceipt.includes(forbidden)) {
			throw new Error(
				`TinyGo producer receipt contains forbidden subset identity ${forbidden}`
			);
		}
	}
	if (!Array.isArray(receipt.assets))
		throw new Error('TinyGo producer receipt.assets must be an array');
	for (const [path, evidence] of [
		['tinygo-compiler.wasm', manifest.assets.compiler],
		['tinygoroot.tar.gz', manifest.assets.rootArchive]
	] as const) {
		const asset = receipt.assets.find((value): value is JsonObject =>
			Boolean(
				value && typeof value === 'object' && !Array.isArray(value) && value.path === path
			)
		);
		if (!asset || asset.bytes !== evidence.bytes || asset.sha256 !== evidence.sha256) {
			throw new Error(`TinyGo producer receipt does not bind ${path}`);
		}
	}

	let packageGraphReceiptValue: unknown;
	try {
		packageGraphReceiptValue = JSON.parse(
			new TextDecoder().decode(options.packageGraphReceipt)
		);
	} catch (error) {
		throw new Error('TinyGo package-graph producer receipt is not valid JSON', {
			cause: error
		});
	}
	const packageGraphReceipt = expectObject(
		packageGraphReceiptValue,
		'TinyGo package-graph producer receipt'
	);
	if (
		(packageGraphReceipt.format !== TINYGO_UPSTREAM_PACKAGE_GRAPH_RECEIPT_FORMAT &&
			packageGraphReceipt.format !== TINYGO_UPSTREAM_PACKAGE_GRAPH_RECEIPT_FORMAT_V1) ||
		packageGraphReceipt.producerId !== 'wasm-llvm/tinygo-browser/package-graph' ||
		packageGraphReceipt.status !== 'passed'
	) {
		throw new Error('TinyGo package-graph producer receipt is not passed upstream cmd/go');
	}
	const graphUpstream = expectObject(
		packageGraphReceipt.upstream,
		'TinyGo package-graph producer receipt.upstream'
	);
	const graphIdentityPackages = graphUpstream.identityPackages;
	if (
		graphUpstream.module !== 'golang.org/toolchain' ||
		graphUpstream.version !== TINYGO_GO_VERSION ||
		graphUpstream.entrypoint !== 'cmd/go' ||
		!Array.isArray(graphIdentityPackages) ||
		TINYGO_UPSTREAM_PACKAGE_GRAPH_PACKAGES.some((name) => !graphIdentityPackages.includes(name))
	) {
		throw new Error('TinyGo package-graph receipt does not identify pinned upstream cmd/go');
	}
	const graphProtocol = expectObject(
		packageGraphReceipt.protocol,
		'TinyGo package-graph producer receipt.protocol'
	);
	const expectedGraphArguments = [
		`-json=${TINYGO_UPSTREAM_PACKAGE_GRAPH_FIELDS.join(',')}`,
		'-deps',
		'-e',
		'-mod=readonly',
		`-tags=${TINYGO_UPSTREAM_PACKAGE_GRAPH_TAGS.join(' ')}`,
		'.'
	];
	const expectedVendorArguments = expectedGraphArguments.map((argument) =>
		argument === '-mod=readonly' ? '-mod=vendor' : argument
	);
	const graphArguments = graphProtocol.arguments;
	if (
		graphProtocol.command !== 'list' ||
		!Array.isArray(graphArguments) ||
		graphArguments.length !== expectedGraphArguments.length ||
		expectedGraphArguments.some((argument, index) => graphArguments[index] !== argument) ||
		graphProtocol.maxBytes !== MAX_PACKAGE_JSON_BYTES ||
		graphProtocol.maxPackages !== MAX_PACKAGE_COUNT
	) {
		throw new Error('TinyGo package-graph receipt protocol differs from browser protocol v1');
	}
	if (packageGraphReceipt.format === TINYGO_UPSTREAM_PACKAGE_GRAPH_RECEIPT_FORMAT) {
		const argumentsByModuleMode = expectObject(
			graphProtocol.argumentsByModuleMode,
			'TinyGo package-graph producer receipt.protocol.argumentsByModuleMode'
		);
		if (
			JSON.stringify(graphProtocol.moduleModes) !== JSON.stringify(['readonly', 'vendor']) ||
			JSON.stringify(argumentsByModuleMode.readonly) !==
				JSON.stringify(expectedGraphArguments) ||
			JSON.stringify(argumentsByModuleMode.vendor) !== JSON.stringify(expectedVendorArguments)
		) {
			throw new Error('TinyGo package-graph receipt does not bind offline vendor mode');
		}
	}
	const graphEnvironment = expectObject(
		graphProtocol.environment,
		'TinyGo package-graph producer receipt.protocol.environment'
	);
	for (const [name, expected] of Object.entries({
		GOOS: 'wasip1',
		GOARCH: 'wasm',
		CGO_ENABLED: '1',
		GOTOOLCHAIN: 'local',
		GOPROXY: 'off',
		GOSUMDB: 'off',
		GOVCS: 'off',
		GOENV: 'off'
	})) {
		if (graphEnvironment[name] !== expected) {
			throw new Error(`TinyGo package-graph receipt has unexpected ${name}`);
		}
	}
	const graphAcceptance = expectObject(
		packageGraphReceipt.acceptance,
		'TinyGo package-graph producer receipt.acceptance'
	);
	if (
		graphAcceptance.status !== 'passed' ||
		graphAcceptance.comparison !== 'same-pinned-native-cmd-go-exact-json'
	) {
		throw new Error('TinyGo package-graph producer acceptance has not passed exact parity');
	}
	if (!Array.isArray(packageGraphReceipt.assets)) {
		throw new Error('TinyGo package-graph producer receipt.assets must be an array');
	}
	const graphAsset = packageGraphReceipt.assets.find((value): value is JsonObject =>
		Boolean(
			value &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			value.path === 'tinygo-package-graph.wasm'
		)
	);
	if (
		!graphAsset ||
		graphAsset.bytes !== manifest.assets.packageGraph.bytes ||
		graphAsset.sha256 !== manifest.assets.packageGraph.sha256
	) {
		throw new Error('TinyGo package-graph receipt does not bind tinygo-package-graph.wasm');
	}
	return { manifest, receipt, packageGraphReceipt, compileProtocolVersion };
}

export function parseConcatenatedTinyGoPackageJSON(source: string) {
	if (new TextEncoder().encode(source).byteLength > MAX_PACKAGE_JSON_BYTES) {
		throw new Error(`TinyGo package JSON exceeds the ${MAX_PACKAGE_JSON_BYTES} byte limit`);
	}
	const values: JsonObject[] = [];
	let index = 0;
	while (index < source.length) {
		while (/\s/u.test(source[index] ?? '')) index += 1;
		if (index >= source.length) break;
		if (source[index] !== '{')
			throw new Error(`TinyGo package JSON value ${values.length} is not an object`);
		const start = index;
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (; index < source.length; index += 1) {
			const character = source[index];
			if (inString) {
				if (escaped) escaped = false;
				else if (character === '\\') escaped = true;
				else if (character === '"') inString = false;
				continue;
			}
			if (character === '"') inString = true;
			else if (character === '{') depth += 1;
			else if (character === '}') {
				depth -= 1;
				if (depth === 0) {
					index += 1;
					const parsed: unknown = JSON.parse(source.slice(start, index));
					values.push(expectObject(parsed, `TinyGo package JSON value ${values.length}`));
					break;
				}
			}
		}
		if (depth !== 0 || inString) throw new Error('TinyGo package JSON is truncated');
		if (values.length > MAX_PACKAGE_COUNT) {
			throw new Error(`TinyGo package JSON exceeds the ${MAX_PACKAGE_COUNT} package limit`);
		}
	}
	if (values.length === 0) throw new Error('TinyGo package JSON contains no packages');
	return values;
}

function replacePackagePath(
	value: unknown,
	mappings: ReadonlyArray<{ from: string; to: string }>
): unknown {
	if (typeof value === 'string') {
		for (const mapping of mappings) {
			if (value === mapping.from) return mapping.to;
			if (value.startsWith(`${mapping.from}/`))
				return `${mapping.to}${value.slice(mapping.from.length)}`;
		}
		return value;
	}
	if (Array.isArray(value)) return value.map((entry) => replacePackagePath(entry, mappings));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, replacePackagePath(entry, mappings)])
		);
	}
	return value;
}

export function normalizeTinyGoPackageJSON(
	source: string,
	mappings: ReadonlyArray<{ from: string; to: string }>
) {
	const normalizedMappings = mappings
		.map((mapping) => {
			if (!mapping.from.startsWith('/') || !mapping.to.startsWith('/')) {
				throw new Error('TinyGo package path mappings must use absolute POSIX paths');
			}
			return {
				from: mapping.from.replace(/\/$/u, ''),
				to: mapping.to.replace(/\/$/u, '')
			};
		})
		.sort((left, right) => right.from.length - left.from.length);
	return parseConcatenatedTinyGoPackageJSON(source)
		.map((value) => JSON.stringify(replacePackagePath(value, normalizedMappings)))
		.join('\n')
		.concat('\n');
}

function isGuestPathInside(path: string, root: string) {
	return path === root || path.startsWith(`${root}/`);
}

function inspectAbsoluteStrings(value: unknown, visit: (value: string) => void) {
	if (typeof value === 'string') {
		if (value.startsWith('/')) visit(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const entry of value) inspectAbsoluteStrings(entry, visit);
		return;
	}
	if (value && typeof value === 'object') {
		for (const entry of Object.values(value)) inspectAbsoluteStrings(entry, visit);
	}
}

function relativeGuestPath(path: string, root: string) {
	return path === root ? '' : path.slice(root.length + 1);
}

export function validateTinyGoPackageJSON(options: {
	packageJSON: string;
	root: TinyGoWasiDirectoryContents;
	workspace: TinyGoWasiDirectoryContents;
	compileProtocolVersion?: TinyGoCompileProtocolVersion;
}) {
	const compileProtocolVersion = options.compileProtocolVersion ?? 1;
	const packages = parseConcatenatedTinyGoPackageJSON(options.packageJSON);
	const importPaths = new Set<string>();
	const packageImports = new Map<string, string[]>();
	const cgoImportPaths = new Set<string>();
	let workspacePackages = 0;
	for (const [index, pkg] of packages.entries()) {
		const importPath = expectString(pkg.ImportPath, `TinyGo package ${index}.ImportPath`);
		if (pkg.Error !== undefined && pkg.Error !== null) {
			const packageError = expectObject(pkg.Error, `TinyGo package ${importPath}.Error`);
			const detail =
				typeof packageError.Err === 'string' && packageError.Err.length > 0
					? `: ${packageError.Err}`
					: '';
			throw new Error(`TinyGo package discovery failed for ${importPath}${detail}`);
		}
		if (importPaths.has(importPath)) throw new Error(`duplicate TinyGo package ${importPath}`);
		importPaths.add(importPath);
		const directory = expectString(pkg.Dir, `TinyGo package ${importPath}.Dir`);
		const inRoot = isGuestPathInside(directory, TINYGO_ROOT_PATH);
		const inWorkspace = isGuestPathInside(directory, TINYGO_WORKSPACE_PATH);
		if (!inRoot && !inWorkspace) {
			throw new Error(
				`TinyGo package ${importPath} escapes the root and workspace preopens: ${directory}`
			);
		}
		if (inWorkspace) workspacePackages += 1;
		const directoryRoot = inRoot ? TINYGO_ROOT_PATH : TINYGO_WORKSPACE_PATH;
		const vfsRoot = inRoot ? options.root : options.workspace;
		const packageDirectory = relativeGuestPath(directory, directoryRoot);
		if (packageDirectory && !hasTinyGoVfsPath(vfsRoot, packageDirectory, 'directory')) {
			throw new Error(`TinyGo package ${importPath} references a missing package directory`);
		}
		inspectAbsoluteStrings(pkg, (absolutePath) => {
			if (
				!isGuestPathInside(absolutePath, TINYGO_ROOT_PATH) &&
				!isGuestPathInside(absolutePath, TINYGO_WORKSPACE_PATH)
			) {
				throw new Error(
					`TinyGo package ${importPath} contains an unpreopened path: ${absolutePath}`
				);
			}
		});
		const imports = pkg.Imports ?? [];
		if (
			!Array.isArray(imports) ||
			imports.some((dependency) => typeof dependency !== 'string')
		) {
			throw new Error(`TinyGo package ${importPath}.Imports must be a string array`);
		}
		packageImports.set(importPath, imports as string[]);
		for (const field of PACKAGE_FLAG_FIELDS) {
			const flagValues = pkg[field] ?? [];
			if (
				!Array.isArray(flagValues) ||
				flagValues.length > 256 ||
				flagValues.some(
					(flag) =>
						typeof flag !== 'string' ||
						flag.length === 0 ||
						flag.length > 4096 ||
						flag.includes('\0')
				)
			) {
				throw new Error(
					`TinyGo package ${importPath}.${field} must be a bounded string array`
				);
			}
			if (flagValues.length > 0 && compileProtocolVersion < 6) {
				throw new Error(
					`TinyGo package ${importPath} uses ${field.replace('Cgo', '')}, unsupported until compile protocol v6`
				);
			}
		}
		for (const field of SOURCE_FILE_FIELDS) {
			const fileValues = pkg[field] ?? [];
			if (
				!Array.isArray(fileValues) ||
				fileValues.some((file: unknown) => typeof file !== 'string')
			) {
				throw new Error(`TinyGo package ${importPath}.${field} must be a string array`);
			}
			const files = fileValues as string[];
			if (field === 'CgoFiles' && files.length > 0) cgoImportPaths.add(importPath);
			if (field === 'CXXFiles' && files.length > 0 && compileProtocolVersion < 4) {
				throw new Error(
					`TinyGo package ${importPath} uses C++ files, unsupported until compile protocol v4`
				);
			}
			if (
				(field === 'CgoFiles' || field === 'CFiles') &&
				files.length > 0 &&
				compileProtocolVersion < 3
			) {
				throw new Error(
					`TinyGo package ${importPath} uses target CGo/C files, unsupported until compile protocol v3`
				);
			}
			if (field === 'SFiles' && files.length > 0 && !inRoot) {
				if (compileProtocolVersion < 4) {
					throw new Error(
						`TinyGo package ${importPath} uses workspace assembly files, unsupported until compile protocol v4`
					);
				}
				if (!cgoImportPaths.has(importPath)) {
					throw new Error(
						`TinyGo package ${importPath} uses workspace assembly outside a CGo package`
					);
				}
				if (files.some((file) => !file.endsWith('.S'))) {
					throw new Error(
						`TinyGo package ${importPath} uses non-Clang workspace assembly; compile protocol v4 requires uppercase .S files`
					);
				}
			}
			if (field === 'EmbedFiles' && files.length > 0 && compileProtocolVersion === 1) {
				throw new Error(
					`TinyGo package ${importPath} uses go:embed files, unsupported until compile protocol v2 publishes TinyGo's generated embed objects`
				);
			}
			for (const file of files) {
				if (
					file.length === 0 ||
					file.startsWith('/') ||
					file.includes('\\') ||
					file.split('/').some((part) => part === '' || part === '.' || part === '..')
				) {
					throw new Error(`TinyGo package ${importPath} has an unsafe ${field} entry`);
				}
				const relativeFile = packageDirectory ? `${packageDirectory}/${file}` : file;
				if (!hasTinyGoVfsPath(vfsRoot, relativeFile, 'file')) {
					throw new Error(
						`TinyGo package ${importPath} references a missing ${field} file: ${relativeFile}`
					);
				}
			}
		}
	}
	if (workspacePackages === 0) {
		throw new Error('TinyGo package JSON must contain at least one workspace package');
	}
	for (const [importPath, imports] of packageImports) {
		for (const dependency of imports) {
			if (dependency === 'C' && cgoImportPaths.has(importPath)) continue;
			if (!importPaths.has(dependency)) {
				throw new Error(
					`TinyGo package ${importPath} references missing dependency ${dependency}`
				);
			}
		}
	}
	return packages;
}

function parseRuntimeAsset(value: unknown, label: string): TinyGoRuntimeClosureAsset {
	const object = expectObject(value, label);
	const evidence = parseAssetEvidence(object, label);
	return {
		...evidence,
		id: expectString(object.id, `${label}.id`),
		format: expectString(object.format, `${label}.format`),
		...(object.source === undefined
			? {}
			: { source: expectString(object.source, `${label}.source`) })
	};
}

export function parseTinyGoRuntimeClosure(
	value: unknown,
	compilerSha256: string
): TinyGoRuntimeClosure {
	const root = expectObject(value, 'TinyGo runtime closure');
	if (
		root.schemaVersion !== 1 ||
		(root.format !== TINYGO_RUNTIME_CLOSURE_FORMAT &&
			root.format !== TINYGO_RUNTIME_CLOSURE_FORMAT_V1)
	) {
		throw new Error('unexpected TinyGo runtime closure format');
	}
	if (root.compilerSha256 !== compilerSha256) {
		throw new Error('TinyGo runtime closure compiler hash differs from the loaded compiler');
	}
	const profile = expectObject(root.profile, 'TinyGo runtime closure.profile');
	if (
		profile.id !== TINYGO_RUNTIME_PROFILE_ID ||
		profile.target !== 'wasip1' ||
		profile.opt !== '1' ||
		profile.gc !== 'precise' ||
		profile.panicStrategy !== 'print' ||
		profile.scheduler !== 'asyncify' ||
		profile.debug !== false ||
		profile.parallelism !== 1
	) {
		throw new Error('TinyGo runtime closure profile differs from compile protocol v1');
	}
	const extraFilesObject = expectObject(root.extraFiles, 'TinyGo runtime closure.extraFiles');
	const extraFiles = Object.fromEntries(
		Object.entries(extraFilesObject).map(([source, asset]) => [
			source,
			parseRuntimeAsset(asset, `TinyGo runtime closure.extraFiles[${JSON.stringify(source)}]`)
		])
	);
	if (Object.keys(extraFiles).length !== 3) {
		throw new Error('TinyGo runtime closure must contain exactly three extra files');
	}
	const hostedCxx = root.format === TINYGO_RUNTIME_CLOSURE_FORMAT;
	const libCxx = hostedCxx
		? parseRuntimeAsset(root.libCxx, 'TinyGo runtime closure.libCxx')
		: undefined;
	const libCxxAbi = hostedCxx
		? parseRuntimeAsset(root.libCxxAbi, 'TinyGo runtime closure.libCxxAbi')
		: undefined;
	if (
		hostedCxx &&
		(libCxx?.id !== 'libcxx' ||
			libCxx.format !== 'static-archive' ||
			libCxxAbi?.id !== 'libcxxabi' ||
			libCxxAbi.format !== 'static-archive')
	) {
		throw new Error('TinyGo runtime closure hosted C++ archives are invalid');
	}
	return {
		schemaVersion: 1,
		format: root.format as TinyGoRuntimeClosure['format'],
		compilerSha256,
		profile: {
			id: TINYGO_RUNTIME_PROFILE_ID,
			target: 'wasip1',
			opt: '1',
			gc: 'precise',
			panicStrategy: 'print',
			scheduler: 'asyncify',
			debug: false,
			parallelism: 1
		},
		compilerRT: parseRuntimeAsset(root.compilerRT, 'TinyGo runtime closure.compilerRT'),
		wasiLibc: parseRuntimeAsset(root.wasiLibc, 'TinyGo runtime closure.wasiLibc'),
		...(libCxx && libCxxAbi ? { libCxx, libCxxAbi } : {}),
		extraFiles
	};
}
