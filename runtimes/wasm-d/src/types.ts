export type BrowserDTarget = 'wasm32-wasi';
export type BrowserDArtifactFormat = 'wasi-core-wasm';
export type BrowserDCompileStage = 'manifest' | 'assets' | 'compile' | 'link' | 'done';
export type CompilerDiagnosticSeverity = 'error' | 'warning' | 'other';

export interface BrowserDCompileProgress {
	stage: BrowserDCompileStage;
	completed: number;
	total: number;
	percent: number;
	message?: string;
}

export interface CompilerDiagnostic {
	fileName?: string | null;
	lineNumber: number;
	columnNumber?: number;
	severity: CompilerDiagnosticSeverity;
	message: string;
}

export interface BrowserDCompileRequest {
	code: string;
	fileName?: string;
	target?: BrowserDTarget;
	args?: string[];
	compileArgs?: string[];
	linkArgs?: string[];
	log?: boolean;
	stdin?: () => string | Uint8Array | ArrayBuffer | null;
	onProgress?: (progress: BrowserDCompileProgress) => void;
}

export interface BrowserDArtifact {
	bytes: Uint8Array | ArrayBuffer;
	wasm?: WebAssembly.Module;
	target: BrowserDTarget;
	format: BrowserDArtifactFormat;
	fileName: string;
}

export interface BrowserDCompilerResult {
	success: boolean;
	artifact?: BrowserDArtifact;
	stdout?: string;
	stderr?: string;
	diagnostics?: CompilerDiagnostic[];
}

export interface BrowserDCompiler {
	compile: (request: BrowserDCompileRequest) => Promise<BrowserDCompilerResult>;
}

export interface BrowserDExecutionOptions {
	args?: string[];
	programName?: string;
	env?: Record<string, string>;
	stdin?: () => string | Uint8Array | ArrayBuffer | null;
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
}

export interface BrowserDExecutionResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface RuntimeAssetConfig {
	asset: string;
	argv0?: string;
}

export interface EmscriptenLldRuntimeAssetConfig {
	kind: 'emscripten-lld';
	argv0?: string;
	js: RuntimeAssetConfig;
	wasm: RuntimeAssetConfig;
	data: RuntimeAssetConfig;
}

export interface RuntimeManifestV1 {
	manifestVersion: 1;
	name: 'wasm-d';
	version: string;
	defaultTarget: BrowserDTarget;
	compiler: {
			ldc2: RuntimeAssetConfig;
			toolchain: RuntimeAssetConfig;
			linker: EmscriptenLldRuntimeAssetConfig;
	};
	targets: Record<
		BrowserDTarget,
		{
			artifactFormat: BrowserDArtifactFormat;
			execution: {
				kind: 'wasi-preview1';
			};
		}
	>;
}
