import {
	resolveElixirBundleUrl,
	resolveErlangBundleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import type { SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import { BusyError } from '@wasm-idle/core';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';

type BeamEvalLanguage = 'ELIXIR' | 'ERLANG';

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
	prepared = false;
	hasExecuted = false;
	waitingForInput = false;
	pendingEof = false;
	private activeLoadCleanup: (() => void) | null = null;
	private activeRunCleanup: (() => void) | null = null;
	private readonly workerSession = new WorkerSession({
		label: () => (this.language === 'ERLANG' ? 'Erlang' : 'Elixir'),
		onDispose: (worker) => {
			this.activeRunCleanup?.();
			this.activeRunCleanup = null;
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.prepared = false;
			this.hasExecuted = false;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	constructor(language: BeamEvalLanguage = 'ELIXIR') {
		this.language = language;
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		const signal = options.signal;
		const runtimeLabel = this.language === 'ERLANG' ? 'Erlang' : 'Elixir';
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
					cleanup();
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
				cleanup();
				resolve();
			};
			const rejectLoad = (reason?: unknown) => {
				if (this.activeLoadCleanup !== cleanup || activeUid !== this.uid) return;
				cleanup();
				reject(reason);
			};
			try {
				if (this.activeLoadCleanup !== cleanup || activeUid !== this.uid) return;
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const nextBundleUrl =
					this.language === 'ERLANG'
						? resolveErlangBundleUrl(runtimeAssets, currentUrl)
						: resolveElixirBundleUrl(runtimeAssets, currentUrl);
				if (!nextBundleUrl) {
					return rejectLoad(
						`${runtimeLabel} runtime is not configured. Set ${
							this.language === 'ERLANG'
								? 'PUBLIC_WASM_ERLANG_BUNDLE_URL or runtimeAssets.erlang.bundleUrl'
								: 'PUBLIC_WASM_ELIXIR_BUNDLE_URL or runtimeAssets.elixir.bundleUrl'
						}.`
					);
				}

				const needsWorkerReset = !this.worker || this.bundleUrl !== nextBundleUrl;
				const preservePendingInput = this.prepared && !needsWorkerReset;
				if (!preservePendingInput) {
					this.pendingInput = [];
					this.pendingEof = false;
				}
				this.waitingForInput = false;
				this.bundleUrl = nextBundleUrl;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
				}
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
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(
				signal.reason ?? new DOMException(`${runtimeLabel} execution aborted`, 'AbortError')
			);
		}
		const hasExplicitStdin = !prepare && options.stdin !== undefined;
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const activeUid = ++this.uid;
			let onAbort: (() => void) | undefined;
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (signal && onAbort) {
					try {
						signal.removeEventListener('abort', onAbort);
					} catch {
						// Cleanup must not replace the execution result.
					}
				}
				if (hasExplicitStdin) this.resetExplicitStdinState();
				if (this.activeRunCleanup === cleanup) this.activeRunCleanup = null;
			};
			const rejectRun = (reason?: unknown) => {
				cleanup();
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				reject(reason);
			};
			this.activeRunCleanup = cleanup;
			if (hasExplicitStdin) this.resetExplicitStdinState();
			const operation = this.workerSession.beginRun(worker, rejectRun);
			let handler: (event: Event & { data: any }) => void;
			const ownsRun = () =>
				this.worker === worker &&
				this.activeRunCleanup === cleanup &&
				activeUid === this.uid;
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
					const { output, error, buffer } = event.data;
					const hasResults = Object.prototype.hasOwnProperty.call(
						event.data || {},
						'results'
					);
					if (buffer && !hasExplicitStdin) {
						this.waitingForInput = true;
						this.flushPendingInput();
					}
					if (output) {
						this.output?.(output);
					}
					if (!acceptsMessage()) return;
					if (hasResults) {
						const { results } = event.data;
						if (!prepare && typeof results === 'string' && results) {
							this.output?.(`=> ${results}\n`);
							if (!acceptsMessage()) return;
						}
						if (!this.workerSession.complete(operation)) return;
						cleanup();
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.waitingForInput = false;
						this.pendingEof = false;
						this.prepared = prepare;
						this.hasExecuted = !prepare;
						resolve(results || true);
						return;
					}
					if (error) {
						if (!this.workerSession.complete(operation)) return;
						cleanup();
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.waitingForInput = false;
						this.pendingEof = false;
						this.prepared = false;
						this.hasExecuted = false;
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
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					language: this.language,
					log,
					stdin: options.stdin
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
		const loadCleanup = this.activeLoadCleanup;
		this.activeLoadCleanup = null;
		loadCleanup?.();
		const runCleanup = this.activeRunCleanup;
		this.activeRunCleanup = null;
		runCleanup?.();
		this.uid += 1;
		this.prepared = false;
		this.hasExecuted = false;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
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
}

export default Elixir;
