import {
	BASH_WORKER_PROTOCOL_VERSION,
	isBashHostToWorkerMessage,
	isBashWorkerToHostMessage,
	type BashHostToWorkerMessage,
	type BashWorkerLoadMessage,
	type BashWorkerRunMessage,
	type BashWorkerToHostMessage
} from '$lib/playground/bashWorkerProtocol';
import {
	BASH_PREFLIGHT_PROTOCOL,
	BASH_PREFLIGHT_PROTOCOL_VERSION,
	OutputLimitError,
	type ExecutionLimits,
	type WorkspaceLimits
} from '@wasm-idle/core';
import { WASM_BASH_RUNTIME_PROFILE } from '$lib/playground/wasmBashVersion';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => {
	const instances: MockBashWorkerRuntime[] = [];

	class MockBashWorkerRuntime {
		outputBytes?: (stream: 'stdout' | 'stderr', data: Uint8Array) => void;
		loadVerified = vi.fn(
			async (
				_runtimePreflight: unknown,
				_log: boolean,
				_options: unknown,
				progress?: { set?: (value: number, stage?: string) => void }
			) => {
				progress?.set?.(0.25, 'Loading Bash SDK');
				progress?.set?.(1, 'Bash runtime ready');
			}
		);
		run = vi.fn(async () => true as boolean | string);
		write = vi.fn();
		eof = vi.fn();

		constructor() {
			instances.push(this);
		}
	}

	return { instances, MockBashWorkerRuntime };
});

vi.mock('$lib/playground/worker/bashRuntime', () => ({
	default: runtimeMocks.MockBashWorkerRuntime
}));

const limits = Object.freeze({
	assetTimeoutMs: 1_000,
	startupTimeoutMs: 2_000,
	compileTimeoutMs: 3_000,
	runTimeoutMs: 4_000,
	maxOutputBytes: 5_000,
	maxDiagnostics: 100,
	maxWorkspaceBytes: 6_000,
	maxAssetBytes: 7_000,
	maxWasmMemoryBytes: 8_000,
	maxWorkers: 1,
	maxThreads: 1
}) satisfies Readonly<ExecutionLimits>;

const workspaceLimits = Object.freeze({
	maxFiles: 12,
	maxFileBytes: 2_000,
	maxTotalBytes: 4_000,
	maxPathBytes: 128,
	caseSensitive: true
}) satisfies Readonly<WorkspaceLimits>;

const loadMessage = Object.freeze({
	protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
	type: 'load',
	sessionId: 7,
	requestId: 11,
	runtimePreflight: {
		protocol: BASH_PREFLIGHT_PROTOCOL,
		protocolVersion: BASH_PREFLIGHT_PROTOCOL_VERSION,
		profileId: WASM_BASH_RUNTIME_PROFILE.profileId,
		bashPackageVersion: WASM_BASH_RUNTIME_PROFILE.bashPackageVersion,
		bashSourceRevision: WASM_BASH_RUNTIME_PROFILE.bashSourceRevision,
		wasmerSdkVersion: WASM_BASH_RUNTIME_PROFILE.wasmerSdkVersion,
		wasmerSdkPackageIntegrity: WASM_BASH_RUNTIME_PROFILE.wasmerSdkPackageIntegrity,
		manifestFingerprint: WASM_BASH_RUNTIME_PROFILE.manifestFingerprint,
		manifestBytes: new Uint8Array([1]),
		sdkJavaScriptBytes: new Uint8Array([2]),
		wasmerWasmBytes: new Uint8Array([3]),
		webcBytes: new Uint8Array([4])
	},
	limits,
	log: true
}) satisfies BashWorkerLoadMessage;

const runMessage = Object.freeze({
	protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
	type: 'run',
	sessionId: 7,
	requestId: 12,
	code: 'source lib.sh\nprintf "%s" "$VALUE"',
	activePath: 'scripts/main.sh',
	workspaceFiles: [{ path: 'lib.sh', content: 'VALUE=worker-bridge' }],
	programArgs: ['first', 'second'],
	limits,
	workspaceLimits,
	log: false
}) satisfies BashWorkerRunMessage;

function postedMessages() {
	return (
		(globalThis as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage.mock
			.calls ?? []
	).map(([message]) => message as BashWorkerToHostMessage);
}

async function importWorker() {
	await import('./bash');
	const runtime = runtimeMocks.instances.at(-1);
	if (!runtime) throw new Error('Bash worker runtime was not constructed');
	return runtime;
}

async function send(message: unknown) {
	const handler = (globalThis as unknown as { onmessage?: (event: { data: unknown }) => unknown })
		.onmessage;
	if (!handler) throw new Error('Bash worker message handler was not installed');
	return await handler({ data: message });
}

describe('Bash outer worker bridge', () => {
	beforeEach(() => {
		vi.resetModules();
		runtimeMocks.instances.length = 0;
		(globalThis as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage = vi.fn();
		(globalThis as { onmessage?: unknown }).onmessage = undefined;
	});

	it('forwards only the verified payload and limits while preserving load progress identity', async () => {
		const runtime = await importWorker();

		await send(loadMessage);

		expect(runtime.loadVerified).toHaveBeenCalledOnce();
		expect(runtime.loadVerified).toHaveBeenCalledWith(
			loadMessage.runtimePreflight,
			true,
			{ limits },
			expect.objectContaining({ set: expect.any(Function) })
		);
		expect(postedMessages()).toEqual([
			{
				protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
				type: 'progress',
				sessionId: loadMessage.sessionId,
				requestId: loadMessage.requestId,
				value: 0.25,
				stage: 'Loading Bash SDK'
			},
			{
				protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
				type: 'progress',
				sessionId: loadMessage.sessionId,
				requestId: loadMessage.requestId,
				value: 1,
				stage: 'Bash runtime ready'
			},
			{
				protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
				type: 'loaded',
				sessionId: loadMessage.sessionId,
				requestId: loadMessage.requestId
			}
		]);
	});

	it('streams matching stdin, transfers copied UTF-8 output, and returns the run result', async () => {
		const runtime = await importWorker();
		await send(loadMessage);
		(
			globalThis as unknown as { postMessage: ReturnType<typeof vi.fn> }
		).postMessage.mockClear();

		let resolveRun: ((result: boolean | string) => void) | undefined;
		runtime.run.mockImplementationOnce(
			() =>
				new Promise<boolean | string>((resolve) => {
					resolveRun = resolve;
				})
		);
		const pendingRun = send(runMessage);
		await vi.waitFor(() => expect(runtime.run).toHaveBeenCalledOnce());

		expect(runtime.run).toHaveBeenCalledWith(
			runMessage.code,
			false,
			false,
			undefined,
			['first', 'second'],
			{
				activePath: runMessage.activePath,
				workspaceFiles: [{ path: 'lib.sh', content: 'VALUE=worker-bridge' }],
				programArgs: ['first', 'second'],
				limits,
				workspaceLimits
			}
		);
		expect(postedMessages()).toContainEqual({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'stdin-ready',
			sessionId: runMessage.sessionId,
			requestId: runMessage.requestId
		});

		const encodedInput = new TextEncoder().encode('한');
		await send({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'stdin',
			sessionId: runMessage.sessionId,
			requestId: runMessage.requestId + 1,
			bytes: new TextEncoder().encode('stale')
		} satisfies BashHostToWorkerMessage);
		await send({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'stdin',
			sessionId: runMessage.sessionId,
			requestId: runMessage.requestId,
			bytes: encodedInput.slice(0, 1)
		} satisfies BashHostToWorkerMessage);
		await send({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'stdin',
			sessionId: runMessage.sessionId,
			requestId: runMessage.requestId,
			bytes: encodedInput.slice(1)
		} satisfies BashHostToWorkerMessage);
		await send({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'stdin-eof',
			sessionId: runMessage.sessionId,
			requestId: runMessage.requestId
		} satisfies BashHostToWorkerMessage);

		expect(runtime.write).toHaveBeenCalledOnce();
		expect(runtime.write).toHaveBeenCalledWith('한');
		expect(runtime.eof).toHaveBeenCalledOnce();

		const outputSource = new TextEncoder().encode('출력\n');
		runtime.outputBytes?.('stdout', outputSource);
		const outputCall = (
			globalThis as unknown as { postMessage: ReturnType<typeof vi.fn> }
		).postMessage.mock.calls.find(([message]) => message.type === 'output');
		expect(outputCall).toBeDefined();
		const outputMessage = outputCall?.[0] as Extract<
			BashWorkerToHostMessage,
			{ type: 'output' }
		>;
		expect(new TextDecoder().decode(outputMessage.bytes)).toBe('출력\n');
		expect(outputMessage.stream).toBe('stdout');
		expect(outputMessage.bytes).not.toBe(outputSource);
		expect(outputMessage.bytes.buffer).not.toBe(outputSource.buffer);
		expect(outputCall?.[1]).toEqual([outputMessage.bytes.buffer]);

		resolveRun?.(true);
		await pendingRun;
		expect(postedMessages()).toContainEqual({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'result',
			sessionId: runMessage.sessionId,
			requestId: runMessage.requestId,
			result: true
		});
	});

	it('passes explicit stdin without opening the streaming input channel', async () => {
		const runtime = await importWorker();
		await send(loadMessage);
		(
			globalThis as unknown as { postMessage: ReturnType<typeof vi.fn> }
		).postMessage.mockClear();

		await send({ ...runMessage, requestId: 13, stdin: 'prebuffered\n' });

		expect(runtime.run).toHaveBeenCalledWith(
			runMessage.code,
			false,
			false,
			undefined,
			['first', 'second'],
			expect.objectContaining({ stdin: 'prebuffered\n' })
		);
		expect(postedMessages().some(({ type }) => type === 'stdin-ready')).toBe(false);
		expect(postedMessages()).toContainEqual({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'result',
			sessionId: runMessage.sessionId,
			requestId: 13,
			result: true
		});
	});

	it('serializes runtime failures into clone-safe errors with the request identity', async () => {
		const runtime = await importWorker();
		const failure = Object.assign(new Error('WEBc digest mismatch'), {
			code: 'ASSET_INTEGRITY',
			phase: 'asset',
			nonCloneable: () => undefined
		});
		runtime.loadVerified.mockRejectedValueOnce(failure);

		await send(loadMessage);

		const [message] = postedMessages();
		expect(message).toEqual({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'error',
			sessionId: loadMessage.sessionId,
			requestId: loadMessage.requestId,
			phase: 'asset',
			error: {
				name: 'Error',
				message: 'WEBc digest mismatch',
				stack: expect.any(String),
				code: 'ASSET_INTEGRITY'
			}
		});
		expect(() => structuredClone(message)).not.toThrow();
	});

	it('serializes typed error recovery and resource metadata', async () => {
		const runtime = await importWorker();
		await send(loadMessage);
		(
			globalThis as unknown as { postMessage: ReturnType<typeof vi.fn> }
		).postMessage.mockClear();
		runtime.run.mockRejectedValueOnce(
			new OutputLimitError('Bash output exceeded 3 bytes', {
				actual: 4,
				limit: 3,
				phase: 'execute',
				profileId: 'wasmer/bash@1.0.25',
				runtimeId: 'BASH'
			})
		);

		await send(runMessage);

		expect(postedMessages()).toContainEqual({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'error',
			sessionId: runMessage.sessionId,
			requestId: runMessage.requestId,
			phase: 'execute',
			error: {
				name: 'OutputLimitError',
				message: 'Bash output exceeded 3 bytes',
				stack: expect.any(String),
				code: 'output-limit',
				recoverable: true,
				profileId: 'wasmer/bash@1.0.25',
				actual: 4,
				limit: 3
			}
		});
	});

	it('rejects malformed envelopes without invoking the runtime', async () => {
		const runtime = await importWorker();

		await send({ ...loadMessage, protocolVersion: 2 });

		expect(runtime.loadVerified).not.toHaveBeenCalled();
		expect(postedMessages()).toEqual([
			{
				protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
				type: 'error',
				sessionId: loadMessage.sessionId,
				requestId: loadMessage.requestId,
				phase: 'protocol',
				error: {
					name: 'ProtocolError',
					message: 'Invalid Bash worker protocol message',
					stack: expect.any(String)
				}
			}
		]);
	});

	it('validates both sides of the versioned protocol', () => {
		expect(isBashHostToWorkerMessage(loadMessage)).toBe(true);
		expect(isBashHostToWorkerMessage(runMessage)).toBe(true);
		expect(
			isBashHostToWorkerMessage({
				...runMessage,
				limits: { ...limits, maxWorkers: 0 }
			})
		).toBe(false);
		expect(
			isBashWorkerToHostMessage({
				protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
				type: 'output',
				sessionId: 7,
				requestId: 12,
				stream: 'stdout',
				bytes: new Uint8Array([111, 107])
			})
		).toBe(true);
	});
});
