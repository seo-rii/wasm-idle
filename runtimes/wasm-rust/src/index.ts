import {
	compileRust,
	createBrowserRustCompileRequestIdentity,
	preloadBrowserRustRuntime,
	resolveBrowserRustDebugMode,
	type BrowserRustArtifact,
	type BrowserRustCompileProgress,
	type BrowserRustCompiler,
	type BrowserRustCompilerFactory,
	type BrowserRustCompilerResult,
	type BrowserRustCompileRequest,
	type BrowserRustCompileStage,
	type BrowserRustDebugMode,
	type CompilerLogLevel,
	type CompilerLogRecord,
	type CompilerDiagnostic,
	type CreateRustCompilerOptions,
	type DwarfDebugDescriptor,
	type PreloadBrowserRustRuntimeOptions,
	type RuntimeRustCompilerProvenance
} from './compiler.js';
import {
	executeBrowserRustArtifact,
	type BrowserExecutionOptions,
	type BrowserExecutionResult
} from './browser-execution.js';

export type {
	BrowserRustArtifact,
	BrowserRustCompiler,
	BrowserRustCompilerFactory,
	BrowserRustCompilerResult,
	BrowserRustCompileRequest,
	BrowserRustCompileProgress,
	BrowserRustCompileStage,
	BrowserRustDebugMode,
	CompilerLogLevel,
	CompilerLogRecord,
	CompilerDiagnostic,
	CreateRustCompilerOptions,
	DwarfDebugDescriptor,
	PreloadBrowserRustRuntimeOptions,
	RuntimeRustCompilerProvenance,
	BrowserExecutionOptions,
	BrowserExecutionResult
};
export {
	createBrowserRustCompileRequestIdentity,
	executeBrowserRustArtifact,
	preloadBrowserRustRuntime,
	resolveBrowserRustDebugMode
};

export async function createRustCompiler(
	options?: CreateRustCompilerOptions
): Promise<BrowserRustCompiler> {
	return {
		compile: async (request) => compileRust(request, options?.dependencies)
	};
}

const defaultFactory: BrowserRustCompilerFactory = createRustCompiler;

export default defaultFactory;
