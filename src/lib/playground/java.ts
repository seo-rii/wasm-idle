import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import {
	resolveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets,
	type RuntimeAssetConfig,
	type RuntimeAssetIntegrityMap
} from '$lib/playground/assets';
import {
	AssetTooLargeError,
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
	DiagnosticLimitError,
	OutputLimitError,
	TEAVM_RUNTIME_ASSET_NAMES,
	TimeoutError,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
import { resolveJavaSourceIdentity } from '$lib/playground/javaSource';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';

type JavaOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
	explicitStdin: boolean;
};

const OUTPUT_ENCODER = new TextEncoder();

const abortReason = (signal: AbortSignal, phase: JavaOperation['phase']) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup' ? 'Java runtime startup aborted' : 'Java execution aborted',
				'AbortError'
			);

class Java implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	baseUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	assetBridge: WorkerAssetBridge | null = null;
	private activeOperation: JavaOperation | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'Java',
		onDispose: (worker) => {
			if (this.worker === worker) {
				const assetBridge = this.assetBridge;
				delete this.worker;
				this.assetBridge = null;
				try {
					assetBridge?.dispose();
				} catch {
					// Asset cleanup must not replace the worker operation result.
				}
			}
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	private requireOperationIdle() {
		if (!this.activeOperation) return;
		throw new BusyError('Java runtime already has an active operation', {
			runtimeId: 'JAVA',
			phase: this.activeOperation.phase
		});
	}

	private beginOperation(phase: JavaOperation['phase']) {
		this.requireOperationIdle();
		const operation: JavaOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			cleanedUp: false,
			cleanups: [],
			explicitStdin: false
		};
		this.activeOperation = operation;
		return operation;
	}

	private isOperationActive(operation: JavaOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: JavaOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: JavaOperation) {
		if (operation.cleanedUp) return;
		operation.cleanedUp = true;
		const cleanups = operation.cleanups.splice(0);
		for (const cleanup of cleanups) {
			try {
				cleanup();
			} catch {
				// Caller-owned lifecycle cleanup must not replace the operation result.
			}
		}
	}

	private releaseBeforeSession(operation: JavaOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private bindPreSessionAbort(operation: JavaOperation, signal: AbortSignal | undefined) {
		if (!signal || !this.isOperationActive(operation)) return () => undefined;
		let registered = false;
		let unbound = false;
		const unbind = () => {
			if (unbound) return;
			unbound = true;
			if (registered) signal.removeEventListener('abort', onAbort);
		};
		const onAbort = () => {
			if (!this.isOperationActive(operation)) return;
			let reason: unknown;
			try {
				reason = abortReason(signal, operation.phase);
			} catch (error) {
				reason = error;
			}
			operation.cancelled = true;
			operation.cancellationReason = reason;
			this.releaseOperation(operation);
			this.cleanupOperation(operation);
		};
		operation.cleanups.push(unbind);
		try {
			registered = true;
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		} catch (error) {
			if (this.isOperationActive(operation)) {
				operation.cancelled = true;
				operation.cancellationReason = error;
				this.releaseOperation(operation);
				this.cleanupOperation(operation);
			}
		}
		return unbind;
	}

	private bindAbortSignal(operation: JavaOperation, signal: AbortSignal | undefined) {
		if (!signal || !this.isOperationActive(operation)) return;
		let registered = false;
		const onAbort = () => {
			if (!this.isOperationActive(operation)) return;
			let reason: unknown;
			try {
				reason = abortReason(signal, operation.phase);
			} catch (error) {
				reason = error;
			}
			this.cancelOperation(operation, reason);
		};
		operation.cleanups.push(() => {
			if (!registered) return;
			try {
				signal.removeEventListener('abort', onAbort);
			} catch {
				// Listener cleanup must not replace the operation result.
			}
		});
		try {
			registered = true;
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private bindOperationTimeout(operation: JavaOperation, timeoutMs: number) {
		if (!this.isOperationActive(operation)) return;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		operation.cleanups.push(() => {
			if (timeout !== undefined) clearTimeout(timeout);
		});
		try {
			timeout = setTimeout(() => {
				if (!this.isOperationActive(operation)) return;
				const label = operation.phase === 'startup' ? 'startup' : 'execution';
				this.cancelOperation(
					operation,
					new TimeoutError(`Java ${label} timed out after ${timeoutMs} ms`, {
						phase: operation.phase,
						runtimeId: 'JAVA',
						timeoutMs
					})
				);
			}, timeoutMs);
			if (operation.cleanedUp) clearTimeout(timeout);
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private resetExplicitStdinState() {
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
		try {
			resetBufferedStdin(this.buffer);
		} catch {
			// Explicit stdin never consumes the shared terminal buffer.
		}
	}

	private finishExplicitStdin(operation: JavaOperation) {
		if (!operation.explicitStdin) return;
		operation.explicitStdin = false;
		this.resetExplicitStdinState();
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let activeOperation: JavaOperation;
		try {
			activeOperation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let signal: AbortSignal | undefined;
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let unbindPreSessionAbort: () => void = () => undefined;
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Java runtime startup cancelled')
				);
			}
			limits = resolveExecutionLimits(options.limits);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Java runtime startup cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'Java runtime startup cancelled')
			);
		}
		const loadPromise = this.workerSession.load(async (resolve, reject) => {
			const resolveLoad = () => {
				if (!this.releaseOperation(activeOperation)) return;
				resolve();
				this.cleanupOperation(activeOperation);
			};
			const rejectLoad = (reason?: unknown) => {
				if (!this.releaseOperation(activeOperation)) return;
				reject(reason);
				this.cleanupOperation(activeOperation);
			};
			try {
				if (!this.isOperationActive(activeOperation)) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				let resolverAssets: string | PlaygroundRuntimeAssets = runtimeAssets;
				if (runtimeAssets && typeof runtimeAssets === 'object') {
					const runtimeConfig = runtimeAssets.java;
					if (!this.isOperationActive(activeOperation)) return;
					let java: RuntimeAssetConfig | undefined;
					if (runtimeConfig) {
						const baseUrl = runtimeConfig.baseUrl;
						if (!this.isOperationActive(activeOperation)) return;
						const loader = runtimeConfig.loader;
						if (!this.isOperationActive(activeOperation)) return;
						const integritySource = runtimeConfig.integrity;
						if (!this.isOperationActive(activeOperation)) return;
						let integrity: RuntimeAssetIntegrityMap | undefined;
						if (integritySource) {
							integrity = Object.create(null) as RuntimeAssetIntegrityMap;
							const assets = Object.keys(integritySource);
							if (!this.isOperationActive(activeOperation)) return;
							for (const asset of assets) {
								const entry = integritySource[asset];
								if (!this.isOperationActive(activeOperation)) return;
								let snapshot: RuntimeAssetIntegrityMap[string];
								if (typeof entry === 'string') {
									snapshot = entry;
								} else {
									const sha256 = entry.sha256;
									if (!this.isOperationActive(activeOperation)) return;
									const bytes = entry.bytes;
									if (!this.isOperationActive(activeOperation)) return;
									const mediaType = entry.mediaType;
									if (!this.isOperationActive(activeOperation)) return;
									const uncompressedSha256 = entry.uncompressedSha256;
									if (!this.isOperationActive(activeOperation)) return;
									const uncompressedBytes = entry.uncompressedBytes;
									if (!this.isOperationActive(activeOperation)) return;
									snapshot = {
										sha256,
										bytes,
										mediaType,
										uncompressedSha256,
										uncompressedBytes
									};
								}
								Object.defineProperty(integrity, asset, {
									value: snapshot,
									enumerable: true,
									configurable: true,
									writable: true
								});
							}
						}
						const allowedBaseUrlsSource = runtimeConfig.allowedBaseUrls;
						if (!this.isOperationActive(activeOperation)) return;
						const allowedBaseUrls = allowedBaseUrlsSource
							? [...allowedBaseUrlsSource]
							: undefined;
						if (!this.isOperationActive(activeOperation)) return;
						java = { baseUrl, loader, integrity, allowedBaseUrls };
					}
					let rootUrl: string | undefined;
					let rootUrlRead = false;
					const operationIsActive = () => this.isOperationActive(activeOperation);
					resolverAssets = {
						get rootUrl() {
							if (!rootUrlRead) {
								rootUrlRead = true;
								rootUrl = runtimeAssets.rootUrl;
								if (!operationIsActive()) return undefined;
							}
							return rootUrl;
						},
						java
					};
				}
				const assetConfig = resolveRuntimeAssetConfig('java', resolverAssets, currentUrl);
				if (!this.isOperationActive(activeOperation)) return;
				for (const asset of TEAVM_RUNTIME_ASSET_NAMES) {
					const receipt = assetConfig.integrity?.[asset];
					const bytes = typeof receipt === 'object' ? receipt.bytes : undefined;
					if (bytes !== undefined && bytes > limits.maxAssetBytes) {
						throw new AssetTooLargeError(
							`TeaVM runtime receipt exceeds the ${limits.maxAssetBytes} byte limit for ${asset}`,
							{
								actual: bytes,
								limit: limits.maxAssetBytes,
								runtimeId: 'JAVA'
							}
						);
					}
				}
				this.baseUrl = assetConfig.baseUrl;
				const needsWorkerReset =
					!this.worker ||
					!this.assetBridge ||
					!this.assetBridge.matches(assetConfig, limits.maxAssetBytes);
				if (!this.isOperationActive(activeOperation)) return;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
				}
				if (!this.isOperationActive(activeOperation)) return;
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/java?worker'))
						.default;
					if (!this.isOperationActive(activeOperation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(activeOperation)) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					const assetBridge = new WorkerAssetBridge(
						worker,
						'java',
						assetConfig,
						progress,
						limits.maxAssetBytes
					);
					if (!this.isOperationActive(activeOperation) || this.worker !== worker) {
						assetBridge.dispose();
						return;
					}
					this.assetBridge = assetBridge;
					let handler: (event: MessageEvent<any>) => void;
					const ownsWorker = () =>
						this.worker === worker &&
						worker.onmessage === handler &&
						this.assetBridge === assetBridge;
					const ownsLoad = () => ownsWorker() && this.isOperationActive(activeOperation);
					const failLoad = (error: unknown) => {
						if (!ownsLoad()) return;
						rejectLoad(error);
					};
					handler = (event: MessageEvent<any>) => {
						if (!ownsWorker()) return;
						try {
							if (assetBridge.handleMessage(event)) return;
							if (!ownsLoad()) return;
							if (event.data?.load) {
								resolveLoad();
								return;
							}
							if (event.data?.error) rejectLoad(event.data.error);
						} catch (error) {
							failLoad(error);
						}
					};
					worker.onmessage = handler;
					worker.postMessage({
						load: true,
						assets: {
							baseUrl: assetConfig.baseUrl,
							useAssetBridge: assetConfig.useAssetBridge
						}
					});
				} else {
					const worker = this.worker;
					const assetBridge = this.assetBridge;
					if (!assetBridge) return rejectLoad('Worker asset bridge unavailable');
					assetBridge.rebind(worker, assetConfig, progress, limits.maxAssetBytes);
					if (
						!this.isOperationActive(activeOperation) ||
						this.worker !== worker ||
						this.assetBridge !== assetBridge
					) {
						return;
					}
					resolveLoad();
				}
			} catch (error) {
				rejectLoad(error);
			}
		});
		const timeoutMs = Math.min(2_147_483_647, limits.assetTimeoutMs + limits.startupTimeoutMs);
		this.bindOperationTimeout(activeOperation, timeoutMs);
		this.bindAbortSignal(activeOperation, signal);
		return loadPromise.finally(() => {
			this.releaseOperation(activeOperation);
			this.cleanupOperation(activeOperation);
		});
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.flushPendingInput();
	}

	eof() {
		this.pendingEof = true;
		this.flushPendingInput();
	}

	private flushPendingInput() {
		if (!this.waitingForInput) return;
		if (flushQueuedStdin(this.pendingInput, this.buffer)) {
			this.waitingForInput = false;
			return;
		}
		if (this.pendingEof) {
			flushBufferedEof(this.buffer);
			this.pendingEof = false;
			this.waitingForInput = false;
		}
	}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		let activeOperation: JavaOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		const worker = this.worker;
		if (!worker) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, 'Worker not loaded'));
		}
		const assetBridge = this.assetBridge;
		const baseUrl = this.baseUrl;
		let signal: AbortSignal | undefined;
		let unbindPreSessionAbort: () => void = () => undefined;
		let programArgs: string[];
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		let stdin: SandboxExecutionOptions['stdin'];
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Java execution cancelled')
				);
			}
			programArgs = resolveSandboxExecutionArgs('JAVA', args, options).programArgs;
			const { sourcePath } = resolveJavaSourceIdentity(code);
			limits = resolveExecutionLimits(options.limits);
			const workspaceFiles = options.workspaceFiles ?? [];
			const activePath = options.activePath ?? sourcePath;
			const workspaceLimitsSource = options.workspaceLimits;
			const workspaceLimits = workspaceLimitsSource
				? {
						maxFiles: workspaceLimitsSource.maxFiles,
						maxFileBytes: workspaceLimitsSource.maxFileBytes,
						maxTotalBytes: workspaceLimitsSource.maxTotalBytes,
						maxPathBytes: workspaceLimitsSource.maxPathBytes,
						caseSensitive: workspaceLimitsSource.caseSensitive
					}
				: {};
			workspace = validateExecutionWorkspace(code, workspaceFiles, activePath, {
				...workspaceLimits,
				maxFileBytes: Math.min(
					workspaceLimits.maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
					limits.maxWorkspaceBytes
				),
				maxTotalBytes: Math.min(
					workspaceLimits.maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
					limits.maxWorkspaceBytes
				)
			});
			stdin = options.stdin;
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Java execution cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'Java execution cancelled')
			);
		}
		const hasExplicitStdin = stdin !== undefined;
		if (hasExplicitStdin) {
			activeOperation.explicitStdin = true;
			this.resetExplicitStdinState();
		}
		this.exit = false;
		const running = new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			let diagnosticCount = 0;
			let outputBytes = 0;
			const operation = this.workerSession.beginRun(worker, reject);
			const timeoutMs = Math.min(
				2_147_483_647,
				limits.compileTimeoutMs + limits.runTimeoutMs
			);
			this.bindOperationTimeout(activeOperation, timeoutMs);
			this.bindAbortSignal(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) return;
			let handler: (event: Event & { data: any }) => void;
			const ownsWorker = () =>
				this.worker === worker &&
				worker.onmessage === handler &&
				this.assetBridge === assetBridge;
			const ownsRun = () =>
				ownsWorker() && this.isOperationActive(activeOperation) && _uid === this.uid;
			const claimRun = () => {
				if (!ownsRun() || !this.workerSession.complete(operation)) return false;
				this.finishExplicitStdin(activeOperation);
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				this.releaseOperation(activeOperation);
				this.cleanupOperation(activeOperation);
				return true;
			};
			const failRun = (error: unknown, disposeWorker = false) => {
				if (!ownsRun()) return;
				if (disposeWorker) {
					this.cancelOperation(activeOperation, error);
					return;
				}
				if (!claimRun()) return;
				reject(error);
			};
			handler = (event: Event & { data: any }) => {
				if (!ownsWorker()) return;
				try {
					if (assetBridge?.handleMessage(event as MessageEvent<any>)) return;
					if (!ownsRun()) return;
					const { output, results, error, buffer, diagnostic } = event.data;
					if (buffer && !hasExplicitStdin) {
						this.waitingForInput = true;
						this.flushPendingInput();
						if (!ownsRun()) return;
					}
					if (output) {
						const actual =
							outputBytes + OUTPUT_ENCODER.encode(String(output)).byteLength;
						if (actual > limits.maxOutputBytes) {
							failRun(
								new OutputLimitError(
									`Java output exceeded ${limits.maxOutputBytes} bytes`,
									{
										actual,
										limit: limits.maxOutputBytes,
										phase: 'execute',
										runtimeId: 'JAVA'
									}
								),
								true
							);
							return;
						}
						outputBytes = actual;
						this.output?.(output);
					}
					if (!ownsRun()) return;
					if (diagnostic) {
						const actual = diagnosticCount + 1;
						if (actual > limits.maxDiagnostics) {
							failRun(
								new DiagnosticLimitError(
									`Java diagnostics exceeded ${limits.maxDiagnostics} messages`,
									{
										actual,
										limit: limits.maxDiagnostics,
										phase: 'execute',
										runtimeId: 'JAVA'
									}
								),
								true
							);
							return;
						}
						diagnosticCount = actual;
						this.oncompilerdiagnostic?.(diagnostic);
					}
					if (!ownsRun()) return;
					if (results) {
						if (!claimRun()) return;
						resolve(results as string);
						return;
					}
					if (error) failRun(error);
				} catch (error) {
					failRun(error, true);
				}
			};
			worker.onmessage = handler;
			if (!ownsRun()) return;
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					args: programArgs,
					stdin: stdin ?? '',
					hasExplicitStdin,
					baseUrl,
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles
				});
			} catch (error) {
				failRun(error, true);
			}
		});
		return running.finally(() => {
			if (this.releaseOperation(activeOperation)) {
				this.finishExplicitStdin(activeOperation);
				this.exit = true;
			}
			this.cleanupOperation(activeOperation);
		});
	}

	private cancelOperation(operation: JavaOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.activeOperation = null;
		this.uid += 1;
		this.finishExplicitStdin(operation);
		this.waitingForInput = false;
		this.pendingEof = false;
		this.exit = true;
		this.workerSession.terminate(reason);
		this.cleanupOperation(operation);
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const activeOperation = this.activeOperation;
		if (activeOperation) {
			this.cancelOperation(activeOperation, reason);
			return;
		}
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		resetBufferedStdin(this.buffer);
		if (this.activeOperation) {
			this.terminate();
			return;
		}
		if (this.worker) this.worker.onmessage = null;
	}
}

export default Java;
