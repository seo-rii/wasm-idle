import {
	resolveOctaveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { type CompilerDiagnostic, type SandboxExecutionOptions } from '$lib/playground/options';
import {
	BusyError,
	DEFAULT_WORKSPACE_LIMITS,
	OutputLimitError,
	TimeoutError,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';

type OctaveWorkerMessage = {
	load?: true;
	output?: string;
	results?: boolean;
	error?: string;
	buffer?: boolean;
	progress?: { percent?: number; stage?: string };
};

type OctaveOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
};

type OctaveLoadOperation = OctaveOperation & {
	phase: 'startup';
	reject: (reason?: unknown) => void;
};

type OctaveRunOperation = OctaveOperation & {
	phase: 'execute';
	stdinBuffer?: ArrayBufferLike;
};

const OUTPUT_ENCODER = new TextEncoder();

class Octave implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	baseUrl = '';
	workerUrl = '';
	manifestUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	stdinWaiters: Array<() => void> = [];
	private activeLoad: OctaveLoadOperation | null = null;
	private activeRun: OctaveRunOperation | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'Octave',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	private abortReason(signal: AbortSignal, phase: 'startup' | 'execute') {
		const reason = signal.reason;
		if (reason !== undefined) return reason;
		return new DOMException(
			phase === 'startup' ? 'Octave runtime startup aborted' : 'Octave execution aborted',
			'AbortError'
		);
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		if (this.activeLoad || this.activeRun) {
			return Promise.reject(
				new BusyError('Octave runtime already has an active operation', {
					runtimeId: 'OCTAVE',
					phase: this.activeLoad ? 'startup' : 'execute'
				})
			);
		}
		const operation: OctaveLoadOperation = {
			token: Symbol('Octave load'),
			phase: 'startup',
			cancelled: false,
			reject: () => undefined
		};
		this.activeLoad = operation;
		let signal: AbortSignal | undefined;
		try {
			signal = options.signal;
			if (this.activeLoad?.token !== operation.token || operation.cancelled) {
				return Promise.reject(operation.cancellationReason);
			}
			const signalAborted = signal?.aborted ?? false;
			if (this.activeLoad?.token !== operation.token || operation.cancelled) {
				return Promise.reject(operation.cancellationReason);
			}
			if (signalAborted && signal) {
				const reason = this.abortReason(signal, 'startup');
				if (this.activeLoad?.token !== operation.token || operation.cancelled) {
					return Promise.reject(operation.cancellationReason);
				}
				if (this.activeLoad?.token === operation.token) this.activeLoad = null;
				return Promise.reject(reason);
			}
		} catch (error) {
			if (this.activeLoad?.token === operation.token) this.activeLoad = null;
			return Promise.reject(operation.cancelled ? operation.cancellationReason : error);
		}
		let cleanup = () => {
			if (this.activeLoad?.token === operation.token) this.activeLoad = null;
		};
		const loading = new Promise<void>((resolve, reject) => {
			let onAbort: (() => void) | undefined;
			let listenerRegistered = false;
			let cleanedUp = false;
			const ownsLoad = () => this.activeLoad?.token === operation.token;
			cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (ownsLoad()) this.activeLoad = null;
				if (signal && onAbort && listenerRegistered) {
					listenerRegistered = false;
					try {
						signal.removeEventListener('abort', onAbort);
					} catch {
						// Listener cleanup must not replace the startup result.
					}
				}
			};
			const rejectLoad = (reason?: unknown) => {
				if (!ownsLoad()) {
					cleanup();
					return;
				}
				cleanup();
				reject(reason);
			};
			operation.reject = rejectLoad;
			onAbort = signal
				? () => {
						let reason: unknown;
						try {
							reason = this.abortReason(signal, 'startup');
						} catch (error) {
							reason = error;
						}
						rejectLoad(reason);
					}
				: undefined;
			if (signal && onAbort) {
				try {
					listenerRegistered = true;
					signal.addEventListener('abort', onAbort, { once: true });
				} catch (error) {
					rejectLoad(error);
					return;
				}
				if (!ownsLoad()) {
					cleanup();
					return;
				}
				let signalAborted: boolean;
				try {
					signalAborted = signal.aborted;
				} catch (error) {
					rejectLoad(error);
					return;
				}
				if (!ownsLoad()) {
					cleanup();
					return;
				}
				if (signalAborted) onAbort();
			}
			if (!ownsLoad()) return;
			try {
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				let resolverAssets: string | PlaygroundRuntimeAssets = runtimeAssets;
				if (typeof runtimeAssets === 'object') {
					const source = runtimeAssets.octave;
					if (!ownsLoad()) return;
					let octave: PlaygroundRuntimeAssets['octave'];
					if (source) {
						const baseUrl = source.baseUrl;
						if (!ownsLoad()) return;
						const workerUrl = source.workerUrl;
						if (!ownsLoad()) return;
						const manifestUrl = source.manifestUrl;
						if (!ownsLoad()) return;
						octave = { baseUrl, workerUrl, manifestUrl };
					}
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
						octave
					};
				}
				const config = resolveOctaveRuntimeAssetConfig(resolverAssets, currentUrl);
				if (!ownsLoad()) return;
				progress?.set?.(1);
				if (!ownsLoad()) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				this.baseUrl = config.baseUrl;
				this.workerUrl = config.workerUrl;
				this.manifestUrl = config.manifestUrl;
				cleanup();
				resolve();
			} catch (error) {
				rejectLoad(error);
			}
		});
		return loading.finally(() => cleanup());
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.resolveStdinWaiters();
		this.flushPendingInput();
	}

	eof() {
		this.pendingEof = true;
		this.resolveStdinWaiters();
		this.flushPendingInput();
	}

	private resolveStdinWaiters() {
		const waiters = this.stdinWaiters.splice(0);
		for (const resolve of waiters) resolve();
	}

	private readsOctaveStdin(code: string) {
		return /\bstdin\b|\binput\s*\(/.test(code);
	}

	private async collectStdinForRun(code: string, stdinOption: SandboxExecutionOptions['stdin']) {
		if (
			typeof stdinOption !== 'string' &&
			this.pendingInput.length === 0 &&
			!this.pendingEof &&
			this.readsOctaveStdin(code)
		) {
			await new Promise<void>((resolve) => this.stdinWaiters.push(resolve));
		}
		if (typeof stdinOption === 'string') return stdinOption;
		if (!this.readsOctaveStdin(code)) return undefined;
		const stdin = this.pendingInput.join('');
		this.pendingInput = [];
		this.pendingEof = false;
		return stdin;
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

	private createWorker() {
		if (this.worker) {
			this.workerSession.reset();
			this.exit = false;
		}
		const worker = new Worker(this.workerUrl);
		this.worker = worker;
		this.workerSession.attach(worker);
		return worker;
	}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (this.activeLoad || this.activeRun) {
			return Promise.reject(
				new BusyError('Octave runtime already has an active operation', {
					runtimeId: 'OCTAVE',
					phase: this.activeLoad ? 'startup' : 'execute'
				})
			);
		}
		if (prepare) return Promise.resolve(true);
		if (!this.baseUrl || !this.workerUrl || !this.manifestUrl) {
			return Promise.reject('Octave runtime is not configured.');
		}
		const runOperation: OctaveRunOperation = {
			token: Symbol('Octave run'),
			phase: 'execute',
			cancelled: false
		};
		this.activeRun = runOperation;
		const ownsSnapshot = () =>
			this.activeRun?.token === runOperation.token && !runOperation.cancelled;
		let signal: AbortSignal | undefined;
		let programArgs: string[];
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		let stdinOption: SandboxExecutionOptions['stdin'];
		try {
			signal = options.signal;
			if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
			const signalAborted = signal?.aborted ?? false;
			if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
			if (signalAborted && signal) {
				const reason = this.abortReason(signal, 'execute');
				if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
				if (this.activeRun?.token === runOperation.token) this.activeRun = null;
				return Promise.reject(reason);
			}
			const configuredProgramArgs = options.programArgs;
			if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
			const selectedProgramArgs = configuredProgramArgs ?? args;
			programArgs = Array.isArray(selectedProgramArgs) ? [...selectedProgramArgs] : [];
			if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
			const limitOverrides = options.limits;
			if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
			limits = resolveExecutionLimits(limitOverrides);
			if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
			const workspaceFiles = options.workspaceFiles ?? [];
			if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
			const activePath = options.activePath ?? 'main.m';
			if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
			const workspaceLimits = options.workspaceLimits;
			if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
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
			if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
			stdinOption = options.stdin;
			if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
		} catch (error) {
			if (this.activeRun?.token === runOperation.token) this.activeRun = null;
			return Promise.reject(runOperation.cancelled ? runOperation.cancellationReason : error);
		}
		const hasExplicitStdin = stdinOption !== undefined;
		if (hasExplicitStdin) {
			try {
				const buffer = this.buffer;
				if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
				resetBufferedStdin(buffer);
				if (!ownsSnapshot()) return Promise.reject(runOperation.cancellationReason);
				runOperation.stdinBuffer = buffer;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				this.resolveStdinWaiters();
			} catch (error) {
				if (this.activeRun?.token === runOperation.token) {
					this.activeRun = null;
					this.pendingInput = [];
					this.waitingForInput = false;
					this.pendingEof = false;
					this.exit = true;
					this.resolveStdinWaiters();
				}
				return Promise.reject(
					runOperation.cancelled ? runOperation.cancellationReason : error
				);
			}
		}

		const runToken = runOperation.token;
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			let outputBytes = 0;
			let onAbort: (() => void) | undefined;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (timeout !== undefined) {
					const ownedTimeout = timeout;
					timeout = undefined;
					try {
						clearTimeout(ownedTimeout);
					} catch {
						// Timer cleanup must not replace the execution result.
					}
				}
				const ownsRun = this.activeRun?.token === runToken;
				if (ownsRun) {
					this.activeRun = null;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
				}
				if (ownsRun && runOperation.stdinBuffer) {
					this.pendingInput = [];
					this.resolveStdinWaiters();
					try {
						resetBufferedStdin(runOperation.stdinBuffer);
					} catch {
						// Stdin cleanup must not replace the execution result.
					}
				}
				if (signal && onAbort) {
					try {
						signal.removeEventListener('abort', onAbort);
					} catch {
						// Cleanup must not replace the execution result.
					}
				}
			};
			const rejectRun = (reason?: unknown) => {
				cleanup();
				reject(reason);
			};
			const operation = this.workerSession.beginRun(null, rejectRun);
			onAbort = signal
				? () => {
						if (
							this.activeRun?.token !== runToken ||
							runOperation.cancelled ||
							_uid !== this.uid
						) {
							cleanup();
							return;
						}
						let reason: unknown;
						try {
							reason = this.abortReason(signal, 'execute');
						} catch (error) {
							reason = error;
						}
						if (
							this.activeRun?.token !== runToken ||
							runOperation.cancelled ||
							_uid !== this.uid
						) {
							cleanup();
							return;
						}
						this.terminate(reason);
					}
				: undefined;
			if (signal && onAbort) {
				try {
					signal.addEventListener('abort', onAbort, { once: true });
				} catch (error) {
					if (
						this.activeRun?.token === runToken &&
						!runOperation.cancelled &&
						_uid === this.uid
					) {
						this.terminate(error);
					} else {
						cleanup();
					}
				}
			}
			if (this.activeRun?.token !== runToken || runOperation.cancelled || _uid !== this.uid) {
				return;
			}
			if (signal && onAbort) {
				let signalAborted: boolean;
				try {
					signalAborted = signal.aborted;
				} catch (error) {
					if (
						this.activeRun?.token === runToken &&
						!runOperation.cancelled &&
						_uid === this.uid
					) {
						this.terminate(error);
					} else {
						cleanup();
					}
					return;
				}
				if (
					this.activeRun?.token !== runToken ||
					runOperation.cancelled ||
					_uid !== this.uid
				) {
					return;
				}
				if (signalAborted) onAbort();
			}
			if (this.activeRun?.token !== runToken || runOperation.cancelled || _uid !== this.uid) {
				return;
			}
			const timeoutMs = Math.min(
				2_147_483_647,
				limits.assetTimeoutMs +
					limits.startupTimeoutMs +
					limits.compileTimeoutMs +
					limits.runTimeoutMs
			);
			try {
				timeout = setTimeout(() => {
					if (
						this.activeRun?.token !== runToken ||
						runOperation.cancelled ||
						_uid !== this.uid
					) {
						return;
					}
					this.terminate(
						new TimeoutError(`Octave execution timed out after ${timeoutMs} ms`, {
							phase: 'execute',
							runtimeId: 'OCTAVE',
							timeoutMs
						})
					);
				}, timeoutMs);
			} catch (error) {
				if (
					this.activeRun?.token === runToken &&
					!runOperation.cancelled &&
					_uid === this.uid
				) {
					this.terminate(error);
				} else {
					cleanup();
				}
				return;
			}
			this.begin = Date.now();
			this.collectStdinForRun(code, stdinOption)
				.then((stdin) => {
					if (
						this.activeRun?.token !== runToken ||
						runOperation.cancelled ||
						_uid !== this.uid
					) {
						return;
					}
					const worker = this.createWorker();
					let handler: (event: MessageEvent<OctaveWorkerMessage>) => void;
					const ownsRun = () =>
						this.activeRun?.token === runToken &&
						!runOperation.cancelled &&
						this.worker === worker &&
						worker.onmessage === handler &&
						_uid === this.uid;
					const failRun = (error: unknown) => {
						if (!ownsRun()) return;
						this.workerSession.terminate(error);
					};
					handler = (event) => {
						if (!ownsRun()) return;
						try {
							const { output, results, error, buffer, progress } = event.data;
							if (buffer) {
								this.waitingForInput = true;
								this.flushPendingInput();
								if (!ownsRun()) return;
							}
							reportWorkerProgress(_prog, progress);
							if (!ownsRun()) return;
							if (output) {
								const actual =
									outputBytes + OUTPUT_ENCODER.encode(String(output)).byteLength;
								if (actual > limits.maxOutputBytes) {
									failRun(
										new OutputLimitError(
											`Octave output exceeded ${limits.maxOutputBytes} bytes`,
											{
												actual,
												limit: limits.maxOutputBytes,
												phase: 'execute',
												runtimeId: 'OCTAVE'
											}
										)
									);
									return;
								}
								outputBytes = actual;
								this.output?.(output);
							}
							if (!ownsRun()) return;
							if (results) {
								if (worker.onmessage === handler) worker.onmessage = null;
								this.workerSession.complete(operation);
								this.elapse = Date.now() - this.begin;
								cleanup();
								resolve(true);
								return;
							}
							if (error) {
								if (worker.onmessage === handler) worker.onmessage = null;
								this.workerSession.complete(operation);
								this.elapse = Date.now() - this.begin;
								cleanup();
								reject(error);
								return;
							}
						} catch (error) {
							failRun(error);
						}
					};
					worker.onmessage = handler;
					worker.postMessage({
						run: true,
						baseUrl: this.baseUrl,
						manifestUrl: this.manifestUrl,
						buffer: this.buffer,
						code,
						args: programArgs,
						stdin,
						activePath: workspace.activePath,
						workspaceFiles: workspace.workspaceFiles,
						log: _log
					});
				})
				.catch((error) => {
					if (
						this.activeRun?.token !== runToken ||
						runOperation.cancelled ||
						_uid !== this.uid
					) {
						return;
					}
					this.terminate(error);
				});
		});
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const activeLoad = this.activeLoad;
		const activeRun = this.activeRun;
		if (activeLoad) {
			activeLoad.cancelled = true;
			activeLoad.cancellationReason = reason;
		}
		if (activeRun) {
			activeRun.cancelled = true;
			activeRun.cancellationReason = reason;
			if (this.activeRun?.token === activeRun.token) this.activeRun = null;
		}
		if (activeRun?.stdinBuffer) {
			this.pendingInput = [];
			try {
				resetBufferedStdin(activeRun.stdinBuffer);
			} catch {
				// Stdin cleanup must not replace the termination result.
			}
		}
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.resolveStdinWaiters();
		this.exit = true;
		this.workerSession.terminate(reason);
		if (activeLoad) {
			activeLoad.reject(reason);
			if (this.activeLoad?.token === activeLoad.token) this.activeLoad = null;
		}
	}

	async clear() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		this.resolveStdinWaiters();
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		if (!this.exit || this.activeLoad || this.activeRun) {
			this.terminate();
		}
	}
}

export default Octave;
