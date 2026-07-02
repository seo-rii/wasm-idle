import { compileD, createDCompiler, type CreateDCompilerOptions } from './compiler.js';
import { executeBrowserDArtifact } from './browser-execution.js';
import { loadRuntimeManifest, parseRuntimeManifest } from './runtime-manifest.js';
import { parseTar } from './tar.js';

export type {
	BrowserDArtifact,
	BrowserDArtifactFormat,
	BrowserDCompiler,
	BrowserDCompilerResult,
	BrowserDCompileProgress,
	BrowserDCompileRequest,
	BrowserDCompileStage,
	BrowserDExecutionOptions,
	BrowserDExecutionResult,
	BrowserDTarget,
	CompilerDiagnostic,
	CompilerDiagnosticSeverity,
	RuntimeManifestV1
} from './types.js';
export type { CreateDCompilerOptions } from './compiler.js';

export {
	compileD,
	createDCompiler,
	executeBrowserDArtifact,
	loadRuntimeManifest,
	parseRuntimeManifest,
	parseTar
};

const defaultFactory = createDCompiler;
export default defaultFactory;
