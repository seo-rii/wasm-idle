import {
	compileRust,
	preloadBrowserRustRuntime,
	type BrowserRustCompileProgress,
	type BrowserRustCompiler,
	type BrowserRustCompilerFactory,
	type BrowserRustCompilerResult,
	type BrowserRustCompileRequest,
	type BrowserRustCompileStage,
	type CompilerLogLevel,
	type CompilerLogRecord,
	type CompilerDiagnostic,
	type CreateRustCompilerOptions,
	type PreloadBrowserRustRuntimeOptions
} from './compiler.js';
import {
	executeBrowserRustArtifact,
	type BrowserExecutionOptions,
	type BrowserExecutionResult
} from './browser-execution.js';

export type {
	BrowserRustCompiler,
	BrowserRustCompilerFactory,
	BrowserRustCompilerResult,
	BrowserRustCompileRequest,
	BrowserRustCompileProgress,
	BrowserRustCompileStage,
	CompilerLogLevel,
	CompilerLogRecord,
	CompilerDiagnostic,
	CreateRustCompilerOptions,
	PreloadBrowserRustRuntimeOptions,
	BrowserExecutionOptions,
	BrowserExecutionResult
};
export { executeBrowserRustArtifact, preloadBrowserRustRuntime };

export async function createRustCompiler(
	options?: CreateRustCompilerOptions
): Promise<BrowserRustCompiler> {
	return {
		compile: async (request) => compileRust(request, options?.dependencies)
	};
}

const defaultFactory: BrowserRustCompilerFactory = createRustCompiler;

export default defaultFactory;
