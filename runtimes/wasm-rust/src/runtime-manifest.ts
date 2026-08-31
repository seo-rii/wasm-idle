import { resolveVersionedAssetUrl } from './asset-url.js';
import {
	fetchRuntimeAssetBytes,
	registerRuntimeAssetReceipts,
	type RuntimeAssetDownloadProgress,
	type RuntimeAssetReceipt
} from './runtime-asset.js';
import type {
	BrowserRustArtifactFormat,
	RuntimeAssetDeliveryBudgetDescriptor,
	RuntimeRustCompilerProvenance,
	SupportedTargetTriple
} from './types.js';

export interface RuntimeAssetFile {
	asset: string;
	runtimePath: string;
}

export interface RuntimeAssetPackDeltaReference {
	format: 'copy-literal-v1';
	base: RuntimeAssetPackReference;
}

export interface RuntimeAssetPackReference {
	asset: string;
	index: string;
	fileCount: number;
	totalBytes: number;
	decodedTotalBytes?: number;
	delta?: RuntimeAssetPackDeltaReference;
}

export interface RuntimeCompilerConfig {
	rustcWasm: string;
	workerBitcodeFile: string;
	workerSharedOutputBytes: number;
	workerSharedWorkspaceBytes: number;
	compileTimeoutMs: number;
	artifactIdleMs: number;
	rustcMemory: {
		initialPages: number;
		maximumPages: number;
	};
}

export interface RuntimeLinkConfig {
	args: string[];
	allocatorObjectRuntimePath?: string;
	allocatorObjectAsset?: string;
	files?: RuntimeAssetFile[];
	pack?: RuntimeAssetPackReference;
}

export interface RuntimeLlvmCompileConfig {
	kind: 'llvm-wasm' | 'llvm-wasm+component-encoder';
	llvm: {
		llc: string;
		llcWasm?: string;
		lld: string;
		lldWasm?: string;
		lldData?: string;
	};
	link: RuntimeLinkConfig;
}

export interface RuntimeIntegratedCompileConfig {
	kind: 'integrated-rustc' | 'integrated-rustc+component-encoder';
}

export type RuntimeTargetCompileConfig = RuntimeLlvmCompileConfig | RuntimeIntegratedCompileConfig;

export function isIntegratedCompilerOutput(
	compile: RuntimeTargetCompileConfig
): compile is RuntimeIntegratedCompileConfig {
	return (
		compile.kind === 'integrated-rustc' || compile.kind === 'integrated-rustc+component-encoder'
	);
}

export interface RuntimeTargetExecutionConfig {
	kind: 'preview1' | 'preview2-component';
}

export interface RuntimeTargetConfig {
	targetTriple: SupportedTargetTriple;
	artifactFormat: BrowserRustArtifactFormat;
	sysrootFiles?: RuntimeAssetFile[];
	sysrootPack?: RuntimeAssetPackReference;
	compile: RuntimeTargetCompileConfig;
	execution: RuntimeTargetExecutionConfig;
}

export interface RuntimeManifestV1 {
	version: string;
	hostTriple: string;
	targetTriple: SupportedTargetTriple;
	rustcWasm: string;
	workerBitcodeFile: string;
	workerSharedOutputBytes: number;
	compileTimeoutMs: number;
	artifactIdleMs: number;
	rustcMemory: {
		initialPages: number;
		maximumPages: number;
	};
	sysrootFiles: RuntimeAssetFile[];
	llvm: {
		llc: string;
		llcWasm?: string;
		lld: string;
		lldWasm?: string;
		lldData?: string;
	};
	link: RuntimeLinkConfig;
	compilerProvenance?: RuntimeRustCompilerProvenance;
}

export interface RuntimeManifestV2 {
	manifestVersion: 2;
	version: string;
	hostTriple: string;
	defaultTargetTriple: SupportedTargetTriple;
	compiler: RuntimeCompilerConfig;
	compilerProvenance?: RuntimeRustCompilerProvenance;
	targets: Partial<Record<SupportedTargetTriple, Omit<RuntimeTargetConfig, 'targetTriple'>>>;
}

export interface RuntimeManifestProducer {
	id: string;
	manifestSha256: string;
	runner: string;
	sourceDateEpoch: number;
}

export interface RuntimeManifestV3 {
	manifestVersion: 3;
	version: string;
	hostTriple: string;
	defaultTargetTriple: SupportedTargetTriple;
	compiler: RuntimeCompilerConfig;
	producer?: RuntimeManifestProducer;
	compilerProvenance?: RuntimeRustCompilerProvenance;
	targets: Partial<Record<SupportedTargetTriple, Omit<RuntimeTargetConfig, 'targetTriple'>>>;
	assetReceipts?: Readonly<Record<string, RuntimeAssetReceipt>>;
}

export interface NormalizedRuntimeManifest {
	manifestVersion: 1 | 2 | 3;
	version: string;
	hostTriple: string;
	defaultTargetTriple: SupportedTargetTriple;
	compiler: RuntimeCompilerConfig;
	producer?: RuntimeManifestProducer;
	compilerProvenance?: RuntimeRustCompilerProvenance;
	targets: Partial<Record<SupportedTargetTriple, RuntimeTargetConfig>>;
	assetReceipts?: Readonly<Record<string, RuntimeAssetReceipt>>;
}

export interface WasmRustRuntimeProfile {
	profileId: string;
	protocolVersion: 1;
	manifestPath: 'runtime/runtime-manifest.v3.json';
	manifestFingerprint: string;
	manifestReceipt: RuntimeAssetReceipt;
	moduleUrl: string;
}

export type RuntimeManifest = RuntimeManifestV1 | RuntimeManifestV2 | RuntimeManifestV3;

export class RuntimeManifestLoadError extends Error {
	readonly manifestUrl: string;
	readonly status?: number;
	readonly statusText?: string;
	readonly code?: string;

	constructor(
		manifestUrl: string,
		options: {
			status?: number;
			statusText?: string;
			code?: string;
		} = {}
	) {
		const detail =
			options.status !== undefined
				? ` (HTTP ${options.status}${options.statusText ? ` ${options.statusText}` : ''})`
				: options.code
					? ` (${options.code})`
					: '';
		super(`failed to load wasm-rust runtime manifest from ${manifestUrl}${detail}`);
		this.name = 'RuntimeManifestLoadError';
		this.manifestUrl = manifestUrl;
		if (options.status !== undefined) {
			this.status = options.status;
		}
		if (options.statusText) {
			this.statusText = options.statusText;
		}
		if (options.code) {
			this.code = options.code;
		}
	}
}

export function isMissingRuntimeManifestError(error: unknown) {
	if (!error || typeof error !== 'object') {
		return false;
	}
	const candidate = error as {
		status?: number;
		code?: string;
	};
	return candidate.status === 404 || candidate.code === 'ENOENT';
}

function isNormalizedRuntimeManifest(
	value: RuntimeManifest | NormalizedRuntimeManifest
): value is NormalizedRuntimeManifest {
	if (!('compiler' in value) || !('targets' in value) || !('defaultTargetTriple' in value)) {
		return false;
	}
	for (const targetConfig of Object.values(value.targets)) {
		if (targetConfig && !('targetTriple' in targetConfig)) {
			return false;
		}
	}
	return true;
}

function parseCompilerProvenance(
	value: unknown,
	runtimeVersion: string,
	hostTriple: string,
	strict = false
): RuntimeRustCompilerProvenance | undefined {
	if (value === undefined) return undefined;
	const provenance = expectObject(value, 'compilerProvenance');
	expectOnlyKeys(
		provenance,
		'compilerProvenance',
		['name', 'version', 'revision', 'llvmVersion', 'llvmRevision'],
		strict
	);
	if (provenance.name !== 'rustc') {
		throw new Error('compilerProvenance.name must be rustc');
	}
	return {
		name: 'rustc',
		version: expectString(provenance.version, 'compilerProvenance.version'),
		revision: expectString(provenance.revision, 'compilerProvenance.revision'),
		llvmVersion: expectString(provenance.llvmVersion, 'compilerProvenance.llvmVersion'),
		llvmRevision: expectString(provenance.llvmRevision, 'compilerProvenance.llvmRevision'),
		runtimeVersion,
		hostTriple
	};
}

function isRuntimeManifestV2(
	value: RuntimeManifest | NormalizedRuntimeManifest
): value is RuntimeManifestV2 {
	return 'manifestVersion' in value && value.manifestVersion === 2;
}

function isRuntimeManifestV3(
	value: RuntimeManifest | NormalizedRuntimeManifest
): value is RuntimeManifestV3 {
	return 'manifestVersion' in value && value.manifestVersion === 3;
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	return value as Record<string, unknown>;
}

function expectOnlyKeys(
	object: Record<string, unknown>,
	label: string,
	allowedKeys: readonly string[],
	strict: boolean
) {
	if (!strict) return;
	const allowed = new Set(allowedKeys);
	const unknownKeys = Object.keys(object).filter((key) => !allowed.has(key));
	if (unknownKeys.length) {
		throw new Error(
			`invalid ${label} in wasm-rust runtime manifest: unknown fields ${unknownKeys.join(', ')}`
		);
	}
}

function expectString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	return value;
}

function expectNumber(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	return value;
}

function expectNonNegativeInteger(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	return value;
}

function expectStringArray(value: unknown, label: string): string[] {
	if (
		!Array.isArray(value) ||
		value.some((entry) => typeof entry !== 'string' || entry.length === 0)
	) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	return value as string[];
}

function expectCanonicalPath(value: unknown, label: string, allowSharedLld = false): string {
	const sourcePath = expectString(value, label);
	const path =
		allowSharedLld && sourcePath.startsWith('../../shared/emscripten-lld/')
			? sourcePath.slice('../../shared/emscripten-lld/'.length)
			: sourcePath;
	if (
		(path !== sourcePath && path.length === 0) ||
		path.startsWith('/') ||
		path.endsWith('/') ||
		path.includes('\\') ||
		path.includes(':') ||
		path.includes('%') ||
		path.includes('?') ||
		path.includes('#') ||
		/[\u0000-\u001f\u007f]/u.test(path) ||
		path.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
		(sourcePath.startsWith('../') && path === sourcePath)
	) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest: non-canonical path`);
	}
	return sourcePath;
}

function expectRuntimePath(value: unknown, label: string): string {
	const runtimePath = expectString(value, label);
	if (
		!runtimePath.startsWith('/') ||
		runtimePath.length === 1 ||
		runtimePath.endsWith('/') ||
		runtimePath.includes('\\') ||
		/[\u0000-\u001f\u007f]/u.test(runtimePath) ||
		runtimePath
			.slice(1)
			.split('/')
			.some((segment) => !segment || segment === '.' || segment === '..')
	) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest: non-canonical path`);
	}
	return runtimePath;
}

function parseRuntimeManifestProducer(
	value: unknown,
	strict: boolean
): RuntimeManifestProducer | undefined {
	if (value === undefined) return undefined;
	const producer = expectObject(value, 'producer');
	expectOnlyKeys(
		producer,
		'producer',
		['id', 'manifestSha256', 'runner', 'sourceDateEpoch'],
		strict
	);
	const manifestSha256 = expectString(producer.manifestSha256, 'producer.manifestSha256');
	if (!/^[a-f0-9]{64}$/u.test(manifestSha256)) {
		throw new Error('invalid producer.manifestSha256 in wasm-rust runtime manifest');
	}
	return Object.freeze({
		id: expectString(producer.id, 'producer.id'),
		manifestSha256,
		runner: expectString(producer.runner, 'producer.runner'),
		sourceDateEpoch: expectNonNegativeInteger(
			producer.sourceDateEpoch,
			'producer.sourceDateEpoch'
		)
	});
}

function parseRuntimeAssetReceipt(value: unknown, label: string): RuntimeAssetReceipt {
	const object = expectObject(value, label);
	expectOnlyKeys(
		object,
		label,
		['bytes', 'sha256', 'uncompressedBytes', 'uncompressedSha256'],
		true
	);
	const bytes = expectNonNegativeInteger(object.bytes, `${label}.bytes`);
	const sha256 = expectString(object.sha256, `${label}.sha256`);
	const hasLogicalBytes = object.uncompressedBytes !== undefined;
	const hasLogicalSha256 = object.uncompressedSha256 !== undefined;
	if (!/^[a-f0-9]{64}$/u.test(sha256) || hasLogicalBytes !== hasLogicalSha256) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	if (!hasLogicalBytes) return Object.freeze({ bytes, sha256 });
	const uncompressedBytes = expectNonNegativeInteger(
		object.uncompressedBytes,
		`${label}.uncompressedBytes`
	);
	const uncompressedSha256 = expectString(
		object.uncompressedSha256,
		`${label}.uncompressedSha256`
	);
	if (!/^[a-f0-9]{64}$/u.test(uncompressedSha256)) {
		throw new Error(`invalid ${label}.uncompressedSha256 in wasm-rust runtime manifest`);
	}
	return Object.freeze({ bytes, sha256, uncompressedBytes, uncompressedSha256 });
}

function parseRuntimeAssetReceipts(
	value: unknown
): Readonly<Record<string, RuntimeAssetReceipt>> | undefined {
	if (value === undefined) return undefined;
	const object = expectObject(value, 'assetReceipts');
	if (Object.keys(object).length > 4096) {
		throw new Error('invalid assetReceipts in wasm-rust runtime manifest: too many entries');
	}
	const receipts: Record<string, RuntimeAssetReceipt> = Object.create(null) as Record<
		string,
		RuntimeAssetReceipt
	>;
	for (const assetPath of Object.keys(object).sort()) {
		expectCanonicalPath(assetPath, `assetReceipts path ${assetPath}`);
		receipts[assetPath] = parseRuntimeAssetReceipt(
			object[assetPath],
			`assetReceipts.${assetPath}`
		);
	}
	return Object.freeze(receipts);
}

function expectTargetTriple(value: unknown, label: string): SupportedTargetTriple {
	if (value !== 'wasm32-wasip1' && value !== 'wasm32-wasip2' && value !== 'wasm32-wasip3') {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	return value;
}

function expectArtifactFormat(value: unknown, label: string): BrowserRustArtifactFormat {
	if (value !== 'core-wasm' && value !== 'component') {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	return value;
}

function expectCompileKind(value: unknown, label: string): RuntimeTargetCompileConfig['kind'] {
	if (
		value !== 'llvm-wasm' &&
		value !== 'llvm-wasm+component-encoder' &&
		value !== 'integrated-rustc' &&
		value !== 'integrated-rustc+component-encoder'
	) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	return value;
}

function expectExecutionKind(value: unknown, label: string): RuntimeTargetExecutionConfig['kind'] {
	if (value !== 'preview1' && value !== 'preview2-component') {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	return value;
}

function expectAssetFileArray(value: unknown, label: string, strict = false): RuntimeAssetFile[] {
	if (!Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	if (strict && value.length > 4096) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest: too many entries`);
	}
	return value.map((entry, index) => {
		const object = expectObject(entry, `${label}[${index}]`);
		expectOnlyKeys(object, `${label}[${index}]`, ['asset', 'runtimePath'], strict);
		return {
			asset: strict
				? expectCanonicalPath(object.asset, `${label}[${index}].asset`, true)
				: expectString(object.asset, `${label}[${index}].asset`),
			runtimePath: strict
				? expectRuntimePath(object.runtimePath, `${label}[${index}].runtimePath`)
				: expectString(object.runtimePath, `${label}[${index}].runtimePath`)
		};
	});
}

function parseRuntimeAssetPack(
	value: unknown,
	label: string,
	strict = false,
	ancestors = new Set<object>(),
	ancestorAssets = new Set<string>(),
	depth = 0
): RuntimeAssetPackReference {
	const object = expectObject(value, label);
	expectOnlyKeys(
		object,
		label,
		['asset', 'index', 'fileCount', 'totalBytes', 'decodedTotalBytes', 'delta'],
		strict
	);
	if (strict && depth > 8) {
		throw new Error(`invalid ${label}: delta chain is too deep in wasm-rust runtime manifest`);
	}
	if (ancestors.has(object)) {
		throw new Error(`invalid ${label}: cyclic delta base in wasm-rust runtime manifest`);
	}
	const asset = strict
		? expectCanonicalPath(object.asset, `${label}.asset`, true)
		: expectString(object.asset, `${label}.asset`);
	const index = strict
		? expectCanonicalPath(object.index, `${label}.index`, true)
		: expectString(object.index, `${label}.index`);
	const assetIdentity = index;
	if (strict && ancestorAssets.has(assetIdentity)) {
		throw new Error(`invalid ${label}: cyclic delta asset pair in wasm-rust runtime manifest`);
	}
	ancestors.add(object);
	ancestorAssets.add(assetIdentity);
	try {
		const decodedTotalBytes =
			object.decodedTotalBytes === undefined
				? undefined
				: expectNonNegativeInteger(object.decodedTotalBytes, `${label}.decodedTotalBytes`);
		let delta: RuntimeAssetPackDeltaReference | undefined;
		if (object.delta !== undefined) {
			const deltaObject = expectObject(object.delta, `${label}.delta`);
			expectOnlyKeys(deltaObject, `${label}.delta`, ['format', 'base'], strict);
			if (deltaObject.format !== 'copy-literal-v1') {
				throw new Error(`invalid ${label}.delta.format in wasm-rust runtime manifest`);
			}
			delta = {
				format: 'copy-literal-v1',
				base: parseRuntimeAssetPack(
					deltaObject.base,
					`${label}.delta.base`,
					strict,
					ancestors,
					ancestorAssets,
					depth + 1
				)
			};
		}
		return {
			asset,
			index,
			fileCount: expectNonNegativeInteger(object.fileCount, `${label}.fileCount`),
			totalBytes: expectNonNegativeInteger(object.totalBytes, `${label}.totalBytes`),
			...(decodedTotalBytes === undefined ? {} : { decodedTotalBytes }),
			...(delta ? { delta } : {})
		};
	} finally {
		ancestors.delete(object);
		ancestorAssets.delete(assetIdentity);
	}
}

function parseRustcMemory(
	value: unknown,
	label: string,
	strict = false
): RuntimeCompilerConfig['rustcMemory'] {
	const object = expectObject(value, label);
	expectOnlyKeys(object, label, ['initialPages', 'maximumPages'], strict);
	const initialPages = expectNumber(object.initialPages, `${label}.initialPages`);
	const maximumPages = expectNumber(object.maximumPages, `${label}.maximumPages`);
	if (initialPages > maximumPages) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest: initial exceeds maximum`);
	}
	return { initialPages, maximumPages };
}

function parseCompilerConfig(value: unknown, label: string, strict = false): RuntimeCompilerConfig {
	const object = expectObject(value, label);
	expectOnlyKeys(
		object,
		label,
		[
			'rustcWasm',
			'workerBitcodeFile',
			'workerSharedOutputBytes',
			'workerSharedWorkspaceBytes',
			'compileTimeoutMs',
			'artifactIdleMs',
			'rustcMemory'
		],
		strict
	);
	return {
		rustcWasm: strict
			? expectCanonicalPath(object.rustcWasm, `${label}.rustcWasm`, true)
			: expectString(object.rustcWasm, `${label}.rustcWasm`),
		workerBitcodeFile: expectString(object.workerBitcodeFile, `${label}.workerBitcodeFile`),
		workerSharedOutputBytes: expectNumber(
			object.workerSharedOutputBytes,
			`${label}.workerSharedOutputBytes`
		),
		workerSharedWorkspaceBytes:
			object.workerSharedWorkspaceBytes === undefined
				? 128 * 1024 * 1024
				: expectNumber(
						object.workerSharedWorkspaceBytes,
						`${label}.workerSharedWorkspaceBytes`
					),
		compileTimeoutMs: expectNumber(object.compileTimeoutMs, `${label}.compileTimeoutMs`),
		artifactIdleMs: expectNumber(object.artifactIdleMs, `${label}.artifactIdleMs`),
		rustcMemory: parseRustcMemory(object.rustcMemory, `${label}.rustcMemory`, strict)
	};
}

function normalizeRuntimeLlvmConfig(
	llvm: RuntimeLlvmCompileConfig['llvm']
): RuntimeLlvmCompileConfig['llvm'] {
	return {
		llc: llvm.llc,
		llcWasm: llvm.llcWasm || 'llvm/llc.wasm',
		lld: llvm.lld,
		lldWasm: llvm.lldWasm || 'llvm/lld.wasm',
		lldData: llvm.lldData || 'llvm/lld.data'
	};
}

function parseLinkConfig(value: unknown, label: string, strict = false): RuntimeLinkConfig {
	const object = expectObject(value, label);
	expectOnlyKeys(
		object,
		label,
		['args', 'allocatorObjectRuntimePath', 'allocatorObjectAsset', 'files', 'pack'],
		strict
	);
	const pack =
		object.pack === undefined
			? undefined
			: parseRuntimeAssetPack(object.pack, `${label}.pack`, strict);
	const files =
		object.files === undefined
			? undefined
			: expectAssetFileArray(object.files, `${label}.files`, strict);
	const allocatorObjectRuntimePath =
		object.allocatorObjectRuntimePath === undefined
			? undefined
			: strict
				? expectRuntimePath(
						object.allocatorObjectRuntimePath,
						`${label}.allocatorObjectRuntimePath`
					)
				: expectString(
						object.allocatorObjectRuntimePath,
						`${label}.allocatorObjectRuntimePath`
					);
	const allocatorObjectAsset =
		object.allocatorObjectAsset === undefined
			? undefined
			: strict
				? expectCanonicalPath(
						object.allocatorObjectAsset,
						`${label}.allocatorObjectAsset`,
						true
					)
				: expectString(object.allocatorObjectAsset, `${label}.allocatorObjectAsset`);
	if (strict && pack && (files || allocatorObjectAsset || allocatorObjectRuntimePath)) {
		throw new Error(
			`invalid ${label}: pack and legacy link fields are mutually exclusive in wasm-rust runtime manifest`
		);
	}
	if (!pack && (!allocatorObjectRuntimePath || !allocatorObjectAsset || !files)) {
		throw new Error(
			`invalid ${label}: missing legacy link asset fields in wasm-rust runtime manifest`
		);
	}
	return {
		args: expectStringArray(object.args, `${label}.args`),
		...(allocatorObjectRuntimePath
			? {
					allocatorObjectRuntimePath
				}
			: {}),
		...(allocatorObjectAsset
			? {
					allocatorObjectAsset
				}
			: {}),
		...(files
			? {
					files
				}
			: {}),
		...(pack
			? {
					pack
				}
			: {})
	};
}

function parseRuntimeTargetConfig(
	value: unknown,
	label: string,
	targetTriple: SupportedTargetTriple,
	strict = false
): RuntimeTargetConfig {
	const object = expectObject(value, label);
	expectOnlyKeys(
		object,
		label,
		['artifactFormat', 'sysrootFiles', 'sysrootPack', 'compile', 'execution'],
		strict
	);
	const compile = expectObject(object.compile, `${label}.compile`);
	const compileKind = expectCompileKind(compile.kind, `${label}.compile.kind`);
	const execution = expectObject(object.execution, `${label}.execution`);
	expectOnlyKeys(execution, `${label}.execution`, ['kind'], strict);
	const sysrootFiles =
		object.sysrootFiles === undefined
			? undefined
			: expectAssetFileArray(object.sysrootFiles, `${label}.sysrootFiles`, strict);
	const sysrootPack =
		object.sysrootPack === undefined
			? undefined
			: parseRuntimeAssetPack(object.sysrootPack, `${label}.sysrootPack`, strict);
	if (!sysrootFiles && !sysrootPack) {
		throw new Error(`invalid ${label}: missing sysroot assets in wasm-rust runtime manifest`);
	}
	if (strict && sysrootFiles && sysrootPack) {
		throw new Error(
			`invalid ${label}: sysrootFiles and sysrootPack are mutually exclusive in wasm-rust runtime manifest`
		);
	}
	let parsedCompile: RuntimeTargetCompileConfig;
	if (
		compileKind === 'integrated-rustc' ||
		compileKind === 'integrated-rustc+component-encoder'
	) {
		expectOnlyKeys(compile, `${label}.compile`, ['kind'], strict);
		parsedCompile = { kind: compileKind };
	} else {
		expectOnlyKeys(compile, `${label}.compile`, ['kind', 'llvm', 'link'], strict);
		const llvm = expectObject(compile.llvm, `${label}.compile.llvm`);
		expectOnlyKeys(
			llvm,
			`${label}.compile.llvm`,
			['llc', 'llcWasm', 'lld', 'lldWasm', 'lldData'],
			strict
		);
		parsedCompile = {
			kind: compileKind,
			llvm: {
				llc: strict
					? expectCanonicalPath(llvm.llc, `${label}.compile.llvm.llc`, true)
					: expectString(llvm.llc, `${label}.compile.llvm.llc`),
				...(llvm.llcWasm === undefined
					? {}
					: {
							llcWasm: strict
								? expectCanonicalPath(
										llvm.llcWasm,
										`${label}.compile.llvm.llcWasm`,
										true
									)
								: expectString(llvm.llcWasm, `${label}.compile.llvm.llcWasm`)
						}),
				lld: strict
					? expectCanonicalPath(llvm.lld, `${label}.compile.llvm.lld`, true)
					: expectString(llvm.lld, `${label}.compile.llvm.lld`),
				...(llvm.lldWasm === undefined
					? {}
					: {
							lldWasm: strict
								? expectCanonicalPath(
										llvm.lldWasm,
										`${label}.compile.llvm.lldWasm`,
										true
									)
								: expectString(llvm.lldWasm, `${label}.compile.llvm.lldWasm`)
						}),
				...(llvm.lldData === undefined
					? {}
					: {
							lldData: strict
								? expectCanonicalPath(
										llvm.lldData,
										`${label}.compile.llvm.lldData`,
										true
									)
								: expectString(llvm.lldData, `${label}.compile.llvm.lldData`)
						})
			},
			link: parseLinkConfig(compile.link, `${label}.compile.link`, strict)
		};
	}
	return {
		targetTriple,
		artifactFormat: expectArtifactFormat(object.artifactFormat, `${label}.artifactFormat`),
		...(sysrootFiles
			? {
					sysrootFiles
				}
			: {}),
		...(sysrootPack
			? {
					sysrootPack
				}
			: {}),
		compile: parsedCompile,
		execution: {
			kind: expectExecutionKind(execution.kind, `${label}.execution.kind`)
		}
	};
}

function parseVersionedTargets(
	root: Record<string, unknown>,
	strict = false
): Partial<Record<SupportedTargetTriple, Omit<RuntimeTargetConfig, 'targetTriple'>>> {
	const targets = expectObject(root.targets, 'targets');
	expectOnlyKeys(targets, 'targets', ['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'], strict);
	const parsedTargets: Partial<
		Record<SupportedTargetTriple, Omit<RuntimeTargetConfig, 'targetTriple'>>
	> = {};
	for (const targetTriple of ['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'] as const) {
		const targetValue = targets[targetTriple];
		if (targetValue === undefined) {
			continue;
		}
		const parsedTarget = parseRuntimeTargetConfig(
			targetValue,
			`targets.${targetTriple}`,
			targetTriple,
			strict
		);
		parsedTargets[targetTriple] = {
			artifactFormat: parsedTarget.artifactFormat,
			...(parsedTarget.sysrootFiles
				? {
						sysrootFiles: parsedTarget.sysrootFiles
					}
				: {}),
			...(parsedTarget.sysrootPack
				? {
						sysrootPack: parsedTarget.sysrootPack
					}
				: {}),
			compile: parsedTarget.compile,
			execution: parsedTarget.execution
		};
	}
	return parsedTargets;
}

export function parseRuntimeManifest(value: unknown): RuntimeManifest {
	const root = expectObject(value, 'root');

	if (root.manifestVersion === 3) {
		expectOnlyKeys(
			root,
			'root',
			[
				'manifestVersion',
				'version',
				'hostTriple',
				'defaultTargetTriple',
				'producer',
				'compilerProvenance',
				'compiler',
				'targets',
				'assetReceipts'
			],
			true
		);
		const version = expectString(root.version, 'version');
		const hostTriple = expectString(root.hostTriple, 'hostTriple');
		const producer = parseRuntimeManifestProducer(root.producer, true);
		const compilerProvenance = parseCompilerProvenance(
			root.compilerProvenance,
			version,
			hostTriple,
			true
		);
		const assetReceipts = parseRuntimeAssetReceipts(root.assetReceipts);
		const defaultTargetTriple = expectTargetTriple(
			root.defaultTargetTriple,
			'defaultTargetTriple'
		);
		const targets = parseVersionedTargets(root, true);
		if (!targets[defaultTargetTriple]) {
			throw new Error(
				`invalid defaultTargetTriple in wasm-rust runtime manifest: target ${defaultTargetTriple} is missing`
			);
		}
		return {
			manifestVersion: 3,
			version,
			hostTriple,
			defaultTargetTriple,
			compiler: parseCompilerConfig(root.compiler, 'compiler', true),
			...(producer ? { producer } : {}),
			...(compilerProvenance ? { compilerProvenance } : {}),
			targets,
			...(assetReceipts ? { assetReceipts } : {})
		};
	}

	if (root.manifestVersion === 2) {
		const version = expectString(root.version, 'version');
		const hostTriple = expectString(root.hostTriple, 'hostTriple');
		const compilerProvenance = parseCompilerProvenance(
			root.compilerProvenance,
			version,
			hostTriple
		);
		return {
			manifestVersion: 2,
			version,
			hostTriple,
			defaultTargetTriple: expectTargetTriple(
				root.defaultTargetTriple,
				'defaultTargetTriple'
			),
			compiler: parseCompilerConfig(root.compiler, 'compiler'),
			...(compilerProvenance ? { compilerProvenance } : {}),
			targets: parseVersionedTargets(root)
		};
	}

	const llvm = expectObject(root.llvm, 'llvm');
	const version = expectString(root.version, 'version');
	const hostTriple = expectString(root.hostTriple, 'hostTriple');
	const compilerProvenance = parseCompilerProvenance(
		root.compilerProvenance,
		version,
		hostTriple
	);
	return {
		version,
		hostTriple,
		targetTriple: expectTargetTriple(root.targetTriple, 'targetTriple'),
		rustcWasm: expectString(root.rustcWasm, 'rustcWasm'),
		workerBitcodeFile: expectString(root.workerBitcodeFile, 'workerBitcodeFile'),
		workerSharedOutputBytes: expectNumber(
			root.workerSharedOutputBytes,
			'workerSharedOutputBytes'
		),
		compileTimeoutMs: expectNumber(root.compileTimeoutMs, 'compileTimeoutMs'),
		artifactIdleMs: expectNumber(root.artifactIdleMs, 'artifactIdleMs'),
		rustcMemory: parseRustcMemory(root.rustcMemory, 'rustcMemory'),
		sysrootFiles: expectAssetFileArray(root.sysrootFiles, 'sysrootFiles'),
		llvm: {
			llc: expectString(llvm.llc, 'llvm.llc'),
			...(llvm.llcWasm === undefined
				? {}
				: {
						llcWasm: expectString(llvm.llcWasm, 'llvm.llcWasm')
					}),
			lld: expectString(llvm.lld, 'llvm.lld'),
			...(llvm.lldWasm === undefined
				? {}
				: {
						lldWasm: expectString(llvm.lldWasm, 'llvm.lldWasm')
					}),
			...(llvm.lldData === undefined
				? {}
				: {
						lldData: expectString(llvm.lldData, 'llvm.lldData')
					})
		},
		link: parseLinkConfig(root.link, 'link'),
		...(compilerProvenance ? { compilerProvenance } : {})
	};
}

export function normalizeRuntimeManifest(
	value: RuntimeManifest | NormalizedRuntimeManifest
): NormalizedRuntimeManifest {
	if (isNormalizedRuntimeManifest(value)) {
		const compilerProvenance = parseCompilerProvenance(
			value.compilerProvenance,
			value.version,
			value.hostTriple
		);
		const targets: NormalizedRuntimeManifest['targets'] = {};
		for (const [targetTriple, targetConfig] of Object.entries(value.targets) as Array<
			[SupportedTargetTriple, NormalizedRuntimeManifest['targets'][SupportedTargetTriple]]
		>) {
			if (!targetConfig) {
				continue;
			}
			targets[targetTriple] = {
				...targetConfig,
				compile: isIntegratedCompilerOutput(targetConfig.compile)
					? targetConfig.compile
					: {
							...targetConfig.compile,
							llvm: normalizeRuntimeLlvmConfig(targetConfig.compile.llvm)
						}
			};
		}
		return {
			...value,
			...(value.producer ? { producer: value.producer } : {}),
			...(compilerProvenance ? { compilerProvenance } : {}),
			targets,
			...(value.assetReceipts ? { assetReceipts: value.assetReceipts } : {})
		};
	}

	if (isRuntimeManifestV2(value) || isRuntimeManifestV3(value)) {
		const compilerProvenance = parseCompilerProvenance(
			value.compilerProvenance,
			value.version,
			value.hostTriple
		);
		const targets: NormalizedRuntimeManifest['targets'] = {};
		for (const [targetTriple, targetConfig] of Object.entries(value.targets) as Array<
			[SupportedTargetTriple, RuntimeManifestV2['targets'][SupportedTargetTriple]]
		>) {
			if (!targetConfig) {
				continue;
			}
			targets[targetTriple] = {
				targetTriple,
				artifactFormat: targetConfig.artifactFormat,
				...(targetConfig.sysrootFiles
					? {
							sysrootFiles: targetConfig.sysrootFiles
						}
					: {}),
				...(targetConfig.sysrootPack
					? {
							sysrootPack: targetConfig.sysrootPack
						}
					: {}),
				compile: isIntegratedCompilerOutput(targetConfig.compile)
					? targetConfig.compile
					: {
							...targetConfig.compile,
							llvm: normalizeRuntimeLlvmConfig(targetConfig.compile.llvm)
						},
				execution: targetConfig.execution
			};
		}
		return {
			manifestVersion: value.manifestVersion,
			version: value.version,
			hostTriple: value.hostTriple,
			defaultTargetTriple: value.defaultTargetTriple,
			compiler: value.compiler,
			...(isRuntimeManifestV3(value) && value.producer ? { producer: value.producer } : {}),
			...(compilerProvenance ? { compilerProvenance } : {}),
			targets,
			...(isRuntimeManifestV3(value) && value.assetReceipts
				? { assetReceipts: value.assetReceipts }
				: {})
		};
	}

	const compilerProvenance = parseCompilerProvenance(
		value.compilerProvenance,
		value.version,
		value.hostTriple
	);
	return {
		manifestVersion: 1,
		version: value.version,
		hostTriple: value.hostTriple,
		defaultTargetTriple: value.targetTriple,
		compiler: {
			rustcWasm: value.rustcWasm,
			workerBitcodeFile: value.workerBitcodeFile,
			workerSharedOutputBytes: value.workerSharedOutputBytes,
			workerSharedWorkspaceBytes: 128 * 1024 * 1024,
			compileTimeoutMs: value.compileTimeoutMs,
			artifactIdleMs: value.artifactIdleMs,
			rustcMemory: value.rustcMemory
		},
		...(compilerProvenance ? { compilerProvenance } : {}),
		targets: {
			[value.targetTriple]: {
				targetTriple: value.targetTriple,
				artifactFormat: 'core-wasm',
				sysrootFiles: value.sysrootFiles,
				compile: {
					kind: 'llvm-wasm',
					llvm: normalizeRuntimeLlvmConfig(value.llvm),
					link: value.link
				},
				execution: {
					kind: 'preview1'
				}
			}
		}
	};
}

export function resolveTargetManifest(
	manifest: NormalizedRuntimeManifest,
	targetTriple: SupportedTargetTriple = manifest.defaultTargetTriple
): RuntimeTargetConfig {
	const target = manifest.targets[targetTriple];
	if (!target) {
		throw new Error(
			`unsupported wasm-rust target ${targetTriple}; available targets: ${Object.keys(manifest.targets).join(', ') || 'none'}`
		);
	}
	return target;
}

const COMPONENT_BINARY_ASSET_PATHS = [
	'wasm-rust/vendor/jco/lib/wasi_snapshot_preview1.command.wasm',
	'wasm-rust/vendor/jco/obj/wasm-tools.core.wasm.gz',
	'wasm-rust/vendor/jco/obj/wasm-tools.core2.wasm',
	'wasm-rust/vendor/jco/obj/js-component-bindgen-component.core.wasm.gz',
	'wasm-rust/vendor/jco/obj/js-component-bindgen-component.core2.wasm'
] as const;

function runtimeReceiptPath(assetPath: string) {
	if (assetPath.startsWith('../../shared/emscripten-lld/')) {
		return `shared/emscripten-lld/${assetPath.slice('../../shared/emscripten-lld/'.length)}`;
	}
	return `wasm-rust/runtime/${assetPath}`;
}

function collectRuntimePackAssetPaths(pack: RuntimeAssetPackReference, paths: Set<string>) {
	paths.add(runtimeReceiptPath(pack.asset));
	paths.add(runtimeReceiptPath(pack.index));
	if (pack.delta) collectRuntimePackAssetPaths(pack.delta.base, paths);
}

export function collectRuntimeTargetAssetPaths(
	manifest: NormalizedRuntimeManifest,
	targetTriple: SupportedTargetTriple = manifest.defaultTargetTriple
) {
	const target = resolveTargetManifest(manifest, targetTriple);
	const paths = new Set<string>([runtimeReceiptPath(manifest.compiler.rustcWasm)]);
	if (target.sysrootPack) {
		collectRuntimePackAssetPaths(target.sysrootPack, paths);
	} else {
		for (const entry of target.sysrootFiles || []) paths.add(runtimeReceiptPath(entry.asset));
	}
	if (!isIntegratedCompilerOutput(target.compile)) {
		paths.add(runtimeReceiptPath(target.compile.llvm.llcWasm || 'llvm/llc.wasm'));
		paths.add(runtimeReceiptPath(target.compile.llvm.lldWasm || 'llvm/lld.wasm'));
		paths.add(runtimeReceiptPath(target.compile.llvm.lldData || 'llvm/lld.data'));
		if (target.compile.link.pack) {
			collectRuntimePackAssetPaths(target.compile.link.pack, paths);
		} else {
			if (target.compile.link.allocatorObjectAsset) {
				paths.add(runtimeReceiptPath(target.compile.link.allocatorObjectAsset));
			}
			for (const entry of target.compile.link.files || []) {
				paths.add(runtimeReceiptPath(entry.asset));
			}
		}
	}
	if (
		target.artifactFormat === 'component' ||
		target.execution.kind === 'preview2-component' ||
		target.compile.kind.endsWith('+component-encoder')
	) {
		for (const assetPath of COMPONENT_BINARY_ASSET_PATHS) paths.add(assetPath);
	}
	return [...paths].sort();
}

export function resolveRuntimeAssetDeliveryExpectedBytes(
	manifest: NormalizedRuntimeManifest,
	manifestDeliveryBytes: number,
	targetTriple: SupportedTargetTriple = manifest.defaultTargetTriple
) {
	if (!Number.isSafeInteger(manifestDeliveryBytes) || manifestDeliveryBytes <= 0) {
		throw new Error(
			'wasm-rust runtime manifest delivery bytes must be a positive safe integer'
		);
	}
	const receipts = verifyRuntimeManifestAssetReceipts(manifest);
	let expectedBytes = manifestDeliveryBytes;
	for (const assetPath of collectRuntimeTargetAssetPaths(manifest, targetTriple)) {
		const receipt = receipts[assetPath];
		if (!receipt) {
			throw new Error(`wasm-rust runtime asset ${assetPath} is missing its delivery receipt`);
		}
		// Fetch can expose logical bytes after HTTP or service-worker transparent decoding.
		expectedBytes += receipt.uncompressedBytes ?? receipt.bytes;
		if (!Number.isSafeInteger(expectedBytes)) {
			throw new Error('wasm-rust runtime asset delivery baseline is unsafe');
		}
	}
	return expectedBytes;
}

export function collectRuntimeManifestAssetPaths(manifest: NormalizedRuntimeManifest) {
	const paths = new Set<string>([runtimeReceiptPath(manifest.compiler.rustcWasm)]);
	let needsComponentAssets = false;
	for (const target of Object.values(manifest.targets)) {
		if (!target) continue;
		if (target.sysrootPack) {
			collectRuntimePackAssetPaths(target.sysrootPack, paths);
		} else {
			for (const entry of target.sysrootFiles || []) {
				paths.add(runtimeReceiptPath(entry.asset));
			}
		}
		if (!isIntegratedCompilerOutput(target.compile)) {
			paths.add(runtimeReceiptPath(target.compile.llvm.llcWasm || 'llvm/llc.wasm'));
			paths.add(runtimeReceiptPath(target.compile.llvm.lldWasm || 'llvm/lld.wasm'));
			paths.add(runtimeReceiptPath(target.compile.llvm.lldData || 'llvm/lld.data'));
			if (target.compile.link.pack) {
				collectRuntimePackAssetPaths(target.compile.link.pack, paths);
			} else {
				if (target.compile.link.allocatorObjectAsset) {
					paths.add(runtimeReceiptPath(target.compile.link.allocatorObjectAsset));
				}
				for (const entry of target.compile.link.files || []) {
					paths.add(runtimeReceiptPath(entry.asset));
				}
			}
		}
		needsComponentAssets ||=
			target.artifactFormat === 'component' ||
			target.execution.kind === 'preview2-component' ||
			target.compile.kind.endsWith('+component-encoder');
	}
	if (needsComponentAssets) {
		for (const assetPath of COMPONENT_BINARY_ASSET_PATHS) paths.add(assetPath);
	}
	return [...paths].sort();
}

export function verifyRuntimeManifestAssetReceipts(manifest: NormalizedRuntimeManifest) {
	if (!manifest.assetReceipts) {
		throw new Error('wasm-rust runtime manifest is missing its asset receipt graph');
	}
	const expectedPaths = collectRuntimeManifestAssetPaths(manifest);
	const actualPaths = Object.keys(manifest.assetReceipts).sort();
	const missingPaths = expectedPaths.filter((assetPath) => !manifest.assetReceipts![assetPath]);
	const extraPaths = actualPaths.filter((assetPath) => !expectedPaths.includes(assetPath));
	if (missingPaths.length || extraPaths.length) {
		throw new Error(
			`wasm-rust runtime manifest receipt graph mismatch: missing=${missingPaths.join(',') || 'none'} extra=${extraPaths.join(',') || 'none'}`
		);
	}
	const validatePack = (pack: RuntimeAssetPackReference) => {
		const receipt = manifest.assetReceipts![runtimeReceiptPath(pack.asset)];
		const logicalBytes = receipt!.uncompressedBytes ?? receipt!.bytes;
		if (logicalBytes !== pack.totalBytes) {
			throw new Error(
				`wasm-rust runtime pack ${pack.asset} logical receipt does not match totalBytes`
			);
		}
		if (pack.delta) validatePack(pack.delta.base);
	};
	for (const target of Object.values(manifest.targets)) {
		if (!target) continue;
		if (target.sysrootPack) validatePack(target.sysrootPack);
		if (!isIntegratedCompilerOutput(target.compile) && target.compile.link.pack) {
			validatePack(target.compile.link.pack);
		}
	}
	return manifest.assetReceipts;
}

function rejectDuplicateRuntimeManifestJsonKeys(source: string) {
	let index = 0;
	let valueCount = 0;
	const fail = (message: string): never => {
		throw new Error(`invalid wasm-rust runtime manifest JSON: ${message}`);
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
		if (valueCount > 100_000) fail('too many values');
		if (depth > 64) fail('nesting is too deep');
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
		if (!number) fail('expected a JSON value');
		index += number!.length;
	};
	parseValue(0);
	skipWhitespace();
	if (index !== source.length) fail('unexpected trailing data');
}

function decodeStrictRuntimeManifest(bytes: Uint8Array) {
	let source: string;
	try {
		source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new Error('invalid wasm-rust runtime manifest UTF-8');
	}
	rejectDuplicateRuntimeManifestJsonKeys(source);
	try {
		return JSON.parse(source) as unknown;
	} catch (error) {
		throw new Error(
			`invalid wasm-rust runtime manifest JSON: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

export function parseWasmRustRuntimeProfileFromModuleUrl(
	moduleUrl: string | URL
): WasmRustRuntimeProfile | undefined {
	const url = new URL(moduleUrl.toString());
	const fingerprintValues = url.searchParams.getAll('v');
	const manifestBytesValues = url.searchParams.getAll('rustManifestBytes');
	const manifestSha256Values = url.searchParams.getAll('rustManifestSha256');
	if (
		fingerprintValues.length === 0 &&
		manifestBytesValues.length === 0 &&
		manifestSha256Values.length === 0
	) {
		return undefined;
	}
	if (
		fingerprintValues.length !== 1 ||
		manifestBytesValues.length !== 1 ||
		manifestSha256Values.length !== 1
	) {
		throw new Error(
			'wasm-rust runtime module has an invalid receipt profile: ambiguous fields'
		);
	}
	const fingerprint = fingerprintValues[0]!;
	const manifestBytesValue = manifestBytesValues[0]!;
	const manifestSha256 = manifestSha256Values[0]!;
	const manifestBytes = Number(manifestBytesValue);
	if (
		!/^[a-f0-9]{64}$/u.test(fingerprint || '') ||
		!/^[a-f0-9]{64}$/u.test(manifestSha256 || '') ||
		!/^\d+$/u.test(manifestBytesValue || '') ||
		!Number.isSafeInteger(manifestBytes) ||
		manifestBytes <= 0
	) {
		throw new Error('wasm-rust runtime module has an invalid receipt profile');
	}
	return Object.freeze({
		profileId: `wasm-rust-${fingerprint}`,
		protocolVersion: 1,
		manifestPath: 'runtime/runtime-manifest.v3.json',
		manifestFingerprint: fingerprint,
		manifestReceipt: Object.freeze({ bytes: manifestBytes, sha256: manifestSha256 }),
		moduleUrl: url.href
	});
}

export async function loadRuntimeManifest(
	manifestUrl: string | URL,
	fetchImpl: typeof fetch = fetch,
	options: {
		receipt?: RuntimeAssetReceipt;
		deliveryBudget?: RuntimeAssetDeliveryBudgetDescriptor;
		onProgress?: (progress: RuntimeAssetDownloadProgress) => void;
	} = {}
): Promise<RuntimeManifest> {
	if (options.receipt) {
		const { onProgress, ...fetchOptions } = options;
		const bytes = await fetchRuntimeAssetBytes(
			manifestUrl,
			'wasm-rust runtime manifest',
			fetchImpl,
			false,
			onProgress,
			{
				...fetchOptions,
				maxAssetBytes: Math.max(options.receipt.bytes, 1),
				receipt: options.receipt
			}
		);
		const manifest = parseRuntimeManifest(decodeStrictRuntimeManifest(bytes));
		if (!isRuntimeManifestV3(manifest) || !manifest.assetReceipts) {
			throw new Error(
				'wasm-rust runtime manifest receipt profile requires a v3 asset receipt graph'
			);
		}
		return manifest;
	}
	if (options.deliveryBudget) {
		const { onProgress, ...fetchOptions } = options;
		const bytes = await fetchRuntimeAssetBytes(
			manifestUrl,
			'wasm-rust runtime manifest',
			fetchImpl,
			false,
			onProgress,
			fetchOptions
		);
		return parseRuntimeManifest(decodeStrictRuntimeManifest(bytes));
	}
	const response = await fetchImpl(manifestUrl.toString());
	if (!response.ok) {
		throw new RuntimeManifestLoadError(manifestUrl.toString(), {
			status: response.status,
			statusText: response.statusText
		});
	}
	return parseRuntimeManifest(await response.json());
}

export function registerRuntimeManifestAssetReceipts(
	runtimeBaseUrl: string | URL,
	manifest: NormalizedRuntimeManifest
) {
	const canonicalReceipts = verifyRuntimeManifestAssetReceipts(manifest);
	const resolvedReceipts: Record<string, RuntimeAssetReceipt> = Object.create(null) as Record<
		string,
		RuntimeAssetReceipt
	>;
	for (const [canonicalPath, receipt] of Object.entries(canonicalReceipts)) {
		let relativePath: string;
		if (canonicalPath.startsWith('wasm-rust/runtime/')) {
			relativePath = canonicalPath.slice('wasm-rust/runtime/'.length);
		} else if (canonicalPath.startsWith('wasm-rust/vendor/')) {
			relativePath = `../vendor/${canonicalPath.slice('wasm-rust/vendor/'.length)}`;
		} else if (canonicalPath.startsWith('shared/emscripten-lld/')) {
			relativePath = `../../shared/emscripten-lld/${canonicalPath.slice('shared/emscripten-lld/'.length)}`;
		} else {
			throw new Error(
				`wasm-rust runtime manifest has an unsupported receipt path: ${canonicalPath}`
			);
		}
		resolvedReceipts[resolveVersionedAssetUrl(runtimeBaseUrl, relativePath).href] = receipt;
	}
	registerRuntimeAssetReceipts(runtimeBaseUrl, resolvedReceipts);
}

const EXECUTABLE_GRAPH_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;

interface VerifiedRuntimeExecutableGraphConfiguration {
	readonly fingerprint: string;
	readonly moduleUrls: ReadonlyMap<string, string>;
}

let verifiedRuntimeExecutableGraph: VerifiedRuntimeExecutableGraphConfiguration | null = null;

export function configureVerifiedRuntimeExecutableModuleUrls(
	moduleUrls: Readonly<Record<string, string>>,
	executableGraphFingerprint: string
) {
	if (!moduleUrls || typeof moduleUrls !== 'object' || Array.isArray(moduleUrls)) {
		throw new Error('wasm-rust verified executable module URLs must be an object');
	}
	const entries = Object.entries(moduleUrls);
	if (entries.length === 0 || entries.length > 256) {
		throw new Error('wasm-rust verified executable module URL count is invalid');
	}
	if (!EXECUTABLE_GRAPH_FINGERPRINT_PATTERN.test(executableGraphFingerprint)) {
		throw new Error('wasm-rust verified executable graph fingerprint is invalid');
	}
	const next = new Map<string, string>();
	const targets = new Set<string>();
	for (const [sourceUrl, blobUrl] of entries) {
		let parsedSource: URL;
		let parsedBlob: URL;
		try {
			parsedSource = new URL(sourceUrl);
			parsedBlob = new URL(blobUrl);
		} catch (cause) {
			throw new Error('wasm-rust verified executable module URL is invalid', { cause });
		}
		if (
			(parsedSource.protocol !== 'http:' && parsedSource.protocol !== 'https:') ||
			parsedSource.username ||
			parsedSource.password ||
			parsedSource.hash ||
			parsedSource.href !== sourceUrl
		) {
			throw new Error('wasm-rust verified executable source URL is unsafe');
		}
		if (
			parsedBlob.protocol !== 'blob:' ||
			parsedBlob.search ||
			parsedBlob.hash ||
			parsedBlob.href !== blobUrl ||
			targets.has(blobUrl)
		) {
			throw new Error('wasm-rust verified executable Blob URL is unsafe or duplicated');
		}
		targets.add(blobUrl);
		next.set(sourceUrl, blobUrl);
	}
	const existing = verifiedRuntimeExecutableGraph;
	if (existing) {
		if (
			existing.fingerprint !== executableGraphFingerprint ||
			existing.moduleUrls.size !== next.size ||
			[...next].some(([sourceUrl, blobUrl]) => existing.moduleUrls.get(sourceUrl) !== blobUrl)
		) {
			throw new Error('wasm-rust verified executable graph cannot change within one worker');
		}
		return;
	}
	verifiedRuntimeExecutableGraph = Object.freeze({
		fingerprint: executableGraphFingerprint,
		moduleUrls: next
	});
}

export function clearVerifiedRuntimeExecutableModuleUrls() {
	verifiedRuntimeExecutableGraph = null;
}

export function hasVerifiedRuntimeExecutableModuleUrls() {
	return verifiedRuntimeExecutableGraph !== null;
}

export function getVerifiedRuntimeExecutableGraphConfiguration() {
	if (!verifiedRuntimeExecutableGraph) return null;
	return Object.freeze({
		fingerprint: verifiedRuntimeExecutableGraph.fingerprint,
		moduleUrls: Object.freeze(Object.fromEntries(verifiedRuntimeExecutableGraph.moduleUrls))
	});
}

export function resolveRuntimeAssetUrl(baseUrl: string | URL, assetPath: string): string {
	const resolved = resolveVersionedAssetUrl(baseUrl, assetPath).toString();
	const verifiedModuleUrl = verifiedRuntimeExecutableGraph?.moduleUrls.get(resolved);
	if (verifiedModuleUrl) return verifiedModuleUrl;
	if (
		verifiedRuntimeExecutableGraph &&
		/\.(?:c|m)?js$/u.test(new URL(resolved).pathname.toLowerCase())
	) {
		throw new Error('wasm-rust executable module is missing from the verified Blob graph');
	}
	return resolved;
}
