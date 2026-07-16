import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';

export interface StaticWorkerRuntimeUrls {
	baseUrl: string;
	workerUrl: string;
	manifestUrl?: string;
}

export interface StaticWorkerRuntimeConfig {
	languageId: string;
	displayName: string;
	defaultActivePath: string;
	moduleWorker?: boolean;
	readStdinPattern: RegExp;
	resolveRuntimeAssets: (
		runtimeAssets: string | PlaygroundRuntimeAssets,
		currentUrl: string
	) => StaticWorkerRuntimeUrls;
}

type ProgressSink =
	| { set?: (value: number, stage?: string) => void }
	| import('svelte/store').Writable<number>;

type StaticWorkerMessage = {
	__wasmIdleStaticWorkerReady?: boolean;
	output?: string;
	results?: boolean | string;
	error?: string;
	diagnostic?: CompilerDiagnostic;
	progress?: { percent?: number; stage?: string };
};

type BufferedStdin = {
	stdin?: string;
	stdinEof: boolean;
};

type ActiveRun = {
	id: number;
	progress?: ProgressSink;
	resolve: (result: boolean | string) => void;
	reject: (reason: string) => void;
};

type StdinWaiter = {
	reject: (reason: string) => void;
	resolve: () => void;
};

const WORKER_READY_MESSAGE = '__wasmIdleStaticWorkerReady';

export class StaticWorkerRuntimeSandbox implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	baseUrl = '';
	workerUrl = '';
	manifestUrl = '';
	activeReject: ((reason: string) => void) | null = null;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	pendingEof = false;
	stdinWaiters: StdinWaiter[] = [];

	private activeRun: ActiveRun | null = null;
	private bootstrapUrl = '';
	private lifecycleProgress?: ProgressSink;
	private progressValues = new WeakMap<object, number>();
	private startupReject: ((reason: Error) => void) | null = null;
	private workerGeneration = 0;
	private workerStartPromise: Promise<Worker> | null = null;

	constructor(private readonly config: StaticWorkerRuntimeConfig) {}

	async load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: ProgressSink
	) {
		const progressSink = this.selectProgress(progress);
		const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
		const urls = this.config.resolveRuntimeAssets(runtimeAssets, currentUrl);
		const nextManifestUrl = urls.manifestUrl || '';
		const runtimeChanged =
			this.baseUrl !== urls.baseUrl ||
			this.workerUrl !== urls.workerUrl ||
			this.manifestUrl !== nextManifestUrl;

		if (runtimeChanged && (this.worker || this.workerStartPromise || this.activeRun)) {
			this.terminate();
		}
		this.baseUrl = urls.baseUrl;
		this.workerUrl = urls.workerUrl;
		this.manifestUrl = nextManifestUrl;

		if (!this.baseUrl || !this.workerUrl) {
			throw new Error(`${this.config.displayName} runtime is not configured.`);
		}
		if (!runtimeChanged && this.workerStartPromise) {
			await this.workerStartPromise;
			return;
		}

		this.reportProgress(progressSink, 0.02, `Resolving ${this.config.displayName} runtime`);
		await this.ensureWorkerStarted(progressSink);
	}

	write(input: string) {
		this.pendingInput.push(input);
	}

	eof() {
		this.pendingEof = true;
		this.resolveStdinWaiters();
	}

	private resolveStdinWaiters() {
		const waiters = this.stdinWaiters.splice(0);
		for (const waiter of waiters) waiter.resolve();
	}

	private rejectStdinWaiters(reason: string) {
		const waiters = this.stdinWaiters.splice(0);
		for (const waiter of waiters) waiter.reject(reason);
	}

	private readsStdin(code: string) {
		this.config.readStdinPattern.lastIndex = 0;
		return this.config.readStdinPattern.test(code);
	}

	private async collectStdinForRun(
		code: string,
		options: SandboxExecutionOptions
	): Promise<BufferedStdin> {
		if (typeof options.stdin === 'string') {
			return { stdin: options.stdin, stdinEof: true };
		}
		if (!this.readsStdin(code) && this.pendingInput.length === 0 && !this.pendingEof) {
			return { stdin: undefined, stdinEof: false };
		}

		while (!this.pendingEof) {
			await new Promise<void>((resolve, reject) => {
				this.stdinWaiters.push({ resolve, reject });
			});
		}

		const stdin = this.pendingInput.join('');
		this.pendingInput = [];
		this.pendingEof = false;
		return { stdin, stdinEof: true };
	}

	private selectProgress(progress?: ProgressSink) {
		if (progress) this.lifecycleProgress = progress;
		return progress || this.lifecycleProgress;
	}

	private reportProgress(progress: ProgressSink | undefined, value: number, stage?: string) {
		const sink = this.selectProgress(progress);
		if (!sink) return;
		const clamped = Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0;
		const previous = this.progressValues.get(sink) ?? 0;
		if (clamped < previous) return;
		this.progressValues.set(sink, clamped);
		sink.set?.(clamped, stage);
	}

	private async preloadWorkerScript(progress?: ProgressSink) {
		this.reportProgress(progress, 0.05, `Loading ${this.config.displayName} worker script`);
		let response: Response;
		try {
			response = await fetch(this.workerUrl, { cache: 'force-cache' });
		} catch (error) {
			throw new Error(
				`${this.config.displayName} worker script failed to load: ${this.errorMessage(error)}`
			);
		}
		if (!response.ok) {
			throw new Error(
				`${this.config.displayName} worker script failed to load: HTTP ${response.status}`
			);
		}

		const total = Number(response.headers.get('content-length')) || 0;
		if (!response.body) {
			await response.arrayBuffer();
			this.reportProgress(progress, 0.2, `${this.config.displayName} worker downloaded`);
			return;
		}

		const reader = response.body.getReader();
		let loaded = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			loaded += value.byteLength;
			const ratio = total > 0 ? Math.min(loaded / total, 1) : 0.5;
			this.reportProgress(
				progress,
				0.05 + ratio * 0.15,
				`Loading ${this.config.displayName} worker script`
			);
		}
		this.reportProgress(progress, 0.2, `${this.config.displayName} worker downloaded`);
	}

	private createBootstrapUrl() {
		if (
			typeof Blob !== 'function' ||
			typeof URL?.createObjectURL !== 'function' ||
			typeof URL?.revokeObjectURL !== 'function'
		) {
			throw new Error(`${this.config.displayName} worker bootstrap is unavailable.`);
		}
		const importStatement = this.config.moduleWorker
			? `import ${JSON.stringify(this.workerUrl)};`
			: `importScripts(${JSON.stringify(this.workerUrl)});`;
		const source = `${importStatement}\nself.postMessage({ ${JSON.stringify(
			WORKER_READY_MESSAGE
		)}: true });\n`;
		return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	}

	private revokeBootstrapUrl() {
		if (!this.bootstrapUrl) return;
		URL.revokeObjectURL(this.bootstrapUrl);
		this.bootstrapUrl = '';
	}

	private ensureWorkerStarted(progress?: ProgressSink) {
		if (this.workerStartPromise) return this.workerStartPromise;
		const generation = ++this.workerGeneration;
		const startPromise = this.startWorker(generation, progress);
		this.workerStartPromise = startPromise;
		void startPromise.catch(() => {
			if (this.workerStartPromise === startPromise) this.disposeWorker();
		});
		return startPromise;
	}

	private async startWorker(generation: number, progress?: ProgressSink) {
		await this.preloadWorkerScript(progress);
		if (generation !== this.workerGeneration) {
			throw new Error('Process terminated');
		}

		this.reportProgress(progress, 0.22, `Starting ${this.config.displayName} worker`);
		this.bootstrapUrl = this.createBootstrapUrl();
		let worker: Worker;
		try {
			worker = this.config.moduleWorker
				? new Worker(this.bootstrapUrl, { type: 'module' })
				: new Worker(this.bootstrapUrl);
		} catch (error) {
			this.revokeBootstrapUrl();
			throw new Error(
				`${this.config.displayName} worker failed to start: ${this.errorMessage(error)}`
			);
		}
		if (generation !== this.workerGeneration) {
			worker.terminate();
			this.revokeBootstrapUrl();
			throw new Error('Process terminated');
		}

		this.worker = worker;
		worker.onmessage = (event: MessageEvent<StaticWorkerMessage>) => {
			if (event.data?.__wasmIdleStaticWorkerReady) {
				this.startupReject = null;
				this.revokeBootstrapUrl();
				this.reportProgress(progress, 0.25, `${this.config.displayName} worker ready`);
				readyResolve(worker);
				return;
			}
			this.handleWorkerMessage(event);
		};
		worker.onerror = (event: ErrorEvent) => {
			event.preventDefault?.();
			this.handleWorkerFailure(this.formatWorkerError(event));
		};
		worker.onmessageerror = () => {
			this.handleWorkerFailure(
				`${this.config.displayName} worker message deserialization failed`
			);
		};

		let readyResolve!: (worker: Worker) => void;
		return await new Promise<Worker>((resolve, reject) => {
			readyResolve = resolve;
			this.startupReject = reject;
		});
	}

	private handleWorkerMessage(event: MessageEvent<StaticWorkerMessage>) {
		const activeRun = this.activeRun;
		if (!activeRun) return;
		const { output, results, error, diagnostic, progress } = event.data || {};
		if (progress && typeof progress.percent === 'number') {
			const runtimeProgress = Math.max(0, Math.min(progress.percent / 100, 1));
			this.reportProgress(
				activeRun.progress,
				0.3 + runtimeProgress * 0.65,
				progress.stage || `Running ${this.config.displayName}`
			);
		}
		if (output) this.output?.(output);
		if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
		if (typeof error === 'string') {
			this.rejectRun(activeRun.id, error);
			return;
		}
		if (results !== undefined) {
			this.resolveRun(activeRun.id, typeof results === 'string' ? results : results);
		}
	}

	private formatWorkerError(event: ErrorEvent) {
		const location =
			event.filename && event.lineno
				? ` (${event.filename}:${event.lineno}:${event.colno})`
				: '';
		return `${this.config.displayName} worker script error: ${
			event.message || 'unknown error'
		}${location}`;
	}

	private errorMessage(error: unknown) {
		return error instanceof Error ? error.message : String(error);
	}

	private handleWorkerFailure(reason: string) {
		this.startupReject?.(new Error(reason));
		this.startupReject = null;
		if (this.activeRun) this.rejectRun(this.activeRun.id, reason);
		else this.disposeWorker();
	}

	private resolveRun(id: number, result: boolean | string) {
		const activeRun = this.activeRun;
		if (!activeRun || activeRun.id !== id) return;
		this.elapse = Date.now() - this.begin;
		this.exit = true;
		this.activeRun = null;
		this.activeReject = null;
		this.reportProgress(activeRun.progress, 1, `${this.config.displayName} run complete`);
		this.disposeWorker();
		activeRun.resolve(result);
	}

	private rejectRun(id: number, reason: string) {
		const activeRun = this.activeRun;
		if (!activeRun || activeRun.id !== id) return;
		this.elapse = Date.now() - this.begin;
		this.exit = true;
		this.activeRun = null;
		this.activeReject = null;
		this.disposeWorker();
		activeRun.reject(reason);
	}

	private disposeWorker() {
		this.revokeBootstrapUrl();
		this.workerGeneration += 1;
		this.workerStartPromise = null;
		this.startupReject = null;
		if (this.worker) {
			this.worker.onmessage = null;
			this.worker.onerror = null;
			this.worker.onmessageerror = null;
			this.worker.terminate();
		}
		delete this.worker;
	}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: ProgressSink,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const progress = this.selectProgress(_prog);
		if (!this.baseUrl || !this.workerUrl) {
			return Promise.reject(`${this.config.displayName} runtime is not configured.`);
		}

		if (prepare) {
			return this.ensureWorkerStarted(progress).then(() => {
				this.reportProgress(progress, 0.25, `${this.config.displayName} worker ready`);
				return true;
			});
		}

		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			const id = ++this.uid;
			this.activeRun = { id, progress, resolve, reject };
			this.activeReject = reject;
			this.begin = Date.now();

			void (async () => {
				try {
					const worker = await this.ensureWorkerStarted(progress);
					const { stdin, stdinEof } = await this.collectStdinForRun(code, options);
					if (this.activeRun?.id !== id) return;
					const { programArgs } = resolveSandboxExecutionArgs(
						this.config.languageId,
						args,
						options
					);
					this.reportProgress(
						progress,
						0.3,
						`Loading ${this.config.displayName} runtime`
					);
					worker.postMessage({
						run: true,
						baseUrl: this.baseUrl,
						manifestUrl: this.manifestUrl,
						code,
						args: programArgs,
						stdin,
						stdinEof,
						activePath: options.activePath || this.config.defaultActivePath,
						workspaceFiles: options.workspaceFiles || [],
						log: _log
					});
				} catch (error) {
					this.rejectRun(id, this.errorMessage(error));
				}
			})();
		});
	}

	kill() {
		this.terminate();
	}

	terminate() {
		const reason = 'Process terminated';
		this.uid += 1;
		this.startupReject?.(new Error(reason));
		this.startupReject = null;
		this.rejectStdinWaiters(reason);
		if (this.activeRun) {
			const activeRun = this.activeRun;
			this.activeRun = null;
			this.activeReject = null;
			activeRun.reject(reason);
		}
		this.pendingInput = [];
		this.pendingEof = false;
		this.disposeWorker();
		this.exit = true;
	}

	async clear() {
		this.terminate();
		this.lifecycleProgress = undefined;
		this.progressValues = new WeakMap<object, number>();
	}
}
