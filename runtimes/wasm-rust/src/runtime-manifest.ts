import { resolveVersionedAssetUrl } from './asset-url.js';
import type { BrowserRustArtifactFormat, SupportedTargetTriple } from './types.js';

export interface RuntimeAssetFile {
	asset: string;
	runtimePath: string;
}

export interface RuntimeAssetPackReference {
	asset: string;
	index: string;
	fileCount: number;
	totalBytes: number;
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
}

export interface RuntimeManifestV2 {
	manifestVersion: 2;
	version: string;
	hostTriple: string;
	defaultTargetTriple: SupportedTargetTriple;
	compiler: RuntimeCompilerConfig;
	targets: Partial<Record<SupportedTargetTriple, Omit<RuntimeTargetConfig, 'targetTriple'>>>;
}

export interface RuntimeManifestV3 {
	manifestVersion: 3;
	version: string;
	hostTriple: string;
	defaultTargetTriple: SupportedTargetTriple;
	compiler: RuntimeCompilerConfig;
	targets: Partial<Record<SupportedTargetTriple, Omit<RuntimeTargetConfig, 'targetTriple'>>>;
}

export interface NormalizedRuntimeManifest {
	manifestVersion: 1 | 2 | 3;
	version: string;
	hostTriple: string;
	defaultTargetTriple: SupportedTargetTriple;
	compiler: RuntimeCompilerConfig;
	targets: Partial<Record<SupportedTargetTriple, RuntimeTargetConfig>>;
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

function expectString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	return value;
}

function expectNumber(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
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

function expectAssetFileArray(value: unknown, label: string): RuntimeAssetFile[] {
	if (!Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
	}
	return value.map((entry, index) => {
		const object = expectObject(entry, `${label}[${index}]`);
		return {
			asset: expectString(object.asset, `${label}[${index}].asset`),
			runtimePath: expectString(object.runtimePath, `${label}[${index}].runtimePath`)
		};
	});
}

function parseRuntimeAssetPack(value: unknown, label: string): RuntimeAssetPackReference {
	const object = expectObject(value, label);
	return {
		asset: expectString(object.asset, `${label}.asset`),
		index: expectString(object.index, `${label}.index`),
		fileCount: expectNumber(object.fileCount, `${label}.fileCount`),
		totalBytes: expectNumber(object.totalBytes, `${label}.totalBytes`)
	};
}

function parseRustcMemory(value: unknown, label: string): RuntimeCompilerConfig['rustcMemory'] {
	const object = expectObject(value, label);
	return {
		initialPages: expectNumber(object.initialPages, `${label}.initialPages`),
		maximumPages: expectNumber(object.maximumPages, `${label}.maximumPages`)
	};
}

function parseCompilerConfig(value: unknown, label: string): RuntimeCompilerConfig {
	const object = expectObject(value, label);
	return {
		rustcWasm: expectString(object.rustcWasm, `${label}.rustcWasm`),
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
		rustcMemory: parseRustcMemory(object.rustcMemory, `${label}.rustcMemory`)
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

function parseLinkConfig(value: unknown, label: string): RuntimeLinkConfig {
	const object = expectObject(value, label);
	const pack =
		object.pack === undefined ? undefined : parseRuntimeAssetPack(object.pack, `${label}.pack`);
	const files =
		object.files === undefined
			? undefined
			: expectAssetFileArray(object.files, `${label}.files`);
	const allocatorObjectRuntimePath =
		object.allocatorObjectRuntimePath === undefined
			? undefined
			: expectString(
					object.allocatorObjectRuntimePath,
					`${label}.allocatorObjectRuntimePath`
				);
	const allocatorObjectAsset =
		object.allocatorObjectAsset === undefined
			? undefined
			: expectString(object.allocatorObjectAsset, `${label}.allocatorObjectAsset`);
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
	targetTriple: SupportedTargetTriple
): RuntimeTargetConfig {
	const object = expectObject(value, label);
	const compile = expectObject(object.compile, `${label}.compile`);
	const compileKind = expectCompileKind(compile.kind, `${label}.compile.kind`);
	const execution = expectObject(object.execution, `${label}.execution`);
	const sysrootFiles =
		object.sysrootFiles === undefined
			? undefined
			: expectAssetFileArray(object.sysrootFiles, `${label}.sysrootFiles`);
	const sysrootPack =
		object.sysrootPack === undefined
			? undefined
			: parseRuntimeAssetPack(object.sysrootPack, `${label}.sysrootPack`);
	if (!sysrootFiles && !sysrootPack) {
		throw new Error(`invalid ${label}: missing sysroot assets in wasm-rust runtime manifest`);
	}
	let parsedCompile: RuntimeTargetCompileConfig;
	if (
		compileKind === 'integrated-rustc' ||
		compileKind === 'integrated-rustc+component-encoder'
	) {
		parsedCompile = { kind: compileKind };
	} else {
		const llvm = expectObject(compile.llvm, `${label}.compile.llvm`);
		parsedCompile = {
			kind: compileKind,
			llvm: {
				llc: expectString(llvm.llc, `${label}.compile.llvm.llc`),
				...(llvm.llcWasm === undefined
					? {}
					: {
							llcWasm: expectString(llvm.llcWasm, `${label}.compile.llvm.llcWasm`)
						}),
				lld: expectString(llvm.lld, `${label}.compile.llvm.lld`),
				...(llvm.lldWasm === undefined
					? {}
					: {
							lldWasm: expectString(llvm.lldWasm, `${label}.compile.llvm.lldWasm`)
						}),
				...(llvm.lldData === undefined
					? {}
					: {
							lldData: expectString(llvm.lldData, `${label}.compile.llvm.lldData`)
						})
			},
			link: parseLinkConfig(compile.link, `${label}.compile.link`)
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
	root: Record<string, unknown>
): Partial<Record<SupportedTargetTriple, Omit<RuntimeTargetConfig, 'targetTriple'>>> {
	const targets = expectObject(root.targets, 'targets');
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
			targetTriple
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
		return {
			manifestVersion: 3,
			version: expectString(root.version, 'version'),
			hostTriple: expectString(root.hostTriple, 'hostTriple'),
			defaultTargetTriple: expectTargetTriple(
				root.defaultTargetTriple,
				'defaultTargetTriple'
			),
			compiler: parseCompilerConfig(root.compiler, 'compiler'),
			targets: parseVersionedTargets(root)
		};
	}

	if (root.manifestVersion === 2) {
		return {
			manifestVersion: 2,
			version: expectString(root.version, 'version'),
			hostTriple: expectString(root.hostTriple, 'hostTriple'),
			defaultTargetTriple: expectTargetTriple(
				root.defaultTargetTriple,
				'defaultTargetTriple'
			),
			compiler: parseCompilerConfig(root.compiler, 'compiler'),
			targets: parseVersionedTargets(root)
		};
	}

	const llvm = expectObject(root.llvm, 'llvm');
	return {
		version: expectString(root.version, 'version'),
		hostTriple: expectString(root.hostTriple, 'hostTriple'),
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
		link: parseLinkConfig(root.link, 'link')
	};
}

export function normalizeRuntimeManifest(
	value: RuntimeManifest | NormalizedRuntimeManifest
): NormalizedRuntimeManifest {
	if (isNormalizedRuntimeManifest(value)) {
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
			targets
		};
	}

	if (isRuntimeManifestV2(value) || isRuntimeManifestV3(value)) {
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
			targets
		};
	}

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

export async function loadRuntimeManifest(
	manifestUrl: string | URL,
	fetchImpl: typeof fetch = fetch
): Promise<RuntimeManifest> {
	const response = await fetchImpl(manifestUrl.toString());
	if (!response.ok) {
		throw new RuntimeManifestLoadError(manifestUrl.toString(), {
			status: response.status,
			statusText: response.statusText
		});
	}
	return parseRuntimeManifest(await response.json());
}

export function resolveRuntimeAssetUrl(baseUrl: string | URL, assetPath: string): string {
	return resolveVersionedAssetUrl(baseUrl, assetPath).toString();
}
