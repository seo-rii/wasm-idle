import {
	ProtocolError,
	RUNTIME_ERROR_CODES,
	RUNTIME_PHASES,
	type RuntimeErrorCode,
	type RuntimePhase
} from './errors.js';
import {
	DEFAULT_EXECUTION_LIMITS,
	TERMINATION_REASONS,
	resolveExecutionLimits,
	type ExecutionLimits,
	type ExecutionRuntimeRequirements,
	type TerminationReason
} from './execution.js';
import type { WorkspaceFile } from './workspace.js';

export const RUNTIME_PROTOCOL_NAME = 'wasm-idle-runtime' as const;
export const RUNTIME_PROTOCOL_VERSION = 1 as const;

export type RuntimeStdinMode = 'none' | 'prebuffered' | 'streaming';
export type RuntimeRunId = string;

export interface RuntimeCapabilities {
	stdin: RuntimeStdinMode;
	workspace: boolean;
	abort: boolean;
	artifacts: boolean;
	streamingOutput: boolean;
}

export interface RuntimeHandshakeIdentity {
	languageId: string;
	implementationId: string;
	version: string;
	profileId?: string;
	trustProfileId?: string;
	trustProfileSchemaVersion?: number;
}

export interface RuntimeHandshake {
	protocol: typeof RUNTIME_PROTOCOL_NAME;
	protocolVersion: number;
	manifestSchemaVersion?: number;
	manifestSha256?: string;
	runtime: RuntimeHandshakeIdentity;
	capabilities: RuntimeCapabilities;
}

export interface RuntimeHandshakeExpectation {
	protocolVersion: number;
	manifestSchemaVersion?: number;
	manifestSha256?: string;
	profileId?: string;
	languageId?: string;
	implementationId?: string;
	runtimeVersion?: string;
	trustProfileId?: string;
	trustProfileSchemaVersion?: number;
	requiredCapabilities?: Partial<RuntimeCapabilities>;
}

export function assertRuntimeHandshake(
	expected: RuntimeHandshakeExpectation,
	candidate: unknown
): RuntimeHandshake {
	if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
		throw new ProtocolError('Runtime handshake must be an object');
	}
	const actual = candidate as RuntimeHandshake;
	if (!actual.runtime || typeof actual.runtime !== 'object' || Array.isArray(actual.runtime)) {
		throw new ProtocolError('Runtime handshake identity must be an object');
	}
	if (
		!actual.capabilities ||
		typeof actual.capabilities !== 'object' ||
		Array.isArray(actual.capabilities)
	) {
		throw new ProtocolError('Runtime handshake capabilities must be an object', {
			runtimeId: actual.runtime.implementationId,
			profileId: actual.runtime.profileId
		});
	}
	if (
		actual.protocol !== RUNTIME_PROTOCOL_NAME ||
		actual.protocolVersion !== expected.protocolVersion
	) {
		throw new ProtocolError(
			`Runtime protocol mismatch: expected ${RUNTIME_PROTOCOL_NAME}@${expected.protocolVersion}, received ${actual.protocol}@${actual.protocolVersion}`,
			{
				runtimeId: actual.runtime.implementationId,
				profileId: actual.runtime.profileId
			}
		);
	}
	for (const [identity, value] of [
		['language', actual.runtime?.languageId],
		['implementation', actual.runtime?.implementationId],
		['version', actual.runtime?.version]
	] as const) {
		if (typeof value !== 'string' || !value.trim()) {
			throw new ProtocolError(`Runtime ${identity} identity is missing`, {
				runtimeId: actual.runtime?.implementationId,
				profileId: actual.runtime?.profileId
			});
		}
	}
	if (
		actual.runtime.profileId !== undefined &&
		(typeof actual.runtime.profileId !== 'string' || !actual.runtime.profileId.trim())
	) {
		throw new ProtocolError('Runtime profile identity is malformed', {
			runtimeId: actual.runtime.implementationId,
			profileId: actual.runtime.profileId
		});
	}
	if (
		actual.manifestSchemaVersion !== undefined &&
		(!Number.isSafeInteger(actual.manifestSchemaVersion) || actual.manifestSchemaVersion < 1)
	) {
		throw new ProtocolError('Runtime manifest schema is malformed', {
			runtimeId: actual.runtime.implementationId,
			profileId: actual.runtime.profileId
		});
	}
	if (
		expected.manifestSchemaVersion !== undefined &&
		actual.manifestSchemaVersion !== expected.manifestSchemaVersion
	) {
		throw new ProtocolError(
			`Runtime manifest schema mismatch: expected ${expected.manifestSchemaVersion}, received ${actual.manifestSchemaVersion ?? 'missing'}`,
			{
				runtimeId: actual.runtime.implementationId,
				profileId: actual.runtime.profileId
			}
		);
	}
	if (actual.manifestSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(actual.manifestSha256)) {
		throw new ProtocolError('Runtime manifest SHA-256 is malformed', {
			runtimeId: actual.runtime.implementationId,
			profileId: actual.runtime.profileId
		});
	}
	if (
		expected.manifestSha256 !== undefined &&
		actual.manifestSha256 !== expected.manifestSha256
	) {
		throw new ProtocolError(
			`Runtime manifest SHA-256 mismatch: expected ${expected.manifestSha256}, received ${actual.manifestSha256 ?? 'missing'}`,
			{
				runtimeId: actual.runtime.implementationId,
				profileId: actual.runtime.profileId
			}
		);
	}
	if (expected.profileId !== undefined && actual.runtime.profileId !== expected.profileId) {
		throw new ProtocolError(
			`Runtime profile mismatch: expected ${expected.profileId}, received ${actual.runtime.profileId ?? 'missing'}`,
			{
				runtimeId: actual.runtime.implementationId,
				profileId: actual.runtime.profileId
			}
		);
	}
	for (const [identity, required, received] of [
		['language', expected.languageId, actual.runtime.languageId],
		['implementation', expected.implementationId, actual.runtime.implementationId],
		['version', expected.runtimeVersion, actual.runtime.version],
		['trust profile', expected.trustProfileId, actual.runtime.trustProfileId]
	] as const) {
		if (required !== undefined && received !== required) {
			throw new ProtocolError(
				`Runtime ${identity} mismatch: expected ${required}, received ${received ?? 'missing'}`,
				{
					runtimeId: actual.runtime.implementationId,
					profileId: actual.runtime.profileId
				}
			);
		}
	}
	const hasTrustProfileId = actual.runtime.trustProfileId !== undefined;
	const hasTrustProfileSchemaVersion = actual.runtime.trustProfileSchemaVersion !== undefined;
	if (hasTrustProfileId !== hasTrustProfileSchemaVersion) {
		throw new ProtocolError('Runtime trust profile identity is incomplete', {
			runtimeId: actual.runtime.implementationId,
			profileId: actual.runtime.profileId
		});
	}
	if (
		hasTrustProfileId &&
		(typeof actual.runtime.trustProfileId !== 'string' ||
			!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(actual.runtime.trustProfileId))
	) {
		throw new ProtocolError('Runtime trust profile ID is malformed', {
			runtimeId: actual.runtime.implementationId,
			profileId: actual.runtime.profileId
		});
	}
	if (
		hasTrustProfileSchemaVersion &&
		(!Number.isSafeInteger(actual.runtime.trustProfileSchemaVersion) ||
			(actual.runtime.trustProfileSchemaVersion ?? 0) < 1)
	) {
		throw new ProtocolError('Runtime trust profile schema is malformed', {
			runtimeId: actual.runtime.implementationId,
			profileId: actual.runtime.profileId
		});
	}
	if (
		expected.trustProfileSchemaVersion !== undefined &&
		actual.runtime.trustProfileSchemaVersion !== expected.trustProfileSchemaVersion
	) {
		throw new ProtocolError(
			`Runtime trust profile schema mismatch: expected ${expected.trustProfileSchemaVersion}, received ${actual.runtime.trustProfileSchemaVersion ?? 'missing'}`,
			{
				runtimeId: actual.runtime.implementationId,
				profileId: actual.runtime.profileId
			}
		);
	}
	if (!['none', 'prebuffered', 'streaming'].includes(actual.capabilities.stdin)) {
		throw new ProtocolError('Runtime stdin capability is malformed', {
			runtimeId: actual.runtime.implementationId,
			profileId: actual.runtime.profileId
		});
	}
	for (const capability of ['workspace', 'abort', 'artifacts', 'streamingOutput'] as const) {
		if (typeof actual.capabilities[capability] !== 'boolean') {
			throw new ProtocolError(`Runtime ${capability} capability is malformed`, {
				runtimeId: actual.runtime.implementationId,
				profileId: actual.runtime.profileId
			});
		}
	}
	for (const [capability, required] of Object.entries(
		expected.requiredCapabilities ?? {}
	) as Array<[keyof RuntimeCapabilities, RuntimeCapabilities[keyof RuntimeCapabilities]]>) {
		if (required === undefined) continue;
		const received = actual.capabilities[capability];
		if (received !== required) {
			throw new ProtocolError(
				`Runtime capability mismatch for ${capability}: expected ${String(required)}, received ${String(received)}`,
				{
					runtimeId: actual.runtime.implementationId,
					profileId: actual.runtime.profileId
				}
			);
		}
	}
	return actual;
}

export interface RuntimeWorkerRunRequest {
	code: string;
	activePath?: string;
	workspaceFiles?: WorkspaceFile[];
	args?: string[];
	stdin?: string;
	compileArgs?: string[];
	env?: Record<string, string>;
	runtimeRequirements?: ExecutionRuntimeRequirements;
	limits?: Partial<ExecutionLimits>;
}

export type HostToRuntimeWorkerMessage =
	| {
			type: 'handshake';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
			expected: RuntimeHandshakeExpectation;
	  }
	| {
			type: 'run';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
			runId: RuntimeRunId;
			request: RuntimeWorkerRunRequest;
	  }
	| {
			type: 'stdin';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
			runId: RuntimeRunId;
			data: string;
	  }
	| {
			type: 'stdin-eof';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
			runId: RuntimeRunId;
	  }
	| {
			type: 'abort';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
			runId: RuntimeRunId;
	  }
	| {
			type: 'dispose';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
	  };

export interface SerializedRuntimeError {
	code: RuntimeErrorCode | 'unknown';
	message: string;
	phase?: RuntimePhase;
	recoverable?: boolean;
}

export type RuntimeWorkerToHostMessage =
	| {
			type: 'handshake';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
			handshake: RuntimeHandshake;
	  }
	| {
			type: 'ready';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
	  }
	| {
			type: 'stdout' | 'stderr';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
			runId: RuntimeRunId;
			data: string;
	  }
	| {
			type: 'progress';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
			runId: RuntimeRunId;
			value: number;
			stage?: string;
	  }
	| {
			type: 'diagnostic';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
			runId: RuntimeRunId;
			diagnostic: unknown;
	  }
	| {
			type: 'result';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
			runId: RuntimeRunId;
			exitCode: number | null;
			terminationReason: TerminationReason;
	  }
	| {
			type: 'error';
			protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
			runId: RuntimeRunId;
			error: SerializedRuntimeError;
	  };

function protocolMessageRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new ProtocolError(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function assertProtocolVersion(record: Record<string, unknown>): void {
	if (record.protocolVersion !== RUNTIME_PROTOCOL_VERSION) {
		throw new ProtocolError(
			`Runtime worker protocol mismatch: expected ${RUNTIME_PROTOCOL_VERSION}, received ${String(record.protocolVersion)}`
		);
	}
}

function assertProtocolRunId(record: Record<string, unknown>): void {
	if (
		typeof record.runId !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(record.runId)
	) {
		throw new ProtocolError('Runtime worker message has an invalid run ID');
	}
}

export function assertHostToRuntimeWorkerMessage(message: unknown): HostToRuntimeWorkerMessage {
	const record = protocolMessageRecord(message, 'Host-to-runtime worker message');
	assertProtocolVersion(record);

	switch (record.type) {
		case 'handshake': {
			const expected = protocolMessageRecord(
				record.expected,
				'Runtime handshake expectation'
			);
			if (expected.protocolVersion !== RUNTIME_PROTOCOL_VERSION) {
				throw new ProtocolError(
					'Runtime handshake expectation has an invalid protocol version'
				);
			}
			break;
		}
		case 'run': {
			assertProtocolRunId(record);
			const request = protocolMessageRecord(record.request, 'Runtime run request');
			if (typeof request.code !== 'string') {
				throw new ProtocolError('Runtime run request code must be a string');
			}
			for (const field of ['activePath', 'stdin'] as const) {
				if (request[field] !== undefined && typeof request[field] !== 'string') {
					throw new ProtocolError(`Runtime run request ${field} must be a string`);
				}
			}
			for (const field of ['args', 'compileArgs'] as const) {
				if (
					request[field] !== undefined &&
					(!Array.isArray(request[field]) ||
						!(request[field] as unknown[]).every((value) => typeof value === 'string'))
				) {
					throw new ProtocolError(`Runtime run request ${field} must be a string array`);
				}
			}
			if (request.env !== undefined) {
				const environment = protocolMessageRecord(request.env, 'Runtime run environment');
				for (const [name, value] of Object.entries(environment)) {
					if (
						!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) ||
						typeof value !== 'string' ||
						value.includes('\0')
					) {
						throw new ProtocolError(
							`Runtime run environment entry is invalid: ${name}`
						);
					}
				}
			}
			if (request.workspaceFiles !== undefined) {
				if (!Array.isArray(request.workspaceFiles)) {
					throw new ProtocolError('Runtime run workspaceFiles must be an array');
				}
				for (const file of request.workspaceFiles) {
					const workspaceFile = protocolMessageRecord(file, 'Runtime workspace file');
					const binaryContent =
						ArrayBuffer.isView(workspaceFile.content) &&
						Object.prototype.toString.call(workspaceFile.content) ===
							'[object Uint8Array]';
					if (
						typeof workspaceFile.path !== 'string' ||
						(typeof workspaceFile.content !== 'string' && !binaryContent)
					) {
						throw new ProtocolError('Runtime workspace file is malformed');
					}
				}
			}
			if (request.runtimeRequirements !== undefined) {
				protocolMessageRecord(
					request.runtimeRequirements,
					'Runtime execution requirements'
				);
			}
			if (request.limits !== undefined) {
				const limits = protocolMessageRecord(request.limits, 'Runtime execution limits');
				for (const name of Object.keys(limits)) {
					if (!(name in DEFAULT_EXECUTION_LIMITS)) {
						throw new ProtocolError(`Runtime execution limit is unknown: ${name}`);
					}
				}
				try {
					resolveExecutionLimits(limits as Partial<ExecutionLimits>);
				} catch (cause) {
					throw new ProtocolError('Runtime execution limits are malformed', { cause });
				}
			}
			break;
		}
		case 'stdin':
			assertProtocolRunId(record);
			if (typeof record.data !== 'string') {
				throw new ProtocolError('Runtime stdin data must be a string');
			}
			break;
		case 'stdin-eof':
		case 'abort':
			assertProtocolRunId(record);
			break;
		case 'dispose':
			break;
		default:
			throw new ProtocolError(
				`Unsupported host-to-runtime worker message: ${String(record.type)}`
			);
	}

	return message as HostToRuntimeWorkerMessage;
}

export function assertRuntimeWorkerToHostMessage(message: unknown): RuntimeWorkerToHostMessage {
	const record = protocolMessageRecord(message, 'Runtime worker-to-host message');
	assertProtocolVersion(record);

	switch (record.type) {
		case 'handshake': {
			const handshake = protocolMessageRecord(record.handshake, 'Runtime handshake');
			protocolMessageRecord(handshake.runtime, 'Runtime handshake identity');
			protocolMessageRecord(handshake.capabilities, 'Runtime handshake capabilities');
			assertRuntimeHandshake(
				{ protocolVersion: RUNTIME_PROTOCOL_VERSION },
				handshake as unknown as RuntimeHandshake
			);
			break;
		}
		case 'ready':
			break;
		case 'stdout':
		case 'stderr':
			assertProtocolRunId(record);
			if (typeof record.data !== 'string') {
				throw new ProtocolError('Runtime output data must be a string');
			}
			break;
		case 'progress':
			assertProtocolRunId(record);
			if (
				typeof record.value !== 'number' ||
				!Number.isFinite(record.value) ||
				record.value < 0 ||
				record.value > 1
			) {
				throw new ProtocolError('Runtime progress must be a finite value between 0 and 1');
			}
			if (
				record.stage !== undefined &&
				(typeof record.stage !== 'string' || !record.stage.trim())
			) {
				throw new ProtocolError('Runtime progress stage must be a non-empty string');
			}
			break;
		case 'diagnostic':
			assertProtocolRunId(record);
			if (!Object.prototype.hasOwnProperty.call(record, 'diagnostic')) {
				throw new ProtocolError('Runtime diagnostic payload is missing');
			}
			break;
		case 'result':
			assertProtocolRunId(record);
			if (record.exitCode !== null && !Number.isSafeInteger(record.exitCode)) {
				throw new ProtocolError('Runtime result exitCode must be a safe integer or null');
			}
			if (!TERMINATION_REASONS.includes(record.terminationReason as TerminationReason)) {
				throw new ProtocolError('Runtime result termination reason is invalid');
			}
			break;
		case 'error': {
			assertProtocolRunId(record);
			const error = protocolMessageRecord(record.error, 'Serialized runtime error');
			if (
				typeof error.code !== 'string' ||
				(error.code !== 'unknown' &&
					!RUNTIME_ERROR_CODES.includes(error.code as RuntimeErrorCode))
			) {
				throw new ProtocolError('Serialized runtime error code is invalid');
			}
			if (typeof error.message !== 'string' || !error.message.trim()) {
				throw new ProtocolError('Serialized runtime error message is invalid');
			}
			if (
				error.phase !== undefined &&
				(typeof error.phase !== 'string' ||
					!RUNTIME_PHASES.includes(error.phase as RuntimePhase))
			) {
				throw new ProtocolError('Serialized runtime error phase is invalid');
			}
			if (error.recoverable !== undefined && typeof error.recoverable !== 'boolean') {
				throw new ProtocolError('Serialized runtime error recoverable flag is invalid');
			}
			break;
		}
		default:
			throw new ProtocolError(`Unsupported runtime worker message: ${String(record.type)}`);
	}

	return message as RuntimeWorkerToHostMessage;
}
