import { compileDotnet, createDotnetCompiler, parseDotnetDiagnostics } from './compiler.js';
import { executeBrowserDotnetArtifact } from './browser-execution.js';
import { loadDotnetCompilerRuntime, resetDotnetCompilerRuntimeForTests } from './runtime-loader.js';
export { connectMonoDebugAgent } from './debug-agent.js';
export type { MonoDebugAgentConnection, MonoDebugCommandResponse } from './debug-agent.js';

export type {
	BrowserDotnetArtifact,
	BrowserDotnetArtifactFormat,
	BrowserDotnetCompileProgress,
	BrowserDotnetCompileRequest,
	BrowserDotnetCompiler,
	BrowserDotnetCompilerPrepareOptions,
	BrowserDotnetCompilerResult,
	CompilerDiagnostic,
	CompilerLogRecord,
	DotnetLanguage,
	DotnetDebugMetadata,
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
