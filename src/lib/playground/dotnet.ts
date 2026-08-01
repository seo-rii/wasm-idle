import { resolveDotnetModuleUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';
import { BusyError } from '@wasm-idle/core';

type DotnetSandboxLanguage = 'FSHARP' | 'CSHARP' | 'VBNET';
type DotnetCompileLanguage = 'fsharp' | 'csharp' | 'vbnet';
type DotnetOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	deferCompletion: boolean;
	signal?: AbortSignal;
	onAbort?: () => void;
	abortReject?: (reason: unknown) => void;
};
type DotnetRuntimeModule = {
	createDotnetCompiler: (options?: { loadReferences?: boolean }) => {
		compile(request: {
			code: string;
			language: DotnetCompileLanguage;
			target: 'browser-wasm';
			prepare?: boolean;
			log?: boolean;
			onProgress?: (progress: { percent?: number; stage?: string }) => void;
		}): Promise<{
			success: boolean;
			artifact?: unknown;
			stdout?: string;
			stderr?: string;
			diagnostics?: CompilerDiagnostic[];
			logs?: string[];
		}>;
	};
	executeBrowserDotnetArtifact: (
		artifact: unknown,
		options?: {
			args?: string[];
			env?: Record<string, string>;
			stdin?: string;
			stdout?: (chunk: string) => void;
			stderr?: (chunk: string) => void;
		}
	) => Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
	}>;
};

const readsConsoleStdin = (code: string) => /\b(?:System\.)?Console\.(?:ReadLine|In)\b/.test(code);

class Dotnet implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	runtimeModule: DotnetRuntimeModule | null = null;
	compiler: ReturnType<DotnetRuntimeModule['createDotnetCompiler']> | null = null;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	pendingInput: string[] = [];
	pendingEof = false;
	stdinWaiters: Array<() => void> = [];
	compiledArtifact: unknown = null;
	compiledCacheKey = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	private activeExplicitStdinCleanup: (() => void) | null = null;
	private activeOperation: DotnetOperation | null = null;
	private readonly workerSession = new WorkerSession({
		label: () => this.languageLabel,
		onDispose: (worker) => {
			this.activeExplicitStdinCleanup?.();
			if (this.worker === worker) delete this.worker;
			this.exit = true;
		}
	});

	constructor(private readonly language: DotnetSandboxLanguage = 'FSHARP') {}

	private get compileLanguage(): DotnetCompileLanguage {
		return this.language === 'CSHARP'
			? 'csharp'
			: this.language === 'VBNET'
				? 'vbnet'
				: 'fsharp';
	}

	private get languageLabel() {
		return this.language === 'CSHARP' ? 'C#' : this.language === 'VBNET' ? 'VB.NET' : 'F#';
	}

	private beginOperation(phase: DotnetOperation['phase']) {
		if (this.activeOperation) {
			throw new BusyError(`${this.languageLabel} runtime already has an active operation`, {
				runtimeId: this.language,
				phase: this.activeOperation.phase
			});
		}
		const operation: DotnetOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			deferCompletion: false
		};
		this.activeOperation = operation;
		return operation;
	}

	private completeOperation(operation: DotnetOperation) {
		if (this.activeOperation?.token === operation.token) this.activeOperation = null;
		this.releaseAbortSignal(operation);
		operation.abortReject = undefined;
	}

	private isOperationActive(operation: DotnetOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseAbortSignal(operation: DotnetOperation) {
		const { signal, onAbort } = operation;
		operation.signal = undefined;
		operation.onAbort = undefined;
		if (signal && onAbort) {
			try {
				signal.removeEventListener('abort', onAbort);
			} catch {
				// Listener cleanup must not replace the operation result.
			}
		}
	}

	private abortReason(signal: AbortSignal, phase: DotnetOperation['phase']) {
		if (signal.reason !== undefined) return signal.reason;
		return new DOMException(
			phase === 'startup'
				? `${this.languageLabel} runtime startup aborted`
				: `${this.languageLabel} execution aborted`,
			'AbortError'
		);
	}

	private abortOperation(operation: DotnetOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) {
			this.releaseAbortSignal(operation);
			return;
		}
		const rejectAbort = operation.abortReject;
		operation.abortReject = undefined;
		operation.cancelled = true;
		this.releaseAbortSignal(operation);
		if (!operation.deferCompletion) this.completeOperation(operation);
		this.activeExplicitStdinCleanup?.();
		this.uid += 1;
		this.resolveStdinWaiters();
		this.workerSession.terminate(reason);
		this.exit = true;
		rejectAbort?.(reason);
	}

	private bindAbortSignal(operation: DotnetOperation, signal?: AbortSignal) {
		if (!signal) return;
		const onAbort = () => {
			if (!this.isOperationActive(operation)) {
				this.releaseAbortSignal(operation);
				return;
			}
			this.abortOperation(operation, this.abortReason(signal, operation.phase));
		};
		operation.signal = signal;
		operation.onAbort = onAbort;
		try {
			signal.addEventListener('abort', onAbort, { once: true });
		} catch (error) {
			this.abortOperation(operation, error);
			return;
		}
		if (signal.aborted) onAbort();
	}

	private shouldRunOnMainThread() {
		return (
			typeof window !== 'undefined' &&
			globalThis.crossOriginIsolated === true &&
			typeof SharedArrayBuffer !== 'undefined' &&
			navigator.serviceWorker?.controller != null
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
		const signal = options.signal;
		if (signal?.aborted) {
			return Promise.reject(this.abortReason(signal, 'startup'));
		}
		let operation: DotnetOperation;
		try {
			operation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		const loading = this.workerSession.load(async (resolve, reject) => {
			try {
				if (!this.isOperationActive(operation)) return;
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const nextModuleUrl = resolveDotnetModuleUrl(runtimeAssets, currentUrl);
				if (!nextModuleUrl) {
					return reject(
						`${this.languageLabel} runtime is not configured. Set runtimeAssets.dotnet.moduleUrl or PUBLIC_WASM_DOTNET_MODULE_URL.`
					);
				}
				const needsWorkerReset = !this.worker || this.moduleUrl !== nextModuleUrl;
				const needsRuntimeReset =
					!this.runtimeModule || !this.compiler || this.moduleUrl !== nextModuleUrl;
				if (this.shouldRunOnMainThread()) {
					let runtimeModule = this.runtimeModule;
					let compiler = this.compiler;
					if (needsRuntimeReset) {
						runtimeModule = (await import(
							/* @vite-ignore */ nextModuleUrl
						)) as DotnetRuntimeModule;
						if (!this.isOperationActive(operation)) return;
						if (typeof runtimeModule.createDotnetCompiler !== 'function') {
							return reject('wasm-dotnet module must export createDotnetCompiler');
						}
						if (typeof runtimeModule.executeBrowserDotnetArtifact !== 'function') {
							return reject(
								'wasm-dotnet module must export executeBrowserDotnetArtifact'
							);
						}
						compiler = runtimeModule.createDotnetCompiler();
						if (!this.isOperationActive(operation)) return;
					}
					if (!this.isOperationActive(operation)) return;
					progress?.set?.(1);
					if (!this.isOperationActive(operation)) return;
					if (this.worker) this.workerSession.reset();
					if (!this.isOperationActive(operation)) return;
					this.moduleUrl = nextModuleUrl;
					this.runtimeModule = runtimeModule;
					this.compiler = compiler;
					if (needsRuntimeReset) {
						this.compiledArtifact = null;
						this.compiledCacheKey = '';
					}
					this.completeOperation(operation);
					resolve();
					return;
				}
				if (needsWorkerReset) {
					const WorkerConstructor = (await import('$lib/playground/worker/dotnet?worker'))
						.default;
					if (!this.isOperationActive(operation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(operation)) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					worker.onmessage = (event: MessageEvent<any>) => {
						if (!this.isOperationActive(operation) || this.worker !== worker) return;
						try {
							if (event.data?.load) {
								progress?.set?.(1);
								if (!this.isOperationActive(operation) || this.worker !== worker)
									return;
								this.moduleUrl = nextModuleUrl;
								this.runtimeModule = null;
								this.compiler = null;
								this.compiledArtifact = null;
								this.compiledCacheKey = '';
								this.completeOperation(operation);
								resolve();
								return;
							}
							if (event.data?.error) reject(event.data.error);
						} catch (error) {
							reject(error);
						}
					};
					worker.postMessage({
						load: true,
						moduleUrl: nextModuleUrl
					});
				} else {
					if (!this.isOperationActive(operation)) return;
					progress?.set?.(1);
					if (!this.isOperationActive(operation)) return;
					this.moduleUrl = nextModuleUrl;
					this.runtimeModule = null;
					this.compiler = null;
					this.compiledArtifact = null;
					this.compiledCacheKey = '';
					this.completeOperation(operation);
					resolve();
				}
			} catch (error: any) {
				reject(error?.message || String(error));
			}
		});
		this.bindAbortSignal(operation, signal);
		return loading.finally(() => this.completeOperation(operation));
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.resolveStdinWaiters();
	}

	eof() {
		this.pendingEof = true;
		this.resolveStdinWaiters();
	}

	private resolveStdinWaiters() {
		const waiters = this.stdinWaiters.splice(0);
		for (const resolve of waiters) resolve();
	}

	private resetStdinState() {
		this.pendingInput = [];
		this.pendingEof = false;
		this.resolveStdinWaiters();
	}

	private async collectStdinForRun(
		code: string,
		prepare: boolean,
		options: SandboxExecutionOptions,
		runUid: number
	) {
		const hasExplicitStdin = !prepare && options.stdin !== undefined;
		if (runUid !== this.uid) return '';
		if (
			!prepare &&
			!hasExplicitStdin &&
			this.pendingInput.length === 0 &&
			!this.pendingEof &&
			readsConsoleStdin(code)
		) {
			await new Promise<void>((resolve) => this.stdinWaiters.push(resolve));
		}
		if (runUid !== this.uid) return '';
		if (hasExplicitStdin) return options.stdin as string;
		const stdin = `${options.stdin ?? ''}${this.pendingInput.join('')}`;
		if (!prepare) {
			this.pendingInput = [];
			this.pendingEof = false;
		}
		return stdin;
	}

	async run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const signal = options.signal;
		if (signal?.aborted) throw this.abortReason(signal, 'execute');
		const operation = this.beginOperation('execute');
		let completionDeferred = false;
		try {
			if (options.stdin !== undefined && typeof options.stdin !== 'string') {
				throw new TypeError(`${this.languageLabel} stdin must be a string`);
			}
			if (this.runtimeModule && this.compiler) {
				operation.deferCompletion = true;
				let abortPromise: Promise<never> | undefined;
				if (signal) {
					abortPromise = new Promise<never>((_resolve, reject) => {
						operation.abortReject = reject;
					});
				}
				this.bindAbortSignal(operation, signal);
				if (!this.isOperationActive(operation)) {
					operation.deferCompletion = false;
					this.completeOperation(operation);
					return await abortPromise!;
				}
				const execution = this.runOnMainThread(
					operation,
					code,
					prepare,
					_log,
					_prog,
					args,
					options
				).finally(() => this.completeOperation(operation));
				completionDeferred = true;
				return abortPromise
					? await Promise.race<boolean | string>([abortPromise, execution])
					: await execution;
			}
			if (!this.worker) throw 'Worker not loaded';
			const worker = this.worker;
			const { programArgs } = resolveSandboxExecutionArgs(this.language, args, options);
			this.exit = false;
			return await new Promise<boolean | string>((resolve, reject) => {
				const _uid = ++this.uid;
				const workerOperation = this.workerSession.beginRun(worker, reject);
				const hasExplicitStdin = !prepare && options.stdin !== undefined;
				this.activeExplicitStdinCleanup?.();
				let explicitStdinCleaned = false;
				const cleanupExplicitStdin = () => {
					if (!hasExplicitStdin || explicitStdinCleaned) return;
					explicitStdinCleaned = true;
					if (this.activeExplicitStdinCleanup !== cleanupExplicitStdin) return;
					this.activeExplicitStdinCleanup = null;
					this.resetStdinState();
				};
				if (hasExplicitStdin) {
					this.resetStdinState();
					this.activeExplicitStdinCleanup = cleanupExplicitStdin;
				}
				let handler: (event: Event & { data: any }) => void;
				const ownsRun = () =>
					this.isOperationActive(operation) &&
					this.worker === worker &&
					worker.onmessage === handler &&
					_uid === this.uid;
				const failRun = (error: unknown, disposeWorker = false) => {
					if (!ownsRun()) return;
					cleanupExplicitStdin();
					if (worker.onmessage === handler) worker.onmessage = null;
					this.workerSession.complete(workerOperation);
					if (disposeWorker && this.worker === worker) this.workerSession.reset();
					this.exit = true;
					this.completeOperation(operation);
					reject(error);
				};
				handler = (event: Event & { data: any }) => {
					if (!ownsRun()) return;
					try {
						const { output, results, error, diagnostic, progress } = event.data;
						reportWorkerProgress(_prog, progress);
						if (!ownsRun()) return;
						if (output) this.output?.(output);
						if (!ownsRun()) return;
						if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
						if (!ownsRun()) return;
						if (results) {
							cleanupExplicitStdin();
							if (worker.onmessage === handler) worker.onmessage = null;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.workerSession.complete(workerOperation);
							this.completeOperation(operation);
							resolve(results as string);
							return;
						}
						if (error) {
							this.elapse = Date.now() - this.begin;
							failRun(error);
						}
					} catch (error) {
						failRun(error, true);
					}
				};
				worker.onmessage = handler;
				this.bindAbortSignal(operation, signal);
				if (!ownsRun()) return;
				this.begin = Date.now();
				this.collectStdinForRun(code, prepare, options, _uid)
					.then((stdin) => {
						if (!ownsRun()) return;
						worker.postMessage({
							code,
							language: this.compileLanguage,
							prepare,
							args: programArgs,
							stdin,
							log: _log
						});
					})
					.catch((error) => {
						failRun(error);
					});
			});
		} finally {
			if (!completionDeferred) this.completeOperation(operation);
		}
	}

	private async runOnMainThread(
		operation: DotnetOperation,
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (!this.runtimeModule || !this.compiler) throw new Error('Runtime not loaded');
		const { programArgs } = resolveSandboxExecutionArgs(this.language, args, options);
		this.exit = false;
		this.begin = Date.now();
		const _uid = ++this.uid;
		const hasExplicitStdin = !prepare && options.stdin !== undefined;
		this.activeExplicitStdinCleanup?.();
		let explicitStdinCleaned = false;
		const cleanupExplicitStdin = () => {
			if (!hasExplicitStdin || explicitStdinCleaned) return;
			explicitStdinCleaned = true;
			if (this.activeExplicitStdinCleanup !== cleanupExplicitStdin) return;
			this.activeExplicitStdinCleanup = null;
			this.resetStdinState();
		};
		if (hasExplicitStdin) {
			this.resetStdinState();
			this.activeExplicitStdinCleanup = cleanupExplicitStdin;
		}
		try {
			const compileCacheKey = `${this.compileLanguage}\n${code}`;
			if (!this.compiledArtifact || this.compiledCacheKey !== compileCacheKey) {
				const result = await this.compiler.compile({
					code,
					language: this.compileLanguage,
					target: 'browser-wasm',
					prepare,
					log: _log,
					onProgress: (progress) => {
						if (this.isOperationActive(operation) && _uid === this.uid) {
							reportWorkerProgress(_prog, progress);
						}
					}
				});
				if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
				for (const diagnostic of result.diagnostics || []) {
					if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
					this.oncompilerdiagnostic?.(diagnostic);
				}
				for (const line of result.logs || []) {
					if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
					this.output?.(line.endsWith('\n') ? line : `${line}\n`);
				}
				if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
				if (result.stdout) this.output?.(result.stdout);
				if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
				if (!result.success || !result.artifact) {
					throw new Error(
						result.stderr ||
							result.diagnostics
								?.map((diagnostic) => diagnostic.message)
								.join('\n') ||
							`${this.languageLabel} compilation failed`
					);
				}
				if (result.stderr) this.output?.(result.stderr);
				if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
				this.compiledArtifact = result.artifact;
				this.compiledCacheKey = compileCacheKey;
			}
			if (prepare) return true;

			const stdin = await this.collectStdinForRun(code, prepare, options, _uid);
			if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
			const execution = await this.runtimeModule.executeBrowserDotnetArtifact(
				this.compiledArtifact,
				{
					args: programArgs,
					env: {
						USER: 'jungol'
					},
					stdin,
					stdout: (output) => {
						if (output && this.isOperationActive(operation) && _uid === this.uid) {
							this.output?.(output);
						}
					},
					stderr: (output) => {
						if (output && this.isOperationActive(operation) && _uid === this.uid) {
							this.output?.(output);
						}
					}
				}
			);
			if (!this.isOperationActive(operation) || _uid !== this.uid) return false;
			if (execution.exitCode !== 0) {
				throw new Error(
					`${this.languageLabel} program exited with code ${execution.exitCode}`
				);
			}
			return true;
		} finally {
			cleanupExplicitStdin();
			if (this.isOperationActive(operation) && _uid === this.uid) {
				this.elapse = Date.now() - this.begin;
				this.exit = true;
			}
		}
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const operation = this.activeOperation;
		if (operation) {
			operation.cancelled = true;
			operation.abortReject = undefined;
			this.releaseAbortSignal(operation);
			if (!operation.deferCompletion) this.completeOperation(operation);
		}
		this.activeExplicitStdinCleanup?.();
		this.uid += 1;
		this.resolveStdinWaiters();
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		if (this.worker) this.worker.onmessage = null;
		this.resetStdinState();
		if (this.activeOperation) {
			this.terminate();
		}
	}
}

export default Dotnet;
