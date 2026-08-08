import {
	resolveHaskellBsdtarUrl,
	resolveHaskellModuleUrl,
	resolveHaskellRootfsUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import {
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
	TimeoutError,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
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

const DEFAULT_HASKELL_MAIN_SO_PATH = '/tmp/libplayground001.so';
const DEFAULT_HASKELL_SEARCH_DIRS = [
	'/tmp/clib',
	'/tmp/hslib/lib/wasm32-wasi-ghc-9.14.0.20251031-inplace'
];

type HaskellRuntimeSnapshot = {
	moduleUrl: string;
	rootfsUrl: string;
	bsdtarUrl: string;
	mainSoPath: string;
	searchDirs: string[];
};

type HaskellOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
	explicitStdin: boolean;
};

const abortReason = (signal: AbortSignal, phase: HaskellOperation['phase']) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup'
					? 'Haskell runtime startup aborted'
					: 'Haskell execution aborted',
				'AbortError'
			);

class Haskell implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	runtimeKey = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeOperation: HaskellOperation | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'Haskell',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	private requireOperationIdle() {
		if (!this.activeOperation) return;
		throw new BusyError('Haskell runtime already has an active operation', {
			runtimeId: 'HASKELL',
			phase: this.activeOperation.phase
		});
	}

	private beginOperation(phase: HaskellOperation['phase']) {
		this.requireOperationIdle();
		const operation: HaskellOperation = {
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

	private isOperationActive(operation: HaskellOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: HaskellOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: HaskellOperation) {
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

	private releaseBeforeSession(operation: HaskellOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private bindPreSessionAbort(operation: HaskellOperation, signal: AbortSignal | undefined) {
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

	private bindAbortSignal(operation: HaskellOperation, signal: AbortSignal | undefined) {
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

	private bindOperationTimeout(operation: HaskellOperation, timeoutMs: number) {
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
					new TimeoutError(`Haskell ${label} timed out after ${timeoutMs} ms`, {
						phase: operation.phase,
						runtimeId: 'HASKELL',
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

	private finishExplicitStdin(operation: HaskellOperation) {
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
		let activeOperation: HaskellOperation;
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
					this.releaseBeforeSession(activeOperation, 'Haskell runtime startup cancelled')
				);
			}
			limits = resolveExecutionLimits(options.limits);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Haskell runtime startup cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'Haskell runtime startup cancelled')
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
				let runtimeConfig: PlaygroundRuntimeAssets['haskell'] = undefined;
				if (typeof runtimeAssets === 'object') {
					runtimeConfig = runtimeAssets.haskell;
					let rootUrl: string | undefined;
					let rootUrlRead = false;
					resolverAssets = {
						get rootUrl() {
							if (!rootUrlRead) {
								rootUrlRead = true;
								rootUrl = runtimeAssets.rootUrl;
							}
							return rootUrl;
						},
						haskell: runtimeConfig
					};
				}
				const moduleUrl = resolveHaskellModuleUrl(resolverAssets, currentUrl);
				const rootfsUrl = resolveHaskellRootfsUrl(resolverAssets, currentUrl);
				const bsdtarUrl = resolveHaskellBsdtarUrl(resolverAssets, currentUrl);
				if (!this.isOperationActive(activeOperation)) return;
				if (!moduleUrl || !rootfsUrl || !bsdtarUrl) {
					return rejectLoad(
						'Haskell runtime is not configured. Set PUBLIC_WASM_HASKELL_MODULE_URL, PUBLIC_WASM_HASKELL_ROOTFS_URL, and PUBLIC_WASM_HASKELL_BSDTAR_URL, or runtimeAssets.haskell.'
					);
				}
				const mainSoPath = runtimeConfig?.mainSoPath || DEFAULT_HASKELL_MAIN_SO_PATH;
				const configuredSearchDirs = runtimeConfig?.searchDirs;
				const searchDirs = [...(configuredSearchDirs || DEFAULT_HASKELL_SEARCH_DIRS)];
				if (!this.isOperationActive(activeOperation)) return;
				const runtime: HaskellRuntimeSnapshot = {
					moduleUrl,
					rootfsUrl,
					bsdtarUrl,
					mainSoPath,
					searchDirs
				};
				const nextRuntimeKey = JSON.stringify(runtime);
				if (!this.isOperationActive(activeOperation)) return;
				const needsWorkerReset = !this.worker || this.runtimeKey !== nextRuntimeKey;
				this.runtimeKey = nextRuntimeKey;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
				}
				if (!this.worker) {
					const WorkerConstructor = (
						await import('$lib/playground/worker/haskell?worker')
					).default;
					if (!this.isOperationActive(activeOperation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(activeOperation)) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					let handler: (event: MessageEvent<any>) => void;
					const ownsLoad = () =>
						this.isOperationActive(activeOperation) &&
						this.worker === worker &&
						worker.onmessage === handler;
					const failLoad = (error: unknown) => {
						if (!ownsLoad()) return;
						rejectLoad(error);
					};
					handler = (event: MessageEvent<any>) => {
						if (!ownsLoad()) return;
						try {
							reportWorkerProgress(progress, event.data?.progress);
							if (!ownsLoad()) return;
							if (event.data?.load) {
								progress?.set?.(1);
								if (!ownsLoad()) return;
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
						...runtime,
						log: _log
					});
				} else {
					const worker = this.worker;
					progress?.set?.(1);
					if (!this.isOperationActive(activeOperation) || this.worker !== worker) return;
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
		let activeOperation: HaskellOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		const worker = this.worker;
		if (!worker) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, 'Worker not loaded'));
		}
		let signal: AbortSignal | undefined;
		let unbindPreSessionAbort: () => void = () => undefined;
		let ghcArgs: string;
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		let stdin: SandboxExecutionOptions['stdin'];
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Haskell execution cancelled')
				);
			}
			const { compileArgs, programArgs } = resolveSandboxExecutionArgs(
				'HASKELL',
				args,
				options
			);
			ghcArgs = compileArgs.length ? compileArgs.join(' ') : programArgs.join(' ');
			limits = resolveExecutionLimits(options.limits);
			const workspaceFiles = options.workspaceFiles ?? [];
			const activePath = options.activePath ?? 'main.hs';
			const workspaceLimits = options.workspaceLimits;
			workspace = validateExecutionWorkspace(code, workspaceFiles, activePath, {
				...workspaceLimits,
				maxFileBytes: Math.min(
					workspaceLimits?.maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
					limits.maxWorkspaceBytes
				),
				maxTotalBytes: Math.min(
					workspaceLimits?.maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
					limits.maxWorkspaceBytes
				)
			});
			stdin = options.stdin;
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, 'Haskell execution cancelled')
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, 'Haskell execution cancelled')
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
			const operation = this.workerSession.beginRun(worker, reject);
			const timeoutMs = Math.min(
				2_147_483_647,
				limits.compileTimeoutMs + limits.runTimeoutMs
			);
			this.bindOperationTimeout(activeOperation, timeoutMs);
			this.bindAbortSignal(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) return;
			let handler: (event: Event & { data: any }) => void;
			const ownsRun = () =>
				this.isOperationActive(activeOperation) &&
				this.worker === worker &&
				worker.onmessage === handler &&
				_uid === this.uid;
			const claimRun = () => {
				if (!ownsRun()) return false;
				this.finishExplicitStdin(activeOperation);
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				this.workerSession.complete(operation);
				this.releaseOperation(activeOperation);
				this.cleanupOperation(activeOperation);
				try {
					if (worker.onmessage === handler) worker.onmessage = null;
				} catch {
					// Handler cleanup must not replace the operation result.
				}
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
				if (!ownsRun()) return;
				try {
					const { output, results, error, buffer, diagnostic, progress } = event.data;
					if (buffer && !hasExplicitStdin) {
						this.waitingForInput = true;
						this.flushPendingInput();
						if (!ownsRun()) return;
					}
					reportWorkerProgress(_prog, progress);
					if (!ownsRun()) return;
					if (output) this.output?.(output);
					if (!ownsRun()) return;
					if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
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
					ghcArgs,
					stdin,
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles,
					log: _log
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

	private cancelOperation(operation: HaskellOperation, reason: unknown) {
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

export default Haskell;
