import type {
	BrowserClangArtifact,
	BrowserClangCompileProgress,
	BrowserClangCompileRequest,
	BrowserClangWorkspaceFile
} from '@wasm-idle/llvm-core/clang';
import type { WorkerRuntimeAssetConfig } from './worker/assets';

export type ClangCompileWorkerRequest = {
	request: Omit<BrowserClangCompileRequest, 'onProgress'>;
	runtimeBaseUrl: string;
	maxAssetBytes?: number;
	languageSysroots?: boolean;
	log?: boolean;
	assets: WorkerRuntimeAssetConfig;
};

export type ClangCompileWorkerResponse =
	| { type: 'progress'; progress: BrowserClangCompileProgress }
	| { type: 'compiled'; artifact: BrowserClangArtifact; stdout: string; stderr: string }
	| { type: 'error'; error: string; stdout: string; stderr: string };

export type ClangExecuteWorkerRequest = {
	artifact: BrowserClangArtifact;
	programArgs?: string[];
	env?: Record<string, string>;
	workspaceFiles?: BrowserClangWorkspaceFile[];
	activePath?: string;
	code?: string;
	inputBuffer: SharedArrayBuffer;
	stdin?: string;
};

export type ClangExecuteWorkerResponse =
	| { type: 'stdin' }
	| { type: 'output'; output: string }
	| { type: 'done'; exitCode: number | null }
	| { type: 'error'; error: string };

/**
 * One stdin response occupies two Int32 control words followed by UTF-8 bytes.
 * Before requesting input the worker sets state to WAITING, posts `stdin`, and
 * waits on word 0. The parent writes bytes and length, then atomically publishes
 * DATA or EOF and notifies word 0. It writes only in response to a request.
 * The worker copies DATA before making another request; EOF remains latched.
 */
export const CLANG_STDIN_HEADER_BYTES = Int32Array.BYTES_PER_ELEMENT * 2;
export const CLANG_STDIN_WAITING = 0;
export const CLANG_STDIN_DATA = 1;
export const CLANG_STDIN_EOF = 2;
