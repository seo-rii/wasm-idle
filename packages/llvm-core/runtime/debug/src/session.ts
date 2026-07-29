import { DapClient } from './dap-client.js';
import { preflightDebugRuntimeAssets, sha256Hex } from './manifest.js';
import { createSharedByteQueue, SharedByteQueue } from './shared-byte-queue.js';
import { validateDebugSourcePath } from './worker/module-loader.js';
import type {
	BrowserLldbSessionOptions,
	DapEvent,
	DapRequestOptions,
	DebugCapabilities,
	DebugSessionGeneration,
	DebugWorkerKind,
	DebugWorkerOutboundMessage,
	ResolvedBreakpoint,
	WorkerLike
} from './types.js';

const DEFAULT_QUEUE_CAPACITY = 256 * 1024;
const WORKER_SHUTDOWN_GRACE_MS = 25;
let nextGeneration = 1;

function createGeneration(): DebugSessionGeneration {
	const generation = nextGeneration;
	nextGeneration += 1;
	return `wasm-debug-${Date.now().toString(36)}-${generation.toString(36)}`;
}

function defaultWorkerFactory(kind: DebugWorkerKind): WorkerLike {
	if (kind === 'lldb') {
		return new Worker(new URL('./worker/lldb-worker.js', import.meta.url), {
			type: 'module',
			name: 'wasm-lldb-debugger'
		}) as unknown as WorkerLike;
	}
	return new Worker(new URL('./worker/target-worker.js', import.meta.url), {
		type: 'module',
		name: 'wasm-target-debugger'
	}) as unknown as WorkerLike;
}

export class BrowserLldbSession {
	readonly generation = createGeneration();
	private readonly eventListeners = new Set<(event: DapEvent) => void>();
	private readonly options: BrowserLldbSessionOptions;
	private lldbWorker?: WorkerLike;
	private targetWorker?: WorkerLike;
	private dap?: DapClient;
	private disposeDapEvents?: () => void;
	private stdin?: SharedByteQueue;
	private stdinWrites: Promise<void> = Promise.resolve();
	private readonly outputAbortController = new AbortController();
	private readonly outputQueues: SharedByteQueue[] = [];
	private readonly outputReaders: Promise<void>[] = [];
	private readonly dapQueues: SharedByteQueue[] = [];
	private readonly rspQueues: SharedByteQueue[] = [];
	private readonly workerEventDisposers: Array<() => void> = [];
	private readonly resolvedBreakpoints = new Map<string, ResolvedBreakpoint[]>();
	private readonly lifecycleAbortController = new AbortController();
	private initializePromise?: Promise<DebugCapabilities>;
	private disposePromise?: Promise<void>;
	private targetExitPending = false;
	private initialized = false;
	private disposed = false;

	constructor(options: BrowserLldbSessionOptions) {
		this.options = options;
	}

	initialize(): Promise<DebugCapabilities> {
		if (this.initialized) {
			return Promise.reject(new Error('LLDB debug session is already initialized'));
		}
		if (this.disposed) return Promise.reject(this.disposedError());
		if (!this.initializePromise) {
			const initialization = this.initializeOnce();
			this.initializePromise = initialization;
			void initialization.catch(() => {
				if (this.initializePromise === initialization && !this.disposed) {
					this.initializePromise = undefined;
				}
			});
		}
		return this.initializePromise;
	}

	private async initializeOnce(): Promise<DebugCapabilities> {
		if (typeof SharedArrayBuffer === 'undefined') {
			throw new Error(
				'LLDB debugging requires SharedArrayBuffer and a cross-origin-isolated browser context'
			);
		}
		if (
			typeof crossOriginIsolated === 'boolean' &&
			!crossOriginIsolated &&
			typeof window !== 'undefined'
		) {
			throw new Error(
				'LLDB debugging requires cross-origin isolation (COOP and COEP response headers)'
			);
		}

		const module = new Uint8Array(
			this.options.module instanceof Uint8Array
				? this.options.module
				: this.options.module.slice(0)
		);
		if (this.options.moduleSha256) {
			const actualSha256 = await this.awaitWhileActive(sha256Hex(module));
			if (actualSha256 !== this.options.moduleSha256) {
				throw new Error(
					`debug module SHA-256 mismatch: expected ${this.options.moduleSha256}, received ${actualSha256}`
				);
			}
		}
		const sourcePaths = new Set<string>();
		for (const source of this.options.sources) {
			validateDebugSourcePath(source.path);
			if (sourcePaths.has(source.path)) {
				throw new Error(`duplicate debug source path: ${source.path}`);
			}
			sourcePaths.add(source.path);
			if (source.contentSha256) {
				const actualSha256 = await this.awaitWhileActive(
					sha256Hex(new TextEncoder().encode(source.content))
				);
				if (actualSha256 !== source.contentSha256) {
					throw new Error(
						`debug source SHA-256 mismatch for ${source.path}: expected ${source.contentSha256}, received ${actualSha256}`
					);
				}
			}
		}

		const queueCapacity = this.options.queueCapacity ?? DEFAULT_QUEUE_CAPACITY;
		const queueGeneration = nextGeneration;
		const dapInput = createSharedByteQueue(queueCapacity, queueGeneration);
		const dapOutput = createSharedByteQueue(queueCapacity, queueGeneration);
		const lldbToTarget = createSharedByteQueue(queueCapacity, queueGeneration);
		const targetToLldb = createSharedByteQueue(queueCapacity, queueGeneration);
		const stdin = createSharedByteQueue(queueCapacity, queueGeneration);
		const stdout = createSharedByteQueue(queueCapacity, queueGeneration);
		const stderr = createSharedByteQueue(queueCapacity, queueGeneration);
		const assets = await this.awaitWhileActive(
			preflightDebugRuntimeAssets(
				this.options.manifest,
				this.options.runtimeBaseUrl,
				this.options.fetchImpl ?? fetch,
				this.lifecycleAbortController.signal
			)
		);
		this.assertActive();
		const workerFactory = this.options.workerFactory ?? defaultWorkerFactory;
		try {
			this.dapQueues.push(new SharedByteQueue(dapInput), new SharedByteQueue(dapOutput));
			this.rspQueues.push(
				new SharedByteQueue(lldbToTarget),
				new SharedByteQueue(targetToLldb)
			);
			this.stdin = new SharedByteQueue(stdin);
			const lldbWorker = workerFactory('lldb');
			if (this.disposed) {
				lldbWorker.terminate();
				throw this.disposedError();
			}
			this.lldbWorker = lldbWorker;
			const targetWorker = workerFactory('target');
			if (this.disposed) {
				targetWorker.terminate();
				throw this.disposedError();
			}
			this.targetWorker = targetWorker;

			this.attachWorkerEvents(lldbWorker, 'lldb');
			this.attachWorkerEvents(targetWorker, 'target');
			const lldbReady = this.waitForReady(lldbWorker, 'lldb');
			const targetReady = this.waitForReady(targetWorker, 'target');
			const workersReady = Promise.all([lldbReady, targetReady]);
			void workersReady.catch(() => undefined);
			for (const [descriptor, channel] of [
				[stdout, 'stdout'],
				[stderr, 'stderr']
			] as const) {
				const queue = new SharedByteQueue(descriptor);
				const decoder = new TextDecoder();
				this.outputQueues.push(queue);
				this.outputReaders.push(
					(async () => {
						const buffer = new Uint8Array(16 * 1024);
						try {
							while (!this.outputAbortController.signal.aborted) {
								const length = await queue.read(
									buffer,
									this.outputAbortController.signal
								);
								if (length === 0) break;
								const output = decoder.decode(buffer.subarray(0, length), {
									stream: true
								});
								if (output) this.options.onOutput?.(channel, output);
							}
							const output = decoder.decode();
							if (output) this.options.onOutput?.(channel, output);
						} catch (error) {
							if (!this.outputAbortController.signal.aborted) {
								this.options.onLifecycle?.({
									type: 'worker-error',
									worker: 'target',
									message:
										error instanceof Error
											? error.message
											: 'failed to read target output'
								});
								void this.dispose();
							}
						}
					})()
				);
			}

			targetWorker.postMessage({
				type: 'initialize-target',
				generation: this.generation,
				module,
				args: this.options.launch?.args ?? [],
				env: this.options.launch?.env ?? {},
				cwd: this.options.launch?.cwd ?? '/workspace',
				workspaceFiles: this.options.sources,
				rspInput: lldbToTarget,
				rspOutput: targetToLldb,
				stdout,
				stderr,
				stdin,
				assets: {
					js: assets.targetRuntime.js.toString(),
					wasm: assets.targetRuntime.wasm.toString(),
					worker: assets.targetRuntime.worker.toString()
				}
			});
			this.assertActive();
			lldbWorker.postMessage({
				type: 'initialize-lldb',
				generation: this.generation,
				module,
				sources: this.options.sources,
				dapInput,
				dapOutput,
				rspInput: targetToLldb,
				rspOutput: lldbToTarget,
				assets: {
					js: assets.lldb.js.toString(),
					wasm: assets.lldb.wasm.toString(),
					worker: assets.lldb.worker.toString()
				}
			});
			this.assertActive();

			await this.awaitWhileActive(workersReady);
			this.assertActive();
			this.dap = new DapClient({
				input: dapInput,
				output: dapOutput,
				requestTimeoutMs: this.options.requestTimeoutMs,
				transportWriteTimeoutMs: this.options.transportWriteTimeoutMs
			}).start();
			let resolveInitialized!: () => void;
			const adapterInitialized = new Promise<void>((resolve) => {
				resolveInitialized = resolve;
			});
			this.disposeDapEvents = this.dap.onEvent((event) => {
				if (event.event === 'initialized') resolveInitialized();
				this.applyBreakpointEvent(event);
				for (const listener of this.eventListeners) listener(event);
			});

			const capabilities = await this.awaitWhileActive(
				this.dap.request<DebugCapabilities>('initialize', {
					clientID: 'wasm-idle',
					clientName: 'wasm-idle',
					adapterID: 'lldb',
					pathFormat: 'path',
					linesStartAt1: true,
					columnsStartAt1: true,
					supportsVariableType: true,
					supportsVariablePaging: true,
					supportsMemoryReferences: true,
					locale: 'en-US'
				})
			);
			const attachResponse = this.dap.request('attach', {
				program: this.options.launch?.program ?? '/workspace/program.wasm',
				stopOnEntry: this.options.launch?.stopOnEntry ?? false,
				args: this.options.launch?.args ?? [],
				env: this.options.launch?.env ?? {},
				cwd: this.options.launch?.cwd ?? '/workspace',
				attachCommands: [
					`process connect --plugin wasm wasm-messageport://${this.generation}`
				]
			});
			const attachFailure = attachResponse.then<never>(
				() => new Promise<never>(() => undefined),
				(error: unknown) => Promise.reject(error)
			);
			const initializedTimeoutMs = this.options.requestTimeoutMs ?? 15_000;
			let initializedTimeout: ReturnType<typeof setTimeout> | undefined;
			await this.awaitWhileActive(
				Promise.race([
					adapterInitialized,
					attachFailure,
					new Promise<never>((_, reject) => {
						initializedTimeout = setTimeout(
							() =>
								reject(new Error('DAP adapter did not send the initialized event')),
							initializedTimeoutMs
						);
					})
				]).finally(() => {
					if (initializedTimeout !== undefined) clearTimeout(initializedTimeout);
				})
			);
			for (const breakpoint of this.options.breakpoints ?? []) {
				const response = await this.awaitWhileActive(
					this.dap.request<{
						breakpoints?: ResolvedBreakpoint[];
					}>('setBreakpoints', {
						source: breakpoint.source,
						breakpoints: breakpoint.lines.map((line) => ({ line })),
						sourceModified: false
					})
				);
				this.resolvedBreakpoints.set(
					breakpoint.source.path,
					breakpoint.lines.map((requestedLine, index) => {
						const resolved = response.breakpoints?.[index];
						return {
							...resolved,
							verified: resolved?.verified === true,
							line: resolved?.line ?? requestedLine,
							source: resolved?.source ?? breakpoint.source
						};
					})
				);
			}
			await this.awaitWhileActive(this.dap.request('configurationDone'));
			await this.awaitWhileActive(attachResponse);
			this.assertActive();
			this.initialized = true;
			return capabilities;
		} catch (error) {
			const failure = this.disposed ? this.disposedError() : error;
			await this.dispose();
			throw failure;
		}
	}

	request<TBody = unknown>(
		command: string,
		args?: unknown,
		options?: DapRequestOptions
	): Promise<TBody> {
		if (!this.dap) throw new Error('LLDB debug session is not initialized');
		return this.dap.request<TBody>(command, args, options);
	}

	onEvent(listener: (event: DapEvent) => void) {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	getResolvedBreakpoints(sourcePath: string) {
		return [...(this.resolvedBreakpoints.get(sourcePath) ?? [])];
	}

	private applyBreakpointEvent(event: DapEvent) {
		if (event.event !== 'breakpoint') return;
		const body = event.body as
			| {
					reason?: 'new' | 'changed' | 'removed';
					breakpoint?: ResolvedBreakpoint;
			  }
			| undefined;
		const breakpoint = body?.breakpoint;
		if (!breakpoint) return;
		const sourcePath = breakpoint.source?.path;
		for (const [path, current] of this.resolvedBreakpoints) {
			if (sourcePath && sourcePath !== path) continue;
			const index =
				breakpoint.id === undefined
					? current.findIndex(
							(candidate) =>
								sourcePath === path &&
								candidate.line !== undefined &&
								candidate.line === breakpoint.line
						)
					: current.findIndex((candidate) => candidate.id === breakpoint.id);
			if (index < 0) continue;
			const next = [...current];
			if (body?.reason === 'removed') {
				next.splice(index, 1);
			} else {
				next[index] = {
					...next[index],
					...breakpoint,
					verified: breakpoint.verified === true,
					source: breakpoint.source ?? next[index].source
				};
			}
			this.resolvedBreakpoints.set(path, next);
			return;
		}
	}

	writeStdin(value: string) {
		if (!this.stdin || !this.initialized) {
			throw new Error('LLDB debug session is not initialized');
		}
		const bytes = new TextEncoder().encode(value);
		this.stdinWrites = this.stdinWrites.then(() => this.stdin?.write(bytes));
		return this.stdinWrites;
	}

	closeStdin() {
		if (!this.stdin || !this.initialized) {
			throw new Error('LLDB debug session is not initialized');
		}
		this.stdinWrites = this.stdinWrites.then(() => {
			this.stdin?.close();
		});
		return this.stdinWrites;
	}

	async disconnect(options: { terminateTarget?: boolean } = {}) {
		if (this.disposePromise) return this.disposePromise;
		if (this.dap) {
			const disconnectRequest = this.dap
				.request('disconnect', {
					restart: false,
					terminateDebuggee: options.terminateTarget ?? true
				})
				.catch(() => undefined);
			let disconnectGrace: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				disconnectRequest,
				new Promise<void>((resolve) => {
					disconnectGrace = setTimeout(resolve, WORKER_SHUTDOWN_GRACE_MS);
				})
			]).finally(() => {
				if (disconnectGrace !== undefined) clearTimeout(disconnectGrace);
			});
		}
		await this.dispose();
	}

	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		const disposeError = this.disposedError();
		this.lifecycleAbortController.abort(disposeError);
		this.disposePromise = (async () => {
			this.disposeDapEvents?.();
			if (this.stdin && !this.stdin.closed) this.stdin.close();
			for (const queue of this.dapQueues) {
				if (!queue.closed) queue.close();
			}
			for (const queue of this.rspQueues) {
				if (!queue.closed) queue.close();
			}
			this.outputAbortController.abort(disposeError);
			for (const output of this.outputQueues) {
				if (!output.closed) output.close();
			}
			const workers = [this.lldbWorker, this.targetWorker].filter(
				(worker): worker is WorkerLike => worker !== undefined
			);
			for (const worker of workers) {
				try {
					worker.postMessage({ type: 'dispose', generation: this.generation });
				} catch {
					// A worker that already exited will be terminated below.
				}
			}
			const gracefulShutdown =
				workers.length === 0
					? Promise.resolve()
					: new Promise<void>((resolve) => {
							setTimeout(resolve, WORKER_SHUTDOWN_GRACE_MS);
						});
			await Promise.all([
				this.dap?.close() ?? Promise.resolve(),
				Promise.allSettled(this.outputReaders),
				gracefulShutdown
			]);
			for (const worker of workers) worker.terminate();
			for (const removeListeners of this.workerEventDisposers.splice(0)) removeListeners();
			this.lldbWorker = undefined;
			this.targetWorker = undefined;
			this.dap = undefined;
			this.stdin = undefined;
			this.initialized = false;
			this.outputQueues.length = 0;
			this.outputReaders.length = 0;
			this.dapQueues.length = 0;
			this.rspQueues.length = 0;
			this.resolvedBreakpoints.clear();
			this.eventListeners.clear();
		})();
		return this.disposePromise;
	}

	private attachWorkerEvents(worker: WorkerLike, kind: DebugWorkerKind) {
		const messageListener = (event: MessageEvent<DebugWorkerOutboundMessage>) => {
			const message = event.data;
			if (message.generation !== this.generation) return;
			if (this.disposed) return;
			if (message.type === 'output') {
				this.options.onOutput?.(message.channel, message.data);
			}
			if (message.type === 'memory') {
				this.options.onMemory?.(message.worker, message.bytes);
			}
			if (message.type === 'error') {
				const reportError = () => {
					this.options.onLifecycle?.({
						type: 'worker-error',
						worker: message.worker,
						message: message.message
					});
					void this.dispose();
				};
				if (worker === this.targetWorker) {
					this.afterTargetOutputDrained(reportError);
				} else {
					reportError();
				}
			}
			if (message.type === 'exit' && worker === this.targetWorker) {
				this.afterTargetOutputDrained(() => {
					this.options.onLifecycle?.({
						type: 'target-exit',
						exitCode: message.exitCode
					});
				});
			}
		};
		const fail = (error: Error) => {
			if (this.disposed) return;
			const reportError = () => {
				this.options.onLifecycle?.({
					type: 'worker-error',
					worker: kind,
					message: error.message
				});
				void this.dispose();
			};
			if (worker === this.targetWorker) {
				this.afterTargetOutputDrained(reportError);
			} else {
				reportError();
			}
		};
		const errorListener = (event: ErrorEvent) => fail(this.workerEventError(kind, event));
		const messageErrorListener = (event: MessageEvent<unknown>) =>
			fail(this.workerEventError(kind, event));
		worker.addEventListener('message', messageListener);
		worker.addEventListener('error', errorListener);
		worker.addEventListener('messageerror', messageErrorListener);
		this.workerEventDisposers.push(() => {
			worker.removeEventListener('message', messageListener);
			worker.removeEventListener('error', errorListener);
			worker.removeEventListener('messageerror', messageErrorListener);
		});
	}

	private afterTargetOutputDrained(callback: () => void) {
		if (this.targetExitPending) return;
		this.targetExitPending = true;
		for (const output of this.outputQueues) {
			if (!output.closed) output.close();
		}
		void Promise.allSettled(this.outputReaders).then(() => {
			if (!this.disposed) callback();
		});
	}

	private waitForReady(worker: WorkerLike, expectedKind: DebugWorkerKind) {
		const timeoutMs = this.options.readyTimeoutMs ?? 30_000;
		const signal = this.lifecycleAbortController.signal;
		return new Promise<void>((resolve, reject) => {
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const cleanup = () => {
				if (timeout !== undefined) clearTimeout(timeout);
				worker.removeEventListener('message', listener);
				worker.removeEventListener('error', errorListener);
				worker.removeEventListener('messageerror', messageErrorListener);
				signal.removeEventListener('abort', abortListener);
			};
			const abortListener = () => {
				cleanup();
				reject(this.disposedError());
			};
			const errorListener = (event: ErrorEvent) => {
				cleanup();
				reject(this.workerEventError(expectedKind, event));
			};
			const messageErrorListener = (event: MessageEvent<unknown>) => {
				cleanup();
				reject(this.workerEventError(expectedKind, event));
			};
			const listener = (event: MessageEvent<DebugWorkerOutboundMessage>) => {
				const message = event.data;
				if (message.generation !== this.generation) return;
				if (message.type === 'error' && message.worker === expectedKind) {
					cleanup();
					reject(new Error(message.message));
					return;
				}
				if (message.type !== 'ready' || message.worker !== expectedKind) return;
				cleanup();
				resolve();
			};
			timeout = setTimeout(() => {
				cleanup();
				reject(new Error(`${expectedKind} debug worker did not become ready`));
			}, timeoutMs);
			worker.addEventListener('message', listener);
			worker.addEventListener('error', errorListener);
			worker.addEventListener('messageerror', messageErrorListener);
			if (signal.aborted) {
				abortListener();
			} else {
				signal.addEventListener('abort', abortListener, { once: true });
			}
		});
	}

	private assertActive() {
		if (this.disposed) throw this.disposedError();
	}

	private async awaitWhileActive<T>(operation: Promise<T>): Promise<T> {
		if (this.disposed) {
			void operation.catch(() => undefined);
			throw this.disposedError();
		}
		const signal = this.lifecycleAbortController.signal;
		let abortListener!: () => void;
		const aborted = new Promise<never>((_, reject) => {
			abortListener = () => reject(this.disposedError());
			signal.addEventListener('abort', abortListener, { once: true });
		});
		try {
			return await Promise.race([operation, aborted]);
		} finally {
			signal.removeEventListener('abort', abortListener);
		}
	}

	private disposedError() {
		return new Error('LLDB debug session is disposed');
	}

	private workerEventError(kind: DebugWorkerKind, event: ErrorEvent | MessageEvent<unknown>) {
		if ('message' in event && typeof event.message === 'string' && event.message) {
			return new Error(`${kind} debug worker failed: ${event.message}`);
		}
		return new Error(`${kind} debug worker could not deserialize a message`);
	}
}

export function createBrowserLldbSession(options: BrowserLldbSessionOptions) {
	return new BrowserLldbSession(options);
}
