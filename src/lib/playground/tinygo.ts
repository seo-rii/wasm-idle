import {
	resolveTinyGoHostCompileUrl,
	resolveTinyGoModuleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';

type TinyGoRuntimeHooks = {
	boot(): Promise<void>;
	plan(): Promise<unknown>;
	execute(): Promise<void>;
	reset(): void;
	readActivityLog(): string;
	readBuildArtifact(): {
		path: string;
		bytes: Uint8Array;
		runnable?: boolean;
		entrypoint?: '_start' | '_initialize' | null;
		reason?: 'bootstrap-artifact' | 'missing-wasi-entrypoint';
	} | null;
	setWorkspaceFiles(files: Record<string, string> | null): void;
	dispose?(): void;
};

type TinyGoRuntimeModule = {
	createBundledTinyGoRuntime?: () => TinyGoRuntimeHooks;
	createTinyGoRuntime?: (options: { assetBaseUrl: string }) => TinyGoRuntimeHooks;
};

type TinyGoHostCompileResponse = {
	artifact: {
		bytesBase64: string;
		entrypoint?: '_start' | '_initialize' | null;
		path: string;
		reason?: 'bootstrap-artifact' | 'missing-wasi-entrypoint';
		runnable?: boolean;
	};
	logs?: string[];
};

const ACTIVITY_PREFIX_PATTERN = /^\[\d{2}:\d{2}:\d{2}\]\s?/gm;

class TinyGo implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = new SharedArrayBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	hostCompileUrl = '';
	runtime: TinyGoRuntimeHooks | null = null;
	runtimePromise: Promise<TinyGoRuntimeHooks> | null = null;
	loadPromise: Promise<void> | null = null;
	compiledArtifact: Uint8Array | null = null;
	compiledArtifactExecutionError = '';
	compiledCacheKey = '';
	activeReject: ((reason: string) => void) | null = null;
	waitingForInput = false;
	pendingEof = false;
	lastActivityLog = '';

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		return new Promise<void>(async (resolve, reject) => {
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextModuleUrl = resolveTinyGoModuleUrl(runtimeAssets, currentUrl);
			const nextHostCompileUrl = resolveTinyGoHostCompileUrl(runtimeAssets, currentUrl);
			if (!nextModuleUrl && !nextHostCompileUrl) {
				return reject(
					'TinyGo runtime is not configured. Set PUBLIC_WASM_TINYGO_MODULE_URL, runtimeAssets.tinygo.moduleUrl, or runtimeAssets.tinygo.hostCompileUrl.'
				);
			}
			if (
				(this.moduleUrl && this.moduleUrl !== nextModuleUrl) ||
				(this.hostCompileUrl && this.hostCompileUrl !== nextHostCompileUrl)
			) {
				this.disposeRuntime();
				this.compiledArtifact = null;
				this.compiledArtifactExecutionError = '';
				this.compiledCacheKey = '';
			}
			this.moduleUrl = nextModuleUrl;
			this.hostCompileUrl = nextHostCompileUrl;
			try {
				progress?.set?.(0.25);
				await this.ensureWorker();
				progress?.set?.(0.5);
				if (!nextHostCompileUrl && nextModuleUrl) {
					await this.ensureRuntime();
				}
				progress?.set?.(1);
				resolve();
			} catch (error) {
				reject(error instanceof Error ? error.message : String(error));
			}
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

	private async ensureWorker() {
		if (this.worker) return;
		if (this.loadPromise) {
			await this.loadPromise;
			return;
		}
		this.loadPromise = new Promise<void>(async (resolve, reject) => {
			this.worker = new (await import('$lib/playground/worker/tinygo?worker')).default();
			this.worker.onerror = (event: ErrorEvent) => {
				const location =
					event.filename && event.lineno
						? ` (${event.filename}:${event.lineno}:${event.colno})`
						: '';
				reject(`TinyGo worker script error: ${event.message || 'unknown error'}${location}`);
			};
			this.worker.onmessageerror = () => {
				reject('TinyGo worker message deserialization failed');
			};
			this.worker.onmessage = (event: MessageEvent<any>) => {
				if (event.data?.load) resolve();
				if (event.data?.error) reject(event.data.error);
			};
			this.worker.postMessage({ load: true });
		}).finally(() => {
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
			const runtimeModule = (await import(/* @vite-ignore */ moduleUrl)) as TinyGoRuntimeModule;
			if (typeof runtimeModule.createBundledTinyGoRuntime === 'function') {
				this.runtime = runtimeModule.createBundledTinyGoRuntime();
				return this.runtime;
			}
			if (typeof runtimeModule.createTinyGoRuntime === 'function') {
				this.runtime = runtimeModule.createTinyGoRuntime({
					assetBaseUrl: new URL('./', moduleUrl).toString()
				});
				return this.runtime;
			};
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
		log = true,
		prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		const compileCacheKey = JSON.stringify({
			code,
			hostCompileUrl: this.hostCompileUrl,
			moduleUrl: this.moduleUrl
		});
		if (this.compiledArtifact && this.compiledCacheKey === compileCacheKey) {
			return;
		}
		if (this.hostCompileUrl) {
			prog?.set?.(0.05);
			let hostCompileResponse: Response | null = null;
			try {
				hostCompileResponse = await fetch(this.hostCompileUrl, {
					method: 'POST',
					headers: {
						'content-type': 'application/json'
					},
					body: JSON.stringify({
						source: code
					})
				});
			} catch (error) {
				if (!this.moduleUrl) {
					throw error;
				}
			}
			if (hostCompileResponse?.ok) {
				const payload = (await hostCompileResponse.json()) as TinyGoHostCompileResponse;
				const artifactBase64 = payload.artifact?.bytesBase64 || '';
				if (!payload.artifact?.path || !artifactBase64) {
					throw new Error('TinyGo host compile did not return a wasm artifact');
				}
				const artifactBytes = Uint8Array.from(atob(artifactBase64), (char) => char.charCodeAt(0));
				this.compiledArtifact = artifactBytes;
				this.compiledArtifactExecutionError =
					payload.artifact.runnable === false
						? payload.artifact.reason === 'bootstrap-artifact'
							? 'TinyGo browser runtime produced a bootstrap artifact and cannot execute it yet.'
							: 'TinyGo browser runtime produced a wasm artifact without a supported WASI entrypoint.'
						: '';
				this.compiledCacheKey = compileCacheKey;
				prog?.set?.(0.95);
				if (log) {
					for (const line of payload.logs || []) {
						this.output?.(line.endsWith('\n') ? line : `${line}\n`);
					}
					this.output?.(`tinygo artifact ready: ${payload.artifact.path}\n`);
				}
				return;
			}
			if (
				hostCompileResponse &&
				hostCompileResponse.status !== 404 &&
				hostCompileResponse.status !== 405 &&
				hostCompileResponse.status !== 501
			) {
				let failureMessage = 'TinyGo host compile failed';
				try {
					const payload = await hostCompileResponse.json();
					if (typeof payload?.error === 'string' && payload.error) {
						failureMessage = payload.error;
					}
				} catch {
					const responseText = await hostCompileResponse.text();
					if (responseText.trim()) {
						failureMessage = responseText.trim();
					}
				}
				throw new Error(failureMessage);
			}
		}
		if (!this.moduleUrl) {
			throw new Error('TinyGo host compile endpoint is unavailable.');
		}
		const runtime = await this.ensureRuntime();
		runtime.reset();
		this.lastActivityLog = runtime.readActivityLog();
		runtime.setWorkspaceFiles({ 'main.go': code });
		prog?.set?.(0.05);
		await runtime.boot();
		this.emitActivityLog(runtime);
		prog?.set?.(0.2);
		await runtime.plan();
		this.emitActivityLog(runtime);
		prog?.set?.(0.45);
		await runtime.execute();
		this.emitActivityLog(runtime);
		prog?.set?.(0.95);
		const artifact = runtime.readBuildArtifact();
		if (!artifact) {
			throw new Error(this.extractCompileFailure());
		}
		this.compiledArtifact = new Uint8Array(artifact.bytes);
		this.compiledArtifactExecutionError =
			artifact.runnable === false
				? artifact.reason === 'bootstrap-artifact'
					? 'TinyGo browser runtime produced a bootstrap artifact and cannot execute it yet.'
					: 'TinyGo browser runtime produced a wasm artifact without a supported WASI entrypoint.'
				: '';
		this.compiledCacheKey = compileCacheKey;
		if (log) {
			this.output?.(`tinygo artifact ready: ${artifact.path}\n`);
		}
	}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		this.exit = false;
		return new Promise<boolean | string>(async (resolve, reject) => {
			try {
				this.begin = Date.now();
				await this.ensureWorker();
				await this.compileArtifact(code, _log, prepare ? _prog : undefined);
				if (prepare) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					resolve(true);
					return;
				}
				if (this.compiledArtifactExecutionError) {
					throw new Error(this.compiledArtifactExecutionError);
				}
				if (!this.worker || !this.compiledArtifact) {
					throw new Error('TinyGo runtime did not prepare an artifact');
				}
				const { programArgs } = resolveSandboxExecutionArgs('TINYGO', args, options);
				const _uid = ++this.uid;
				this.activeReject = reject;
				this.worker.onmessage = (event: Event & { data: any }) => {
					if (!this.worker) return reject('Worker not loaded');
					if (_uid !== this.uid) return (this.worker.onmessage = null);
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
						this.activeReject = null;
						resolve(results as string);
					}
					if (error) {
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.waitingForInput = false;
						this.pendingEof = false;
						this.activeReject = null;
						reject(error);
					}
				};
				this.worker.postMessage({
					artifact: new Uint8Array(this.compiledArtifact),
					buffer: this.buffer,
					args: programArgs,
					log: _log
				});
			} catch (error) {
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				this.activeReject = null;
				reject(error instanceof Error ? error.message : String(error));
			}
		});
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.activeReject?.('Process terminated');
		this.activeReject = null;
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.worker?.terminate?.();
		delete this.worker;
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
