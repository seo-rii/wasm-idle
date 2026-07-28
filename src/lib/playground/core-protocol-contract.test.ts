import { describe, expect, it } from 'vitest';

import {
	RUNTIME_PROTOCOL_NAME,
	RUNTIME_PROTOCOL_VERSION,
	ProtocolError,
	assertRuntimeHandshake,
	type HostToRuntimeWorkerMessage,
	type RuntimeHandshake,
	type RuntimeWorkerToHostMessage
} from '@wasm-idle/core';

const handshake = {
	protocol: 'wasm-idle-runtime',
	protocolVersion: 1,
	manifestSchemaVersion: 2,
	runtime: {
		languageId: 'RUST',
		implementationId: 'rustc',
		version: '1.99.0',
		profileId: 'rust-browser-1.99-llvm-22'
	},
	capabilities: {
		stdin: 'streaming',
		workspace: true,
		abort: true,
		artifacts: true,
		streamingOutput: true
	}
} satisfies RuntimeHandshake;

describe('core worker protocol', () => {
	it('accepts a matching protocol, profile, schema, and capability handshake', () => {
		expect(RUNTIME_PROTOCOL_NAME).toBe('wasm-idle-runtime');
		expect(RUNTIME_PROTOCOL_VERSION).toBe(1);
		expect(
			assertRuntimeHandshake(
				{
					protocolVersion: 1,
					manifestSchemaVersion: 2,
					profileId: 'rust-browser-1.99-llvm-22',
					requiredCapabilities: {
						stdin: 'streaming',
						workspace: true,
						abort: true
					}
				},
				handshake
			)
		).toBe(handshake);
	});

	it('fails fast with both expected and actual profile identities', () => {
		expect(() =>
			assertRuntimeHandshake(
				{
					protocolVersion: 1,
					profileId: 'rust-browser-1.99-llvm-18'
				},
				handshake
			)
		).toThrowError(
			expect.objectContaining<Partial<ProtocolError>>({
				code: 'protocol',
				phase: 'protocol',
				message:
					'Runtime profile mismatch: expected rust-browser-1.99-llvm-18, received rust-browser-1.99-llvm-22'
			})
		);
	});

	it.each([
		[
			{ protocolVersion: 2 },
			'Runtime protocol mismatch: expected wasm-idle-runtime@2, received wasm-idle-runtime@1'
		],
		[
			{ protocolVersion: 1, manifestSchemaVersion: 3 },
			'Runtime manifest schema mismatch: expected 3, received 2'
		],
		[
			{ protocolVersion: 1, requiredCapabilities: { stdin: 'streaming', workspace: false } },
			'Runtime capability mismatch for workspace: expected false, received true'
		]
	] as const)('rejects incompatible handshakes', (expected, message) => {
		expect(() => assertRuntimeHandshake(expected, handshake)).toThrowError(message);
	});

	it('requires a run ID on every execution-scoped worker message', () => {
		const hostMessages = [
			{
				type: 'run',
				protocolVersion: 1,
				runId: 'run-1',
				request: { code: 'print(1)' }
			},
			{ type: 'stdin', protocolVersion: 1, runId: 'run-1', data: 'input\n' },
			{ type: 'stdin-eof', protocolVersion: 1, runId: 'run-1' },
			{ type: 'abort', protocolVersion: 1, runId: 'run-1' }
		] satisfies HostToRuntimeWorkerMessage[];
		const workerMessages = [
			{ type: 'stdout', protocolVersion: 1, runId: 'run-1', data: '1\n' },
			{ type: 'stderr', protocolVersion: 1, runId: 'run-1', data: '' },
			{
				type: 'result',
				protocolVersion: 1,
				runId: 'run-1',
				exitCode: 0,
				terminationReason: 'completed'
			},
			{
				type: 'error',
				protocolVersion: 1,
				runId: 'run-1',
				error: { code: 'runtime', message: 'trap' }
			}
		] satisfies RuntimeWorkerToHostMessage[];

		expect(hostMessages.every((message) => message.runId === 'run-1')).toBe(true);
		expect(workerMessages.every((message) => message.runId === 'run-1')).toBe(true);
	});
});
