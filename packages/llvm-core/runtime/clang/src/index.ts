import Runtime from './runtime.js';
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
	BrowserClangRuntimeOptions,
	BrowserClangRuntimeRunOptions,
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
	ProgressSink,
	RuntimeBuildInfo,
	RuntimeBuildProducerRecord,
	RuntimeBuildToolchainInfo,
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
	parseRuntimeManifest,
	preloadBrowserClangRuntime,
	readBuffer,
	resolveRuntimeAssetUrls,
	resolveRuntimeBaseUrl,
	resolveRuntimeBaseUrlFromManifestUrl,
	resolveRuntimeManifestUrl,
	untar
};

const defaultFactory = createClangCompiler;
export default defaultFactory;
