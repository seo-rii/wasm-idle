import {
	resolveElixirBundleUrl,
	resolveErlangBundleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { snapshotElixirRuntimeAssetReceipts } from '$lib/playground/elixirAssets';
import type { SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	BusyError,
	CancelledError,
	DEFAULT_WORKSPACE_LIMITS,
	OutputLimitError,
	RuntimeConfigurationError,
	TimeoutError,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';
import { WASM_ELIXIR_ASSET_RECEIPTS } from '$lib/playground/wasmElixirVersion';

type BeamEvalLanguage = 'ELIXIR' | 'ERLANG';

const OUTPUT_ENCODER = new TextEncoder();
const MAX_TIMER_DELAY_MS = 2_147_483_647;

class Elixir implements Sandbox {
	language: BeamEvalLanguage;
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	bundleUrl = '';
	bundleIdentity = '';
	prepared = false;
	hasExecuted = false;
	waitingForInput = false;
	pendingEof = false;
	private activeLoadCleanup: (() => void) | null = null;
	private activeRunCleanup: (() => void) | null = null;
	private disposed = false;
	private disposePromise: Promise<void> | null = null;
	private readonly disposeCancellation: CancelledError;
	private readonly workerSession = new WorkerSession({
		label: () => (this.language === 'ERLANG' ? 'Erlang' : 'Elixir'),
		onDispose: (worker) => {
			if (this.worker !== worker) return;
			delete this.worker;
			this.bundleIdentity = '';
			this.exit = true;
			this.prepared = false;
			this.hasExecuted = false;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	constructor(language: BeamEvalLanguage = 'ELIXIR') {
		this.language = language;
		const runtimeLabel = language === 'ERLANG' ? 'Erlang' : 'Elixir';
		this.disposeCancellation = new CancelledError(`${runtimeLabel} sandbox disposed`, {
			phase: 'dispose',
			runtimeId: language,
			recoverable: false
		});
	}

	private disposedConfigurationError() {
		const runtimeLabel = this.language === 'ERLANG' ? 'Erlang' : 'Elixir';
		return new RuntimeConfigurationError(`${runtimeLabel} sandbox is disposed`, {
			phase: 'dispose',
			runtimeId: this.language
		});
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		const runtimeLabel = this.language === 'ERLANG' ? 'Erlang' : 'Elixir';
		if (this.disposed) return Promise.reject(this.disposedConfigurationError());
		const signal = options.signal;
		if (this.disposed) return Promise.reject(this.disposedConfigurationError());
		if (signal?.aborted) {
			return Promise.reject(
				signal.reason ??
					new DOMException(`${runtimeLabel} runtime startup aborted`, 'AbortError')
			);
		}
		if (this.activeLoadCleanup || this.activeRunCleanup) {
			return Promise.reject(
				new BusyError(`${runtimeLabel} runtime already has an active operation`, {
					runtimeId: this.language,
					phase: this.activeLoadCleanup ? 'startup' : 'execute'
				})
			);
		}
		const activeUid = ++this.uid;
		let onAbort: (() => void) | undefined;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		let cleanedUp = false;
		const cleanup = () => {
			if (cleanedUp) return;
			cleanedUp = true;
			if (this.activeLoadCleanup === cleanup) this.activeLoadCleanup = null;
			if (deadline !== undefined) {
				try {
					clearTimeout(deadline);
				} catch {
					// Timer cleanup must not replace the startup result.
				}
				deadline = undefined;
			}
			if (signal && onAbort) {
				try {
					signal.removeEventListener('abort', onAbort);
				} catch {
					// Cleanup must not replace the startup result.
				}
			}
		};
		onAbort = signal
			? () => {
					if (this.activeLoadCleanup !== cleanup || activeUid !== this.uid) {
						cleanup();
						return;
					}
					const reason =
						signal.reason ??
						new DOMException(`${runtimeLabel} runtime startup aborted`, 'AbortError');
					this.terminate(reason);
				}
			: undefined;
		this.activeLoadCleanup = cleanup;
		const loadPromise = this.workerSession.load(async (resolve, reject) => {
			const resolveLoad = () => {
				if (
					this.activeLoadCleanup !== cleanup ||
					activeUid !== this.uid ||
					signal?.aborted
				) {
					return;
				}
				resolve();
				cleanup();
			};
			const rejectLoad = (reason?: unknown) => {
				if (this.activeLoadCleanup !== cleanup || activeUid !== this.uid) return;
				reject(reason);
				cleanup();
			};
			try {
				if (this.activeLoadCleanup !== cleanup || activeUid !== this.uid) return;
				const limits = resolveExecutionLimits(options.limits);
				if (this.activeLoadCleanup !== cleanup || activeUid !== this.uid) return;
				const timeoutMs = Math.min(
					MAX_TIMER_DELAY_MS,
					limits.assetTimeoutMs + limits.startupTimeoutMs
				);
				let scheduledDeadline: ReturnType<typeof setTimeout>;
				try {
					scheduledDeadline = setTimeout(() => {
						if (this.activeLoadCleanup !== cleanup || activeUid !== this.uid) return;
						this.terminate(
							new TimeoutError(
								`${runtimeLabel} startup timed out after ${timeoutMs} ms`,
								{
									phase: 'startup',
									runtimeId: this.language,
									timeoutMs
								}
							)
						);
					}, timeoutMs);
				} catch (error) {
					rejectLoad(error);
					return;
				}
				if (cleanedUp) {
					try {
						clearTimeout(scheduledDeadline);
					} catch {
						// A synchronously settled timer is already detached.
					}
					return;
				}
				deadline = scheduledDeadline;
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const nextBundleUrl =
					this.language === 'ERLANG'
						? resolveErlangBundleUrl(runtimeAssets, currentUrl)
						: resolveElixirBundleUrl(runtimeAssets, currentUrl);
				if (
					this.activeLoadCleanup !== cleanup ||
					activeUid !== this.uid ||
					signal?.aborted
				) {
					return;
				}
				if (!nextBundleUrl) {
					return rejectLoad(
						`${runtimeLabel} runtime is not configured. Set ${
							this.language === 'ERLANG'
								? 'PUBLIC_WASM_ERLANG_BUNDLE_URL or runtimeAssets.erlang.bundleUrl'
								: 'PUBLIC_WASM_ELIXIR_BUNDLE_URL or runtimeAssets.elixir.bundleUrl'
						}.`
					);
				}
				const configuredReceipts =
					typeof runtimeAssets === 'object'
						? this.language === 'ERLANG'
							? runtimeAssets.erlang?.integrity || runtimeAssets.elixir?.integrity
							: runtimeAssets.elixir?.integrity
						: undefined;
				if (
					this.activeLoadCleanup !== cleanup ||
					activeUid !== this.uid ||
					signal?.aborted
				) {
					return;
				}
				const assetReceipts = snapshotElixirRuntimeAssetReceipts(
					configuredReceipts || WASM_ELIXIR_ASSET_RECEIPTS
				);
				if (
					this.activeLoadCleanup !== cleanup ||
					activeUid !== this.uid ||
					signal?.aborted
				) {
					return;
				}
				const nextBundleIdentity = JSON.stringify([nextBundleUrl, assetReceipts]);
				if (
					this.activeLoadCleanup !== cleanup ||
					activeUid !== this.uid ||
					signal?.aborted
				) {
					return;
				}

				const needsWorkerReset = !this.worker || this.bundleIdentity !== nextBundleIdentity;
				const preservePendingInput = this.prepared && !needsWorkerReset;
				if (!preservePendingInput) {
					this.pendingInput = [];
					this.pendingEof = false;
				}
				this.waitingForInput = false;
				this.bundleUrl = nextBundleUrl;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
					if (
						this.activeLoadCleanup !== cleanup ||
						activeUid !== this.uid ||
						signal?.aborted
					) {
						return;
					}
				}
				this.bundleIdentity = nextBundleIdentity;
				if (!this.worker) {
					progress?.set?.(0.2);
					if (
						this.activeLoadCleanup !== cleanup ||
						activeUid !== this.uid ||
						signal?.aborted
					) {
						return;
					}
					const WorkerConstructor = (await import('$lib/playground/worker/elixir?worker'))
						.default;
					if (
						this.activeLoadCleanup !== cleanup ||
						activeUid !== this.uid ||
						signal?.aborted
					) {
						return;
					}
					const worker = new WorkerConstructor();
					if (
						this.activeLoadCleanup !== cleanup ||
						activeUid !== this.uid ||
						signal?.aborted
					) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					progress?.set?.(0.5);
					if (
						this.activeLoadCleanup !== cleanup ||
						activeUid !== this.uid ||
						signal?.aborted ||
						this.worker !== worker
					) {
						return;
					}
					const handler = (event: MessageEvent<any>) => {
						if (
							this.worker !== worker ||
							worker.onmessage !== handler ||
							this.activeLoadCleanup !== cleanup ||
							activeUid !== this.uid ||
							signal?.aborted
						) {
							return;
						}
						try {
							if (event.data?.load) {
								progress?.set?.(1);
								resolveLoad();
							}
							if (event.data?.error) rejectLoad(event.data.error);
						} catch (error) {
							rejectLoad(error);
						}
					};
					worker.onmessage = handler;
					worker.postMessage({
						load: true,
						bundleUrl: this.bundleUrl,
						assetReceipts,
						log
					});
				} else {
					const worker = this.worker;
					progress?.set?.(1);
					if (
						this.activeLoadCleanup !== cleanup ||
						activeUid !== this.uid ||
						signal?.aborted ||
						this.worker !== worker
					) {
						return;
					}
					resolveLoad();
				}
			} catch (error) {
				rejectLoad(error);
			}
		});
		if (signal && onAbort) {
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		}
		return loadPromise.finally(cleanup);
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

	run(
		code: string,
		prepare: boolean,
		log = true,
		_prog?: SandboxProgress,
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const runtimeLabel = this.language === 'ERLANG' ? 'Erlang' : 'Elixir';
		if (this.disposed) return Promise.reject(this.disposedConfigurationError());
		if (this.activeLoadCleanup || this.activeRunCleanup) {
			return Promise.reject(
				new BusyError(`${runtimeLabel} runtime already has an active operation`, {
					runtimeId: this.language,
					phase: this.activeLoadCleanup ? 'startup' : 'execute'
				})
			);
		}
		const worker = this.worker;
		if (!worker) return Promise.reject('Worker not loaded');
		return new Promise<boolean | string>((resolve, reject) => {
			let activeUid = this.uid;
			let outputBytes = 0;
			let limits: ReturnType<typeof resolveExecutionLimits>;
			let signal: AbortSignal | undefined;
			let stdin: string | undefined;
			let hasExplicitStdin = false;
			let onAbort: (() => void) | undefined;
			let deadline: ReturnType<typeof setTimeout> | undefined;
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (this.activeRunCleanup === cleanup) this.activeRunCleanup = null;
				if (deadline !== undefined) {
					try {
						clearTimeout(deadline);
					} catch {
						// Timer cleanup must not replace the execution result.
					}
					deadline = undefined;
				}
				if (hasExplicitStdin) this.resetExplicitStdinState();
				if (signal && onAbort) {
					try {
						signal.removeEventListener('abort', onAbort);
					} catch {
						// Cleanup must not replace the execution result.
					}
				}
			};
			const rejectRun = (reason?: unknown) => {
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				cleanup();
				reject(reason);
			};
			this.activeRunCleanup = cleanup;
			const operation = this.workerSession.beginRun(worker, rejectRun);
			let handler: (event: Event & { data: any }) => void;
			const ownsReservation = () =>
				this.worker === worker &&
				this.activeRunCleanup === cleanup &&
				activeUid === this.uid;
			const failBeforeDispatch = (reason: unknown) => {
				if (!ownsReservation() || !this.workerSession.complete(operation)) return;
				cleanup();
				reject(reason);
			};
			try {
				signal = options.signal;
				if (!ownsReservation()) return;
				const signalAborted = signal?.aborted ?? false;
				if (!ownsReservation()) return;
				if (signalAborted) {
					const reason =
						signal?.reason ??
						new DOMException(`${runtimeLabel} execution aborted`, 'AbortError');
					if (ownsReservation()) failBeforeDispatch(reason);
					return;
				}
				limits = resolveExecutionLimits(options.limits);
				if (!ownsReservation()) return;
				const workspaceFiles = options.workspaceFiles ?? [];
				if (!ownsReservation()) return;
				const activePath =
					options.activePath ?? (this.language === 'ERLANG' ? 'main.erl' : 'main.exs');
				if (!ownsReservation()) return;
				const workspaceLimits = options.workspaceLimits;
				if (!ownsReservation()) return;
				const maxFiles = workspaceLimits?.maxFiles;
				if (!ownsReservation()) return;
				const maxFileBytes = workspaceLimits?.maxFileBytes;
				if (!ownsReservation()) return;
				const maxTotalBytes = workspaceLimits?.maxTotalBytes;
				if (!ownsReservation()) return;
				const maxPathBytes = workspaceLimits?.maxPathBytes;
				if (!ownsReservation()) return;
				const caseSensitive = workspaceLimits?.caseSensitive;
				if (!ownsReservation()) return;
				const workspace = validateExecutionWorkspace(code, workspaceFiles, activePath, {
					maxFiles,
					maxFileBytes: Math.min(
						maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
						limits.maxWorkspaceBytes
					),
					maxTotalBytes: Math.min(
						maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
						limits.maxWorkspaceBytes
					),
					maxPathBytes,
					caseSensitive
				});
				if (!ownsReservation()) return;
				if (workspace.workspaceFiles.length > 0) {
					throw new RuntimeConfigurationError(
						`${runtimeLabel} runtime does not support auxiliary workspace files`,
						{ phase: 'execute', runtimeId: this.language }
					);
				}
				stdin = options.stdin;
				if (!ownsReservation()) return;
				hasExplicitStdin = !prepare && stdin !== undefined;
			} catch (error) {
				failBeforeDispatch(error);
				return;
			}
			activeUid = ++this.uid;
			if (hasExplicitStdin) this.resetExplicitStdinState();
			this.exit = false;
			const ownsRun = () => ownsReservation();
			const acceptsMessage = () => ownsRun() && worker.onmessage === handler;
			const failRun = (reason?: unknown) => {
				if (!acceptsMessage()) return;
				this.workerSession.terminate(reason);
			};
			handler = (event: Event & { data: any }) => {
				if (!acceptsMessage()) {
					return;
				}
				try {
					const { output, error, buffer, progress } = event.data;
					const hasResults = Object.prototype.hasOwnProperty.call(
						event.data || {},
						'results'
					);
					const results = hasResults ? event.data.results : undefined;
					if (buffer && !hasExplicitStdin) {
						if (!prepare) {
							_prog?.report?.({
								kind: 'ready',
								state: 'waiting-input',
								reason: 'stdin-request',
								label: `${runtimeLabel} program is waiting for input`
							});
						}
						this.waitingForInput = true;
						this.flushPendingInput();
					}
					reportWorkerProgress(_prog, progress);
					if (!acceptsMessage()) return;
					const emissions: unknown[] = [];
					if (output) emissions.push(output);
					if (!prepare && typeof results === 'string' && results) {
						emissions.push(`=> ${results}\n`);
					}
					for (const emission of emissions) {
						const actual =
							outputBytes + OUTPUT_ENCODER.encode(String(emission)).byteLength;
						if (actual > limits.maxOutputBytes) {
							failRun(
								new OutputLimitError(
									`${runtimeLabel} output exceeded ${limits.maxOutputBytes} bytes`,
									{
										actual,
										limit: limits.maxOutputBytes,
										phase: 'execute',
										runtimeId: this.language
									}
								)
							);
							return;
						}
						outputBytes = actual;
						this.output?.(emission);
						if (!acceptsMessage()) return;
					}
					if (hasResults) {
						if (!this.workerSession.complete(operation)) return;
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.waitingForInput = false;
						this.pendingEof = false;
						this.prepared = prepare;
						this.hasExecuted = !prepare;
						cleanup();
						resolve(results || true);
						return;
					}
					if (error) {
						if (!this.workerSession.complete(operation)) return;
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.waitingForInput = false;
						this.pendingEof = false;
						this.prepared = false;
						this.hasExecuted = false;
						cleanup();
						reject(error);
						return;
					}
				} catch (error) {
					failRun(error);
				}
			};
			onAbort = signal
				? () => {
						if (
							this.activeRunCleanup !== cleanup ||
							this.worker !== worker ||
							worker.onmessage !== handler ||
							activeUid !== this.uid
						) {
							cleanup();
							return;
						}
						this.terminate(
							signal.reason ??
								new DOMException(`${runtimeLabel} execution aborted`, 'AbortError')
						);
					}
				: undefined;
			worker.onmessage = handler;
			if (signal && onAbort) {
				signal.addEventListener('abort', onAbort, { once: true });
				if (signal.aborted) onAbort();
			}
			if (
				this.activeRunCleanup !== cleanup ||
				this.worker !== worker ||
				worker.onmessage !== handler ||
				activeUid !== this.uid
			) {
				return;
			}
			const timeoutMs = Math.min(
				MAX_TIMER_DELAY_MS,
				limits.compileTimeoutMs + limits.runTimeoutMs
			);
			let scheduledDeadline: ReturnType<typeof setTimeout>;
			try {
				scheduledDeadline = setTimeout(() => {
					if (!acceptsMessage()) return;
					failRun(
						new TimeoutError(
							`${runtimeLabel} execution timed out after ${timeoutMs} ms`,
							{
								phase: 'execute',
								runtimeId: this.language,
								timeoutMs
							}
						)
					);
				}, timeoutMs);
			} catch (error) {
				failRun(error);
				return;
			}
			if (cleanedUp || !acceptsMessage()) {
				try {
					clearTimeout(scheduledDeadline);
				} catch {
					// A synchronously settled timer is already detached.
				}
				return;
			}
			deadline = scheduledDeadline;
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					language: this.language,
					log,
					stdin
				});
			} catch (error) {
				if (worker.onmessage === handler) worker.onmessage = null;
				this.workerSession.terminate(error);
			}
		});
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		if (this.disposed) return;
		const loadCleanup = this.activeLoadCleanup;
		this.activeLoadCleanup = null;
		const runCleanup = this.activeRunCleanup;
		this.activeRunCleanup = null;
		this.uid += 1;
		this.prepared = false;
		this.hasExecuted = false;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.exit = true;
		this.workerSession.terminate(reason);
		loadCleanup?.();
		runCleanup?.();
	}

	async clear() {
		if (this.disposed) return;
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		if (this.worker) {
			this.worker.onmessage = null;
		}
		resetBufferedStdin(this.buffer);
		if (!this.exit || this.hasExecuted || this.activeLoadCleanup || this.activeRunCleanup) {
			this.terminate();
		}
	}

	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.disposePromise = Promise.resolve();

		const loadCleanup = this.activeLoadCleanup;
		const runCleanup = this.activeRunCleanup;
		this.activeLoadCleanup = null;
		this.activeRunCleanup = null;
		this.uid += 1;
		delete this.worker;
		this.bundleUrl = '';
		this.bundleIdentity = '';
		this.output = null;
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
		this.prepared = false;
		this.hasExecuted = false;
		this.exit = true;
		try {
			resetBufferedStdin(this.buffer);
		} catch {
			// Terminal cleanup is best effort after host state becomes unreachable.
		}
		this.workerSession.terminate(this.disposeCancellation);
		loadCleanup?.();
		runCleanup?.();
		return this.disposePromise;
	}
}

export default Elixir;
