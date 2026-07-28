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
}

export interface RuntimeHandshake {
	protocol: typeof RUNTIME_PROTOCOL_NAME;
	protocolVersion: number;
	manifestSchemaVersion?: number;
	runtime: RuntimeHandshakeIdentity;
	capabilities: RuntimeCapabilities;
}

export interface RuntimeHandshakeExpectation {
	protocolVersion: number;
	manifestSchemaVersion?: number;
	profileId?: string;
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
	if (expected.profileId !== undefined && actual.runtime.profileId !== expected.profileId) {
		throw new ProtocolError(
			`Runtime profile mismatch: expected ${expected.profileId}, received ${actual.runtime.profileId ?? 'missing'}`,
			{
				runtimeId: actual.runtime.implementationId,
				profileId: actual.runtime.profileId
			}
		);
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
