import {
	resolveRustCompilerUrl,
	resolveTinyGoModuleUrl,
	type PlaygroundRuntimeAssets,
	type TinyGoRuntimeAssetLoader,
	type TinyGoRuntimeAssetPackReference
} from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type SandboxExecutionOptions,
	type TinyGoTarget
} from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';

type TinyGoRuntimeHooks = {
	boot(): Promise<void>;
	plan(): Promise<unknown>;
	execute(): Promise<void>;
	reset(): void;
	readActivityLog(): string;
	readBuildArtifact(): {
		path: string;
		bytes: Uint8Array;
		artifactKind?: 'probe' | 'bootstrap' | 'execution';
		runnable?: boolean;
		entrypoint?: '_start' | '_initialize' | 'main' | null;
		reason?: 'bootstrap-artifact' | 'missing-wasi-entrypoint';
	} | null;
	setBuildRequestOverrides?(overrides: { target?: TinyGoTarget } | null): void;
	setWorkspaceFiles(files: Record<string, string> | null): void;
	dispose?(): void;
};

type TinyGoRuntimeAssetProgress = {
	assetPath: string;
	assetUrl: string;
	label: string;
	loaded: number;
	total: number | null;
};

type TinyGoRuntimeModule = {
	createBundledTinyGoRuntime?: (options?: {
		assetLoader?: TinyGoRuntimeAssetLoader;
		assetPacks?: TinyGoRuntimeAssetPackReference[];
		rustRuntimeBaseUrl?: string;
		onProgress?: (progress: TinyGoRuntimeAssetProgress) => void;
	}) => TinyGoRuntimeHooks;
	createTinyGoRuntime?: (options: {
		assetBaseUrl: string;
		assetLoader?: TinyGoRuntimeAssetLoader;
		assetPacks?: TinyGoRuntimeAssetPackReference[];
		rustRuntimeBaseUrl?: string;
		onProgress?: (progress: TinyGoRuntimeAssetProgress) => void;
	}) => TinyGoRuntimeHooks;
};

const ACTIVITY_PREFIX_PATTERN = /^\[\d{2}:\d{2}:\d{2}\]\s?/gm;

class TinyGo implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	rustRuntimeBaseUrl = '';
	assetLoader: TinyGoRuntimeAssetLoader | undefined = undefined;
	assetPacks: TinyGoRuntimeAssetPackReference[] | undefined = undefined;
	runtime: TinyGoRuntimeHooks | null = null;
	runtimePromise: Promise<TinyGoRuntimeHooks> | null = null;
	loadPromise: Promise<void> | null = null;
	compiledArtifact: Uint8Array | null = null;
	compiledArtifactExecutionError = '';
	compiledCacheKey = '';
	waitingForInput = false;
	pendingEof = false;
	lastActivityLog = '';
	runtimeProgress:
		| { set?: (value: number) => void }
		| import('svelte/store').Writable<number>
		| undefined = undefined;
	runtimeProgressStart = 0;
	runtimeProgressEnd = 0;
	runtimeProgressValue = 0;
	runtimeProgressAssets = new Map<string, { loaded: number; total: number }>();
	private readonly workerSession = new WorkerSession({
		label: 'TinyGo',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	async load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	): Promise<void> {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
		const nextModuleUrl = resolveTinyGoModuleUrl(runtimeAssets, currentUrl);
		const nextRustCompilerUrl = resolveRustCompilerUrl(runtimeAssets, currentUrl);
		const nextRustRuntimeBaseUrl = nextRustCompilerUrl
			? new URL('./runtime/', nextRustCompilerUrl).toString()
			: '';
		if (!nextModuleUrl) {
			throw new Error(
				'TinyGo runtime is not configured. Set PUBLIC_WASM_TINYGO_MODULE_URL or runtimeAssets.tinygo.moduleUrl.'
			);
		}
		if (
			(this.moduleUrl && this.moduleUrl !== nextModuleUrl) ||
			this.rustRuntimeBaseUrl !== nextRustRuntimeBaseUrl
		) {
			this.disposeRuntime();
			this.compiledArtifact = null;
			this.compiledArtifactExecutionError = '';
			this.compiledCacheKey = '';
		}
		this.assetLoader =
			typeof runtimeAssets === 'object' ? runtimeAssets?.tinygo?.assetLoader : undefined;
		this.assetPacks =
			typeof runtimeAssets === 'object' ? runtimeAssets?.tinygo?.assetPacks : undefined;
		this.moduleUrl = nextModuleUrl;
		this.rustRuntimeBaseUrl = nextRustRuntimeBaseUrl;
		try {
			progress?.set?.(0.25);
			await this.ensureWorker();
			progress?.set?.(0.5);
			await this.ensureRuntime();
			progress?.set?.(1);
		} catch (error) {
			throw new Error(error instanceof Error ? error.message : String(error));
		}
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

	private async ensureWorker() {
		if (this.worker) return;
		if (this.loadPromise) {
			await this.loadPromise;
			return;
		}
		this.loadPromise = (async () => {
			const WorkerConstructor = (await import('$lib/playground/worker/tinygo?worker'))
				.default;
			this.worker = new WorkerConstructor();
			await this.workerSession.waitForLoad(this.worker, (resolve, reject) => {
				if (!this.worker) return reject('Worker not loaded');
				this.worker.onmessage = (event: MessageEvent<any>) => {
					if (event.data?.load) resolve();
					if (event.data?.error) reject(event.data.error);
				};
				this.worker.postMessage({ load: true });
			});
		})().finally(() => {
			this.loadPromise = null;
		});
		await this.loadPromise;
	}

	private disposeRuntime() {
		this.runtime?.dispose?.();
		this.runtime = null;
		this.runtimePromise = null;
		this.lastActivityLog = '';
		this.compiledArtifactExecutionError = '';
	}

	private async ensureRuntime() {
		if (this.runtime) {
			return this.runtime;
		}
		if (this.runtimePromise) {
			return await this.runtimePromise;
		}
		const moduleUrl = this.moduleUrl;
		this.runtimePromise = (async () => {
			const runtimeModule = (await import(
				/* @vite-ignore */ moduleUrl
			)) as TinyGoRuntimeModule;
			if (typeof runtimeModule.createBundledTinyGoRuntime === 'function') {
				this.runtime = runtimeModule.createBundledTinyGoRuntime({
					assetLoader: this.assetLoader,
					assetPacks: this.assetPacks,
					rustRuntimeBaseUrl: this.rustRuntimeBaseUrl || undefined,
					onProgress: (progress) => {
						if (!this.runtimeProgress) return;
						const total =
							progress.total && progress.total > 0 ? progress.total : progress.loaded;
						const key = progress.assetUrl || progress.assetPath;
						this.runtimeProgressAssets.set(key, {
							loaded: Math.max(0, progress.loaded),
							total: Math.max(1, total)
						});
						let loaded = 0;
						let size = 0;
						for (const entry of this.runtimeProgressAssets.values()) {
							loaded += Math.min(entry.loaded, entry.total);
							size += entry.total;
						}
						if (size <= 0) return;
						const nextValue =
							this.runtimeProgressStart +
							((this.runtimeProgressEnd - this.runtimeProgressStart) * loaded) / size;
						if (nextValue <= this.runtimeProgressValue) return;
						this.runtimeProgressValue = nextValue;
						this.runtimeProgress.set?.(nextValue);
					}
				});
				return this.runtime;
			}
			if (typeof runtimeModule.createTinyGoRuntime === 'function') {
				this.runtime = runtimeModule.createTinyGoRuntime({
					assetBaseUrl: new URL('./', moduleUrl).toString(),
					assetLoader: this.assetLoader,
					assetPacks: this.assetPacks,
					rustRuntimeBaseUrl: this.rustRuntimeBaseUrl || undefined,
					onProgress: (progress) => {
						if (!this.runtimeProgress) return;
						const total =
							progress.total && progress.total > 0 ? progress.total : progress.loaded;
						const key = progress.assetUrl || progress.assetPath;
						this.runtimeProgressAssets.set(key, {
							loaded: Math.max(0, progress.loaded),
							total: Math.max(1, total)
						});
						let loaded = 0;
						let size = 0;
						for (const entry of this.runtimeProgressAssets.values()) {
							loaded += Math.min(entry.loaded, entry.total);
							size += entry.total;
						}
						if (size <= 0) return;
						const nextValue =
							this.runtimeProgressStart +
							((this.runtimeProgressEnd - this.runtimeProgressStart) * loaded) / size;
						if (nextValue <= this.runtimeProgressValue) return;
						this.runtimeProgressValue = nextValue;
						this.runtimeProgress.set?.(nextValue);
					}
				});
				return this.runtime;
			}
			throw new Error(
				'TinyGo runtime module must export createBundledTinyGoRuntime or createTinyGoRuntime'
			);
		})().catch((error) => {
			this.disposeRuntime();
			throw error;
		});
		return await this.runtimePromise;
	}

	private emitActivityLog(hooks: TinyGoRuntimeHooks) {
		const nextActivityLog = hooks.readActivityLog();
		const delta = nextActivityLog.startsWith(this.lastActivityLog)
			? nextActivityLog.slice(this.lastActivityLog.length)
			: nextActivityLog;
		this.lastActivityLog = nextActivityLog;
		if (!delta) return;
		const sanitized = delta.replace(ACTIVITY_PREFIX_PATTERN, '');
		if (sanitized) this.output?.(sanitized);
	}

	private extractCompileFailure() {
		const sanitized = this.lastActivityLog.replace(ACTIVITY_PREFIX_PATTERN, '');
		const lines = sanitized
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		for (let index = lines.length - 1; index >= 0; index -= 1) {
			if (/(failed|error)/i.test(lines[index] || '')) {
				return lines[index] as string;
			}
		}
		return 'TinyGo compilation failed';
	}

	private async compileArtifact(
		code: string,
		target: TinyGoTarget = 'wasm',
		log = true,
		prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		const compileCacheKey = JSON.stringify({
			code,
			moduleUrl: this.moduleUrl,
			target
		});
		if (this.compiledArtifact && this.compiledCacheKey === compileCacheKey) {
			return;
		}
		const runtime = await this.ensureRuntime();
		runtime.reset();
		this.lastActivityLog = runtime.readActivityLog();
		runtime.setWorkspaceFiles({ 'main.go': code });
		runtime.setBuildRequestOverrides?.({ target });
		this.runtimeProgress = prog;
		this.runtimeProgressAssets.clear();
		this.runtimeProgressStart = 0.05;
		this.runtimeProgressEnd = 0.35;
		this.runtimeProgressValue = 0.05;
		try {
			prog?.set?.(0.05);
			await runtime.boot();
			this.emitActivityLog(runtime);
			this.runtimeProgressAssets.clear();
			this.runtimeProgressStart = 0.35;
			this.runtimeProgressEnd = 0.65;
			this.runtimeProgressValue = Math.max(this.runtimeProgressValue, 0.35);
			prog?.set?.(this.runtimeProgressValue);
			await runtime.plan();
			this.emitActivityLog(runtime);
			this.runtimeProgressAssets.clear();
			this.runtimeProgressStart = 0.65;
			this.runtimeProgressEnd = 0.92;
			this.runtimeProgressValue = Math.max(this.runtimeProgressValue, 0.65);
			prog?.set?.(this.runtimeProgressValue);
			await runtime.execute();
			this.emitActivityLog(runtime);
			prog?.set?.(0.95);
		} finally {
			this.runtimeProgress = undefined;
			this.runtimeProgressAssets.clear();
		}
		const artifact = runtime.readBuildArtifact();
		if (!artifact) {
			const compileFailure = this.extractCompileFailure();
			if (/(?:probe-only|supported WASI entrypoint)/i.test(compileFailure)) {
				throw new Error(
					`TinyGo browser runtime could not produce a runnable execution artifact: ${compileFailure}.`
				);
			}
			throw new Error(compileFailure);
		}
		const runtimeLogLines = runtime
			.readActivityLog()
			.replace(ACTIVITY_PREFIX_PATTERN, '')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
		let browserRuntimeFailure = '';
		for (let index = runtimeLogLines.length - 1; index >= 0; index -= 1) {
			const line = runtimeLogLines[index] || '';
			if (/^(?:build execution failed:|artifact probe failed:)/.test(line)) {
				browserRuntimeFailure = line.replace(
					/^(?:build execution failed:|artifact probe failed:)\s*/,
					''
				);
				break;
			}
		}
		this.compiledArtifact = new Uint8Array(artifact.bytes);
		this.compiledArtifactExecutionError =
			artifact.runnable === false
				? browserRuntimeFailure !== ''
					? `TinyGo browser runtime could not produce a runnable execution artifact: ${browserRuntimeFailure}.`
					: artifact.reason === 'bootstrap-artifact'
						? 'TinyGo browser runtime produced a bootstrap artifact and cannot execute it yet.'
						: artifact.artifactKind === 'probe'
							? 'TinyGo browser runtime produced a non-runnable probe artifact without a supported WASI entrypoint.'
							: 'TinyGo browser runtime produced a non-runnable artifact without a supported WASI entrypoint.'
				: '';
		this.compiledCacheKey = compileCacheKey;
		if (log) {
			this.output?.(`tinygo artifact ready: ${artifact.path}\n`);
		}
	}

	async run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		this.exit = false;
		try {
			this.begin = Date.now();
			await this.ensureWorker();
			const target = options.tinygoTarget || 'wasm';
			await this.compileArtifact(code, target, _log, prepare ? _prog : undefined);
			if (prepare) {
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				return true;
			}
			if (this.compiledArtifactExecutionError) {
				throw new Error(this.compiledArtifactExecutionError);
			}
			if (!this.worker || !this.compiledArtifact) {
				throw new Error('TinyGo runtime did not prepare an artifact');
			}
			const worker = this.worker;
			const compiledArtifact = this.compiledArtifact;
			const { programArgs } = resolveSandboxExecutionArgs('TINYGO', args, options);
			const _uid = ++this.uid;
			return await new Promise<boolean | string>((resolve, reject) => {
				const operation = this.workerSession.beginRun(worker, reject);
				worker.onmessage = (event: Event & { data: any }) => {
					if (this.worker !== worker) return reject('Worker not loaded');
					if (_uid !== this.uid) return (worker.onmessage = null);
					const { output, results, error, buffer } = event.data;
					if (buffer) {
						this.waitingForInput = true;
						this.flushPendingInput();
					}
					if (output) this.output?.(output);
					if (results) {
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.waitingForInput = false;
						this.pendingEof = false;
						this.workerSession.complete(operation);
						resolve(results as string);
					}
					if (error) {
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.waitingForInput = false;
						this.pendingEof = false;
						this.workerSession.complete(operation);
						reject(error);
					}
				};
				worker.postMessage({
					artifact: new Uint8Array(compiledArtifact),
					buffer: this.buffer,
					args: programArgs,
					log: _log
				});
			});
		} catch (error) {
			this.elapse = Date.now() - this.begin;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
			throw error instanceof Error ? error.message : String(error);
		}
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate();
		this.exit = true;
	}

	async clear() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		if (!this.exit) {
			this.terminate();
		}
	}
}

export default TinyGo;
