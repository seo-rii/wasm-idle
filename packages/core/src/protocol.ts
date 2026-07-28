import { ProtocolError, type RuntimeErrorCode, type RuntimePhase } from './errors.js';
import type { ExecutionLimits, TerminationReason } from './execution.js';
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
	actual: RuntimeHandshake
): RuntimeHandshake {
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
	if (!actual.capabilities || typeof actual.capabilities !== 'object') {
		throw new ProtocolError('Runtime capabilities are malformed', {
			runtimeId: actual.runtime.implementationId,
			profileId: actual.runtime.profileId
		});
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
