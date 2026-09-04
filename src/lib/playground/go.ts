import { resolveGoCompilerUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	type DebugCommand,
	type DebugSessionEvent,
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
import { createWasmIdleSharedBuffer, requireSharedArrayBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerInputReady, reportWorkerProgress } from '$lib/playground/workerProgress';
import { BusyError, TimeoutError, resolveExecutionLimits } from '@wasm-idle/core';

const debugBreakpointBufferInts = 1028;

function resolveGoManifestUrl(
	runtimeAssets: string | PlaygroundRuntimeAssets,
	currentUrl: string,
	compilerUrl: string
) {
	const configured =
		typeof runtimeAssets === 'object' ? runtimeAssets.go?.manifestUrl?.trim() : undefined;
	if (configured) {
		return currentUrl ? new URL(configured, currentUrl).href : new URL(configured).href;
	}
	const compiler = currentUrl ? new URL(compilerUrl, currentUrl) : new URL(compilerUrl);
	const manifest = new URL('./runtime/runtime-manifest.v1.json', compiler);
	manifest.search = compiler.search;
	return manifest.href;
}

function compilerRuntimeLimitsKey(limits: ReturnType<typeof resolveExecutionLimits>) {
	return [
		limits.assetTimeoutMs,
		limits.compileTimeoutMs,
		limits.maxAssetBytes,
		limits.maxWasmMemoryBytes
	].join(':');
}

class Go implements Sandbox {
	output: any = null;
	ondebug?: (event: DebugSessionEvent) => void;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	debugBuffer = createWasmIdleSharedBuffer(
		Int32Array.BYTES_PER_ELEMENT * debugBreakpointBufferInts
	);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	compilerUrl = '';
	manifestUrl = '';
	private compilerLimitsKey = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeExplicitStdinCleanup: (() => void) | null = null;
	private activeLoadSignalCleanup: (() => void) | null = null;
	private activeRunSignalCleanup: (() => void) | null = null;
	private readonly workerSession = new WorkerSession({
		label: 'Go',
		onDispose: (worker) => {
			this.activeRunSignalCleanup?.();
			this.activeRunSignalCleanup = null;
			this.activeExplicitStdinCleanup?.();
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
			this.ondebug?.({ type: 'stop' });
		}
	});

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let limits: ReturnType<typeof resolveExecutionLimits>;
		try {
			limits = resolveExecutionLimits(options.limits);
		} catch (error) {
			return Promise.reject(error);
		}
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(
				signal.reason ?? new DOMException('Go runtime startup aborted', 'AbortError')
			);
		}
		let onAbort: (() => void) | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let cleanedUp = false;
		const cleanupSignal = () => {
			if (cleanedUp) return;
			cleanedUp = true;
			if (signal && onAbort) {
				try {
					signal.removeEventListener('abort', onAbort);
				} catch {
					// Cleanup must not replace the startup result.
				}
			}
			if (timeout !== undefined) clearTimeout(timeout);
			if (this.activeLoadSignalCleanup === cleanupSignal) {
				this.activeLoadSignalCleanup = null;
			}
		};
		onAbort = signal
			? () => {
					if (this.activeLoadSignalCleanup !== cleanupSignal) {
						cleanupSignal();
						return;
					}
					const reason =
						signal.reason ??
						new DOMException('Go runtime startup aborted', 'AbortError');
					cleanupSignal();
					this.workerSession.terminate(reason);
				}
			: undefined;
		const loadPromise = this.workerSession.load(async (resolve, reject) => {
			const resolveLoad = () => {
				cleanupSignal();
				resolve();
			};
			const rejectLoad = (reason?: unknown) => {
				cleanupSignal();
				reject(reason);
			};
			try {
				if (this.activeLoadSignalCleanup !== cleanupSignal || signal?.aborted) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const nextCompilerUrl = resolveGoCompilerUrl(runtimeAssets, currentUrl);
				if (!nextCompilerUrl) {
					return rejectLoad(
						'Go runtime is not configured. Set PUBLIC_WASM_GO_COMPILER_URL or runtimeAssets.go.compilerUrl.'
					);
				}
				const nextManifestUrl = resolveGoManifestUrl(
					runtimeAssets,
					currentUrl,
					nextCompilerUrl
				);
				const nextCompilerLimitsKey = compilerRuntimeLimitsKey(limits);
				const needsWorkerReset =
					!this.worker ||
					this.compilerUrl !== nextCompilerUrl ||
					this.manifestUrl !== nextManifestUrl ||
					this.compilerLimitsKey !== nextCompilerLimitsKey;
				this.compilerUrl = nextCompilerUrl;
				this.manifestUrl = nextManifestUrl;
				this.compilerLimitsKey = nextCompilerLimitsKey;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
				}
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/go?worker'))
						.default;
					if (this.activeLoadSignalCleanup !== cleanupSignal || signal?.aborted) return;
					const worker = new WorkerConstructor();
					if (this.activeLoadSignalCleanup !== cleanupSignal || signal?.aborted) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					worker.onmessage = (event: MessageEvent<any>) => {
						if (
							this.activeLoadSignalCleanup !== cleanupSignal ||
							signal?.aborted ||
							this.worker !== worker
						) {
							return;
						}
						if (event.data?.load) {
							progress?.set?.(1);
							resolveLoad();
						}
						if (event.data?.error) rejectLoad(event.data.error);
					};
					worker.postMessage({
						load: true,
						compilerUrl: this.compilerUrl,
						manifestUrl: this.manifestUrl,
						runtimeLimits: limits
					});
				} else {
					progress?.set?.(1);
					if (this.activeLoadSignalCleanup !== cleanupSignal || signal?.aborted) return;
					resolveLoad();
				}
			} catch (error) {
				rejectLoad(error);
			}
		});
		this.activeLoadSignalCleanup = cleanupSignal;
		if (signal && onAbort) {
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		}
		timeout = setTimeout(() => {
			if (this.activeLoadSignalCleanup !== cleanupSignal) return;
			this.workerSession.terminate(
				new TimeoutError(`Go startup timed out after ${limits.startupTimeoutMs} ms`, {
					phase: 'startup',
					runtimeId: 'GO',
					timeoutMs: limits.startupTimeoutMs
				})
			);
		}, limits.startupTimeoutMs);
		return loadPromise.finally(cleanupSignal);
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

	private resetStdinState() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		resetBufferedStdin(this.buffer);
	}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (options.debug) requireSharedArrayBuffer('Go debugging');
		if (!this.exit) {
			const error = new BusyError('Go runtime already has an active execution', {
				runtimeId: 'GO',
				phase: 'execute'
			});
			this.terminate(error);
			return Promise.reject(error);
		}
		let limits: ReturnType<typeof resolveExecutionLimits>;
		try {
			limits = resolveExecutionLimits(options.limits);
		} catch (error) {
			return Promise.reject(error);
		}
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(
				signal.reason ?? new DOMException('Go execution aborted', 'AbortError')
			);
		}
		const worker = this.worker;
		if (!worker) return Promise.reject('Worker not loaded');
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const { programArgs } = resolveSandboxExecutionArgs('GO', args, options);
			const target = options.goTarget || 'wasip1/wasm';
			const _uid = ++this.uid;
			this.setBreakpoints(options.debug ? [...(options.breakpoints || [])] : []);
			const hasExplicitStdin = !options.debug && options.stdin !== undefined;
			this.activeExplicitStdinCleanup?.();
			let explicitStdinCleaned = false;
			const cleanupExplicitStdin = () => {
				if (!hasExplicitStdin || explicitStdinCleaned) return;
				explicitStdinCleaned = true;
				if (this.activeExplicitStdinCleanup === cleanupExplicitStdin) {
					this.activeExplicitStdinCleanup = null;
				}
				this.resetStdinState();
			};
			if (hasExplicitStdin) {
				this.resetStdinState();
				this.activeExplicitStdinCleanup = cleanupExplicitStdin;
			}
			let onAbort: (() => void) | undefined;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			let activePhase: 'compile' | 'execute' = 'compile';
			const armTimeout = (phase: 'compile' | 'execute') => {
				activePhase = phase;
				if (timeout !== undefined) clearTimeout(timeout);
				const timeoutMs =
					phase === 'compile' ? limits.compileTimeoutMs : limits.runTimeoutMs;
				timeout = setTimeout(() => {
					if (
						this.activeRunSignalCleanup !== cleanupSignal ||
						this.worker !== worker ||
						_uid !== this.uid
					) {
						return;
					}
					this.terminate(
						new TimeoutError(`Go ${phase} timed out after ${timeoutMs} ms`, {
							phase,
							runtimeId: 'GO',
							timeoutMs
						})
					);
				}, timeoutMs);
			};
			let signalCleanedUp = false;
			const cleanupSignal = () => {
				if (signalCleanedUp) return;
				signalCleanedUp = true;
				if (signal && onAbort) {
					try {
						signal.removeEventListener('abort', onAbort);
					} catch {
						// Cleanup must not replace the execution result.
					}
				}
				if (timeout !== undefined) clearTimeout(timeout);
				if (this.activeRunSignalCleanup === cleanupSignal) {
					this.activeRunSignalCleanup = null;
				}
			};
			const cleanup = () => {
				cleanupSignal();
				cleanupExplicitStdin();
			};
			const loadSignalCleanup = this.activeLoadSignalCleanup;
			this.activeLoadSignalCleanup = null;
			loadSignalCleanup?.();
			const operation = this.workerSession.beginRun(worker, (reason) => {
				cleanup();
				reject(reason);
			});
			const handler = (event: Event & { data: any }) => {
				if (this.worker !== worker || worker.onmessage !== handler || _uid !== this.uid) {
					cleanup();
					if (worker.onmessage === handler) worker.onmessage = null;
					return;
				}
				const { output, results, error, buffer, diagnostic, progress, debugEvent, phase } =
					event.data;
				if (phase === 'compile' || phase === 'execute') {
					if (phase !== activePhase) armTimeout(phase);
				}
				if (buffer && !hasExplicitStdin) {
					this.waitingForInput = true;
					if (!prepare) reportWorkerInputReady(_prog, 'Go runtime ready for input');
					this.flushPendingInput();
				}
				reportWorkerProgress(_prog, progress);
				if (output) this.output(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (debugEvent) this.ondebug?.(debugEvent);
				if (results) {
					cleanup();
					if (worker.onmessage === handler) worker.onmessage = null;
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					this.ondebug?.({ type: 'stop' });
					resolve(results as string);
				}
				if (error) {
					cleanup();
					if (worker.onmessage === handler) worker.onmessage = null;
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					this.ondebug?.({ type: 'stop' });
					reject(error);
				}
			};
			onAbort = signal
				? () => {
						if (
							this.activeRunSignalCleanup !== cleanupSignal ||
							this.worker !== worker ||
							worker.onmessage !== handler ||
							_uid !== this.uid
						) {
							cleanup();
							return;
						}
						this.terminate(
							signal.reason ?? new DOMException('Go execution aborted', 'AbortError')
						);
					}
				: undefined;
			this.activeRunSignalCleanup = cleanupSignal;
			worker.onmessage = handler;
			armTimeout('compile');
			if (signal && onAbort) {
				signal.addEventListener('abort', onAbort, { once: true });
				if (signal.aborted) onAbort();
			}
			if (this.worker !== worker || worker.onmessage !== handler || _uid !== this.uid) return;
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					debugBuffer: this.debugBuffer,
					stdin: options.stdin,
					args: programArgs,
					target,
					log: _log,
					debug: !!options.debug,
					breakpoints: [...(options.breakpoints || [])],
					pauseOnEntry: !!options.pauseOnEntry,
					runtimeLimits: limits
				});
			} catch (error) {
				cleanup();
				if (worker.onmessage === handler) worker.onmessage = null;
				this.workerSession.complete(operation);
				this.exit = true;
				reject(error);
			}
		});
	}

	debugCommand(command: DebugCommand) {
		const control = new Int32Array(this.debugBuffer);
		Atomics.store(
			control,
			1,
			command === 'stepInto' ? 2 : command === 'nextLine' ? 3 : command === 'stepOut' ? 4 : 1
		);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
		this.ondebug?.({ type: 'resume', command });
	}

	setBreakpoints(lines: number[]) {
		const control = new Int32Array(this.debugBuffer);
		const next = [...new Set(lines.filter((line) => Number.isInteger(line) && line > 0))]
			.sort((left, right) => left - right)
			.slice(0, Math.max(0, control.length - 4));
		for (let index = 4; index < control.length; index += 1) {
			Atomics.store(control, index, next[index - 4] || 0);
		}
		Atomics.store(control, 3, next.length);
		Atomics.add(control, 2, 1);
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const loadSignalCleanup = this.activeLoadSignalCleanup;
		this.activeLoadSignalCleanup = null;
		loadSignalCleanup?.();
		const runSignalCleanup = this.activeRunSignalCleanup;
		this.activeRunSignalCleanup = null;
		runSignalCleanup?.();
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		const control = new Int32Array(this.debugBuffer);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		this.resetStdinState();
		if (this.worker) this.worker.onmessage = null;
		new Int32Array(this.debugBuffer).fill(0);
		if (!this.exit || this.activeLoadSignalCleanup) {
			this.terminate();
		}
	}
}

export default Go;
