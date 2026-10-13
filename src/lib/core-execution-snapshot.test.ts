import {
	createPlaygroundBinding,
	RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
	type ExecutionRequest,
	type ExecutionResult,
	type Sandbox
} from '../../packages/core/src/index';
import { describe, expect, it, vi } from 'vitest';

const result: ExecutionResult = {
	ok: true,
	exitCode: 0,
	stdout: '',
	stderr: '',
	diagnostics: [],
	artifacts: [],
	timings: { assetMs: 0, startupMs: 0, compileMs: 0, executeMs: 0, totalMs: 0 },
	terminationReason: 'completed',
	runtime: { languageId: 'C', implementationId: 'test', version: '1', protocolVersion: 1 }
};

function runtime(execute: NonNullable<Sandbox['execute']>): Sandbox {
	return {
		constructor: Object,
		eof: vi.fn(),
		load: vi.fn(async () => undefined),
		run: vi.fn(async () => true),
		terminate: vi.fn(),
		clear: vi.fn(async () => undefined),
		execute
	};
}

describe('execution request snapshots', () => {
	it('isolates admitted binary workspace contents from caller mutations', async () => {
		const execute = vi.fn(async (_request: ExecutionRequest) => result);
		const binding = createPlaygroundBinding('/runtime', async () => runtime(execute));
		const sandbox = await binding.load('C');
		const content = new Uint8Array(8).fill(7);
		const operation = sandbox.execute!({
			code: 'x',
			workspaceFiles: [{ path: 'data.bin', content }],
			limits: { maxWorkspaceBytes: 16 }
		});
		content.fill(99);
		await operation;

		const admitted = execute.mock.calls[0][0].workspaceFiles![0].content;
		expect(admitted).toEqual(new Uint8Array(8).fill(7));
		expect(admitted).not.toBe(content);
		await binding.dispose();
	});

	it('keeps resizable workspace buffers within the admitted byte budget', async () => {
		const execute = vi.fn(async (_request: ExecutionRequest) => result);
		const binding = createPlaygroundBinding('/runtime', async () => runtime(execute));
		const sandbox = await binding.load('C');
		const buffer = new ArrayBuffer(8, { maxByteLength: 1024 });
		const content = new Uint8Array(buffer).fill(7);
		const operation = sandbox.execute!({
			code: 'x',
			workspaceFiles: [{ path: 'data.bin', content }],
			limits: { maxWorkspaceBytes: 16 }
		});
		buffer.resize(1024);
		content.fill(99);
		await operation;

		const admitted = execute.mock.calls[0][0].workspaceFiles![0].content;
		expect(admitted).toEqual(new Uint8Array(8).fill(7));
		expect(admitted).not.toBe(content);
		await expect(
			sandbox.execute!({
				code: 'x',
				workspaceFiles: [{ path: 'data.bin', content }],
				limits: { maxWorkspaceBytes: 16 }
			})
		).rejects.toMatchObject({ code: 'file-size-limit' });
		expect(execute).toHaveBeenCalledTimes(1);
		await binding.dispose();
	});

	it('executes the code and environment admitted by the trust policy', async () => {
		const execute = vi.fn(async (_request: ExecutionRequest) => result);
		const binding = createPlaygroundBinding('/runtime', async () => runtime(execute), {
			trustProfile: {
				schemaVersion: RUNTIME_TRUST_PROFILE_SCHEMA_VERSION,
				profileId: 'snapshot-test',
				network: { mode: 'none', allowedOrigins: [] },
				storage: { mode: 'none' },
				environment: { mode: 'allowlist', allowedNames: ['MODE'] },
				threads: { maxThreads: 0 },
				workers: { maxNestedWorkers: 0 },
				sharedArrayBuffer: false,
				dynamicCode: 'wasm-only',
				sameOriginAccess: false
			}
		});
		const sandbox = await binding.load('C');
		const request: ExecutionRequest = {
			code: 'small',
			env: { MODE: 'safe' },
			limits: { maxWorkspaceBytes: 16 }
		};

		const operation = sandbox.execute!(request);
		request.code = 'x'.repeat(1024);
		request.env!.MODE = 'changed';
		request.env!.FORBIDDEN = 'injected';
		request.limits!.maxWorkspaceBytes = 2048;
		await operation;

		const admitted = execute.mock.calls[0][0];
		expect(admitted.code).toBe('small');
		expect(admitted.env).toEqual({ MODE: 'safe' });
		expect(Object.isFrozen(admitted.env)).toBe(true);
		expect(admitted.limits!.maxWorkspaceBytes).toBe(16);
		await binding.dispose();
	});

	it('isolates nested arguments, breakpoints, and environment without a trust profile', async () => {
		const execute = vi.fn(async (_request: ExecutionRequest) => result);
		const binding = createPlaygroundBinding('/runtime', async () => runtime(execute));
		const sandbox = await binding.load('C');
		const request: ExecutionRequest = {
			code: 'original',
			args: ['first'],
			compileArgs: ['-O1'],
			env: { MODE: 'original' },
			debug: {
				mode: 'trace',
				pauseOnEntry: true,
				sourceBreakpoints: [{ sourcePath: 'main.c', lines: [2] }]
			}
		};

		const operation = sandbox.execute!(request);
		request.args![0] = 'changed';
		request.compileArgs!.push('-DCHANGED');
		request.env!.MODE = 'changed';
		request.debug!.mode = 'native';
		request.debug!.sourceBreakpoints![0].sourcePath = 'other.c';
		request.debug!.sourceBreakpoints![0].lines.push(999);
		request.stdin = 'late input';
		await operation;

		expect(execute.mock.calls[0][0]).toMatchObject({
			code: 'original',
			args: ['first'],
			compileArgs: ['-O1'],
			env: { MODE: 'original' },
			debug: {
				mode: 'trace',
				pauseOnEntry: true,
				sourceBreakpoints: [{ sourcePath: 'main.c', lines: [2] }]
			}
		});
		expect(execute.mock.calls[0][0].stdin).toBeUndefined();
		await binding.dispose();
	});
});
