import Runtime from './runtime.js';
import { resolveDebugMode } from './types.js';
import {
	compileClang,
	createClangCompiler,
	preloadBrowserClangRuntime,
	type CreateClangCompilerOptions,
	type PreloadBrowserClangRuntimeOptions
} from './compiler.js';
import {
	executeBrowserClangArtifact,
	createBrowserWasiHost,
	type BrowserExecutionImportContext,
	type BrowserExecutionOptions,
	type BrowserExecutionResult,
	type BrowserWasiHost
} from './browser-execution.js';
import {
	loadRuntimeManifest,
	parseRuntimeManifest,
	resolveRuntimeManifestUrl
} from './runtime-manifest.js';
import { resolveRuntimeAssetUrls } from './runtime-assets.js';
import { resolveRuntimeBaseUrl, resolveRuntimeBaseUrlFromManifestUrl } from './url.js';
import { normalizeDwarfWorkspacePath } from './workspace.js';
import { MemFS, Memory, untar } from './memory/index.js';
import { compile, getInstance, readBuffer } from './wasm.js';
import {
	BrowserClangDebugController,
	BrowserClangDebugDriver,
	createBrowserClangDebugController,
	createBrowserClangDebugDriver
} from './debug/index.js';

export type {
	BrowserClangArtifact,
	BrowserClangArtifactFormat,
	BrowserClangCompileProgress,
	BrowserClangCompileRequest,
	BrowserClangCompileStage,
	BrowserClangCompiler,
	BrowserClangCompilerFactory,
	BrowserClangCompilerResult,
	BrowserClangDebugMode,
	BrowserClangRuntimeOptions,
	BrowserClangRuntimeRunOptions,
	BrowserClangWorkspaceFile,
	CompilerDiagnostic,
	CompilerLogLevel,
	CompilerLogRecord,
	DebugCommand,
	DebugFrame,
	DebugPauseReason,
	DebugSessionEvent,
	DebugStructFieldMetadata,
	DebugVariable,
	DebugVariableMetadata,
	DwarfDebugDescriptor,
	ProgressSink,
	RuntimeBuildInfo,
	RuntimeBuildProducerRecord,
	RuntimeBuildToolchainInfo,
	RuntimeCompilerProvenance,
	RuntimeManifestV1,
	SupportedClangLanguage,
	SupportedClangTarget
} from './types.js';
export type {
	BrowserExecutionImportContext,
	BrowserExecutionOptions,
	BrowserExecutionResult,
	BrowserWasiHost
} from './browser-execution.js';
export type { CreateClangCompilerOptions, PreloadBrowserClangRuntimeOptions } from './compiler.js';
export type { ClangRuntimeLocation } from './compiler.js';
export type { RuntimeAssetUrls } from './runtime-assets.js';
export type { MemFsOptions, TarFileSystem } from './memory/index.js';
export type {
	BrowserClangDebugRunRequest,
	BrowserClangDebugRuntimeOptions,
	CreateBrowserClangDebugControllerOptions,
	CreateBrowserClangDebugDriverOptions
} from './debug/index.js';

export {
	BrowserClangDebugController,
	BrowserClangDebugDriver,
	MemFS,
	Memory,
	Runtime as BrowserClangRuntime,
	compile,
	compileClang,
	createBrowserClangDebugController,
	createBrowserClangDebugDriver,
	createBrowserWasiHost,
	createClangCompiler,
	executeBrowserClangArtifact,
	getInstance,
	loadRuntimeManifest,
	normalizeDwarfWorkspacePath,
	parseRuntimeManifest,
	preloadBrowserClangRuntime,
	readBuffer,
	resolveRuntimeAssetUrls,
	resolveRuntimeBaseUrl,
	resolveRuntimeBaseUrlFromManifestUrl,
	resolveDebugMode,
	resolveRuntimeManifestUrl,
	untar
};

const defaultFactory = createClangCompiler;
export default defaultFactory;
