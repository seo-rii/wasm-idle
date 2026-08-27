import {
	compileRust,
	createBrowserRustCompileRequestIdentity,
	preloadBrowserRustRuntime as preloadBrowserRustRuntimeInternal,
	resolveBrowserRustDebugMode,
	type BrowserRustArtifact,
	type BrowserRustCompileProgress,
	type BrowserRustCompiler,
	type BrowserRustCompilerFactory,
	type BrowserRustCompilerResult,
	type BrowserRustCompileRequest,
	type BrowserRustCompileStage,
	type BrowserRustDebugMode,
	type BrowserRustWorkerLimits,
	type CompilerLogLevel,
	type CompilerLogRecord,
	type CompilerDiagnostic,
	type CompileRustDependencies,
	type CreateRustCompilerOptions,
	type DwarfDebugDescriptor,
	type PreloadBrowserRustRuntimeOptions,
	type RuntimeAssetDeliveryBudgetDescriptor,
	type RuntimeAssetDeliveryBudgetSnapshot,
	type RuntimeRustCompilerProvenance
} from './compiler.js';
import {
	executeBrowserRustArtifact as executeBrowserRustArtifactInternal,
	type BrowserExecutionOptions,
	type BrowserExecutionResult
} from './browser-execution.js';
import { loadBundledRuntimeContext } from './compiler-runtime.js';
import {
	configureVerifiedRuntimeExecutableModuleUrls,
	hasVerifiedRuntimeExecutableModuleUrls,
	parseWasmRustRuntimeProfileFromModuleUrl,
	type WasmRustRuntimeProfile
} from './runtime-manifest.js';

export type {
	BrowserRustArtifact,
	BrowserRustCompiler,
	BrowserRustCompilerFactory,
	BrowserRustCompilerResult,
	BrowserRustCompileRequest,
	BrowserRustCompileProgress,
	BrowserRustCompileStage,
	BrowserRustDebugMode,
	BrowserRustWorkerLimits,
	CompilerLogLevel,
	CompilerLogRecord,
	CompilerDiagnostic,
	CreateRustCompilerOptions,
	DwarfDebugDescriptor,
	PreloadBrowserRustRuntimeOptions,
	RuntimeAssetDeliveryBudgetDescriptor,
	RuntimeAssetDeliveryBudgetSnapshot,
	RuntimeRustCompilerProvenance,
	BrowserExecutionOptions,
	BrowserExecutionResult
};
export { createBrowserRustCompileRequestIdentity, resolveBrowserRustDebugMode };
export { configureVerifiedRuntimeExecutableModuleUrls };

const bundledRuntimeProfile = parseWasmRustRuntimeProfileFromModuleUrl(import.meta.url);

function requireVerifiedExecutableGraph() {
	if (bundledRuntimeProfile && !hasVerifiedRuntimeExecutableModuleUrls()) {
		throw new Error(
			'wasm-rust executable modules must be loaded through a receipt-verified graph'
		);
	}
}

function assertMatchingRuntimeProfile(
	provided: WasmRustRuntimeProfile | undefined,
	bundled: WasmRustRuntimeProfile
) {
	if (!provided) return;
	if (
		provided.protocolVersion !== bundled.protocolVersion ||
		provided.profileId !== bundled.profileId ||
		provided.manifestPath !== bundled.manifestPath ||
		provided.manifestFingerprint !== bundled.manifestFingerprint ||
		provided.manifestReceipt.bytes !== bundled.manifestReceipt.bytes ||
		provided.manifestReceipt.sha256 !== bundled.manifestReceipt.sha256 ||
		provided.moduleUrl !== bundled.moduleUrl
	) {
		throw new Error('wasm-rust runtime dependency profile conflicts with the bundled profile');
	}
}

function sealCompileDependencies(
	dependencies: CompileRustDependencies | undefined,
	profile: WasmRustRuntimeProfile
): CompileRustDependencies {
	assertMatchingRuntimeProfile(dependencies?.runtimeProfile, profile);
	const {
		loadManifest: _loadManifest,
		runtimeProfile: _runtimeProfile,
		...sealed
	} = dependencies || {};
	return { ...sealed, runtimeProfile: profile };
}

export async function preloadBrowserRustRuntime(options: PreloadBrowserRustRuntimeOptions = {}) {
	requireVerifiedExecutableGraph();
	if (bundledRuntimeProfile) {
		assertMatchingRuntimeProfile(options.dependencies?.runtimeProfile, bundledRuntimeProfile);
	}
	const {
		loadManifest: _loadManifest,
		runtimeProfile: _runtimeProfile,
		...preloadDependencies
	} = options.dependencies || {};
	return preloadBrowserRustRuntimeInternal({
		...options,
		...(bundledRuntimeProfile
			? {
					dependencies: {
						...preloadDependencies,
						runtimeProfile: bundledRuntimeProfile
					}
				}
			: {})
	});
}

export async function executeBrowserRustArtifact(
	artifact: BrowserRustArtifact,
	runtimeBaseUrlOrOptions?: string | BrowserExecutionOptions,
	options?: BrowserExecutionOptions
): Promise<BrowserExecutionResult> {
	requireVerifiedExecutableGraph();
	if (typeof runtimeBaseUrlOrOptions === 'string') {
		return executeBrowserRustArtifactInternal(artifact, runtimeBaseUrlOrOptions, options);
	}
	if (artifact.format === 'component' && bundledRuntimeProfile) {
		const context = await loadBundledRuntimeContext(
			undefined,
			artifact.targetTriple,
			bundledRuntimeProfile
		);
		return executeBrowserRustArtifactInternal(
			artifact,
			context.versionedRuntimeBaseUrl.toString(),
			runtimeBaseUrlOrOptions
		);
	}
	return executeBrowserRustArtifactInternal(artifact, runtimeBaseUrlOrOptions);
}

export async function createRustCompiler(
	options?: CreateRustCompilerOptions
): Promise<BrowserRustCompiler> {
	requireVerifiedExecutableGraph();
	return {
		compile: async (request) =>
			compileRust(
				request,
				bundledRuntimeProfile
					? sealCompileDependencies(options?.dependencies, bundledRuntimeProfile)
					: options?.dependencies
			)
	};
}

const defaultFactory: BrowserRustCompilerFactory = createRustCompiler;

export default defaultFactory;
