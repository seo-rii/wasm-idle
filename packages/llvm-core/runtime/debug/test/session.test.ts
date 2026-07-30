import { describe, expect, it } from 'vitest';

import { DapMessageParser, encodeDapMessage } from '../src/dap-client.js';
import { BrowserLldbSession } from '../src/session.js';
import { SharedByteQueue } from '../src/shared-byte-queue.js';
import type {
	BrowserLldbSessionOptions,
	DapRequest,
	DapResponse,
	DapEvent,
	DebugWorkerInboundMessage,
	DebugWorkerOutboundMessage,
	RuntimeManifestV2,
	WorkerLike
} from '../src/types.js';

const hash = 'a'.repeat(64);
const assetHash = 'a647260c0a2f386cdb893fdc303169041dcf2955da1fa881501863ec8b968785';
const manifest: RuntimeManifestV2 = {
	manifestVersion: 2,
	version: 'test',
	defaultTarget: 'wasm32-wasi',
	compiler: {
		memfs: { asset: 'memfs.zip', argv0: 'memfs' },
		clang: { asset: 'clang.zip', argv0: 'clang' },
		lld: { asset: 'lld.zip', argv0: 'wasm-ld' },
		sysroot: { asset: 'sysroot.tar.zip' },
		provenance: {
			name: 'clang',
			version: '22.1.8',
			revision: 'ca7933e47d3a3451d81e72ac174dcb5aa28b59d1'
		}
	},
	targets: {
		'wasm32-wasi': {
			artifactFormat: 'wasi-core-wasm',
			execution: { kind: 'wasi-preview1' }
		}
	},
	clangd: { js: 'clangd.js', wasm: 'clangd.wasm' },
	debugger: {
		protocolVersion: 1,
		transport: 'shared-ring-v1',
		lldb: {
			js: 'lldb.js',
			wasm: 'lldb.wasm',
			worker: 'lldb.pthread.mjs',
			jsSha256: assetHash,
			wasmSha256: assetHash,
			workerSha256: assetHash,
			llvmVersion: '22.1.8',
			llvmRevision: 'ca7933e47d3a3451d81e72ac174dcb5aa28b59d1',
			patchesSha256: hash
		},
		targetRuntime: {
			name: 'wamr',
			js: 'wamr.js',
			wasm: 'wamr.wasm',
			worker: 'wamr.worker.mjs',
			jsSha256: assetHash,
			wasmSha256: assetHash,
			workerSha256: assetHash,
			revision: '25bd7eb63e828e4bd242cc9b38d260b4b31c6605'
		},
		capabilities: {
			breakpoints: true,
			stepping: true,
			stackTrace: true,
			locals: true,
			globals: true,
			readMemory: true,
			evaluateExpressions: false,
			dataBreakpoints: false,
			wasmThreads: false
		}
	}
};

class FakeWorker implements WorkerLike {
	readonly received: DebugWorkerInboundMessage[] = [];
	readonly requests: DapRequest[] = [];
	private readonly listeners = new Set<
		(event: MessageEvent<DebugWorkerOutboundMessage>) => void
	>();
	private readonly errorListeners = new Set<(event: ErrorEvent) => void>();
	private readonly messageErrorListeners = new Set<(event: MessageEvent<unknown>) => void>();
	private terminated = false;
	private dapOutput?: SharedByteQueue;

	constructor(
		readonly kind: 'lldb' | 'target',
		readonly commands: string[],
		private readonly failAfterReady = false,
		private readonly suppressReady = false,
		private readonly suppressedResponses = new Set<string>()
	) {}

	postMessage(message: DebugWorkerInboundMessage) {
		this.received.push(message);
		if (message.type === 'initialize-target') {
			const stdout = new SharedByteQueue(message.stdout);
			stdout.tryWrite(new TextEncoder().encode('target output\n'));
			stdout.close();
			if (!this.suppressReady) {
				this.emit({
					type: 'memory',
					worker: 'target',
					bytes: 256,
					generation: message.generation
				});
				this.emit({
					type: 'ready',
					worker: 'target',
					generation: message.generation
				});
				if (this.failAfterReady) {
					this.emit({
						type: 'error',
						worker: 'target',
						generation: message.generation,
						message: 'target failed after ready'
					});
				}
			}
		}
		if (message.type === 'initialize-lldb') {
			if (!this.suppressReady) {
				this.emit({
					type: 'memory',
					worker: 'lldb',
					bytes: 512,
					generation: message.generation
				});
				this.emit({
					type: 'ready',
					worker: 'lldb',
					generation: message.generation
				});
				this.dapOutput = new SharedByteQueue(message.dapOutput);
				void this.runAdapter(new SharedByteQueue(message.dapInput), this.dapOutput).catch(
					() => undefined
				);
			}
		}
	}

	addEventListener(
		type: 'message',
		listener: (event: MessageEvent<DebugWorkerOutboundMessage>) => void
	): void;
	addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	addEventListener(type: 'messageerror', listener: (event: MessageEvent<unknown>) => void): void;
	addEventListener(
		type: 'message' | 'error' | 'messageerror',
		listener:
			| ((event: MessageEvent<DebugWorkerOutboundMessage>) => void)
			| ((event: ErrorEvent) => void)
			| ((event: MessageEvent<unknown>) => void)
	) {
		if (type === 'message') {
			this.listeners.add(
				listener as (event: MessageEvent<DebugWorkerOutboundMessage>) => void
			);
		} else if (type === 'error') {
			this.errorListeners.add(listener as (event: ErrorEvent) => void);
		} else {
			this.messageErrorListeners.add(listener as (event: MessageEvent<unknown>) => void);
		}
	}

	removeEventListener(
		type: 'message',
		listener: (event: MessageEvent<DebugWorkerOutboundMessage>) => void
	): void;
	removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
	removeEventListener(
		type: 'messageerror',
		listener: (event: MessageEvent<unknown>) => void
	): void;
	removeEventListener(
		type: 'message' | 'error' | 'messageerror',
		listener:
			| ((event: MessageEvent<DebugWorkerOutboundMessage>) => void)
			| ((event: ErrorEvent) => void)
			| ((event: MessageEvent<unknown>) => void)
	) {
		if (type === 'message') {
			this.listeners.delete(
				listener as (event: MessageEvent<DebugWorkerOutboundMessage>) => void
			);
		} else if (type === 'error') {
			this.errorListeners.delete(listener as (event: ErrorEvent) => void);
		} else {
			this.messageErrorListeners.delete(listener as (event: MessageEvent<unknown>) => void);
		}
	}

	terminate() {
		this.terminated = true;
	}

	get isTerminated() {
		return this.terminated;
	}

	emitFinalOutputAndExit(output: string, exitCode = 0) {
		const initialization = this.received.find(
			(message) => message.type === 'initialize-target'
		);
		if (!initialization || initialization.type !== 'initialize-target') {
			throw new Error('target worker was not initialized');
		}
		const stderr = new SharedByteQueue(initialization.stderr);
		stderr.tryWrite(new TextEncoder().encode(output));
		stderr.close();
		this.emit({
			type: 'exit',
			exitCode,
			generation: initialization.generation
		});
	}

	async emitDapEvent(event: DapEvent) {
		if (!this.dapOutput) throw new Error('LLDB DAP output was not initialized');
		await this.dapOutput.write(encodeDapMessage(event));
	}

	async respondDapRequest(
		request: DapRequest,
		response: { success?: boolean; body?: unknown; message?: string } = {}
	) {
		if (!this.dapOutput) throw new Error('LLDB DAP output was not initialized');
		const message: DapResponse = {
			seq: this.commands.length + 1_000,
			type: 'response',
			request_seq: request.seq,
			command: request.command,
			success: response.success !== false,
			...(response.body === undefined ? {} : { body: response.body }),
			...(response.message === undefined ? {} : { message: response.message })
		};
		await this.dapOutput.write(encodeDapMessage(message));
	}

	private emit(message: DebugWorkerOutboundMessage) {
		for (const listener of this.listeners) {
			listener({ data: message } as MessageEvent<DebugWorkerOutboundMessage>);
		}
	}

	private async runAdapter(input: SharedByteQueue, output: SharedByteQueue) {
		const parser = new DapMessageParser();
		const chunk = new Uint8Array(31);
		let pendingAttach: DapRequest | undefined;
		while (!this.terminated) {
			const length = await input.read(chunk);
			if (length === 0) return;
			for (const message of parser.push(chunk.slice(0, length))) {
				if (message.type !== 'request') continue;
				const request = message as DapRequest;
				this.requests.push(request);
				this.commands.push(request.command);
				if (request.command === 'attach') {
					pendingAttach = request;
					const initialized: DapEvent = {
						seq: this.commands.length + 100,
						type: 'event',
						event: 'initialized'
					};
					await output.write(encodeDapMessage(initialized));
					continue;
				}
				if (this.suppressedResponses.has(request.command)) continue;
				const response: DapResponse = {
					seq: this.commands.length + 100,
					type: 'response',
					request_seq: request.seq,
					command: request.command,
					success: true,
					body:
						request.command === 'initialize'
							? {
									supportsConfigurationDoneRequest: true,
									supportsReadMemoryRequest: true
								}
							: {}
				};
				await output.write(encodeDapMessage(response));
				if (request.command === 'configurationDone' && pendingAttach) {
					const attachResponse: DapResponse = {
						seq: this.commands.length + 101,
						type: 'response',
						request_seq: pendingAttach.seq,
						command: pendingAttach.command,
						success: true,
						body: {}
					};
					pendingAttach = undefined;
					await output.write(encodeDapMessage(attachResponse));
				}
			}
		}
	}
}

describe('BrowserLldbSession', () => {
	it('connects before breakpoints and starts the target only after configurationDone', async () => {
		const commands: string[] = [];
		const workers: FakeWorker[] = [];
		const output: string[] = [];
		const memory: string[] = [];
		const deferredResponses = new Set<string>();
		const session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: [{ path: '/workspace/main.cpp', content: 'int main() { return 0; }' }],
			breakpoints: [
				{
					source: { path: '/workspace/main.cpp' },
					lines: [1]
				}
			],
			launch: {
				program: '/workspace/program.wasm',
				args: ['first', 'second'],
				env: { MODE: 'debug' },
				cwd: '/workspace'
			},
			workerFactory: (kind) => {
				const worker = new FakeWorker(kind, commands, false, false, deferredResponses);
				workers.push(worker);
				return worker;
			},
			fetchImpl: async () => new Response('debug-asset'),
			onOutput: (channel, value) => output.push(`${channel}:${value}`),
			onMemory: (worker, bytes) => memory.push(`${worker}:${bytes}`),
			requestTimeoutMs: 1_000,
			readyTimeoutMs: 1_000
		});

		await expect(session.initialize()).resolves.toMatchObject({
			supportsConfigurationDoneRequest: true,
			supportsReadMemoryRequest: true
		});
		expect(commands).toEqual(['initialize', 'attach', 'setBreakpoints', 'configurationDone']);
		expect(memory).toEqual(['target:256', 'lldb:512']);
		const lldbWorker = workers.find((worker) => worker.kind === 'lldb');
		expect(
			lldbWorker?.requests.find((request) => request.command === 'attach')?.arguments
		).toMatchObject({
			program: '/workspace/program.wasm',
			attachCommands: [
				expect.stringMatching(/^process connect --plugin wasm wasm-messageport:\/\//)
			]
		});
		await expect.poll(() => output.join('')).toContain('stdout:target output\n');
		const targetInit = workers
			.flatMap((worker) => worker.received)
			.find((message) => message.type === 'initialize-target');
		const lldbInit = workers
			.flatMap((worker) => worker.received)
			.find((message) => message.type === 'initialize-lldb');
		expect(targetInit).toMatchObject({
			type: 'initialize-target',
			args: ['first', 'second'],
			env: { MODE: 'debug' },
			cwd: '/workspace',
			workspaceFiles: [
				{
					path: '/workspace/main.cpp',
					content: 'int main() { return 0; }'
				}
			]
		});
		expect(lldbInit).toMatchObject({
			type: 'initialize-lldb',
			sources: [{ path: '/workspace/main.cpp' }]
		});
		expect(session.getResolvedBreakpoints('/workspace/main.cpp')).toEqual([
			{
				verified: false,
				line: 1,
				source: { path: '/workspace/main.cpp' }
			}
		]);
		await lldbWorker?.emitDapEvent({
			seq: 500,
			type: 'event',
			event: 'breakpoint',
			body: {
				reason: 'changed',
				breakpoint: {
					verified: true,
					line: 1,
					source: { path: '/workspace/main.cpp' }
				}
			}
		});
		await expect
			.poll(() => session.getResolvedBreakpoints('/workspace/main.cpp'))
			.toEqual([
				{
					verified: true,
					line: 1,
					source: { path: '/workspace/main.cpp' }
				}
			]);
		const dynamicBreakpoints = await session.setBreakpoints(
			{ path: '/workspace/main.cpp' },
			[7]
		);
		expect(dynamicBreakpoints).toEqual([
			{
				verified: false,
				line: 7,
				source: { path: '/workspace/main.cpp' }
			}
		]);
		dynamicBreakpoints[0]!.verified = true;
		dynamicBreakpoints[0]!.source!.path = '/workspace/caller-mutated.cpp';
		expect(session.getResolvedBreakpoints('/workspace/main.cpp')).toEqual([
			{
				verified: false,
				line: 7,
				source: { path: '/workspace/main.cpp' }
			}
		]);
		const breakpointSnapshot = session.getResolvedBreakpoints('/workspace/main.cpp');
		breakpointSnapshot[0]!.verified = true;
		breakpointSnapshot[0]!.source!.path = '/workspace/snapshot-mutated.cpp';
		expect(session.getResolvedBreakpoints('/workspace/main.cpp')).toEqual([
			{
				verified: false,
				line: 7,
				source: { path: '/workspace/main.cpp' }
			}
		]);
		const disposeMutatingEventListener = session.onEvent((event) => {
			if (event.seq !== 501) return;
			const body = event.body as { breakpoint?: { source?: { path: string } } } | undefined;
			if (body?.breakpoint?.source) {
				body.breakpoint.source.path = '/workspace/listener-mutated.cpp';
			}
			disposeMutatingEventListener();
		});
		await lldbWorker?.emitDapEvent({
			seq: 501,
			type: 'event',
			event: 'breakpoint',
			body: {
				reason: 'changed',
				breakpoint: {
					id: 77,
					verified: true,
					line: 7,
					source: { path: '/workspace/main.cpp' }
				}
			}
		});
		await expect
			.poll(() => session.getResolvedBreakpoints('/workspace/main.cpp'))
			.toEqual([
				{
					id: 77,
					verified: true,
					line: 7,
					source: { path: '/workspace/main.cpp' }
				}
			]);
		await lldbWorker?.emitDapEvent({
			seq: 502,
			type: 'event',
			event: 'breakpoint',
			body: {
				reason: 'changed',
				breakpoint: {
					id: 77,
					verified: true,
					line: 9,
					source: { path: '/workspace/helper.cpp' }
				}
			}
		});
		await expect
			.poll(() => session.getResolvedBreakpoints('/workspace/main.cpp'))
			.toEqual([
				{
					id: 77,
					verified: true,
					line: 9,
					source: { path: '/workspace/helper.cpp' }
				}
			]);
		expect(session.getResolvedBreakpoints('/workspace/helper.cpp')).toEqual([]);
		await session.setBreakpoints({ path: '/workspace/main.cpp' }, [7]);
		const staleEventReceived = new Promise<void>((resolve) => {
			const dispose = session.onEvent((event) => {
				if (event.seq !== 503) return;
				dispose();
				resolve();
			});
		});
		await lldbWorker?.emitDapEvent({
			seq: 503,
			type: 'event',
			event: 'breakpoint',
			body: {
				reason: 'changed',
				breakpoint: {
					id: 77,
					verified: true,
					line: 7,
					source: { path: '/workspace/main.cpp' }
				}
			}
		});
		await staleEventReceived;
		expect(session.getResolvedBreakpoints('/workspace/main.cpp')).toEqual([
			{
				verified: false,
				line: 7,
				source: { path: '/workspace/main.cpp' }
			}
		]);
		const malformedEventReceived = new Promise<void>((resolve) => {
			const dispose = session.onEvent((event) => {
				if (event.seq !== 504) return;
				dispose();
				resolve();
			});
		});
		await lldbWorker?.emitDapEvent({
			seq: 504,
			type: 'event',
			event: 'breakpoint',
			body: {
				reason: 'unexpected',
				breakpoint: {
					verified: true,
					line: 7,
					source: { path: '/workspace/main.cpp' }
				}
			}
		});
		await malformedEventReceived;
		expect(session.getResolvedBreakpoints('/workspace/main.cpp')).toEqual([
			{
				verified: false,
				line: 7,
				source: { path: '/workspace/main.cpp' }
			}
		]);
		const invalidLineRequestCount = lldbWorker!.requests.length;
		const invalidLineResults = await Promise.allSettled(
			[0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY].map((line) =>
				session.setBreakpoints({ path: '/workspace/main.cpp' }, [line])
			)
		);
		expect(invalidLineResults.map((result) => result.status)).toEqual(
			Array.from({ length: invalidLineResults.length }, () => 'rejected')
		);
		for (const result of invalidLineResults) {
			if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(RangeError);
		}
		expect(lldbWorker!.requests).toHaveLength(invalidLineRequestCount);
		const mutableSource = { path: '/workspace/main.cpp' };
		const sourceMutationRequestCount = lldbWorker!.requests.filter(
			(request) => request.command === 'setBreakpoints'
		).length;
		deferredResponses.add('setBreakpoints');
		const sourceMutationUpdate = session.setBreakpoints(mutableSource, [29]);
		mutableSource.path = '/workspace/caller-mutated.cpp';
		await expect
			.poll(
				() =>
					lldbWorker!.requests.filter((request) => request.command === 'setBreakpoints')
						.length
			)
			.toBe(sourceMutationRequestCount + 1);
		await lldbWorker!.respondDapRequest(
			lldbWorker!.requests.filter((request) => request.command === 'setBreakpoints').at(-1)!,
			{
				body: { breakpoints: [{ id: 129, verified: true, line: 29 }] }
			}
		);
		await expect(sourceMutationUpdate).resolves.toEqual([
			{
				id: 129,
				verified: true,
				line: 29,
				source: { path: '/workspace/main.cpp' }
			}
		]);
		const setBreakpointRequestCount = lldbWorker!.requests.filter(
			(request) => request.command === 'setBreakpoints'
		).length;
		const olderBreakpointUpdate = session.setBreakpoints({ path: '/workspace/main.cpp' }, [11]);
		const newerBreakpointUpdate = session.setBreakpoints({ path: '/workspace/main.cpp' }, [13]);
		await expect
			.poll(
				() =>
					lldbWorker!.requests.filter((request) => request.command === 'setBreakpoints')
						.length
			)
			.toBe(setBreakpointRequestCount + 2);
		const successfulRequests = lldbWorker!.requests
			.filter((request) => request.command === 'setBreakpoints')
			.slice(-2);
		const currentBreakpoints = [
			{
				id: 113,
				verified: true,
				line: 13,
				source: { path: '/workspace/main.cpp' }
			}
		];
		await lldbWorker!.respondDapRequest(successfulRequests[1]!, {
			body: { breakpoints: [{ id: 113, verified: true, line: 13 }] }
		});
		await expect(newerBreakpointUpdate).resolves.toEqual(currentBreakpoints);
		await lldbWorker!.respondDapRequest(successfulRequests[0]!, {
			body: { breakpoints: [{ id: 111, verified: true, line: 11 }] }
		});
		await expect(olderBreakpointUpdate).resolves.toEqual(currentBreakpoints);
		expect(session.getResolvedBreakpoints('/workspace/main.cpp')).toEqual(currentBreakpoints);

		const staleFailure = session.setBreakpoints({ path: '/workspace/main.cpp' }, [17]);
		const latestSuccess = session.setBreakpoints({ path: '/workspace/main.cpp' }, [19]);
		await expect
			.poll(
				() =>
					lldbWorker!.requests.filter((request) => request.command === 'setBreakpoints')
						.length
			)
			.toBe(setBreakpointRequestCount + 4);
		const failureRequests = lldbWorker!.requests
			.filter((request) => request.command === 'setBreakpoints')
			.slice(-2);
		const latestBreakpoints = [
			{
				id: 119,
				verified: true,
				line: 19,
				source: { path: '/workspace/main.cpp' }
			}
		];
		await lldbWorker!.respondDapRequest(failureRequests[1]!, {
			body: { breakpoints: [{ id: 119, verified: true, line: 19 }] }
		});
		await expect(latestSuccess).resolves.toEqual(latestBreakpoints);
		await lldbWorker!.respondDapRequest(failureRequests[0]!, {
			success: false,
			message: 'obsolete breakpoint failure'
		});
		await expect(staleFailure).resolves.toEqual(latestBreakpoints);

		const currentFailure = session.setBreakpoints({ path: '/workspace/main.cpp' }, [23]);
		await expect
			.poll(
				() =>
					lldbWorker!.requests.filter((request) => request.command === 'setBreakpoints')
						.length
			)
			.toBe(setBreakpointRequestCount + 5);
		const currentFailureRequest = lldbWorker!.requests
			.filter((request) => request.command === 'setBreakpoints')
			.at(-1)!;
		await lldbWorker!.respondDapRequest(currentFailureRequest, {
			success: false,
			message: 'current breakpoint failure'
		});
		await expect(currentFailure).rejects.toThrow('current breakpoint failure');
		expect(targetInit).toMatchObject({ stdin: { generation: expect.any(Number) } });
		if (!targetInit || targetInit.type !== 'initialize-target' || !targetInit.stdin) {
			throw new Error('target stdin queue was not initialized');
		}
		await session.writeStdin('hello');
		const stdin = new SharedByteQueue(targetInit.stdin);
		const input = new Uint8Array(5);
		expect(stdin.tryRead(input)).toBe(5);
		expect(new TextDecoder().decode(input)).toBe('hello');
		await session.closeStdin();
		expect(stdin.closed).toBe(true);

		await session.disconnect();
		expect(commands).toContain('disconnect');
	});

	it('snapshots mutable initialization inputs before awaiting runtime assets', async () => {
		const commands: string[] = [];
		const workers: FakeWorker[] = [];
		let releaseAssets!: () => void;
		const assetGate = new Promise<void>((resolve) => {
			releaseAssets = resolve;
		});
		let reportAssetFetchStarted!: () => void;
		const assetFetchStarted = new Promise<void>((resolve) => {
			reportAssetFetchStarted = resolve;
		});
		let reportedAssetFetch = false;
		const options: BrowserLldbSessionOptions = {
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: [
				{
					path: '/workspace/main.cpp',
					content: 'int main() { return 0; }',
					contentSha256:
						'80a7161009ffaf868641acac3f5e49bc5f86021ee1d177f3b1cbb47573513649'
				}
			],
			breakpoints: [
				{
					source: { path: '/workspace/main.cpp' },
					lines: [1]
				}
			],
			launch: {
				program: '/workspace/program.wasm',
				args: ['original'],
				env: { MODE: 'original' },
				cwd: '/workspace'
			},
			fetchImpl: async () => {
				if (!reportedAssetFetch) {
					reportedAssetFetch = true;
					reportAssetFetchStarted();
				}
				await assetGate;
				return new Response('debug-asset');
			},
			workerFactory: (kind) => {
				const worker = new FakeWorker(kind, commands);
				workers.push(worker);
				return worker;
			},
			requestTimeoutMs: 1_000,
			readyTimeoutMs: 1_000
		};
		const session = new BrowserLldbSession(options);
		const initialization = session.initialize();
		await assetFetchStarted;

		options.sources[0]!.content = 'int main() { return 1; }';
		options.sources.push({
			path: '/workspace/injected.cpp',
			content: 'int injected;'
		});
		options.breakpoints![0]!.source.path = '/workspace/injected.cpp';
		options.breakpoints![0]!.lines[0] = 9;
		options.launch!.args!.push('mutated');
		options.launch!.env!.MODE = 'mutated';
		releaseAssets();

		try {
			await initialization;
			const targetInit = workers
				.flatMap((worker) => worker.received)
				.find((message) => message.type === 'initialize-target');
			const lldbInit = workers
				.flatMap((worker) => worker.received)
				.find((message) => message.type === 'initialize-lldb');
			expect(targetInit).toMatchObject({
				type: 'initialize-target',
				args: ['original'],
				env: { MODE: 'original' },
				workspaceFiles: [
					{
						path: '/workspace/main.cpp',
						content: 'int main() { return 0; }'
					}
				]
			});
			expect(lldbInit).toMatchObject({
				type: 'initialize-lldb',
				sources: [
					{
						path: '/workspace/main.cpp',
						content: 'int main() { return 0; }'
					}
				]
			});
			const lldbWorker = workers.find((worker) => worker.kind === 'lldb');
			expect(
				lldbWorker?.requests.find((request) => request.command === 'attach')?.arguments
			).toMatchObject({
				args: ['original'],
				env: { MODE: 'original' }
			});
			expect(
				lldbWorker?.requests.find((request) => request.command === 'setBreakpoints')
					?.arguments
			).toMatchObject({
				source: { path: '/workspace/main.cpp' },
				lines: [1]
			});
		} finally {
			releaseAssets();
			await session.dispose();
		}
	});

	it('disposes a running target without waiting for the disconnect response', async () => {
		const commands: string[] = [];
		const workers: FakeWorker[] = [];
		const session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: [],
			fetchImpl: async () => new Response('debug-asset'),
			workerFactory: (kind) => {
				const worker = new FakeWorker(
					kind,
					commands,
					false,
					false,
					new Set(['disconnect'])
				);
				workers.push(worker);
				return worker;
			},
			requestTimeoutMs: 1_000,
			readyTimeoutMs: 1_000
		});
		await session.initialize();

		const disconnect = session.disconnect({ terminateTarget: true });
		try {
			await expect(
				Promise.race([
					disconnect.then(() => 'disconnected' as const),
					new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 100))
				])
			).resolves.toBe('disconnected');
			expect(commands).toContain('disconnect');
			expect(workers.every((worker) => worker.isTerminated)).toBe(true);
		} finally {
			await session.dispose();
			await disconnect;
		}
	});

	it('verifies large debug assets one at a time before creating workers', async () => {
		const workers: FakeWorker[] = [];
		let activeFetches = 0;
		let maximumActiveFetches = 0;
		let fetchCount = 0;
		const session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: [],
			workerFactory: (kind) => {
				const worker = new FakeWorker(kind, []);
				workers.push(worker);
				return worker;
			},
			fetchImpl: async () => {
				activeFetches += 1;
				maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
				await Promise.resolve();
				activeFetches -= 1;
				fetchCount += 1;
				return new Response('debug-asset');
			},
			requestTimeoutMs: 1_000,
			readyTimeoutMs: 1_000
		});

		await session.initialize();

		expect(fetchCount).toBe(6);
		expect(maximumActiveFetches).toBe(1);
		expect(workers).toHaveLength(2);
		await session.dispose();
	});

	it('drains final target output before publishing the target exit', async () => {
		const workers: FakeWorker[] = [];
		const output: string[] = [];
		const lifecycleOutput: string[] = [];
		let session!: BrowserLldbSession;
		session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: [],
			workerFactory: (kind) => {
				const worker = new FakeWorker(kind, []);
				workers.push(worker);
				return worker;
			},
			fetchImpl: async () => new Response('debug-asset'),
			onOutput: (channel, value) => output.push(`${channel}:${value}`),
			onLifecycle: (event) => {
				if (event.type !== 'target-exit') return;
				lifecycleOutput.push(output.join(''));
				void session.dispose();
			},
			requestTimeoutMs: 1_000,
			readyTimeoutMs: 1_000
		});

		await session.initialize();
		const targetWorker = workers.find((worker) => worker.kind === 'target');
		if (!targetWorker) throw new Error('target worker was not created');
		targetWorker.emitFinalOutputAndExit('final output\n');

		await expect
			.poll(() => lifecycleOutput)
			.toEqual([expect.stringContaining('stderr:final output\n')]);
		await session.dispose();
	});

	it('rejects stale module bytes before creating workers', async () => {
		let created = false;
		const session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0),
			moduleSha256: hash,
			sources: [],
			workerFactory: () => {
				created = true;
				return new FakeWorker('lldb', []);
			}
		});
		await expect(session.initialize()).rejects.toThrow(/SHA-256 mismatch/u);
		expect(created).toBe(false);
	});

	it('keeps the module hash expectation fixed while its digest is pending', async () => {
		let created = false;
		const options: BrowserLldbSessionOptions = {
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			moduleSha256: hash,
			sources: [],
			fetchImpl: async () => new Response('debug-asset'),
			workerFactory: (kind) => {
				created = true;
				return new FakeWorker(kind, []);
			},
			requestTimeoutMs: 1_000,
			readyTimeoutMs: 1_000
		};
		const session = new BrowserLldbSession(options);
		const initialization = session.initialize();
		options.moduleSha256 = 'cd5d4935a48c0672cb06407bb443bc0087aff947c6b864bac886982c73b3027f';

		try {
			await expect(initialization).rejects.toThrow(
				`debug module SHA-256 mismatch: expected ${hash}`
			);
			expect(created).toBe(false);
		} finally {
			await session.dispose();
		}
	});

	it('rejects corrupt runtime assets before creating workers', async () => {
		let created = false;
		const session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: [],
			fetchImpl: async () => new Response('corrupt'),
			workerFactory: () => {
				created = true;
				return new FakeWorker('lldb', []);
			}
		});
		await expect(session.initialize()).rejects.toThrow(/SHA-256 mismatch/u);
		expect(created).toBe(false);
	});

	it('rejects non-canonical or stale source content before creating workers', async () => {
		for (const source of [
			{
				path: '/workspace/../workspace/program.wasm' as `/workspace/${string}`,
				content: 'overwrite'
			},
			{
				path: '/workspace/main.cpp' as const,
				content: 'int main() {}',
				contentSha256: hash
			}
		]) {
			let created = false;
			const session = new BrowserLldbSession({
				manifest,
				runtimeBaseUrl: 'https://cdn.example/debug/',
				module: Uint8Array.of(0, 97, 115, 109),
				sources: [source],
				workerFactory: () => {
					created = true;
					return new FakeWorker('lldb', []);
				}
			});
			await expect(session.initialize()).rejects.toThrow(/canonical|SHA-256 mismatch/u);
			expect(created).toBe(false);
		}
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects configured breakpoint line $line before creating workers',
		async (line) => {
			let created = false;
			const session = new BrowserLldbSession({
				manifest,
				runtimeBaseUrl: 'https://cdn.example/debug/',
				module: Uint8Array.of(0, 97, 115, 109),
				sources: [
					{
						path: '/workspace/main.cpp',
						content: 'int main() { return 0; }'
					}
				],
				breakpoints: [
					{
						source: { path: '/workspace/main.cpp' },
						lines: [line]
					}
				],
				fetchImpl: async () => new Response('debug-asset'),
				workerFactory: (kind) => {
					created = true;
					return new FakeWorker(kind, []);
				},
				requestTimeoutMs: 1_000,
				readyTimeoutMs: 1_000
			});

			const result = await session.initialize().then(
				() => undefined,
				(error: unknown) => error
			);
			await session.dispose();
			expect(result).toBeInstanceOf(RangeError);
			expect(created).toBe(false);
		}
	);

	it('shares one initialization flight across concurrent callers', async () => {
		const commands: string[] = [];
		const workers: FakeWorker[] = [];
		const session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: [],
			fetchImpl: async () => new Response('debug-asset'),
			workerFactory: (kind) => {
				const worker = new FakeWorker(kind, commands);
				workers.push(worker);
				return worker;
			},
			requestTimeoutMs: 1_000,
			readyTimeoutMs: 1_000
		});

		const first = session.initialize();
		const second = session.initialize();
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
		expect(workers.map((worker) => worker.kind)).toEqual(['lldb', 'target']);
		await expect(session.initialize()).rejects.toThrow(/already initialized/u);
		await session.dispose();
	});

	it('cancels initialization during asset verification before workers are created', async () => {
		let releaseAssets!: () => void;
		const assetGate = new Promise<void>((resolve) => {
			releaseAssets = resolve;
		});
		let workersCreated = 0;
		const session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: [],
			fetchImpl: async () => {
				await assetGate;
				return new Response('debug-asset');
			},
			workerFactory: () => {
				workersCreated += 1;
				return new FakeWorker('lldb', []);
			}
		});
		const initialization = session.initialize();
		const releaseTimer = setTimeout(releaseAssets, 100);

		try {
			await session.dispose();
			await expect(initialization).rejects.toThrow(/disposed/u);
			expect(workersCreated).toBe(0);
		} finally {
			clearTimeout(releaseTimer);
			releaseAssets();
			await session.dispose();
		}
	});

	it('observes worker failures emitted immediately after ready', async () => {
		const lifecycle: string[] = [];
		const workers: FakeWorker[] = [];
		const session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: [],
			fetchImpl: async () => new Response('debug-asset'),
			workerFactory: (kind) => {
				const worker = new FakeWorker(kind, [], kind === 'target');
				workers.push(worker);
				return worker;
			},
			onLifecycle: (event) => {
				if (event.type === 'worker-error')
					lifecycle.push(`${event.worker}:${event.message}`);
			},
			requestTimeoutMs: 1_000,
			readyTimeoutMs: 1_000
		});

		try {
			await expect(session.initialize()).rejects.toThrow(
				/disposed|target failed after ready/u
			);
			expect(lifecycle).toEqual(['target:target failed after ready']);
		} finally {
			await session.dispose();
		}
		expect(workers.every((worker) => worker.isTerminated)).toBe(true);
	});

	it('closes every transport queue when disposed before workers are ready', async () => {
		const workers: FakeWorker[] = [];
		const session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: [],
			fetchImpl: async () => new Response('debug-asset'),
			workerFactory: (kind) => {
				const worker = new FakeWorker(kind, [], false, kind === 'lldb');
				workers.push(worker);
				return worker;
			},
			requestTimeoutMs: 1_000,
			readyTimeoutMs: 1_000
		});
		const initialization = session.initialize();
		await expect
			.poll(() =>
				workers.some((worker) =>
					worker.received.some((message) => message.type === 'initialize-lldb')
				)
			)
			.toBe(true);
		const targetInit = workers
			.flatMap((worker) => worker.received)
			.find((message) => message.type === 'initialize-target');
		const lldbInit = workers
			.flatMap((worker) => worker.received)
			.find((message) => message.type === 'initialize-lldb');
		if (
			!targetInit ||
			targetInit.type !== 'initialize-target' ||
			!targetInit.stdin ||
			!lldbInit ||
			lldbInit.type !== 'initialize-lldb'
		) {
			throw new Error('debug workers were not initialized');
		}
		const queues = [
			lldbInit.dapInput,
			lldbInit.dapOutput,
			lldbInit.rspInput,
			lldbInit.rspOutput,
			targetInit.stdin
		].map((descriptor) => new SharedByteQueue(descriptor));
		const rejected = expect(initialization).rejects.toThrow(/disposed/u);

		const disposal = session.dispose();
		expect(queues.every((queue) => queue.closed)).toBe(true);
		await rejected;
		await disposal;
		expect(workers.every((worker) => worker.isTerminated)).toBe(true);
	});

	it('closes session-owned RSP queues before gracefully terminating workers', async () => {
		const commands: string[] = [];
		const workers: FakeWorker[] = [];
		const session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: [],
			fetchImpl: async () => new Response('debug-asset'),
			workerFactory: (kind) => {
				const worker = new FakeWorker(kind, commands);
				workers.push(worker);
				return worker;
			},
			requestTimeoutMs: 1_000,
			readyTimeoutMs: 1_000
		});
		await session.initialize();
		const targetInit = workers
			.flatMap((worker) => worker.received)
			.find((message) => message.type === 'initialize-target');
		if (!targetInit || targetInit.type !== 'initialize-target') {
			throw new Error('target worker was not initialized');
		}
		const rspQueues = [
			new SharedByteQueue(targetInit.rspInput),
			new SharedByteQueue(targetInit.rspOutput)
		];

		const disposal = session.dispose();
		expect(rspQueues.every((queue) => queue.closed)).toBe(true);
		expect(workers.every((worker) => !worker.isTerminated)).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(
			workers.every((worker) => worker.received.some((message) => message.type === 'dispose'))
		).toBe(true);
		expect(workers.every((worker) => !worker.isTerminated)).toBe(true);

		await disposal;
		expect(workers.every((worker) => worker.isTerminated)).toBe(true);
	});

	it('shares one in-flight disposal across concurrent callers', async () => {
		const session = new BrowserLldbSession({
			manifest,
			runtimeBaseUrl: 'https://cdn.example/debug/',
			module: Uint8Array.of(0, 97, 115, 109),
			sources: []
		});

		const first = session.dispose();
		const second = session.dispose();

		expect(second).toBe(first);
		await expect(first).resolves.toBeUndefined();
	});
});
