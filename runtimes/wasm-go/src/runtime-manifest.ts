import { fetchRuntimeAssetJson } from './runtime-asset.js';
import type {
	BrowserGoArtifactFormat,
	NormalizedRuntimeManifest,
	RuntimeAssetFile,
	RuntimeAssetPackReference,
	RuntimeCompilerConfig,
	RuntimeHostConfig,
	RuntimeManifestV1,
	RuntimePlannerConfig,
	RuntimeStdlibIndexAsset,
	RuntimeTargetConfig,
	RuntimeTargetExecutionConfig,
	RuntimeToolConfig,
	SupportedGoTarget
} from './types.js';

type RuntimeManifest = RuntimeManifestV1 | NormalizedRuntimeManifest;

function isNormalizedRuntimeManifest(value: RuntimeManifest): value is NormalizedRuntimeManifest {
	for (const target of Object.values(value.targets)) {
		if (target && 'target' in target) {
			return true;
		}
	}
	return false;
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-go runtime manifest`);
	}
	return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid ${label} in wasm-go runtime manifest`);
	}
	return value;
}

function expectStringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
		throw new Error(`invalid ${label} in wasm-go runtime manifest`);
	}
	return value as string[];
}

function expectPositiveInteger(value: unknown, label: string): number {
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		value <= 0 ||
		!Number.isFinite(value)
	) {
		throw new Error(`invalid ${label} in wasm-go runtime manifest`);
	}
	return value;
}

function expectNonNegativeInteger(value: unknown, label: string): number {
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		value < 0 ||
		!Number.isFinite(value)
	) {
		throw new Error(`invalid ${label} in wasm-go runtime manifest`);
	}
	return value;
}

function expectTarget(value: unknown, label: string): SupportedGoTarget {
	if (
		value !== 'wasip1/wasm' &&
		value !== 'wasip2/wasm' &&
		value !== 'wasip3/wasm' &&
		value !== 'js/wasm'
	) {
		throw new Error(`invalid ${label} in wasm-go runtime manifest`);
	}
	return value;
}

function expectArtifactFormat(
	value: unknown,
	label: string
): Exclude<BrowserGoArtifactFormat, 'go-archive'> {
	if (value !== 'wasi-core-wasm' && value !== 'js-wasm') {
		throw new Error(`invalid ${label} in wasm-go runtime manifest`);
	}
	return value;
}

function parseRuntimeAssetFileArray(value: unknown, label: string): RuntimeAssetFile[] {
	if (!Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-go runtime manifest`);
	}
	return value.map((entry, index) => {
		const object = expectObject(entry, `${label}[${index}]`);
		return {
			asset: expectString(object.asset, `${label}[${index}].asset`),
			runtimePath: expectString(object.runtimePath, `${label}[${index}].runtimePath`),
			...(typeof object.readonly === 'boolean' ? { readonly: object.readonly } : {})
		} satisfies RuntimeAssetFile;
	});
}

function parseRuntimePackReference(value: unknown, label: string): RuntimeAssetPackReference {
	const object = expectObject(value, label);
	return {
		asset: expectString(object.asset, `${label}.asset`),
		index: expectString(object.index, `${label}.index`),
		fileCount: expectNonNegativeInteger(object.fileCount, `${label}.fileCount`),
		totalBytes: expectNonNegativeInteger(object.totalBytes, `${label}.totalBytes`)
	};
}

function parseRuntimeStdlibIndexAsset(value: unknown, label: string): RuntimeStdlibIndexAsset {
	const object = expectObject(value, label);
	return {
		asset: expectString(object.asset, `${label}.asset`),
		packageCount: expectNonNegativeInteger(object.packageCount, `${label}.packageCount`)
	};
}

function parseRuntimeToolConfig(value: unknown, label: string): RuntimeToolConfig {
	const object = expectObject(value, label);
	const memory = expectObject(object.memory, `${label}.memory`);
	return {
		asset: expectString(object.asset, `${label}.asset`),
		argv0: expectString(object.argv0, `${label}.argv0`),
		memory: {
			initialPages: expectPositiveInteger(memory.initialPages, `${label}.memory.initialPages`),
			maximumPages: expectPositiveInteger(memory.maximumPages, `${label}.memory.maximumPages`)
		}
	};
}

function parseRuntimeHostConfig(value: unknown, label: string): RuntimeHostConfig {
	const object = expectObject(value, label);
	return {
		rootDirectory: expectString(object.rootDirectory, `${label}.rootDirectory`),
		pwd: expectString(object.pwd, `${label}.pwd`),
		tmpDirectory: expectString(object.tmpDirectory, `${label}.tmpDirectory`),
		env: expectStringArray(object.env, `${label}.env`)
	};
}

function parseRuntimePlannerConfig(value: unknown, label: string): RuntimePlannerConfig {
	const object = expectObject(value, label);
	return {
		workspaceRoot: expectString(object.workspaceRoot, `${label}.workspaceRoot`),
		importcfgPath: expectString(object.importcfgPath, `${label}.importcfgPath`),
		embedcfgPath: expectString(object.embedcfgPath, `${label}.embedcfgPath`),
		compileOutputPath: expectString(object.compileOutputPath, `${label}.compileOutputPath`),
		linkOutputPath: expectString(object.linkOutputPath, `${label}.linkOutputPath`),
		defaultLang: expectString(object.defaultLang, `${label}.defaultLang`),
		defaultTrimpath: expectString(object.defaultTrimpath, `${label}.defaultTrimpath`)
	};
}

function parseRuntimeCompilerConfig(value: unknown, label: string): RuntimeCompilerConfig {
	const object = expectObject(value, label);
	return {
		compile: parseRuntimeToolConfig(object.compile, `${label}.compile`),
		link: parseRuntimeToolConfig(object.link, `${label}.link`),
		compileTimeoutMs: expectPositiveInteger(object.compileTimeoutMs, `${label}.compileTimeoutMs`),
		linkTimeoutMs: expectPositiveInteger(object.linkTimeoutMs, `${label}.linkTimeoutMs`),
		host: parseRuntimeHostConfig(object.host, `${label}.host`)
	};
}

function parseExecutionConfig(
	value: unknown,
	label: string
): RuntimeTargetExecutionConfig {
	const object = expectObject(value, label);
	if (object.kind !== 'wasi-preview1' && object.kind !== 'js-wasm-exec') {
		throw new Error(`invalid ${label}.kind in wasm-go runtime manifest`);
	}
	if (object.kind === 'js-wasm-exec') {
		return {
			kind: 'js-wasm-exec',
			wasmExecJs: expectString(object.wasmExecJs, `${label}.wasmExecJs`)
		};
	}
	return {
		kind: 'wasi-preview1'
	};
}

function expectedTargetShape(target: SupportedGoTarget) {
	if (target === 'wasip1/wasm') {
		return {
			goos: ['wasip1'],
			goarch: 'wasm'
		} as const;
	}
	if (target === 'wasip2/wasm') {
		return {
			goos: ['wasip1', 'wasip2'],
			goarch: 'wasm'
		} as const;
	}
	if (target === 'wasip3/wasm') {
		return {
			goos: ['wasip1', 'wasip3'],
			goarch: 'wasm'
		} as const;
	}
	return {
		goos: ['js'],
		goarch: 'wasm'
	} as const;
}

function parseTargetConfig(
	target: SupportedGoTarget,
	value: unknown,
	label: string
): RuntimeTargetConfig {
	const object = expectObject(value, label);
	const expected = expectedTargetShape(target);
	const goos = expectString(object.goos, `${label}.goos`) as RuntimeTargetConfig['goos'];
	const goarch = expectString(object.goarch, `${label}.goarch`);
	if (!(expected.goos as readonly string[]).includes(goos) || goarch !== expected.goarch) {
		throw new Error(`invalid ${label}.goos/goarch in wasm-go runtime manifest`);
	}
	return {
		target,
		goos,
		goarch,
		artifactFormat: expectArtifactFormat(object.artifactFormat, `${label}.artifactFormat`),
		...(object.sysrootFiles !== undefined
			? { sysrootFiles: parseRuntimeAssetFileArray(object.sysrootFiles, `${label}.sysrootFiles`) }
			: {}),
		...(object.sysrootPack !== undefined
			? { sysrootPack: parseRuntimePackReference(object.sysrootPack, `${label}.sysrootPack`) }
			: {}),
		...(object.stdlibIndex !== undefined
			? { stdlibIndex: parseRuntimeStdlibIndexAsset(object.stdlibIndex, `${label}.stdlibIndex`) }
			: {}),
		execution: parseExecutionConfig(object.execution, `${label}.execution`),
		planner: parseRuntimePlannerConfig(object.planner, `${label}.planner`)
	};
}

export function parseRuntimeManifest(value: unknown): RuntimeManifestV1 {
	const root = expectObject(value, 'root');
	if (root.manifestVersion !== 1) {
		throw new Error('invalid root.manifestVersion in wasm-go runtime manifest');
	}
	const targetsObject = expectObject(root.targets, 'root.targets');
	const targets: RuntimeManifestV1['targets'] = {};
	for (const [targetKey, targetValue] of Object.entries(targetsObject)) {
		const target = expectTarget(targetKey, `root.targets.${targetKey}`);
		targets[target] = parseTargetConfig(target, targetValue, `root.targets.${target}`);
	}
	return {
		manifestVersion: 1,
		version: expectString(root.version, 'root.version'),
		goVersion: expectString(root.goVersion, 'root.goVersion'),
		defaultTarget: expectTarget(root.defaultTarget, 'root.defaultTarget'),
		compiler: parseRuntimeCompilerConfig(root.compiler, 'root.compiler'),
		targets
	};
}

export function normalizeRuntimeManifest(
	value: RuntimeManifest | unknown
): NormalizedRuntimeManifest {
	const parsed = isNormalizedRuntimeManifest(value as RuntimeManifest)
		? (value as NormalizedRuntimeManifest)
		: (() => {
				const manifest = parseRuntimeManifest(value);
				const normalizedTargets: NormalizedRuntimeManifest['targets'] = {};
				for (const target of Object.keys(manifest.targets) as SupportedGoTarget[]) {
					const config = manifest.targets[target];
					if (!config) {
						continue;
					}
					normalizedTargets[target] = {
						target,
						...config
					};
				}
				return {
					manifestVersion: 1,
					version: manifest.version,
					goVersion: manifest.goVersion,
					defaultTarget: manifest.defaultTarget,
					compiler: manifest.compiler,
					targets: normalizedTargets
				} satisfies NormalizedRuntimeManifest;
			})();
	if (!parsed.targets[parsed.defaultTarget]) {
		throw new Error(
			`default target ${parsed.defaultTarget} is not present in wasm-go runtime manifest`
		);
	}
	return parsed;
}

export function resolveTargetManifest(
	manifest: RuntimeManifest | unknown,
	target: SupportedGoTarget | undefined
): RuntimeTargetConfig {
	const normalized = normalizeRuntimeManifest(manifest);
	const resolvedTarget = target || normalized.defaultTarget;
	const targetConfig = normalized.targets[resolvedTarget];
	if (!targetConfig) {
		throw new Error(`unsupported wasm-go target ${resolvedTarget}`);
	}
	return targetConfig;
}

export async function loadRuntimeManifest(
	manifestUrl: string | URL,
	fetchImpl: typeof fetch = fetch,
	reportProgress?: (loaded: number, total?: number) => void
): Promise<NormalizedRuntimeManifest> {
	try {
		return normalizeRuntimeManifest(
			await fetchRuntimeAssetJson(
				manifestUrl,
				'wasm-go runtime manifest',
				fetchImpl,
				reportProgress
			)
		);
	} catch (error) {
		throw new Error(
			`failed to load wasm-go runtime manifest from ${manifestUrl.toString()}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
