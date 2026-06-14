import { resolveDotnetModuleUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';

type DotnetSandboxLanguage = 'FSHARP' | 'CSHARP' | 'VBNET';
type DotnetCompileLanguage = 'fsharp' | 'csharp' | 'vbnet';
type DotnetRuntimeModule = {
	createDotnetCompiler: () => {
		compile(request: {
			code: string;
			language: DotnetCompileLanguage;
			target: 'browser-wasm';
			prepare?: boolean;
			log?: boolean;
			onProgress?: (progress: { percent?: number }) => void;
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
	activeReject: ((reason: string) => void) | null = null;
	pendingInput: string[] = [];
	pendingEof = false;
	stdinWaiters: Array<() => void> = [];
	compiledArtifact: unknown = null;
	compiledCacheKey = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;

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

	private shouldRunOnMainThread() {
		return (
			typeof globalThis.crossOriginIsolated === 'boolean' &&
			globalThis.crossOriginIsolated &&
			typeof globalThis.SharedArrayBuffer === 'function'
		);
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		return new Promise<void>(async (resolve, reject) => {
			try {
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const nextModuleUrl = resolveDotnetModuleUrl(runtimeAssets, currentUrl);
				if (!nextModuleUrl) {
					return reject(
						`${this.languageLabel} runtime is not configured. Set runtimeAssets.dotnet.moduleUrl or PUBLIC_WASM_DOTNET_MODULE_URL.`
					);
				}
				const needsWorkerReset = !this.worker || this.moduleUrl !== nextModuleUrl;
				const needsRuntimeReset = !this.runtimeModule || this.moduleUrl !== nextModuleUrl;
				this.moduleUrl = nextModuleUrl;
				if (this.shouldRunOnMainThread()) {
					if (this.worker) {
						this.worker.terminate();
						delete this.worker;
					}
					if (needsRuntimeReset) {
						const runtimeModule = (await import(
							/* @vite-ignore */ this.moduleUrl
						)) as DotnetRuntimeModule;
						if (typeof runtimeModule.createDotnetCompiler !== 'function') {
							return reject('wasm-dotnet module must export createDotnetCompiler');
						}
						if (typeof runtimeModule.executeBrowserDotnetArtifact !== 'function') {
							return reject(
								'wasm-dotnet module must export executeBrowserDotnetArtifact'
							);
						}
						this.runtimeModule = runtimeModule;
						this.compiler = runtimeModule.createDotnetCompiler();
						this.compiledArtifact = null;
						this.compiledCacheKey = '';
					}
					progress?.set?.(1);
					resolve();
					return;
				}
				this.runtimeModule = null;
				this.compiler = null;
				this.compiledArtifact = null;
				this.compiledCacheKey = '';
				if (needsWorkerReset && this.worker) {
					this.worker.terminate();
					delete this.worker;
				}
				if (!this.worker) {
					this.worker = new (
						await import('$lib/playground/worker/dotnet?worker')
					).default();
					this.worker.onerror = (event: ErrorEvent) => {
						const location =
							event.filename && event.lineno
								? ` (${event.filename}:${event.lineno}:${event.colno})`
								: '';
						reject(
							`${this.languageLabel} worker script error: ${event.message || 'unknown error'}${location}`
						);
					};
					this.worker.onmessageerror = () => {
						reject(`${this.languageLabel} worker message deserialization failed`);
					};
					this.worker.onmessage = (event: MessageEvent<any>) => {
						if (event.data?.load) {
							progress?.set?.(1);
							resolve();
						}
						if (event.data?.error) reject(event.data.error);
					};
					this.worker.postMessage({
						load: true,
						moduleUrl: this.moduleUrl
					});
				} else {
					progress?.set?.(1);
					resolve();
				}
			} catch (error: any) {
				reject(error?.message || String(error));
			}
		});
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

	private async collectStdinForRun(
		code: string,
		prepare: boolean,
		options: SandboxExecutionOptions
	) {
		if (
			!prepare &&
			!options.stdin &&
			this.pendingInput.length === 0 &&
			!this.pendingEof &&
			readsConsoleStdin(code)
		) {
			await new Promise<void>((resolve) => this.stdinWaiters.push(resolve));
		}
		const stdin = `${options.stdin || ''}${this.pendingInput.join('')}`;
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
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (this.runtimeModule && this.compiler) {
			return this.runOnMainThread(code, prepare, _log, _prog, args, options);
		}
		this.exit = false;
		if (!this.worker) return Promise.reject('Worker not loaded');
		const worker = this.worker;
		return new Promise<boolean | string>((resolve, reject) => {
			const { programArgs } = resolveSandboxExecutionArgs(this.language, args, options);
			const _uid = ++this.uid;
			this.activeReject = reject;
			worker.onmessage = (event: Event & { data: any }) => {
				if (this.worker !== worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (worker.onmessage = null);
				const { output, results, error, diagnostic, progress } = event.data;
				if (progress && typeof progress.percent === 'number') {
					_prog?.set?.(Math.max(0, Math.min(progress.percent / 100, 1)));
				}
				if (output) this.output?.(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.activeReject = null;
					resolve(results as string);
				}
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.activeReject = null;
					reject(error);
				}
			};
			this.begin = Date.now();
			this.collectStdinForRun(code, prepare, options)
				.then((stdin) => {
					if (this.worker !== worker) return reject('Worker not loaded');
					worker.postMessage({
						code,
						language: this.compileLanguage,
						prepare,
						args: programArgs,
						stdin,
						log: _log
					});
				})
				.catch(reject);
		});
	}

	private async runOnMainThread(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (!this.runtimeModule || !this.compiler) throw new Error('Runtime not loaded');
		this.exit = false;
		this.begin = Date.now();
		const _uid = ++this.uid;
		const { programArgs } = resolveSandboxExecutionArgs(this.language, args, options);
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
						if (typeof progress.percent === 'number') {
							_prog?.set?.(Math.max(0, Math.min(progress.percent / 100, 1)));
						}
					}
				});
				if (_uid !== this.uid) return false;
				for (const diagnostic of result.diagnostics || []) {
					this.oncompilerdiagnostic?.(diagnostic);
				}
				for (const line of result.logs || []) {
					this.output?.(line.endsWith('\n') ? line : `${line}\n`);
				}
				if (result.stdout) this.output?.(result.stdout);
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
				this.compiledArtifact = result.artifact;
				this.compiledCacheKey = compileCacheKey;
			}
			if (prepare) return true;

			const stdin = await this.collectStdinForRun(code, prepare, options);
			if (_uid !== this.uid) return false;
			const execution = await this.runtimeModule.executeBrowserDotnetArtifact(
				this.compiledArtifact,
				{
					args: programArgs,
					env: {
						USER: 'jungol'
					},
					stdin,
					stdout: (output) => {
						if (output) this.output?.(output);
					},
					stderr: (output) => {
						if (output) this.output?.(output);
					}
				}
			);
			if (_uid !== this.uid) return false;
			if (execution.exitCode !== 0) {
				throw new Error(
					`${this.languageLabel} program exited with code ${execution.exitCode}`
				);
			}
			return true;
		} finally {
			this.elapse = Date.now() - this.begin;
			this.exit = true;
			this.activeReject = null;
		}
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.activeReject?.('Process terminated');
		this.activeReject = null;
		this.uid += 1;
		this.resolveStdinWaiters();
		this.worker?.terminate?.();
		delete this.worker;
		this.exit = true;
	}

	async clear() {
		if (this.worker) this.worker.onmessage = null;
		this.pendingInput = [];
		this.pendingEof = false;
		this.resolveStdinWaiters();
		if (!this.exit) {
			this.terminate();
		}
	}
}

export default Dotnet;
