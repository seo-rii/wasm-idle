import {
	compileGo,
	createGoCompiler,
	preloadBrowserGoRuntime,
	type CompileGoDependencies,
	type CreateGoCompilerOptions,
	type PreloadBrowserGoRuntimeOptions
} from './compiler.js';
import {
	createBrowserGoBuildPlan
} from './build-planner.js';
import {
	executeBrowserGoArtifact,
	createBrowserWasiHost,
	type BrowserExecutionOptions,
	type BrowserExecutionResult,
	type BrowserWasiHost
} from './browser-execution.js';
import {
	clearRuntimePackCache,
	fetchRuntimeAssetBytes,
	fetchRuntimeAssetJson,
	loadRuntimePackEntries,
	parseRuntimePackIndex
} from './runtime-asset.js';
import {
	loadRuntimeManifest,
	normalizeRuntimeManifest,
	parseRuntimeManifest,
	resolveTargetManifest
} from './runtime-manifest.js';

export type {
	BrowserGoArtifact,
	BrowserGoArtifactFormat,
	BrowserGoBuildPlan,
	BrowserGoCompileProgress,
	BrowserGoCompileRequest,
	BrowserGoCompileStage,
	BrowserGoCompiler,
	BrowserGoCompilerFactory,
	BrowserGoCompilerResult,
	BrowserGoGeneratedFile,
	BrowserGoSourceFile,
	BrowserGoToolInvocation,
	BrowserGoToolResult,
	BrowserGoWorkspaceFile,
	CompilerDiagnostic,
	CompilerLogLevel,
	CompilerLogRecord,
	GoEmbedFile,
	GoEmbedPattern,
	GoPackageArchive,
	NormalizedRuntimeManifest,
	RuntimeAssetFile,
	RuntimeAssetPackReference,
	RuntimeCompilerConfig,
	RuntimeHostConfig,
	RuntimeManifestV1,
	RuntimePackIndex,
	RuntimePackIndexEntry,
	RuntimePlannerConfig,
	RuntimeTargetConfig,
	RuntimeTargetExecutionConfig,
	RuntimeToolConfig,
	RuntimeToolMemoryConfig,
	SupportedGoTarget
} from './types.js';
export type {
	BrowserExecutionOptions,
	BrowserExecutionResult,
	BrowserWasiHost
} from './browser-execution.js';
export type {
	CompileGoDependencies,
	CreateGoCompilerOptions,
	PreloadBrowserGoRuntimeOptions
} from './compiler.js';
export {
	clearRuntimePackCache,
	compileGo,
	createBrowserGoBuildPlan,
	createBrowserWasiHost,
	createGoCompiler,
	executeBrowserGoArtifact,
	fetchRuntimeAssetBytes,
	fetchRuntimeAssetJson,
	loadRuntimeManifest,
	loadRuntimePackEntries,
	normalizeRuntimeManifest,
	parseRuntimeManifest,
	parseRuntimePackIndex,
	preloadBrowserGoRuntime,
	resolveTargetManifest
};

const defaultFactory = createGoCompiler;

export default defaultFactory;
