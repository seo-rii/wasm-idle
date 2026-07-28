import { RuntimeConfigurationError, type RuntimeErrorCode, type RuntimePhase } from './errors.js';
import type { DebugSourceBreakpoints } from './debug.js';
import type { WorkspaceFile } from './workspace.js';

export interface ExecutionLimits {
	assetTimeoutMs: number;
	startupTimeoutMs: number;
	compileTimeoutMs: number;
	runTimeoutMs: number;
	maxOutputBytes: number;
	maxDiagnostics: number;
	maxWorkspaceBytes: number;
	maxAssetBytes: number;
	maxWasmMemoryBytes: number;
	maxWorkers: number;
	maxThreads: number;
}

export const DEFAULT_EXECUTION_LIMITS = Object.freeze({
	assetTimeoutMs: 60_000,
	startupTimeoutMs: 60_000,
	compileTimeoutMs: 120_000,
	runTimeoutMs: 30_000,
	maxOutputBytes: 1024 * 1024,
	maxDiagnostics: 1000,
	maxWorkspaceBytes: 8 * 1024 * 1024,
	maxAssetBytes: 128 * 1024 * 1024,
	maxWasmMemoryBytes: 512 * 1024 * 1024,
	maxWorkers: 1,
	maxThreads: 1
}) satisfies Readonly<ExecutionLimits>;

export function resolveExecutionLimits(limits: Partial<ExecutionLimits> = {}): ExecutionLimits {
	const resolved = { ...DEFAULT_EXECUTION_LIMITS, ...limits };
	for (const [name, value] of Object.entries(resolved)) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new RuntimeConfigurationError(
				`Execution limit ${name} must be a positive safe integer`
			);
		}
	}
	return resolved;
}

export const TERMINATION_REASONS = [
	'completed',
	'compile-error',
	'runtime-error',
	'cancelled',
	'timeout',
	'output-limit',
	'memory-limit',
	'workspace-limit',
	'worker-crash',
	'asset-error'
] as const;

export type TerminationReason = (typeof TERMINATION_REASONS)[number];

export interface ExecutionDebugOptions {
	mode?: 'none' | 'trace' | 'native';
	pauseOnEntry?: boolean;
	sourceBreakpoints?: DebugSourceBreakpoints[];
}

export interface ExecutionRequest {
	code: string;
	activePath?: string;
	workspaceFiles?: WorkspaceFile[];
	args?: string[];
	stdin?: string | AsyncIterable<Uint8Array>;
	compileArgs?: string[];
	env?: Record<string, string>;
	debug?: ExecutionDebugOptions;
	limits?: Partial<ExecutionLimits>;
	signal?: AbortSignal;
}

export type ExecutionDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface ExecutionDiagnostic {
	message: string;
	severity: ExecutionDiagnosticSeverity;
	code?: string;
	fileName?: string;
	lineNumber?: number;
	columnNumber?: number;
	endLineNumber?: number;
	endColumnNumber?: number;
}

export type ExecutionArtifactKind =
	| 'file'
	| 'image'
	| 'audio'
	| 'table'
	| 'wasm-module'
	| 'compiler-ir';

export interface ExecutionArtifact {
	path: string;
	kind: ExecutionArtifactKind;
	mediaType?: string;
	data: string | Uint8Array;
}

export interface ExecutionTimings {
	assetMs: number;
	startupMs: number;
	compileMs: number;
	executeMs: number;
	totalMs: number;
}

export interface RuntimeIdentity {
	languageId: string;
	implementationId: string;
	version: string;
	profileId?: string;
	protocolVersion: number;
	manifestSchemaVersion?: number;
}

export interface ExecutionErrorSummary {
	code: RuntimeErrorCode | 'unknown';
	message: string;
	phase?: RuntimePhase;
	recoverable?: boolean;
}

export interface ExecutionResult {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	diagnostics: ExecutionDiagnostic[];
	artifacts: ExecutionArtifact[];
	timings: ExecutionTimings;
	terminationReason: TerminationReason;
	runtime: RuntimeIdentity;
	error?: ExecutionErrorSummary;
}
