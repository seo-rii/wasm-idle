export type DebugCommand = 'continue' | 'stepInto' | 'nextLine' | 'stepOut';
export type DebugPauseReason = 'breakpoint' | 'entry' | 'step' | 'nextLine' | 'stepOut';
export type CompilerDiagnosticSeverity = 'error' | 'warning' | 'other';
export type DebugVariableKind = 'number' | 'bool' | 'array' | 'text';
export type DebugArrayElementKind = 'int' | 'float' | 'double' | 'bool' | 'char';
export type SupportedClangLanguage = 'C' | 'CPP';
export type SupportedClangTarget = 'wasm32-wasi';
export type BrowserClangArtifactFormat = 'wasi-core-wasm';
export type BrowserClangCompileStage = 'bootstrap' | 'compile' | 'link' | 'done';
export type CompilerLogLevel = 'log' | 'warn' | 'error' | 'debug';

export interface ProgressSink {
	set?: (value: number) => void;
}

export interface CompilerDiagnostic {
	fileName?: string | null;
	lineNumber: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity: CompilerDiagnosticSeverity;
	message: string;
}

export interface CompilerLogRecord {
	level: CompilerLogLevel;
	message: string;
}

export interface DebugVariable {
	name: string;
	value: string;
}

export interface DebugStructFieldMetadata {
	name: string;
	kind: DebugArrayElementKind;
	offset: number;
}

export interface DebugVariableMetadata {
	slot: number;
	name: string;
	kind: DebugVariableKind;
	fromLine: number;
	toLine: number;
	elementKind?: DebugArrayElementKind;
	length?: number;
	dimensions?: number[];
	structFields?: DebugStructFieldMetadata[];
	structSize?: number;
}

export interface DebugFrame {
	functionName: string;
	line: number;
}

export type DebugSessionEvent =
	| {
			type: 'pause';
			line: number;
			reason: DebugPauseReason;
			locals: DebugVariable[];
			callStack: DebugFrame[];
	  }
	| { type: 'resume'; command: DebugCommand }
	| { type: 'stop' };

export interface BrowserClangPauseEvent {
	type: 'pause';
	line: number;
	reason: DebugPauseReason;
	locals: DebugVariable[];
	callStack: DebugFrame[];
}

export interface BrowserClangDebugMetadata {
	variableMetadata: Record<number, DebugVariableMetadata[]>;
	globalVariableMetadata: DebugVariableMetadata[];
	functionMetadata: Record<number, string>;
}

export interface BrowserClangCompileProgress {
	stage: BrowserClangCompileStage;
	completed: number;
	total: number;
	percent: number;
	message?: string;
}

export interface BrowserClangCompileRequest {
	code: string;
	language?: SupportedClangLanguage;
	target?: SupportedClangTarget;
	fileName?: string;
	compileArgs?: string[];
	cppVersion?: string;
	cVersion?: string;
	log?: boolean;
	showTiming?: boolean;
	debug?: boolean;
	breakpoints?: number[];
	pauseOnEntry?: boolean;
	onProgress?: (progress: BrowserClangCompileProgress) => void;
}

export interface BrowserClangArtifact {
	bytes: Uint8Array | ArrayBuffer;
	wasm?: WebAssembly.Module;
	target: SupportedClangTarget;
	format: BrowserClangArtifactFormat;
	fileName?: string;
	language?: SupportedClangLanguage;
	debugMetadata?: BrowserClangDebugMetadata;
}

export interface BrowserClangCompilerResult {
	success: boolean;
	stdout?: string;
	stderr?: string;
	diagnostics?: CompilerDiagnostic[];
	logs?: string[];
	logRecords?: CompilerLogRecord[];
	artifact?: BrowserClangArtifact;
}

export interface BrowserExecutionOptions {
	args?: string[];
	programName?: string;
	env?: Record<string, string>;
	stdin?: () => string | Uint8Array | ArrayBuffer | null;
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
	files?: Array<{ path: string; contents: string | Uint8Array | ArrayBuffer }>;
}

export interface BrowserExecutionResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface BrowserClangCompiler {
	compile: (request: BrowserClangCompileRequest) => Promise<BrowserClangCompilerResult>;
}

export type BrowserClangCompilerFactory = (
	options?: import('./compiler.js').CreateClangCompilerOptions
) => Promise<BrowserClangCompiler>;

export interface BrowserClangRuntimeOptions {
	stdin?: () => string;
	stdout?: (chunk: string) => void;
	progress?: (value: number) => void;
	onDebugEvent?: (event: BrowserClangPauseEvent) => void;
	log?: boolean;
	showTiming?: boolean;
	runtimeBaseUrl?: string | URL;
	path?: string | URL;
	manifest?: RuntimeManifestV1;
}

export interface BrowserClangRuntimeRunOptions {
	language?: SupportedClangLanguage;
	fileName?: string;
	args?: string[];
	compileArgs?: string[];
	programArgs?: string[];
	cppVersion?: string;
	cVersion?: string;
	debug?: boolean;
	breakpoints?: number[];
	pauseOnEntry?: boolean;
	debugBuffer?: Int32Array;
	interruptBuffer?: Uint8Array;
	watchBuffer?: Int32Array;
	watchResultBuffer?: Int32Array;
}

export interface RuntimeToolAssetConfig {
	asset: string;
	argv0: string;
}

export interface RuntimeCompilerConfig {
	memfs: RuntimeToolAssetConfig;
	clang: RuntimeToolAssetConfig;
	lld: RuntimeToolAssetConfig;
	sysroot: {
		asset: string;
		runtimeRoot?: string;
	};
	defaultCppStandard?: string;
	defaultCStandard?: string;
}

export interface RuntimeClangdConfig {
	js: string;
	wasm: string;
}

export interface RuntimeManifestTarget {
	artifactFormat: BrowserClangArtifactFormat;
	execution: {
		kind: 'wasi-preview1';
	};
}

export interface RuntimeManifestV1 {
	manifestVersion: 1;
	version: string;
	defaultTarget: SupportedClangTarget;
	compiler: RuntimeCompilerConfig;
	targets: Record<SupportedClangTarget, RuntimeManifestTarget>;
	clangd: RuntimeClangdConfig;
}

export interface RuntimeBuildAssetRecord {
	asset: string;
	size: number;
	sha256: string;
}

export interface RuntimeBuildInfo {
	generatedAt: string;
	source: string;
	assets: RuntimeBuildAssetRecord[];
}
