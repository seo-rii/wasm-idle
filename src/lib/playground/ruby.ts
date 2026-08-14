import {
	resolveRubyRuntimeModuleUrl,
	resolveRubyRuntimeAssetIntegrity,
	resolveRubyWasmUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { snapshotRubyRuntimeAssetConfig } from '$lib/playground/rubyAssets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';
import {
	BusyError,
	CancelledError,
	DEFAULT_WORKSPACE_LIMITS,
	DiagnosticLimitError,
	OutputLimitError,
	RuntimeConfigurationError,
	TimeoutError,
	createRuntimeAssetsKey,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';

type RubyOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	explicitStdin: boolean;
	ownsStdin: boolean;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
};

const OUTPUT_ENCODER = new TextEncoder();

const abortReason = (signal: AbortSignal, phase: RubyOperation['phase']) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup' ? 'Ruby runtime startup aborted' : 'Ruby execution aborted',
				'AbortError'
			);

class Ruby implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	wasmUrl = '';
	moduleUrl = '';
	private runtimeAssetKey = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeOperation: RubyOperation | null = null;
	private disposed = false;
	private disposePromise: Promise<void> | null = null;
	private readonly disposeCancellation = new CancelledError('Ruby sandbox disposed', {
		phase: 'dispose',
		runtimeId: 'RUBY',
		recoverable: false
	});
	private readonly workerSession = new WorkerSession({
		label: 'Ruby',
		onDispose: (worker) => {
			if (this.worker !== worker) return;
			delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	private beginOperation(phase: RubyOperation['phase']) {
		if (this.disposed) {
			throw new RuntimeConfigurationError('Ruby sandbox is disposed', {
				phase: 'dispose',
				runtimeId: 'RUBY'
			});
		}
		if (this.activeOperation) {
			throw new BusyError('Ruby runtime already has an active operation', {
				runtimeId: 'RUBY',
				phase: this.activeOperation.phase
			});
		}
		const operation: RubyOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			explicitStdin: false,
			ownsStdin: false,
			cleanedUp: false,
			cleanups: []
		};
		this.activeOperation = operation;
		return operation;
	}

	private isOperationActive(operation: RubyOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: RubyOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: RubyOperation) {
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

	private releaseBeforeSession(operation: RubyOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private bindPreSessionAbort(operation: RubyOperation, signal: AbortSignal | undefined) {
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

	private bindAbortSignal(operation: RubyOperation, signal: AbortSignal | undefined) {
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
			if (registered) signal.removeEventListener('abort', onAbort);
		});
		try {
			registered = true;
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private bindOperationTimeout(operation: RubyOperation, timeoutMs: number) {
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
					new TimeoutError(`Ruby ${label} timed out after ${timeoutMs} ms`, {
						phase: operation.phase,
						runtimeId: 'RUBY',
						timeoutMs
					})
				);
			}, timeoutMs);
			if (operation.cleanedUp) clearTimeout(timeout);
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private resetSharedStdinBuffer() {
		try {
			resetBufferedStdin(this.buffer);
		} catch {
			// Stdin cleanup must not replace the execution result.
		}
	}

	private prepareRunStdin(operation: RubyOperation, explicitStdin: boolean) {
		operation.ownsStdin = true;
		operation.explicitStdin = explicitStdin;
		if (explicitStdin) {
			this.pendingInput = [];
			this.pendingEof = false;
		}
		this.waitingForInput = false;
		this.resetSharedStdinBuffer();
	}

	private finishRunStdin(operation: RubyOperation) {
		if (!operation.ownsStdin) return;
		const resetSharedBuffer = operation.explicitStdin;
		operation.ownsStdin = false;
		operation.explicitStdin = false;
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
		if (resetSharedBuffer) this.resetSharedStdinBuffer();
	}

	private cancelOperation(operation: RubyOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.finishRunStdin(operation);
		this.activeOperation = null;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.exit = true;
		this.workerSession.terminate(reason);
		this.cleanupOperation(operation);
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let activeOperation: RubyOperation;
		try {
			activeOperation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let nextConfig: ReturnType<typeof snapshotRubyRuntimeAssetConfig>;
		let nextAssetKey: string;
		let signal: AbortSignal | undefined;
		let unbindPreSessionAbort: () => void = () => undefined;
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Ruby runtime startup cancelled')
				);
			}
			limits = resolveExecutionLimits(options.limits);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Ruby runtime startup cancelled')
				);
			}
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextModuleUrl = resolveRubyRuntimeModuleUrl(runtimeAssets, currentUrl);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Ruby runtime startup cancelled')
				);
			}
			const nextWasmUrl = resolveRubyWasmUrl(runtimeAssets, currentUrl);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Ruby runtime startup cancelled')
				);
			}
			const nextIntegrity = resolveRubyRuntimeAssetIntegrity(runtimeAssets);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Ruby runtime startup cancelled')
				);
			}
			nextConfig = snapshotRubyRuntimeAssetConfig({
				moduleUrl: nextModuleUrl,
				wasmUrl: nextWasmUrl,
				integrity: nextIntegrity,
				maxAssetBytes: limits.maxAssetBytes
			});
			const resolvedAssetKey = createRuntimeAssetsKey({
				ruby: {
					moduleUrl: nextConfig.moduleUrl,
					wasmUrl: nextConfig.wasmUrl,
					integrity: nextConfig.integrity
				}
			});
			if (!resolvedAssetKey) {
				throw new RuntimeConfigurationError('Ruby runtime asset key could not be created', {
					phase: 'startup',
					runtimeId: 'RUBY'
				});
			}
			nextAssetKey = resolvedAssetKey;
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Ruby runtime startup cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'Ruby runtime startup cancelled')
			);
		}
		const loading = this.workerSession.load(async (resolve, reject) => {
			const resolveOperation = () => {
				if (!this.releaseOperation(activeOperation)) return;
				resolve();
				this.cleanupOperation(activeOperation);
			};
			const rejectOperation = (reason?: unknown) => {
				if (!this.releaseOperation(activeOperation)) return;
				reject(reason);
				this.cleanupOperation(activeOperation);
			};
			try {
				if (!this.isOperationActive(activeOperation)) return;
				const needsWorkerReset = !this.worker || this.runtimeAssetKey !== nextAssetKey;
				if (needsWorkerReset && this.worker) this.workerSession.reset();
				if (!this.isOperationActive(activeOperation)) return;
				this.wasmUrl = nextConfig.wasmUrl;
				this.moduleUrl = nextConfig.moduleUrl;
				this.runtimeAssetKey = nextAssetKey;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/ruby?worker'))
						.default;
					if (!this.isOperationActive(activeOperation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(activeOperation)) {
						try {
							worker.terminate();
						} catch {
							// The unattached worker is already detached.
						}
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					let handler: (event: MessageEvent<any>) => void;
					handler = (event) => {
						if (
							!this.isOperationActive(activeOperation) ||
							this.worker !== worker ||
							worker.onmessage !== handler
						) {
							return;
						}
						try {
							if (event.data?.load) {
								progress?.set?.(1);
								if (
									!this.isOperationActive(activeOperation) ||
									this.worker !== worker ||
									worker.onmessage !== handler
								) {
									return;
								}
								resolveOperation();
								return;
							}
							if (event.data?.error !== undefined) rejectOperation(event.data.error);
						} catch (error) {
							rejectOperation(error);
						}
					};
					worker.onmessage = handler;
					worker.postMessage({
						load: true,
						moduleUrl: nextConfig.moduleUrl,
						wasmUrl: nextConfig.wasmUrl,
						integrity: nextConfig.integrity,
						maxAssetBytes: nextConfig.maxAssetBytes
					});
				} else {
					const worker = this.worker;
					progress?.set?.(1);
					if (!this.isOperationActive(activeOperation) || this.worker !== worker) return;
					resolveOperation();
				}
			} catch (error) {
				rejectOperation(error);
			}
		});
		const timeoutMs = Math.min(2_147_483_647, limits.assetTimeoutMs + limits.startupTimeoutMs);
		this.bindOperationTimeout(activeOperation, timeoutMs);
		this.bindAbortSignal(activeOperation, signal);
		return loading.finally(() => {
			this.releaseOperation(activeOperation);
			this.cleanupOperation(activeOperation);
		});
	}

	write(input: string) {
		if (this.disposed) return;
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.flushPendingInput();
	}

	eof() {
		if (this.disposed) return;
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
		let activeOperation: RubyOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let signal: AbortSignal | undefined;
		let unbindPreSessionAbort: () => void = () => undefined;
		let request: {
			programArgs: string[];
			stdin: string | undefined;
			activePath: string;
			workspaceFiles: NonNullable<SandboxExecutionOptions['workspaceFiles']>;
		};
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Ruby execution cancelled')
				);
			}
			limits = resolveExecutionLimits(options.limits);
			const workspace = validateExecutionWorkspace(
				code,
				options.workspaceFiles ?? [],
				options.activePath ?? 'main.rb',
				{
					...options.workspaceLimits,
					maxFileBytes: Math.min(
						options.workspaceLimits?.maxFileBytes ??
							DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
						limits.maxWorkspaceBytes
					),
					maxTotalBytes: Math.min(
						options.workspaceLimits?.maxTotalBytes ??
							DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
						limits.maxWorkspaceBytes
					)
				}
			);
			const programArgs = resolveSandboxExecutionArgs('RUBY', args, options).programArgs;
			const stdin = options.stdin;
			if (stdin !== undefined && typeof stdin !== 'string') {
				throw new RuntimeConfigurationError('Ruby stdin must be a string', {
					phase: 'execute',
					runtimeId: 'RUBY'
				});
			}
			request = {
				programArgs,
				stdin,
				activePath: workspace.activePath ?? 'main.rb',
				workspaceFiles: workspace.workspaceFiles
			};
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Ruby execution cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'Ruby execution cancelled')
			);
		}
		const worker = this.worker;
		if (!worker) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, 'Worker not loaded'));
		}
		const hasExplicitStdin = request.stdin !== undefined;
		this.prepareRunStdin(activeOperation, hasExplicitStdin);
		this.exit = false;
		const running = new Promise<boolean | string>((resolve, reject) => {
			let diagnosticCount = 0;
			let outputBytes = 0;
			const workerOperation = this.workerSession.beginRun(worker, reject);
			const timeoutMs = Math.min(
				2_147_483_647,
				limits.compileTimeoutMs + limits.runTimeoutMs
			);
			this.bindOperationTimeout(activeOperation, timeoutMs);
			this.bindAbortSignal(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) return;
			const runUid = ++this.uid;
			let handler: (event: Event & { data: any }) => void;
			const ownsRun = () =>
				this.isOperationActive(activeOperation) &&
				this.worker === worker &&
				worker.onmessage === handler &&
				runUid === this.uid;
			const settleRunState = () => {
				this.finishRunStdin(activeOperation);
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
			};
			const claimRun = () => {
				if (!ownsRun()) return false;
				settleRunState();
				this.workerSession.complete(workerOperation);
				this.releaseOperation(activeOperation);
				this.cleanupOperation(activeOperation);
				try {
					if (worker.onmessage === handler) worker.onmessage = null;
				} catch {
					// Handler cleanup must not replace the execution result.
				}
				return true;
			};
			const failRun = (reason: unknown, disposeWorker = false) => {
				if (disposeWorker) {
					if (!ownsRun()) return;
					this.cancelOperation(activeOperation, reason);
					return;
				}
				if (!claimRun()) return;
				reject(reason);
			};
			handler = (event) => {
				if (
					this.worker !== worker ||
					worker.onmessage !== handler ||
					!this.isOperationActive(activeOperation)
				) {
					return;
				}
				try {
					const { output, results, error, buffer, diagnostic, progress } = event.data;
					if (buffer && !hasExplicitStdin) {
						this.waitingForInput = true;
						this.flushPendingInput();
						if (!ownsRun()) return;
					}
					reportWorkerProgress(_prog, progress);
					if (!ownsRun()) return;
					if (typeof output === 'string' && output.length > 0) {
						const actual = outputBytes + OUTPUT_ENCODER.encode(output).byteLength;
						if (actual > limits.maxOutputBytes) {
							failRun(
								new OutputLimitError(
									`Ruby output exceeded ${limits.maxOutputBytes} bytes`,
									{
										actual,
										limit: limits.maxOutputBytes,
										phase: 'execute',
										runtimeId: 'RUBY'
									}
								),
								true
							);
							return;
						}
						outputBytes = actual;
						this.output?.(output);
						if (!ownsRun()) return;
					}
					if (diagnostic !== undefined) {
						const actual = diagnosticCount + 1;
						if (actual > limits.maxDiagnostics) {
							failRun(
								new DiagnosticLimitError(
									`Ruby diagnostics exceeded ${limits.maxDiagnostics} messages`,
									{
										actual,
										limit: limits.maxDiagnostics,
										phase: 'execute',
										runtimeId: 'RUBY'
									}
								),
								true
							);
							return;
						}
						diagnosticCount = actual;
						this.oncompilerdiagnostic?.(diagnostic);
						if (!ownsRun()) return;
					}
					if (results !== undefined) {
						if (!claimRun()) return;
						resolve(results as boolean | string);
						return;
					}
					if (error !== undefined) failRun(error);
				} catch (error) {
					failRun(error, true);
				}
			};
			worker.onmessage = handler;
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					args: request.programArgs,
					stdin: request.stdin,
					activePath: request.activePath,
					workspaceFiles: request.workspaceFiles,
					log: _log
				});
			} catch (error) {
				failRun(error);
			}
		});
		return running.finally(() => {
			if (this.isOperationActive(activeOperation)) {
				this.finishRunStdin(activeOperation);
				this.releaseOperation(activeOperation);
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
			}
			this.cleanupOperation(activeOperation);
		});
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		if (this.disposed) return;
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
		if (this.disposed) return;
		if (this.activeOperation) this.terminate();
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		const worker = this.worker;
		if (worker) {
			try {
				worker.onmessage = null;
			} catch {
				// Idle handler cleanup is best effort.
			}
		}
		this.resetSharedStdinBuffer();
	}

	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.disposePromise = Promise.resolve();

		const activeOperation = this.activeOperation;
		delete this.worker;
		this.wasmUrl = '';
		this.moduleUrl = '';
		this.runtimeAssetKey = '';
		this.output = null;
		this.oncompilerdiagnostic = undefined;
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		this.resetSharedStdinBuffer();
		if (activeOperation) {
			this.cancelOperation(activeOperation, this.disposeCancellation);
		} else {
			this.uid += 1;
			this.workerSession.terminate(this.disposeCancellation);
			this.exit = true;
		}
		return this.disposePromise;
	}
}

export default Ruby;
