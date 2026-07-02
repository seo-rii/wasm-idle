import { compileDotnet, createDotnetCompiler, parseDotnetDiagnostics } from './compiler.js';
import { executeBrowserDotnetArtifact } from './browser-execution.js';
import { loadDotnetCompilerRuntime, resetDotnetCompilerRuntimeForTests } from './runtime-loader.js';

export type {
	BrowserDotnetArtifact,
	BrowserDotnetArtifactFormat,
	BrowserDotnetCompileProgress,
	BrowserDotnetCompileRequest,
	BrowserDotnetCompiler,
	BrowserDotnetCompilerResult,
	CompilerDiagnostic,
	CompilerLogRecord,
	DotnetLanguage,
	DotnetRuntimeCompileRequest,
	DotnetRuntimeCompileResponse,
	DotnetRuntimeRunRequest,
	DotnetRuntimeRunResponse,
	DotnetTarget
} from './types.js';
export type {
	BrowserDotnetExecutionOptions,
	BrowserDotnetExecutionResult
} from './browser-execution.js';
export type { DotnetCompilerRuntime, DotnetCompilerRuntimeOptions } from './runtime-loader.js';
export type { CompileDotnetDependencies, CreateDotnetCompilerOptions } from './compiler.js';

export {
	compileDotnet,
	createDotnetCompiler,
	executeBrowserDotnetArtifact,
	loadDotnetCompilerRuntime,
	parseDotnetDiagnostics,
	resetDotnetCompilerRuntimeForTests
};

export default createDotnetCompiler;
