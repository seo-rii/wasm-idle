import type { CompileRequest, CompileResult, ToolchainManifest } from './types.js';

export interface CompileWorkerRequestMessage {
	type: 'compile';
	request: CompileRequest;
	manifest?: ToolchainManifest;
}

export interface CompileWorkerResultMessage {
	type: 'result';
	result: CompileResult;
}

export interface CompileWorkerErrorMessage {
	type: 'error';
	error: string;
}

export type CompileWorkerMessage =
	| CompileWorkerRequestMessage
	| CompileWorkerResultMessage
	| CompileWorkerErrorMessage;
