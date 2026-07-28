import {
	DiagnosticLimitError,
	OutputLimitError,
	ProtocolError,
	RuntimeConfigurationError,
	type RuntimeErrorCode,
	type RuntimePhase
} from './errors.js';
import type { DebugSourceBreakpoints } from './debug.js';
import {
	WorkspaceValidationError,
	normalizeWorkspacePath,
	type WorkspaceFile
} from './workspace.js';

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

export function validateExecutionResult(
	result: unknown,
	limits: Partial<ExecutionLimits> = {}
): ExecutionResult {
	const resolvedLimits = resolveExecutionLimits(limits);
	if (!result || typeof result !== 'object' || Array.isArray(result)) {
		throw new ProtocolError('Runtime returned a malformed execution result');
	}
	const value = result as Record<string, unknown>;
	if (typeof value.ok !== 'boolean') {
		throw new ProtocolError('Execution result ok must be boolean');
	}
	if (value.exitCode !== null && !Number.isSafeInteger(value.exitCode)) {
		throw new ProtocolError('Execution result exitCode must be a safe integer or null');
	}
	if (typeof value.stdout !== 'string' || typeof value.stderr !== 'string') {
		throw new ProtocolError('Execution result stdout and stderr must be strings');
	}
	const textEncoder = new TextEncoder();
	const outputBytes =
		textEncoder.encode(value.stdout).byteLength + textEncoder.encode(value.stderr).byteLength;
	if (outputBytes > resolvedLimits.maxOutputBytes) {
		throw new OutputLimitError(
			`Runtime output exceeded ${resolvedLimits.maxOutputBytes} bytes`,
			{
				limit: resolvedLimits.maxOutputBytes,
				actual: outputBytes
			}
		);
	}
	if (!Array.isArray(value.diagnostics)) {
		throw new ProtocolError('Execution result diagnostics must be an array');
	}
	if (value.diagnostics.length > resolvedLimits.maxDiagnostics) {
		throw new DiagnosticLimitError(
			`Runtime diagnostics exceeded ${resolvedLimits.maxDiagnostics} entries`,
			{
				limit: resolvedLimits.maxDiagnostics,
				actual: value.diagnostics.length
			}
		);
	}
	for (const diagnostic of value.diagnostics) {
		if (!diagnostic || typeof diagnostic !== 'object' || Array.isArray(diagnostic)) {
			throw new ProtocolError('Execution result contains a malformed diagnostic');
		}
		const record = diagnostic as Record<string, unknown>;
		if (typeof record.message !== 'string') {
			throw new ProtocolError('Execution diagnostic message must be a string');
		}
		if (!['error', 'warning', 'information', 'hint'].includes(String(record.severity))) {
			throw new ProtocolError('Execution diagnostic severity is invalid');
		}
		for (const field of [
			'lineNumber',
			'columnNumber',
			'endLineNumber',
			'endColumnNumber'
		] as const) {
			if (
				record[field] !== undefined &&
				(!Number.isSafeInteger(record[field]) || (record[field] as number) < 0)
			) {
				throw new ProtocolError(`Execution diagnostic ${field} is invalid`);
			}
		}
		for (const field of ['code', 'fileName'] as const) {
			if (record[field] !== undefined && typeof record[field] !== 'string') {
				throw new ProtocolError(`Execution diagnostic ${field} must be a string`);
			}
		}
	}
	if (!Array.isArray(value.artifacts)) {
		throw new ProtocolError('Execution result artifacts must be an array');
	}
	const artifactPaths = new Set<string>();
	const foldedArtifactPaths = new Map<string, string>();
	let artifactBytes = 0;
	for (const artifact of value.artifacts) {
		if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
			throw new ProtocolError('Execution result contains a malformed artifact');
		}
		const record = artifact as Record<string, unknown>;
		if (typeof record.path !== 'string') {
			throw new ProtocolError('Execution artifact path must be a string');
		}
		const normalizedPath = normalizeWorkspacePath(record.path);
		if (normalizedPath !== record.path) {
			throw new ProtocolError(`Execution artifact path is not normalized: ${record.path}`);
		}
		if (artifactPaths.has(normalizedPath)) {
			throw new ProtocolError(`Duplicate execution artifact path: ${normalizedPath}`);
		}
		artifactPaths.add(normalizedPath);
		const foldedPath = normalizedPath.toLowerCase();
		const collidingPath = foldedArtifactPaths.get(foldedPath);
		if (collidingPath && collidingPath !== normalizedPath) {
			throw new ProtocolError(
				`Execution artifact paths differ only by case: ${collidingPath} and ${normalizedPath}`
			);
		}
		foldedArtifactPaths.set(foldedPath, normalizedPath);
		if (
			!['file', 'image', 'audio', 'table', 'wasm-module', 'compiler-ir'].includes(
				String(record.kind)
			)
		) {
			throw new ProtocolError(`Execution artifact ${normalizedPath} has an invalid kind`);
		}
		if (
			record.mediaType !== undefined &&
			(typeof record.mediaType !== 'string' || !record.mediaType.includes('/'))
		) {
			throw new ProtocolError(
				`Execution artifact ${normalizedPath} has an invalid MIME type`
			);
		}
		if (typeof record.data === 'string') {
			artifactBytes += textEncoder.encode(record.data).byteLength;
		} else if (
			ArrayBuffer.isView(record.data) &&
			Object.prototype.toString.call(record.data) === '[object Uint8Array]'
		) {
			artifactBytes += (record.data as Uint8Array).byteLength;
		} else {
			throw new ProtocolError(
				`Execution artifact ${normalizedPath} data must be a string or Uint8Array`
			);
		}
		if (artifactBytes > resolvedLimits.maxWorkspaceBytes) {
			throw new WorkspaceValidationError(
				'total-size-limit',
				`Execution artifacts are ${artifactBytes} bytes; limit is ${resolvedLimits.maxWorkspaceBytes}`,
				{ limit: resolvedLimits.maxWorkspaceBytes, actual: artifactBytes }
			);
		}
	}
	if (!value.timings || typeof value.timings !== 'object' || Array.isArray(value.timings)) {
		throw new ProtocolError('Execution result timings must be an object');
	}
	for (const field of ['assetMs', 'startupMs', 'compileMs', 'executeMs', 'totalMs'] as const) {
		const timing = (value.timings as Record<string, unknown>)[field];
		if (typeof timing !== 'number' || !Number.isFinite(timing) || timing < 0) {
			throw new ProtocolError(`Execution timing ${field} is invalid`);
		}
	}
	if (!TERMINATION_REASONS.includes(value.terminationReason as TerminationReason)) {
		throw new ProtocolError('Execution result termination reason is invalid');
	}
	if (!value.runtime || typeof value.runtime !== 'object' || Array.isArray(value.runtime)) {
		throw new ProtocolError('Execution result runtime identity must be an object');
	}
	const runtime = value.runtime as Record<string, unknown>;
	for (const field of ['languageId', 'implementationId', 'version'] as const) {
		if (typeof runtime[field] !== 'string' || !(runtime[field] as string).trim()) {
			throw new ProtocolError(`Execution runtime ${field} is missing`);
		}
	}
	if (
		runtime.profileId !== undefined &&
		(typeof runtime.profileId !== 'string' || !runtime.profileId.trim())
	) {
		throw new ProtocolError('Execution runtime profileId is invalid');
	}
	if (!Number.isSafeInteger(runtime.protocolVersion) || (runtime.protocolVersion as number) < 1) {
		throw new ProtocolError('Execution runtime protocolVersion is invalid');
	}
	if (
		runtime.manifestSchemaVersion !== undefined &&
		(!Number.isSafeInteger(runtime.manifestSchemaVersion) ||
			(runtime.manifestSchemaVersion as number) < 1)
	) {
		throw new ProtocolError('Execution runtime manifestSchemaVersion is invalid');
	}
	if (value.error !== undefined) {
		if (!value.error || typeof value.error !== 'object' || Array.isArray(value.error)) {
			throw new ProtocolError('Execution result error summary must be an object');
		}
		const error = value.error as Record<string, unknown>;
		if (typeof error.code !== 'string' || typeof error.message !== 'string') {
			throw new ProtocolError('Execution result error summary is malformed');
		}
		if (error.recoverable !== undefined && typeof error.recoverable !== 'boolean') {
			throw new ProtocolError('Execution result error recoverable must be boolean');
		}
	}
	return result as ExecutionResult;
}
