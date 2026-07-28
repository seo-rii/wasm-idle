import {
	ProtocolError,
	RUNTIME_PROTOCOL_NAME,
	assertHostToRuntimeWorkerMessage,
	assertRuntimeWorkerToHostMessage
} from '@wasm-idle/core';
import { describe, expect, it } from 'vitest';

const handshake = {
	protocol: RUNTIME_PROTOCOL_NAME,
	protocolVersion: 1,
	runtime: {
		languageId: 'C',
		implementationId: 'clang',
		version: '22.1.8'
	},
	capabilities: {
		stdin: 'streaming',
		workspace: true,
		abort: true,
		artifacts: true,
		streamingOutput: true
	}
};

describe('runtime worker protocol validation', () => {
	it('accepts every host message family without replacing the message', () => {
		const messages = [
			{ type: 'handshake', protocolVersion: 1, expected: { protocolVersion: 1 } },
			{
				type: 'run',
				protocolVersion: 1,
				runId: 'run-1',
				request: {
					code: 'int main() {}',
					workspaceFiles: [{ path: 'helper.c', content: 'int helper();' }],
					env: { MODE: 'test' },
					runtimeRequirements: { wasmMemoryBytes: 1024 },
					limits: { maxWasmMemoryBytes: 2048 }
				}
			},
			{ type: 'stdin', protocolVersion: 1, runId: 'run-1', data: 'input\n' },
			{ type: 'stdin-eof', protocolVersion: 1, runId: 'run-1' },
			{ type: 'abort', protocolVersion: 1, runId: 'run-1' },
			{ type: 'dispose', protocolVersion: 1 }
		];

		for (const message of messages) {
			expect(assertHostToRuntimeWorkerMessage(message)).toBe(message);
		}
	});

	it('accepts every worker message family without replacing the message', () => {
		const messages = [
			{ type: 'handshake', protocolVersion: 1, handshake },
			{ type: 'ready', protocolVersion: 1 },
			{ type: 'stdout', protocolVersion: 1, runId: 'run-1', data: 'ok\n' },
			{ type: 'stderr', protocolVersion: 1, runId: 'run-1', data: '' },
			{ type: 'progress', protocolVersion: 1, runId: 'run-1', value: 0.5, stage: 'compile' },
			{ type: 'diagnostic', protocolVersion: 1, runId: 'run-1', diagnostic: null },
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
				error: { code: 'runtime', message: 'trap', phase: 'execute', recoverable: true }
			}
		];

		for (const message of messages) {
			expect(assertRuntimeWorkerToHostMessage(message)).toBe(message);
		}
	});

	it.each([
		[{ type: 'dispose', protocolVersion: 2 }, 'protocol mismatch'],
		[{ type: 'run', protocolVersion: 1, runId: '', request: { code: '' } }, 'invalid run ID'],
		[
			{
				type: 'run',
				protocolVersion: 1,
				runId: 'run-1',
				request: { code: '', limits: { maxWorkers: 0 } }
			},
			'limits are malformed'
		],
		[
			{
				type: 'run',
				protocolVersion: 1,
				runId: 'run-1',
				request: { code: '', workspaceFiles: [{ path: 'main.c', content: 1 }] }
			},
			'workspace file is malformed'
		]
	] as const)('rejects malformed host messages', (message, expected) => {
		expect(() => assertHostToRuntimeWorkerMessage(message)).toThrow(expected);
	});

	it.each([
		[{ type: 'ready', protocolVersion: 2 }, 'protocol mismatch'],
		[{ type: 'progress', protocolVersion: 1, runId: 'run-1', value: 1.1 }, 'between 0 and 1'],
		[
			{
				type: 'result',
				protocolVersion: 1,
				runId: 'run-1',
				exitCode: 1.5,
				terminationReason: 'completed'
			},
			'exitCode'
		],
		[
			{
				type: 'error',
				protocolVersion: 1,
				runId: 'run-1',
				error: { code: 'invented', message: 'bad' }
			},
			'error code is invalid'
		],
		[
			{ type: 'handshake', protocolVersion: 1, handshake: { protocolVersion: 1 } },
			'identity must be an object'
		]
	] as const)('rejects malformed worker messages', (message, expected) => {
		expect(() => assertRuntimeWorkerToHostMessage(message)).toThrowError(
			expect.objectContaining({
				code: 'protocol',
				message: expect.stringContaining(expected)
			})
		);
	});

	it('uses typed protocol errors for non-object messages', () => {
		expect(() => assertRuntimeWorkerToHostMessage(null)).toThrowError(
			expect.objectContaining({
				name: 'ProtocolError',
				code: 'protocol'
			} satisfies Partial<ProtocolError>)
		);
	});
});
