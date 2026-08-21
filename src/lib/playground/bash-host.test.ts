import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BASH_WORKER_PROTOCOL_VERSION } from './bashWorkerProtocol';
import {
	BASH_PREFLIGHT_PROTOCOL,
	BASH_PREFLIGHT_PROTOCOL_VERSION,
	AssetTooLargeError,
	type BashRuntimePreflightPayload
} from '@wasm-idle/core';
import { WASM_BASH_RUNTIME_PROFILE } from './wasmBashVersion';

const { preflightBashRuntimeAssets } = vi.hoisted(() => ({
	preflightBashRuntimeAssets: vi.fn()
}));

vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	preflightBashRuntimeAssets
}));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

const workerInstances: MockWorker[] = [];
let throwOnMessageType = '';

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	readonly messages: any[] = [];
	postMessage = vi.fn((message: any, transfer: Transferable[] = []) => {
		if (message.type === throwOnMessageType) {
			throw new Error(`cannot post ${message.type}`);
		}
		this.messages.push(structuredClone(message, { transfer }));
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}

	emit(message: Record<string, unknown>) {
		this.onmessage?.({ data: message } as MessageEvent<any>);
	}

	emitFor(request: any, message: Record<string, unknown>) {
		this.emit({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			sessionId: request.sessionId,
			requestId: request.requestId,
			...message
		});
	}
}

vi.mock('$lib/playground/worker/bash?worker', () => ({ default: MockWorker }));

import Bash from './bash';

function posted(worker: MockWorker, type: string) {
	return worker.messages.find((message) => message.type === type);
}

function createRuntimePreflight(): BashRuntimePreflightPayload {
	return Object.freeze({
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
	});
}

async function waitForPosted(worker: MockWorker, type: string) {
	await vi.waitFor(() => expect(posted(worker, type)).toBeDefined());
	return posted(worker, type);
}

async function finishLoad(worker: MockWorker) {
	const request = await waitForPosted(worker, 'load');
	worker.emitFor(request, { type: 'loaded' });
	return request;
}

async function loadSandbox(sandbox: Bash, rootUrl = '/assets') {
	const previousWorkerCount = workerInstances.length;
	const loading = sandbox.load(rootUrl);
	await vi.waitFor(() => expect(workerInstances.length).toBeGreaterThan(previousWorkerCount));
	const worker = workerInstances.at(-1)!;
	await finishLoad(worker);
	await loading;
	return worker;
}

describe('Bash disposable worker host', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		throwOnMessageType = '';
		vi.restoreAllMocks();
		preflightBashRuntimeAssets.mockReset();
		preflightBashRuntimeAssets.mockImplementation(async () => createRuntimePreflight());
		vi.useRealTimers();
		history.replaceState({}, '', '/wasm-idle/editor');
	});

	it('preflights four pinned runtime assets before importing the outer worker', async () => {
		let resolvePreflight!: (payload: BashRuntimePreflightPayload) => void;
		preflightBashRuntimeAssets.mockReturnValueOnce(
			new Promise((resolve) => {
				resolvePreflight = resolve;
			})
		);
		const payload = createRuntimePreflight();
		const sandbox = new Bash();
		const loading = sandbox.load('/runtime');

		await Promise.resolve();
		expect(workerInstances).toHaveLength(0);
		resolvePreflight(payload);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const request = await waitForPosted(worker, 'load');
		const transfer = worker.postMessage.mock.calls[0]?.[1] as Transferable[];

		expect(preflightBashRuntimeAssets).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUrl: 'http://localhost:3000/runtime/wasm-bash/',
				manifestUrl: expect.stringMatching(/runtime-manifest\.v2\.json\?v=/u),
				sdkJavaScriptUrl: expect.stringMatching(/sdk\/index\.mjs\.bin\?v=/u),
				wasmerWasmUrl: expect.stringMatching(/wasmer_js_bg\.wasm\.gz\.bin\?v=/u),
				webcUrl: expect.stringMatching(/bash\.webc\.gz\.bin\?v=/u)
			})
		);
		expect(request.runtimePreflight).toMatchObject({
			protocol: BASH_PREFLIGHT_PROTOCOL,
			manifestFingerprint: WASM_BASH_RUNTIME_PROFILE.manifestFingerprint
		});
		expect(transfer).toHaveLength(4);
		expect(new Set(transfer).size).toBe(4);
		expect([
			payload.manifestBytes.byteLength,
			payload.sdkJavaScriptBytes.byteLength,
			payload.wasmerWasmBytes.byteLength,
			payload.webcBytes.byteLength
		]).toEqual([0, 0, 0, 0]);

		worker.emitFor(request, { type: 'loaded' });
		await loading;
	});

	it('keeps a verified generation warm without refetching or retransferring payload bytes', async () => {
		const sandbox = new Bash();
		const progress = { set: vi.fn() };
		const loading = sandbox.load('/runtime', '', true, [], {}, progress);

		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const request = await waitForPosted(worker, 'load');
		expect(request).toMatchObject({
			type: 'load',
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			runtimePreflight: {
				protocol: BASH_PREFLIGHT_PROTOCOL,
				manifestFingerprint: WASM_BASH_RUNTIME_PROFILE.manifestFingerprint
			}
		});

		worker.emitFor(request, { type: 'progress', value: 0.5, stage: 'Loading WEBc' });
		worker.emitFor(request, { type: 'loaded' });
		await loading;

		expect(progress.set).toHaveBeenCalledWith(0.5, 'Loading WEBc');
		expect(progress.set).toHaveBeenLastCalledWith(1, 'Bash runtime ready');
		expect(worker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.load('/runtime')).resolves.toBeUndefined();
		expect(preflightBashRuntimeAssets).toHaveBeenCalledOnce();
		expect(worker.postMessage).toHaveBeenCalledOnce();
	});

	it('does not warm-reuse a generation when its effective startup resource limits change', async () => {
		const sandbox = new Bash();
		const readyWorker = await loadSandbox(sandbox, '/runtime');
		preflightBashRuntimeAssets.mockRejectedValueOnce(
			new AssetTooLargeError('Bash SDK receipt exceeds the stricter limit', {
				actual: 2,
				limit: 1,
				runtimeId: 'BASH'
			})
		);

		await expect(
			sandbox.load('/runtime', '', true, [], { limits: { maxAssetBytes: 1 } })
		).rejects.toMatchObject({ code: 'asset-too-large', limit: 1 });

		expect(preflightBashRuntimeAssets).toHaveBeenCalledTimes(2);
		expect(workerInstances).toHaveLength(1);
		expect(readyWorker.terminate).not.toHaveBeenCalled();
	});

	it.each([
		['maxWasmMemoryBytes', 256 * 1024 * 1024],
		['maxWorkers', 2],
		['maxThreads', 2]
	] as const)(
		'rebinds the warm generation when effective %s changes',
		async (limitName, value) => {
			const sandbox = new Bash();
			const readyWorker = await loadSandbox(sandbox, '/runtime');
			const loading = sandbox.load('/runtime', '', true, [], {
				limits: { [limitName]: value }
			});

			await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
			const replacementWorker = workerInstances[1];
			await finishLoad(replacementWorker);
			await loading;

			expect(preflightBashRuntimeAssets).toHaveBeenCalledTimes(2);
			expect(readyWorker.terminate).toHaveBeenCalledOnce();
			expect(replacementWorker.terminate).not.toHaveBeenCalled();
		}
	);

	it('decodes interleaved stdout and stderr independently and keeps a successful worker warm', async () => {
		const sandbox = new Bash();
		const worker = await loadSandbox(sandbox);
		const output = vi.fn();
		sandbox.output = output;

		const running = sandbox.run('printf "😀"', false);
		const request = await waitForPosted(worker, 'run');
		const encoded = new TextEncoder().encode('😀');
		worker.emitFor(request, {
			type: 'output',
			stream: 'stdout',
			bytes: encoded.slice(0, 2)
		});
		worker.emitFor(request, {
			type: 'output',
			stream: 'stderr',
			bytes: new TextEncoder().encode('warning:')
		});
		worker.emitFor(request, {
			type: 'output',
			stream: 'stdout',
			bytes: encoded.slice(2)
		});
		worker.emitFor(request, { type: 'result', result: true });

		await expect(running).resolves.toBe(true);
		expect(output.mock.calls.map(([chunk]) => chunk).join('')).toBe('warning:😀');
		expect(worker.terminate).not.toHaveBeenCalled();
	});

	it('terminates an aborted run immediately and lazily rehydrates for a clean retry', async () => {
		const sandbox = new Bash();
		const firstWorker = await loadSandbox(sandbox);
		const controller = new AbortController();
		const reason = new Error('stop infinite Bash');

		const firstRun = sandbox.run('while :; do :; done', false, true, undefined, [], {
			signal: controller.signal
		});
		await waitForPosted(firstWorker, 'run');
		controller.abort(reason);

		await expect(firstRun).rejects.toBe(reason);
		expect(firstWorker.terminate).toHaveBeenCalledTimes(1);

		const retry = sandbox.run('printf retry', false);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const retryWorker = workerInstances[1];
		await finishLoad(retryWorker);
		const retryRequest = await waitForPosted(retryWorker, 'run');
		retryWorker.emitFor(retryRequest, { type: 'result', result: true });

		await expect(retry).resolves.toBe(true);
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('applies stricter run startup limits when lazily rehydrating a retired generation', async () => {
		const sandbox = new Bash();
		const firstWorker = await loadSandbox(sandbox);
		sandbox.terminate();
		expect(firstWorker.terminate).toHaveBeenCalledOnce();

		preflightBashRuntimeAssets.mockRejectedValueOnce(
			new AssetTooLargeError('Bash SDK receipt exceeds the stricter run limit', {
				actual: 2,
				limit: 1,
				runtimeId: 'BASH'
			})
		);

		await expect(
			sandbox.run('printf blocked', false, true, undefined, [], {
				limits: {
					assetTimeoutMs: 2,
					maxAssetBytes: 1,
					startupTimeoutMs: 3
				}
			})
		).rejects.toMatchObject({ code: 'asset-too-large', limit: 1 });

		expect(preflightBashRuntimeAssets).toHaveBeenCalledTimes(2);
		expect(preflightBashRuntimeAssets.mock.calls[1]?.[0]).toMatchObject({
			limits: {
				assetTimeoutMs: 2,
				maxAssetBytes: 1,
				startupTimeoutMs: 3
			}
		});
		expect(workerInstances).toHaveLength(1);
	});

	it('ignores retained messages from a terminated generation', async () => {
		const sandbox = new Bash();
		const firstWorker = await loadSandbox(sandbox);
		const output = vi.fn();
		sandbox.output = output;
		const controller = new AbortController();

		const firstRun = sandbox.run('while :; do printf stale; done', false, true, undefined, [], {
			signal: controller.signal
		});
		const staleRequest = await waitForPosted(firstWorker, 'run');
		controller.abort(new Error('replace generation'));
		await expect(firstRun).rejects.toThrow('replace generation');

		const retry = sandbox.run('printf fresh', false);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const retryWorker = workerInstances[1];
		await finishLoad(retryWorker);
		const retryRequest = await waitForPosted(retryWorker, 'run');

		firstWorker.emitFor(staleRequest, {
			type: 'output',
			stream: 'stdout',
			bytes: new TextEncoder().encode('stale')
		});
		firstWorker.emitFor(staleRequest, { type: 'result', result: true });
		expect(output).not.toHaveBeenCalled();

		retryWorker.emitFor(retryRequest, {
			type: 'output',
			stream: 'stdout',
			bytes: new TextEncoder().encode('fresh')
		});
		retryWorker.emitFor(retryRequest, { type: 'result', result: true });
		await expect(retry).resolves.toBe(true);
		expect(output).toHaveBeenCalledWith('fresh');
	});

	it('ignores only past request messages from the same live worker generation', async () => {
		const sandbox = new Bash();
		const worker = await loadSandbox(sandbox);
		const loadRequest = posted(worker, 'load');
		const running = sandbox.run('printf current', false);
		const runRequest = await waitForPosted(worker, 'run');

		worker.emitFor(loadRequest, { type: 'progress', value: 0.75, stage: 'stale' });
		expect(worker.terminate).not.toHaveBeenCalled();
		worker.emitFor(runRequest, { type: 'result', result: true });

		await expect(running).resolves.toBe(true);
	});

	it('fails fast when a live worker returns a future request identity', async () => {
		const sandbox = new Bash();
		const worker = await loadSandbox(sandbox);
		const running = sandbox.run('printf current', false);
		const request = await waitForPosted(worker, 'run');

		worker.emit({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'result',
			sessionId: request.sessionId,
			requestId: request.requestId + 1,
			result: true
		});

		await expect(running).rejects.toMatchObject({
			name: 'ProtocolError',
			code: 'protocol'
		});
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it.each([0, -1])(
		'fails fast when a live worker returns invalid request identity %s',
		async (requestId) => {
			const sandbox = new Bash();
			const worker = await loadSandbox(sandbox);
			const running = sandbox.run('printf current', false);
			const request = await waitForPosted(worker, 'run');

			worker.emit({
				protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
				type: 'result',
				sessionId: request.sessionId,
				requestId,
				result: true
			});

			await expect(running).rejects.toMatchObject({
				name: 'ProtocolError',
				code: 'protocol'
			});
			expect(worker.terminate).toHaveBeenCalledTimes(1);
		}
	);

	it('preserves the ready worker when a replacement load fails', async () => {
		const sandbox = new Bash();
		const readyWorker = await loadSandbox(sandbox, '/first');

		const replacement = sandbox.load('/replacement');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const candidate = workerInstances[1];
		const loadRequest = await waitForPosted(candidate, 'load');
		candidate.emitFor(loadRequest, {
			type: 'error',
			phase: 'asset',
			error: {
				name: 'AssetIntegrityError',
				message: 'replacement hash mismatch',
				code: 'asset-integrity'
			}
		});

		await expect(replacement).rejects.toMatchObject({
			name: 'AssetIntegrityError',
			code: 'asset-integrity',
			recoverable: false
		});
		expect(candidate.terminate).toHaveBeenCalledTimes(1);
		expect(readyWorker.terminate).not.toHaveBeenCalled();

		const running = sandbox.run('printf original', false);
		const runRequest = await waitForPosted(readyWorker, 'run');
		readyWorker.emitFor(runRequest, { type: 'result', result: true });
		await expect(running).resolves.toBe(true);
	});

	it('retires an idle crashed worker and lazily rehydrates before the next run', async () => {
		const sandbox = new Bash();
		const crashedWorker = await loadSandbox(sandbox);
		const onError = crashedWorker.onerror;

		onError?.({ message: 'idle outer worker crashed' } as ErrorEvent);

		expect(crashedWorker.terminate).toHaveBeenCalledTimes(1);
		const retry = sandbox.run('printf retry', false);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const retryWorker = workerInstances[1];
		await finishLoad(retryWorker);
		const retryRequest = await waitForPosted(retryWorker, 'run');
		retryWorker.emitFor(retryRequest, { type: 'result', result: true });
		await expect(retry).resolves.toBe(true);
	});

	it('enforces the host output ceiling by killing the exact worker', async () => {
		const sandbox = new Bash();
		const worker = await loadSandbox(sandbox);

		const running = sandbox.run('printf 1234', false, true, undefined, [], {
			limits: { maxOutputBytes: 3 }
		});
		const request = await waitForPosted(worker, 'run');
		worker.emitFor(request, {
			type: 'output',
			stream: 'stdout',
			bytes: new TextEncoder().encode('1234')
		});

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			actual: 4,
			limit: 3
		});
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it('kills a timed-out run and releases the operation for retry', async () => {
		vi.useFakeTimers();
		const sandbox = new Bash();
		const loading = sandbox.load('/assets');
		await vi.advanceTimersByTimeAsync(0);
		const worker = workerInstances[0];
		await finishLoad(worker);
		await loading;

		const running = sandbox.run('sleep forever', false, true, undefined, [], {
			limits: { compileTimeoutMs: 1, runTimeoutMs: 1 }
		});
		const rejection = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			timeoutMs: 2
		});
		await vi.advanceTimersByTimeAsync(2);

		await rejection;
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it('forwards queued and live streaming stdin only after the worker is ready', async () => {
		const sandbox = new Bash();
		const worker = await loadSandbox(sandbox);
		sandbox.write('queued\n');

		const running = sandbox.run('read first; read second', false);
		const request = await waitForPosted(worker, 'run');
		expect(worker.postMessage.mock.calls.map(([message]) => message.type)).not.toContain(
			'stdin'
		);

		worker.emitFor(request, { type: 'stdin-ready' });
		await vi.waitFor(() => expect(posted(worker, 'stdin')).toBeDefined());
		const firstInput = posted(worker, 'stdin');
		expect(new TextDecoder().decode(firstInput.bytes)).toBe('queued\n');

		sandbox.write('live\n');
		sandbox.eof();
		await vi.waitFor(() => {
			const types = worker.postMessage.mock.calls.map(([message]) => message.type);
			expect(types.filter((type) => type === 'stdin')).toHaveLength(2);
			expect(types).toContain('stdin-eof');
		});
		worker.emitFor(request, { type: 'result', result: true });
		await expect(running).resolves.toBe(true);
	});

	it('does not leak input queued during an explicit-stdin run into the next execution', async () => {
		const sandbox = new Bash();
		const worker = await loadSandbox(sandbox);

		const explicitRun = sandbox.run('read value', false, true, undefined, [], {
			stdin: 'authoritative\n'
		});
		const explicitRequest = await waitForPosted(worker, 'run');
		sandbox.write('must-not-leak\n');
		worker.emitFor(explicitRequest, { type: 'result', result: true });
		await explicitRun;

		worker.postMessage.mockClear();
		worker.messages.length = 0;
		const nextRun = sandbox.run('printf clean', false);
		const nextRequest = await waitForPosted(worker, 'run');
		worker.emitFor(nextRequest, { type: 'stdin-ready' });
		expect(posted(worker, 'stdin')).toBeUndefined();
		worker.emitFor(nextRequest, { type: 'result', result: true });
		await nextRun;
	});

	it('rejects overlapping operations without replacing the first worker', async () => {
		const sandbox = new Bash();
		const firstLoad = sandbox.load('/assets');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));

		await expect(sandbox.load('/other')).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup'
		});
		await expect(sandbox.run('printf overlap', false)).rejects.toMatchObject({
			name: 'BusyError',
			code: 'busy',
			phase: 'startup'
		});
		expect(workerInstances).toHaveLength(1);

		await finishLoad(workerInstances[0]);
		await firstLoad;
	});

	it('preserves queued input and timing state when run preflight fails', async () => {
		const sandbox = new Bash();
		const worker = await loadSandbox(sandbox);
		sandbox.write('queued\n');
		sandbox.eof();
		const begin = sandbox.begin;
		const elapse = sandbox.elapse;

		await expect(
			sandbox.run('printf unreachable', false, true, undefined, [], {
				activePath: '../escape.sh'
			})
		).rejects.toMatchObject({ name: 'WorkspaceValidationError' });

		expect(sandbox.pendingInput).toEqual(['queued\n']);
		expect(sandbox.pendingEof).toBe(true);
		expect(sandbox.begin).toBe(begin);
		expect(sandbox.elapse).toBe(elapse);
		expect(sandbox.exit).toBe(true);
		expect(posted(worker, 'run')).toBeUndefined();
	});

	it('types worker startup, protocol, and synchronous dispatch failures', async () => {
		const startupSandbox = new Bash();
		const startup = startupSandbox.load('/assets');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		workerInstances[0].onerror?.({ message: 'outer worker crashed' } as ErrorEvent);
		await expect(startup).rejects.toMatchObject({
			name: 'WorkerStartupError',
			code: 'worker-startup',
			phase: 'startup'
		});

		const protocolSandbox = new Bash();
		const protocolWorker = await loadSandbox(protocolSandbox);
		const running = protocolSandbox.run('printf protocol', false);
		await waitForPosted(protocolWorker, 'run');
		protocolWorker.onmessageerror?.({} as MessageEvent);
		await expect(running).rejects.toMatchObject({
			name: 'ProtocolError',
			code: 'protocol'
		});

		throwOnMessageType = 'load';
		const dispatchSandbox = new Bash();
		await expect(dispatchSandbox.load('/dispatch')).rejects.toMatchObject({
			name: 'ProtocolError',
			code: 'protocol'
		});
		const failedPayload = await preflightBashRuntimeAssets.mock.results.at(-1)?.value;
		throwOnMessageType = '';
		const retry = dispatchSandbox.load('/dispatch');
		await vi.waitFor(() => expect(workerInstances.length).toBeGreaterThan(3));
		const retryWorker = workerInstances.at(-1)!;
		const retryRequest = await finishLoad(retryWorker);
		await retry;
		const retryPayload = retryRequest.runtimePreflight as BashRuntimePreflightPayload;
		expect(retryPayload).not.toBe(failedPayload);
		expect(retryPayload.manifestBytes.byteLength).toBe(1);
	});

	it('preserves typed worker errors and their resource metadata', async () => {
		const sandbox = new Bash();
		const worker = await loadSandbox(sandbox);
		const running = sandbox.run('printf overflow', false);
		const request = await waitForPosted(worker, 'run');
		worker.emitFor(request, {
			type: 'error',
			phase: 'execute',
			error: {
				name: 'OutputLimitError',
				message: 'inner Bash output exceeded 3 bytes',
				code: 'output-limit',
				recoverable: true,
				actual: 4,
				limit: 3
			}
		});

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			recoverable: true,
			actual: 4,
			limit: 3
		});

		const protocolSandbox = new Bash();
		const protocolLoading = protocolSandbox.load('/protocol');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const protocolWorker = workerInstances[1];
		const protocolRequest = await waitForPosted(protocolWorker, 'load');
		protocolWorker.emitFor(protocolRequest, {
			type: 'error',
			phase: 'protocol',
			error: {
				name: 'ProtocolError',
				message: 'inner Bash protocol failed',
				code: 'protocol',
				recoverable: false
			}
		});
		await expect(protocolLoading).rejects.toMatchObject({
			name: 'ProtocolError',
			code: 'protocol',
			phase: 'protocol',
			recoverable: false
		});
	});

	it('clears the worker, remembered configuration, and pending input idempotently', async () => {
		const sandbox = new Bash();
		const worker = await loadSandbox(sandbox);
		sandbox.write('stale');

		await sandbox.clear();
		await sandbox.clear();

		expect(worker.terminate).toHaveBeenCalledTimes(1);
		await expect(sandbox.run('printf unavailable', false)).rejects.toThrow(
			'Bash runtime is not loaded'
		);
	});

	it('clears both a replacement candidate and the previously ready worker', async () => {
		const sandbox = new Bash();
		const readyWorker = await loadSandbox(sandbox, '/first');
		const replacement = sandbox.load('/replacement');
		const rejection = expect(replacement).rejects.toBe('Process terminated');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const candidate = workerInstances[1];
		await waitForPosted(candidate, 'load');
		sandbox.write('stale during load');
		sandbox.eof();

		await sandbox.clear();
		await rejection;

		expect(candidate.terminate).toHaveBeenCalledTimes(1);
		expect(readyWorker.terminate).toHaveBeenCalledTimes(1);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		await expect(sandbox.run('printf unavailable', false)).rejects.toThrow(
			'Bash runtime is not loaded'
		);
	});

	it('disposes an idle Bash runtime exactly once and rejects reentrant work', async () => {
		const sandbox = new Bash();
		const worker = await loadSandbox(sandbox);
		const output = vi.fn();
		const diagnostic = vi.fn();
		sandbox.output = output;
		sandbox.oncompilerdiagnostic = diagnostic;
		sandbox.write('queued input\n');
		sandbox.eof();

		let cleanupSnapshot: Record<string, unknown> | undefined;
		let reentrantLoad: Promise<void> | undefined;
		let reentrantDisposal: Promise<void> | undefined;
		worker.terminate.mockImplementationOnce(() => {
			cleanupSnapshot = {
				readyWorker: Reflect.get(sandbox, 'readyWorker'),
				loadedConfig: Reflect.get(sandbox, 'loadedConfig'),
				webcUrl: sandbox.webcUrl,
				output: sandbox.output,
				diagnostic: sandbox.oncompilerdiagnostic,
				pendingInput: [...sandbox.pendingInput],
				pendingEof: sandbox.pendingEof,
				onmessage: worker.onmessage,
				onerror: worker.onerror,
				onmessageerror: worker.onmessageerror
			};
			reentrantLoad = sandbox.load('/reentrant');
			reentrantDisposal = sandbox.dispose();
		});

		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();
		expect(secondDisposal).toBe(firstDisposal);
		expect(reentrantDisposal).toBe(firstDisposal);
		const reentrantLoadResult = expect(reentrantLoad!).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'BASH'
		});
		await firstDisposal;
		await reentrantLoadResult;

		expect(cleanupSnapshot).toEqual({
			readyWorker: null,
			loadedConfig: null,
			webcUrl: '',
			output: undefined,
			diagnostic: undefined,
			pendingInput: [],
			pendingEof: false,
			onmessage: null,
			onerror: null,
			onmessageerror: null
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		await expect(sandbox.load('/replacement')).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'BASH'
		});
		await expect(sandbox.run('printf unavailable', true)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'dispose',
			runtimeId: 'BASH'
		});
		sandbox.write('ignored input\n');
		sandbox.eof();
		sandbox.terminate();
		await sandbox.clear();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(1);
	});

	it('settles active Bash startup with the stable disposal cancellation', async () => {
		const sandbox = new Bash();
		const loading = sandbox.load('/assets');
		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const worker = workerInstances[0];
		const request = await waitForPosted(worker, 'load');
		const staleHandler = worker.onmessage;
		const cancellation = loading.catch((error) => error);

		await sandbox.dispose();
		await expect(cancellation).resolves.toBe(Reflect.get(sandbox, 'disposeCancellation'));
		expect(await cancellation).toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'BASH',
			recoverable: false
		});
		expect(worker.terminate).toHaveBeenCalledOnce();
		staleHandler?.({
			data: {
				protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
				sessionId: request.sessionId,
				requestId: request.requestId,
				type: 'loaded'
			}
		} as MessageEvent<any>);
		expect(workerInstances).toHaveLength(1);
	});

	it('settles an active Bash run and ignores retained output after disposal', async () => {
		const sandbox = new Bash();
		const worker = await loadSandbox(sandbox);
		const output = vi.fn();
		sandbox.output = output;
		const running = sandbox.run('printf active', false);
		const request = await waitForPosted(worker, 'run');
		const staleHandler = worker.onmessage;
		const cancellation = running.catch((error) => error);

		await sandbox.dispose();
		await expect(cancellation).resolves.toBe(Reflect.get(sandbox, 'disposeCancellation'));
		expect(await cancellation).toMatchObject({
			name: 'CancelledError',
			code: 'cancelled',
			phase: 'dispose',
			runtimeId: 'BASH',
			recoverable: false
		});
		expect(worker.terminate).toHaveBeenCalledOnce();

		staleHandler?.({
			data: {
				protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
				sessionId: request.sessionId,
				requestId: request.requestId,
				type: 'output',
				stream: 'stdout',
				bytes: new TextEncoder().encode('late output')
			}
		} as MessageEvent<any>);
		await Promise.resolve();
		expect(output).not.toHaveBeenCalled();
		expect(sandbox.output).toBeUndefined();
	});

	it('disposes a replacement candidate and the previously ready Bash worker once', async () => {
		const sandbox = new Bash();
		const readyWorker = await loadSandbox(sandbox, '/first');
		const replacement = sandbox.load('/replacement');
		const cancellation = replacement.catch((error) => error);
		await vi.waitFor(() => expect(workerInstances).toHaveLength(2));
		const candidate = workerInstances[1];
		await waitForPosted(candidate, 'load');

		const firstDisposal = sandbox.dispose();
		const secondDisposal = sandbox.dispose();
		expect(secondDisposal).toBe(firstDisposal);
		await firstDisposal;
		await expect(cancellation).resolves.toBe(Reflect.get(sandbox, 'disposeCancellation'));
		expect(candidate.terminate).toHaveBeenCalledOnce();
		expect(readyWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
	});
});
