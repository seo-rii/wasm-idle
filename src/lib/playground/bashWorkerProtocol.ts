import {
	requireBashRuntimePreflightPayload,
	type BashRuntimePreflightPayload,
	type ExecutionLimits,
	type RuntimeResourceKind,
	type WorkspaceLimits
} from '@wasm-idle/core';

export const BASH_WORKER_PROTOCOL_VERSION = 1 as const;

export interface BashSerializedError {
	readonly name: string;
	readonly message: string;
	readonly stack?: string;
	readonly code?: string;
	readonly recoverable?: boolean;
	readonly profileId?: string;
	readonly actual?: number;
	readonly limit?: number;
	readonly timeoutMs?: number;
	readonly resource?: RuntimeResourceKind;
	readonly feature?: string;
	readonly languageId?: string;
}

export type BashWorkerErrorPhase = 'asset' | 'startup' | 'execute' | 'protocol';

interface BashWorkerEnvelope {
	readonly protocolVersion: typeof BASH_WORKER_PROTOCOL_VERSION;
	readonly sessionId: number;
	readonly requestId: number;
}

export interface BashWorkerLoadMessage extends BashWorkerEnvelope {
	readonly type: 'load';
	readonly runtimePreflight: BashRuntimePreflightPayload;
	readonly limits: ExecutionLimits;
	readonly log?: boolean;
}

export interface BashWorkerRunMessage extends BashWorkerEnvelope {
	readonly type: 'run';
	readonly code: string;
	readonly activePath: string;
	readonly workspaceFiles: ReadonlyArray<
		Readonly<{
			path: string;
			content: string;
		}>
	>;
	readonly programArgs: readonly string[];
	readonly stdin?: string;
	readonly limits: ExecutionLimits;
	readonly workspaceLimits: WorkspaceLimits;
	readonly log?: boolean;
}

export interface BashWorkerStdinMessage extends BashWorkerEnvelope {
	readonly type: 'stdin';
	readonly bytes: Uint8Array;
}

export interface BashWorkerStdinEofMessage extends BashWorkerEnvelope {
	readonly type: 'stdin-eof';
}

export type BashHostToWorkerMessage =
	| BashWorkerLoadMessage
	| BashWorkerRunMessage
	| BashWorkerStdinMessage
	| BashWorkerStdinEofMessage;

export interface BashWorkerProgressMessage extends BashWorkerEnvelope {
	readonly type: 'progress';
	readonly value: number;
	readonly stage?: string;
}

export interface BashWorkerLoadedMessage extends BashWorkerEnvelope {
	readonly type: 'loaded';
}

export interface BashWorkerStdinReadyMessage extends BashWorkerEnvelope {
	readonly type: 'stdin-ready';
}

export interface BashWorkerExecutionReadyMessage extends BashWorkerEnvelope {
	readonly type: 'execution-ready';
	readonly progress: Readonly<{
		kind: 'ready';
		state: 'running';
		reason: 'started';
		label?: string;
	}>;
}

export interface BashWorkerOutputMessage extends BashWorkerEnvelope {
	readonly type: 'output';
	readonly stream: 'stdout' | 'stderr';
	readonly bytes: Uint8Array;
}

export interface BashWorkerResultMessage extends BashWorkerEnvelope {
	readonly type: 'result';
	readonly result: boolean | string;
}

export interface BashWorkerErrorMessage extends BashWorkerEnvelope {
	readonly type: 'error';
	readonly phase: BashWorkerErrorPhase;
	readonly error: BashSerializedError;
}

export type BashWorkerToHostMessage =
	| BashWorkerProgressMessage
	| BashWorkerLoadedMessage
	| BashWorkerStdinReadyMessage
	| BashWorkerExecutionReadyMessage
	| BashWorkerOutputMessage
	| BashWorkerResultMessage
	| BashWorkerErrorMessage;

const EXECUTION_LIMIT_KEYS = [
	'assetTimeoutMs',
	'startupTimeoutMs',
	'compileTimeoutMs',
	'runTimeoutMs',
	'maxOutputBytes',
	'maxDiagnostics',
	'maxWorkspaceBytes',
	'maxAssetBytes',
	'maxWasmMemoryBytes',
	'maxWorkers',
	'maxThreads'
] as const satisfies readonly (keyof ExecutionLimits)[];

const WORKSPACE_LIMIT_KEYS = [
	'maxFiles',
	'maxFileBytes',
	'maxTotalBytes',
	'maxPathBytes'
] as const satisfies readonly (keyof WorkspaceLimits)[];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isUint8Array(value: unknown): value is Uint8Array {
	return (
		ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]'
	);
}

function isIdentifier(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function hasEnvelope(value: Record<string, unknown>) {
	return (
		value.protocolVersion === BASH_WORKER_PROTOCOL_VERSION &&
		isIdentifier(value.sessionId) &&
		isIdentifier(value.requestId)
	);
}

function hasResolvedExecutionLimits(value: unknown): value is ExecutionLimits {
	if (!isRecord(value)) return false;
	return EXECUTION_LIMIT_KEYS.every(
		(key) => Number.isSafeInteger(value[key]) && (value[key] as number) > 0
	);
}

function hasResolvedWorkspaceLimits(value: unknown): value is WorkspaceLimits {
	if (!isRecord(value) || typeof value.caseSensitive !== 'boolean') return false;
	return WORKSPACE_LIMIT_KEYS.every(
		(key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0
	);
}

function hasRuntimePreflight(value: unknown): value is BashRuntimePreflightPayload {
	try {
		requireBashRuntimePreflightPayload(value);
		return true;
	} catch {
		return false;
	}
}

function hasWorkspaceFiles(value: unknown): value is BashWorkerRunMessage['workspaceFiles'] {
	return (
		Array.isArray(value) &&
		value.every(
			(file) =>
				isRecord(file) && typeof file.path === 'string' && typeof file.content === 'string'
		)
	);
}

function hasStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function isBashHostToWorkerMessage(value: unknown): value is BashHostToWorkerMessage {
	if (!isRecord(value) || !hasEnvelope(value)) return false;
	switch (value.type) {
		case 'load':
			return (
				hasRuntimePreflight(value.runtimePreflight) &&
				hasResolvedExecutionLimits(value.limits) &&
				(value.log === undefined || typeof value.log === 'boolean')
			);
		case 'run':
			return (
				typeof value.code === 'string' &&
				typeof value.activePath === 'string' &&
				hasWorkspaceFiles(value.workspaceFiles) &&
				hasStringArray(value.programArgs) &&
				(value.stdin === undefined || typeof value.stdin === 'string') &&
				hasResolvedExecutionLimits(value.limits) &&
				hasResolvedWorkspaceLimits(value.workspaceLimits) &&
				(value.log === undefined || typeof value.log === 'boolean')
			);
		case 'stdin':
			return isUint8Array(value.bytes);
		case 'stdin-eof':
			return true;
		default:
			return false;
	}
}

function hasSerializedError(value: unknown): value is BashSerializedError {
	return (
		isRecord(value) &&
		typeof value.name === 'string' &&
		typeof value.message === 'string' &&
		(value.stack === undefined || typeof value.stack === 'string') &&
		(value.code === undefined || typeof value.code === 'string') &&
		(value.recoverable === undefined || typeof value.recoverable === 'boolean') &&
		(value.profileId === undefined || typeof value.profileId === 'string') &&
		(value.actual === undefined || Number.isSafeInteger(value.actual)) &&
		(value.limit === undefined || Number.isSafeInteger(value.limit)) &&
		(value.timeoutMs === undefined || Number.isSafeInteger(value.timeoutMs)) &&
		(value.resource === undefined ||
			value.resource === 'wasm-memory' ||
			value.resource === 'nested-workers' ||
			value.resource === 'threads') &&
		(value.feature === undefined || typeof value.feature === 'string') &&
		(value.languageId === undefined || typeof value.languageId === 'string')
	);
}

export function isBashWorkerToHostMessage(value: unknown): value is BashWorkerToHostMessage {
	if (!isRecord(value) || !hasEnvelope(value)) return false;
	switch (value.type) {
		case 'progress':
			return (
				Number.isFinite(value.value) &&
				(value.stage === undefined || typeof value.stage === 'string')
			);
		case 'loaded':
		case 'stdin-ready':
			return true;
		case 'execution-ready':
			return (
				isRecord(value.progress) &&
				value.progress.kind === 'ready' &&
				value.progress.state === 'running' &&
				value.progress.reason === 'started' &&
				(value.progress.label === undefined || typeof value.progress.label === 'string')
			);
		case 'output':
			return (
				(value.stream === 'stdout' || value.stream === 'stderr') &&
				isUint8Array(value.bytes)
			);
		case 'result':
			return typeof value.result === 'boolean' || typeof value.result === 'string';
		case 'error':
			return (
				(value.phase === 'asset' ||
					value.phase === 'startup' ||
					value.phase === 'execute' ||
					value.phase === 'protocol') &&
				hasSerializedError(value.error)
			);
		default:
			return false;
	}
}
