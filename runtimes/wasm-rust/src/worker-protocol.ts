import type { NormalizedRuntimeManifest } from './runtime-manifest.js';
import type {
	BrowserRustCompileStage,
	BrowserRustCompileWorkerRequest,
	CompilerDiagnostic
} from './types.js';

export interface SharedRuntimeAssetFile {
	runtimePath: string;
	buffer: SharedArrayBuffer;
}

export interface CompileWorkerRequest {
	type: 'compile';
	runtimeBaseUrl: string;
	manifest: NormalizedRuntimeManifest;
	request: BrowserRustCompileWorkerRequest;
	sharedBitcodeBuffer: SharedArrayBuffer;
	sharedStatusBuffer: SharedArrayBuffer;
}

export interface CompileWorkerSuccessMessage {
	type: 'result';
	stdout: string;
	stderr: string;
	exitCode: number | null;
	diagnostics?: CompilerDiagnostic[];
}

export type CompileWorkerFailureKind =
	| 'helper-thread'
	| 'worker-bootstrap'
	| 'compile-timeout'
	| 'runtime-trap'
	| 'thread-pool-exhausted'
	| 'stale-runtime-metadata'
	| 'compiler-panicked';

export interface CompileWorkerFailureMessage {
	type: 'error';
	message: string;
	failureKind?: CompileWorkerFailureKind;
	stdout?: string;
	stderr?: string;
	diagnostics?: CompilerDiagnostic[];
	exitCode?: number | null;
}

export interface CompileWorkerLogMessage {
	type: 'log';
	message: string;
}

export interface CompileWorkerProgressMessage {
	type: 'progress';
	progress: {
		stage: Extract<
			BrowserRustCompileStage,
			'fetch-rustc' | 'fetch-sysroot' | 'prepare-fs' | 'init-thread-pool' | 'rustc-main'
		>;
		completed: number;
		total: number;
		message?: string;
		bytesCompleted?: number;
		bytesTotal?: number;
	};
}

export type CompileWorkerMessage =
	| CompileWorkerSuccessMessage
	| CompileWorkerFailureMessage
	| CompileWorkerLogMessage
	| CompileWorkerProgressMessage;

export interface RustcThreadWorkerRequest {
	type: 'thread-start';
	runtimeBaseUrl: string;
	manifest: NormalizedRuntimeManifest;
	sourceCode: string;
	log: boolean;
	sharedBitcodeBuffer: SharedArrayBuffer;
	sharedStatusBuffer: SharedArrayBuffer;
	threadCounterBuffer: SharedArrayBuffer;
	sysrootAssets: SharedRuntimeAssetFile[];
	rustcModule: WebAssembly.Module;
	memory: WebAssembly.Memory;
	args: string[];
	threadId: number;
	startArg: number;
	readyBuffer: SharedArrayBuffer;
}

export interface RustcThreadPoolInitRequest {
	type: 'thread-pool-init';
	runtimeBaseUrl: string;
	manifest: NormalizedRuntimeManifest;
	sourceCode: string;
	log: boolean;
	sharedBitcodeBuffer: SharedArrayBuffer;
	sharedStatusBuffer: SharedArrayBuffer;
	threadCounterBuffer: SharedArrayBuffer;
	sysrootAssets: SharedRuntimeAssetFile[];
	rustcModule: WebAssembly.Module;
	memory: WebAssembly.Memory;
	args: string[];
	slotIndex: number;
	slotBuffer: SharedArrayBuffer;
	poolBuffers: SharedArrayBuffer[];
}

export interface RustcThreadWorkerLogMessage {
	type: 'thread-log';
	threadId: number;
	phase: string;
	detail?: string;
}

export interface RustcThreadWorkerReadyMessage {
	type: 'thread-ready';
}
