import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { type CompilerDiagnostic, type SandboxExecutionOptions } from '$lib/playground/options';
import { importRuntimeModule } from '$lib/playground/runtimeModule';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import { fetchRuntimeAssetBytes } from '$lib/playground/worker/runtimeAssetFetch';
import {
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
	OutputLimitError,
	TimeoutError,
	resolveExecutionLimits,
	type ExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';

type BashRuntimeAssetConfig = PlaygroundRuntimeAssets & {
	bash?: { moduleUrl?: string; webcUrl?: string; workerUrl?: string };
};

interface WasixInstance {
	stdin?: WritableStream<Uint8Array>;
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	wait(): Promise<{ ok: boolean; code: number }>;
	free(): void;
}

interface WasmerCommand {
	run(options: Record<string, unknown>): Promise<WasixInstance>;
	free(): void;
}

interface WasmerPackage {
	entrypoint?: WasmerCommand;
	free(): void;
}

interface WasmerSdk {
	init(options: { sdkUrl: string; workerUrl: string }): Promise<unknown>;
	Wasmer: { fromFile(bytes: Uint8Array): Promise<WasmerPackage> };
}

let sdkPromise: Promise<WasmerSdk> | undefined;
let sdkCacheKey = '';

type BashOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
	abortController: AbortController;
};

const abortReason = (signal: AbortSignal, phase: BashOperation['phase']) => {
	const reason = signal.reason;
	return reason !== undefined
		? reason
		: new DOMException(
				phase === 'startup' ? 'Bash runtime startup aborted' : 'Bash execution aborted',
				'AbortError'
			);
};

const EXECUTION_LIMIT_KEYS = [
	'assetTimeoutMs',
	'startupTimeoutMs',
	'compileTimeoutMs',
	'runTimeoutMs',
	'maxOutputBytes',
	'maxDiagnostics',
	'maxWorkspaceBytes',
	'maxAssetBytes',
	'maxWasmMemoryBytes',
	'maxWorkers',
	'maxThreads'
] as const satisfies readonly (keyof ExecutionLimits)[];

class Bash implements Sandbox {
	output?: (data: string) => void;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	webcUrl = '';
	runtimePackage: WasmerPackage | null = null;
	instance: WasixInstance | null = null;
	stdinWriter: WritableStreamDefaultWriter | null = null;
	outputController: AbortController | null = null;
	pendingInput: string[] = [];
	pendingEof = false;
	activeLoadReject: ((reason: unknown) => void) | null = null;
	activeLoadCleanup: (() => void) | null = null;
	private loadGeneration = 0;
	activeReject: ((reason: unknown) => void) | null = null;
	activeRunCleanup: (() => void) | null = null;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	private activeOperation: BashOperation | null = null;

	private beginOperation(phase: BashOperation['phase']) {
		if (this.activeOperation) {
			throw new BusyError('Bash runtime already has an active operation', {
				runtimeId: 'BASH',
				phase: this.activeOperation.phase
			});
		}
		const operation: BashOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			cleanedUp: false,
			cleanups: [],
			abortController: new AbortController()
		};
		this.activeOperation = operation;
		return operation;
	}

	private isOperationActive(operation: BashOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private requireOperationActive(operation: BashOperation) {
		if (this.isOperationActive(operation)) return;
		throw operation.cancelled
			? operation.cancellationReason
			: operation.phase === 'startup'
				? 'Bash runtime startup cancelled'
				: 'Bash execution cancelled';
	}

	private snapshotExecutionLimits(
		operation: BashOperation,
		source: Partial<ExecutionLimits> | undefined
	) {
		const snapshot: Partial<ExecutionLimits> = {};
		if (source) {
			for (const key of EXECUTION_LIMIT_KEYS) {
				this.requireOperationActive(operation);
				const value = source[key];
				this.requireOperationActive(operation);
				if (value !== undefined) {
					(snapshot as Record<keyof ExecutionLimits, number | undefined>)[key] = value;
				}
			}
		}
		const limits = resolveExecutionLimits(snapshot);
		this.requireOperationActive(operation);
		return limits;
	}

	private releaseOperation(operation: BashOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: BashOperation) {
		if (operation.cleanedUp) return;
		operation.cleanedUp = true;
		const cleanups = operation.cleanups.splice(0);
		for (const cleanup of cleanups) {
			try {
				cleanup();
			} catch {
				// Caller-owned cleanup must not replace the operation result.
			}
		}
	}

	private abortOperationSignal(operation: BashOperation, reason: unknown) {
		try {
			operation.abortController.abort(reason);
		} catch {
			// Internal abort cleanup must not replace the operation result.
		}
	}

	private bindOperationTimeout(operation: BashOperation, timeoutMs: number) {
		if (!this.isOperationActive(operation)) return;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		operation.cleanups.push(() => {
			if (timeout !== undefined) clearTimeout(timeout);
		});
		try {
			timeout = setTimeout(() => {
				if (!this.isOperationActive(operation)) return;
				const label = operation.phase === 'startup' ? 'startup' : 'execution';
				this.terminate(
					new TimeoutError(`Bash ${label} timed out after ${timeoutMs} ms`, {
						phase: operation.phase,
						runtimeId: 'BASH',
						timeoutMs
					})
				);
			}, timeoutMs);
			if (operation.cleanedUp) clearTimeout(timeout);
		} catch (error) {
			if (this.isOperationActive(operation)) this.terminate(error);
		}
	}

	private releaseBeforeSession(operation: BashOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private bindPreSessionAbort(operation: BashOperation, signal: AbortSignal | undefined) {
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
			if (!this.isOperationActive(operation)) return;
			operation.cancelled = true;
			operation.cancellationReason = reason;
			this.releaseOperation(operation);
			this.cleanupOperation(operation);
			this.abortOperationSignal(operation, reason);
		};
		operation.cleanups.push(unbind);
		try {
			const alreadyAborted = signal.aborted;
			if (!this.isOperationActive(operation)) return unbind;
			if (alreadyAborted) {
				onAbort();
				return unbind;
			}
			registered = true;
			signal.addEventListener('abort', onAbort, { once: true });
			if (!this.isOperationActive(operation)) return unbind;
			const abortedAfterBinding = signal.aborted;
			if (!this.isOperationActive(operation)) return unbind;
			if (abortedAfterBinding) onAbort();
		} catch (error) {
			if (this.isOperationActive(operation)) {
				operation.cancelled = true;
				operation.cancellationReason = error;
				this.releaseOperation(operation);
				this.cleanupOperation(operation);
				this.abortOperationSignal(operation, error);
			}
		}
		return unbind;
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let activeOperation: BashOperation;
		try {
			activeOperation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let signal: AbortSignal | undefined;
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let resolvedWebcUrl: string;
		let resolvedSdkUrl: string;
		let resolvedThreadWorkerUrl: string;
		let unbindPreSessionAbort: () => void = () => undefined;
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			this.requireOperationActive(activeOperation);
			const limitSource = options.limits;
			this.requireOperationActive(activeOperation);
			limits = this.snapshotExecutionLimits(activeOperation, limitSource);
			let configuredWebcUrl: string | undefined;
			let configuredSdkUrl: string | undefined;
			let configuredWorkerUrl: string | undefined;
			let rootUrl = '';
			if (runtimeAssets && typeof runtimeAssets === 'object') {
				const bashAssets = (runtimeAssets as BashRuntimeAssetConfig).bash;
				this.requireOperationActive(activeOperation);
				if (bashAssets) {
					configuredWebcUrl = bashAssets.webcUrl;
					this.requireOperationActive(activeOperation);
					configuredSdkUrl = bashAssets.moduleUrl;
					this.requireOperationActive(activeOperation);
					configuredWorkerUrl = bashAssets.workerUrl;
					this.requireOperationActive(activeOperation);
				}
				if (!configuredWebcUrl || !configuredSdkUrl || !configuredWorkerUrl) {
					rootUrl = (runtimeAssets as BashRuntimeAssetConfig).rootUrl || '';
					this.requireOperationActive(activeOperation);
				}
			} else {
				rootUrl = typeof runtimeAssets === 'string' ? runtimeAssets : '';
			}
			const normalizedRoot = rootUrl.endsWith('/') ? rootUrl.slice(0, -1) : rootUrl;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextWebcUrl = configuredWebcUrl || `${normalizedRoot}/wasm-bash/bash.webc`;
			const sdkModuleUrl = configuredSdkUrl || `${normalizedRoot}/wasm-bash/sdk/index.mjs`;
			const sdkWorkerUrl =
				configuredWorkerUrl || `${normalizedRoot}/wasm-bash/sdk/worker.mjs`;
			resolvedWebcUrl = currentUrl ? new URL(nextWebcUrl, currentUrl).href : nextWebcUrl;
			this.requireOperationActive(activeOperation);
			resolvedSdkUrl = currentUrl ? new URL(sdkModuleUrl, currentUrl).href : sdkModuleUrl;
			this.requireOperationActive(activeOperation);
			resolvedThreadWorkerUrl = currentUrl
				? new URL(sdkWorkerUrl, currentUrl).href
				: sdkWorkerUrl;
			this.requireOperationActive(activeOperation);
			unbindPreSessionAbort();
			this.requireOperationActive(activeOperation);
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		const timeoutMs = Math.min(2_147_483_647, limits.assetTimeoutMs + limits.startupTimeoutMs);
		const loadGeneration = ++this.loadGeneration;
		return new Promise<void>((resolve, reject) => {
			let onAbort: (() => void) | undefined;
			let settleRejectedLoad: (reason: unknown) => void;
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (signal && onAbort) {
					try {
						signal.removeEventListener('abort', onAbort);
					} catch {
						// Cleanup must not replace the startup result.
					}
				}
				if (this.activeLoadCleanup === cleanup) this.activeLoadCleanup = null;
				if (this.activeLoadReject === settleRejectedLoad) this.activeLoadReject = null;
				this.releaseOperation(activeOperation);
				this.cleanupOperation(activeOperation);
			};
			settleRejectedLoad = (reason: unknown) => {
				cleanup();
				reject(reason);
			};
			const rejectLoad = (reason: unknown) => {
				if (!this.isOperationActive(activeOperation)) return;
				settleRejectedLoad(reason);
				this.abortOperationSignal(activeOperation, reason);
			};
			onAbort = signal
				? () => {
						if (
							!this.isOperationActive(activeOperation) ||
							loadGeneration !== this.loadGeneration
						) {
							cleanup();
							return;
						}
						let reason: unknown;
						try {
							reason = abortReason(signal, 'startup');
						} catch (error) {
							reason = error;
						}
						if (
							!this.isOperationActive(activeOperation) ||
							loadGeneration !== this.loadGeneration
						) {
							return;
						}
						this.terminate(reason);
					}
				: undefined;
			this.activeLoadCleanup = cleanup;
			this.activeLoadReject = settleRejectedLoad;
			try {
				if (signal && onAbort) {
					signal.addEventListener('abort', onAbort, { once: true });
					if (!this.isOperationActive(activeOperation)) return;
					const abortedAfterBinding = signal.aborted;
					if (!this.isOperationActive(activeOperation)) return;
					if (abortedAfterBinding) onAbort();
				}
			} catch (error) {
				if (this.isOperationActive(activeOperation)) this.terminate(error);
			}
			this.bindOperationTimeout(activeOperation, timeoutMs);
			if (!this.isOperationActive(activeOperation)) return;
			void (async () => {
				let nextPackage: WasmerPackage | null = null;
				try {
					if (
						!this.isOperationActive(activeOperation) ||
						loadGeneration !== this.loadGeneration
					) {
						return;
					}
					this.pendingInput = [];
					this.pendingEof = false;
					const nextSdkCacheKey = `${resolvedSdkUrl}\n${resolvedThreadWorkerUrl}`;

					progress?.set?.(0.1, 'Loading Bash runtime');
					if (
						!this.isOperationActive(activeOperation) ||
						loadGeneration !== this.loadGeneration
					) {
						return;
					}
					if (!sdkPromise || sdkCacheKey !== nextSdkCacheKey) {
						sdkCacheKey = nextSdkCacheKey;
						const createdSdkPromise = Promise.resolve()
							.then(() => importRuntimeModule<WasmerSdk>(resolvedSdkUrl))
							.then(async (sdk) => {
								await sdk.init({
									sdkUrl: resolvedSdkUrl,
									workerUrl: resolvedThreadWorkerUrl
								});
								return sdk;
							});
						sdkPromise = createdSdkPromise;
						void createdSdkPromise.catch(() => {
							if (
								sdkPromise === createdSdkPromise &&
								sdkCacheKey === nextSdkCacheKey
							) {
								sdkPromise = undefined;
								sdkCacheKey = '';
							}
						});
					}
					const loadSdkPromise = sdkPromise;
					if (!loadSdkPromise) throw new Error('Bash SDK startup was not scheduled');
					const [webcBytes, sdk] = await Promise.all([
						fetchRuntimeAssetBytes({
							url: resolvedWebcUrl,
							label: 'Bash WEBc package',
							maxAssetBytes: limits.maxAssetBytes,
							signal: activeOperation.abortController.signal
						}),
						loadSdkPromise
					]);
					if (
						!this.isOperationActive(activeOperation) ||
						loadGeneration !== this.loadGeneration
					) {
						return;
					}
					nextPackage = await sdk.Wasmer.fromFile(webcBytes);
					if (
						!this.isOperationActive(activeOperation) ||
						loadGeneration !== this.loadGeneration
					) {
						const stalePackage = nextPackage;
						nextPackage = null;
						try {
							stalePackage.free();
						} catch {
							// Cleanup must not replace the startup result.
						}
						return;
					}
					progress?.set?.(1, 'Bash runtime ready');
					if (
						!this.isOperationActive(activeOperation) ||
						loadGeneration !== this.loadGeneration
					) {
						const stalePackage = nextPackage;
						nextPackage = null;
						try {
							stalePackage.free();
						} catch {
							// Cleanup must not replace the startup result.
						}
						return;
					}
					const previousPackage = this.runtimePackage;
					this.runtimePackage = nextPackage;
					nextPackage = null;
					this.webcUrl = resolvedWebcUrl;
					try {
						previousPackage?.free();
					} catch {
						// Releasing the previous package must not replace startup success.
					}
					cleanup();
					resolve();
				} catch (error) {
					const failedPackage = nextPackage;
					nextPackage = null;
					try {
						failedPackage?.free();
					} catch {
						// Preserve the startup failure.
					}
					if (
						!this.isOperationActive(activeOperation) ||
						loadGeneration !== this.loadGeneration
					) {
						return;
					}
					rejectLoad(error);
				}
			})();
		});
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		void this.flushPendingInput().catch(() => undefined);
	}

	eof() {
		this.pendingEof = true;
		void this.flushPendingInput().catch(() => undefined);
	}

	private async flushPendingInput() {
		const writer = this.stdinWriter;
		if (!writer) return;
		const pending = this.pendingInput.splice(0);
		for (const input of pending) {
			await writer.write(new TextEncoder().encode(input));
			if (this.stdinWriter !== writer) return;
		}
		if (this.pendingEof && this.stdinWriter === writer) {
			this.pendingEof = false;
			await writer.close();
			if (this.stdinWriter === writer) {
				this.stdinWriter = null;
				try {
					writer.releaseLock();
				} catch {
					// The completed stream may already have released its writer.
				}
			}
		}
	}

	private disposeRunHandles(
		instance: WasixInstance | null,
		writer: WritableStreamDefaultWriter | null,
		outputController: AbortController | null,
		reason: unknown
	) {
		try {
			outputController?.abort(reason);
		} catch {
			// Preserve the operation result.
		}
		if (writer) {
			const releaseWriter = () => {
				try {
					writer.releaseLock();
				} catch {
					// Pending stream operations may still own the writer lock.
				}
			};
			try {
				void Promise.resolve(writer.abort(reason))
					.catch(() => undefined)
					.finally(releaseWriter);
			} catch {
				releaseWriter();
			}
		}
		try {
			instance?.free();
		} catch {
			// Preserve the operation result.
		}
	}

	async run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const activeOperation = this.beginOperation('execute');
		if (prepare) {
			this.releaseOperation(activeOperation);
			this.cleanupOperation(activeOperation);
			return true;
		}
		const runtimePackage = this.runtimePackage;
		if (!runtimePackage) {
			throw this.releaseBeforeSession(
				activeOperation,
				new Error('Bash runtime is not loaded')
			);
		}
		let signal: AbortSignal | undefined;
		let programArgs: string[];
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		let stdin: SandboxExecutionOptions['stdin'];
		let unbindPreSessionAbort: () => void = () => undefined;
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			this.requireOperationActive(activeOperation);
			const configuredProgramArgs = options.programArgs;
			this.requireOperationActive(activeOperation);
			const programArgsSource = configuredProgramArgs ?? args;
			programArgs = [];
			if (Array.isArray(programArgsSource)) {
				const programArgCount = programArgsSource.length;
				this.requireOperationActive(activeOperation);
				for (let index = 0; index < programArgCount; index += 1) {
					const argument = programArgsSource[index];
					this.requireOperationActive(activeOperation);
					programArgs.push(argument);
				}
			}
			const limitSource = options.limits;
			this.requireOperationActive(activeOperation);
			limits = this.snapshotExecutionLimits(activeOperation, limitSource);
			const workspaceFilesSource = options.workspaceFiles ?? [];
			this.requireOperationActive(activeOperation);
			if (!Array.isArray(workspaceFilesSource)) {
				throw new TypeError('Bash workspace files must be an array');
			}
			const workspaceFileCount = workspaceFilesSource.length;
			this.requireOperationActive(activeOperation);
			const workspaceFiles: Array<{ path: string; content: string }> = [];
			for (let index = 0; index < workspaceFileCount; index += 1) {
				const file = workspaceFilesSource[index];
				this.requireOperationActive(activeOperation);
				const path = file.path;
				this.requireOperationActive(activeOperation);
				const content = file.content;
				this.requireOperationActive(activeOperation);
				workspaceFiles.push({ path, content });
			}
			const activePath = options.activePath ?? 'main.sh';
			this.requireOperationActive(activeOperation);
			const workspaceLimitsSource = options.workspaceLimits;
			this.requireOperationActive(activeOperation);
			let workspaceLimits: SandboxExecutionOptions['workspaceLimits'] = {};
			if (workspaceLimitsSource) {
				const maxFiles = workspaceLimitsSource.maxFiles;
				this.requireOperationActive(activeOperation);
				const maxFileBytes = workspaceLimitsSource.maxFileBytes;
				this.requireOperationActive(activeOperation);
				const maxTotalBytes = workspaceLimitsSource.maxTotalBytes;
				this.requireOperationActive(activeOperation);
				const maxPathBytes = workspaceLimitsSource.maxPathBytes;
				this.requireOperationActive(activeOperation);
				const caseSensitive = workspaceLimitsSource.caseSensitive;
				this.requireOperationActive(activeOperation);
				workspaceLimits = {
					maxFiles,
					maxFileBytes,
					maxTotalBytes,
					maxPathBytes,
					caseSensitive
				};
			}
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
			this.requireOperationActive(activeOperation);
			stdin = options.stdin;
			this.requireOperationActive(activeOperation);
			unbindPreSessionAbort();
			this.requireOperationActive(activeOperation);
		} catch (error) {
			throw this.releaseBeforeSession(activeOperation, error);
		}
		const timeoutMs = Math.min(2_147_483_647, limits.compileTimeoutMs + limits.runTimeoutMs);
		const mountedFiles = Object.fromEntries(
			workspace.workspaceFiles.map((file) => [file.path, file.content])
		);
		const mountedActivePath = workspace.activePath ?? 'main.sh';
		mountedFiles[mountedActivePath] = code;
		const hasExplicitStdin = stdin !== undefined;
		const queuedStdin = this.pendingInput.length > 0 ? this.pendingInput.join('') : undefined;
		const suppliedStdin = stdin ?? (this.pendingEof ? queuedStdin || '' : undefined);
		this.requireOperationActive(activeOperation);

		this.exit = false;
		this.begin = Date.now();
		const runUid = ++this.uid;
		if (suppliedStdin !== undefined) {
			this.pendingInput = [];
			this.pendingEof = false;
		}

		return new Promise<boolean | string>((resolve, reject) => {
			let outputBytes = 0;
			let settleRejectedRun: (reason: unknown) => void;
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (hasExplicitStdin && this.activeOperation?.token === activeOperation.token) {
					this.pendingInput = [];
					this.pendingEof = false;
				}
				if (signal && onAbort) {
					try {
						signal.removeEventListener('abort', onAbort);
					} catch {
						// Cleanup must not replace the execution result.
					}
				}
				if (this.activeRunCleanup === cleanup) this.activeRunCleanup = null;
				if (this.activeReject === settleRejectedRun) this.activeReject = null;
				this.releaseOperation(activeOperation);
				this.cleanupOperation(activeOperation);
			};
			settleRejectedRun = (reason: unknown) => {
				cleanup();
				reject(reason);
			};
			const onAbort = signal
				? () => {
						if (!this.isOperationActive(activeOperation) || runUid !== this.uid) {
							cleanup();
							return;
						}
						let reason: unknown;
						try {
							reason = abortReason(signal, 'execute');
						} catch (error) {
							reason = error;
						}
						if (!this.isOperationActive(activeOperation) || runUid !== this.uid) {
							return;
						}
						this.terminate(reason);
					}
				: undefined;
			this.activeReject = settleRejectedRun;
			this.activeRunCleanup = cleanup;
			try {
				if (signal && onAbort) {
					signal.addEventListener('abort', onAbort, { once: true });
					if (!this.isOperationActive(activeOperation)) return;
					const abortedAfterBinding = signal.aborted;
					if (!this.isOperationActive(activeOperation)) return;
					if (abortedAfterBinding) onAbort();
				}
			} catch (error) {
				if (this.isOperationActive(activeOperation)) this.terminate(error);
			}
			this.bindOperationTimeout(activeOperation, timeoutMs);
			if (!this.isOperationActive(activeOperation) || runUid !== this.uid) return;
			void (async () => {
				const ownsRun = () =>
					this.isOperationActive(activeOperation) && runUid === this.uid;
				try {
					const command = runtimePackage.entrypoint;
					if (!command) throw new Error('Bash WEBc package has no entrypoint');
					let instancePromise: Promise<WasixInstance>;
					try {
						instancePromise = command.run({
							args: ['-c', code, mountedActivePath, ...programArgs],
							mount: { '/workspace': mountedFiles },
							cwd: '/workspace',
							...(suppliedStdin === undefined ? {} : { stdin: suppliedStdin })
						});
					} finally {
						try {
							command.free();
						} catch {
							// Command cleanup must not replace the execution result.
						}
					}
					const instance = await instancePromise;
					if (!ownsRun()) {
						this.disposeRunHandles(
							instance,
							null,
							null,
							activeOperation.cancellationReason
						);
						return;
					}
					let writer: WritableStreamDefaultWriter | null = null;
					try {
						writer =
							suppliedStdin === undefined
								? instance.stdin?.getWriter() || null
								: null;
					} catch (error) {
						this.disposeRunHandles(instance, null, null, error);
						throw error;
					}
					if (!ownsRun()) {
						this.disposeRunHandles(
							instance,
							writer,
							null,
							activeOperation.cancellationReason
						);
						return;
					}
					this.instance = instance;
					this.stdinWriter = writer;
					await this.flushPendingInput();
					if (!ownsRun()) return;

					const outputController = new AbortController();
					this.outputController = outputController;
					const outputPipes: Promise<void>[] = [];
					const writeOutput = (chunk: Uint8Array) => {
						if (!ownsRun()) return;
						const actual = outputBytes + chunk.byteLength;
						if (actual > limits.maxOutputBytes) {
							this.terminate(
								new OutputLimitError(
									`Bash output exceeded ${limits.maxOutputBytes} bytes`,
									{
										actual,
										limit: limits.maxOutputBytes,
										phase: 'execute',
										runtimeId: 'BASH'
									}
								)
							);
							return;
						}
						outputBytes = actual;
						this.output?.(new TextDecoder().decode(chunk));
					};
					try {
						outputPipes.push(
							instance.stdout.pipeTo(
								new WritableStream({
									write: (chunk) => writeOutput(chunk)
								}),
								{ signal: outputController.signal }
							)
						);
						outputPipes.push(
							instance.stderr.pipeTo(
								new WritableStream({
									write: (chunk) => writeOutput(chunk)
								}),
								{ signal: outputController.signal }
							)
						);
					} catch (error) {
						void Promise.allSettled(outputPipes);
						throw error;
					}
					const outputDone = Promise.allSettled(outputPipes);
					if (!ownsRun()) return;
					this.instance = null;
					const result = await instance.wait();
					await outputDone;
					if (!ownsRun()) return;

					this.elapse = Date.now() - this.begin;
					this.exit = true;
					const settledWriter = this.stdinWriter;
					this.stdinWriter = null;
					this.instance = null;
					if (this.outputController === outputController) {
						this.outputController = null;
					}
					try {
						settledWriter?.releaseLock();
					} catch {
						// The completed stream may already have released its writer.
					}
					if (!result.ok) {
						settleRejectedRun(`Bash exited with status ${result.code}.`);
						return;
					}
					cleanup();
					resolve(true);
				} catch (error) {
					if (!ownsRun()) return;
					this.exit = true;
					const writer = this.stdinWriter;
					const instance = this.instance;
					const outputController = this.outputController;
					this.stdinWriter = null;
					this.instance = null;
					this.outputController = null;
					this.disposeRunHandles(instance, writer, outputController, error);
					settleRejectedRun(error instanceof Error ? error.message : String(error));
				} finally {
					cleanup();
				}
			})();
		});
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const activeOperation = this.activeOperation;
		if (activeOperation) {
			const loadReject = this.activeLoadReject;
			const loadCleanup = this.activeLoadCleanup;
			const reject = this.activeReject;
			const cleanup = this.activeRunCleanup;
			const writer = this.stdinWriter;
			const instance = this.instance;
			const outputController = this.outputController;
			activeOperation.cancelled = true;
			activeOperation.cancellationReason = reason;
			this.activeOperation = null;
			this.activeLoadReject = null;
			this.activeLoadCleanup = null;
			this.activeReject = null;
			this.activeRunCleanup = null;
			this.loadGeneration += 1;
			this.uid += 1;
			this.stdinWriter = null;
			this.instance = null;
			this.outputController = null;
			this.pendingInput = [];
			this.pendingEof = false;
			this.exit = true;
			this.cleanupOperation(activeOperation);
			loadCleanup?.();
			cleanup?.();
			loadReject?.(reason);
			reject?.(reason);
			this.abortOperationSignal(activeOperation, reason);
			this.disposeRunHandles(instance, writer, outputController, reason);
			return;
		}
		const loadReject = this.activeLoadReject;
		const loadCleanup = this.activeLoadCleanup;
		const reject = this.activeReject;
		const cleanup = this.activeRunCleanup;
		const writer = this.stdinWriter;
		const instance = this.instance;
		const outputController = this.outputController;
		this.activeLoadReject = null;
		this.activeLoadCleanup = null;
		this.activeReject = null;
		this.activeRunCleanup = null;
		this.loadGeneration += 1;
		this.uid += 1;
		this.stdinWriter = null;
		this.instance = null;
		this.outputController = null;
		this.pendingInput = [];
		this.pendingEof = false;
		this.exit = true;
		loadCleanup?.();
		cleanup?.();
		loadReject?.(reason);
		reject?.(reason);
		this.disposeRunHandles(instance, writer, outputController, reason);
	}

	async clear() {
		this.terminate();
		const runtimePackage = this.runtimePackage;
		this.runtimePackage = null;
		try {
			runtimePackage?.free();
		} catch {
			// The sandbox is cleared even when the SDK cleanup hook fails.
		}
	}
}

export default Bash;
