export type SupportedTargetTriple = 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3';
export type BrowserRustArtifactFormat = 'core-wasm' | 'component';
export type BrowserRustCompileStage =
	| 'manifest'
	| 'fetch-rustc'
	| 'fetch-sysroot'
	| 'prepare-fs'
	| 'init-thread-pool'
	| 'rustc-main'
	| 'await-bitcode'
	| 'link'
	| 'componentize'
	| 'retry'
	| 'done';

export interface CompilerDiagnostic {
	lineNumber: number;
	columnNumber: number;
	severity: 'error' | 'warning' | 'other';
	message: string;
}

export type CompilerLogLevel = 'log' | 'warn' | 'error' | 'debug';

export interface CompilerLogRecord {
	level: CompilerLogLevel;
	message: string;
}

export interface BrowserRustCompileProgress {
	stage: BrowserRustCompileStage;
	attempt: number;
	maxAttempts: number;
	completed: number;
	total: number;
	percent: number;
	message?: string;
	bytesCompleted?: number;
	bytesTotal?: number;
}

export interface BrowserRustCompileRequest {
	code: string;
	/**
	 * Reserved for a future multi-channel compiler surface. Passing a value is currently rejected.
	 */
	channel?: string;
	/**
	 * Reserved for a future compile-mode surface. Passing a value is currently rejected.
	 */
	mode?: string;
	edition?: string;
	crateType?: string;
	targetTriple?: SupportedTargetTriple;
	log?: boolean;
	/**
	 * Extends the compile timeout floor to 120s for slow browser-hosted rustc startups.
	 */
	extendedTimeout?: boolean;
	/**
	 * @deprecated Use `extendedTimeout` instead. This remains as a compatibility alias.
	 */
	prepare?: boolean;
	onProgress?: (progress: BrowserRustCompileProgress) => void;
}

export interface BrowserRustCompilerResult {
	success: boolean;
	stdout?: string;
	stderr?: string;
	diagnostics?: CompilerDiagnostic[];
	logs?: string[];
	logRecords?: CompilerLogRecord[];
	artifact?: {
		wasm?: Uint8Array | ArrayBuffer;
		wat?: string;
		targetTriple: SupportedTargetTriple;
		format: BrowserRustArtifactFormat;
	};
}

export interface BrowserRustCompiler {
	compile: (request: BrowserRustCompileRequest) => Promise<BrowserRustCompilerResult>;
}

export type BrowserRustCompilerFactory = (
	options?: import('./compiler.js').CreateRustCompilerOptions
) => Promise<BrowserRustCompiler>;
export type BrowserRustCompileWorkerRequest = Omit<BrowserRustCompileRequest, 'onProgress'>;
