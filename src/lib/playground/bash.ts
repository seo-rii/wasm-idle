import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import { importRuntimeModule } from '$lib/playground/runtimeModule';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import { fetchRuntimeAssetBytes } from '$lib/playground/worker/runtimeAssetFetch';
import { BusyError } from '@wasm-idle/core';

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

interface WasmerPackage {
	entrypoint?: { run(options: Record<string, unknown>): Promise<WasixInstance> };
	free(): void;
}

interface WasmerSdk {
	init(options: { sdkUrl: string; workerUrl: string }): Promise<unknown>;
	Wasmer: { fromFile(bytes: Uint8Array): Promise<WasmerPackage> };
}

let sdkPromise: Promise<WasmerSdk> | undefined;
let sdkCacheKey = '';

class Bash implements Sandbox {
	output?: (data: string) => void;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	webcUrl = '';
	runtimePackage: WasmerPackage | null = null;
	instance: WasixInstance | null = null;
	stdinWriter: WritableStreamDefaultWriter | null = null;
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

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		if (this.activeLoadCleanup || this.activeRunCleanup) {
			return Promise.reject(
				new BusyError('Bash runtime already has an active operation', {
					runtimeId: 'BASH',
					phase: this.activeLoadCleanup ? 'startup' : 'execute'
				})
			);
		}
		const loadGeneration = ++this.loadGeneration;
		return new Promise<void>((resolve, reject) => {
			let cleanedUp = false;
			const cleanup = () => {
				if (cleanedUp) return;
				cleanedUp = true;
				if (this.activeLoadCleanup === cleanup) this.activeLoadCleanup = null;
				if (this.activeLoadReject === rejectLoad) this.activeLoadReject = null;
			};
			const rejectLoad = (reason: unknown) => {
				cleanup();
				reject(reason);
			};
			this.activeLoadCleanup = cleanup;
			this.activeLoadReject = rejectLoad;
			void (async () => {
				let nextPackage: WasmerPackage | null = null;
				try {
					if (
						this.activeLoadCleanup !== cleanup ||
						loadGeneration !== this.loadGeneration
					) {
						return;
					}
					this.pendingInput = [];
					this.pendingEof = false;
					const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
					const bashAssets = (runtimeAssets as BashRuntimeAssetConfig)?.bash;
					const configured = bashAssets?.webcUrl;
					const rootUrl =
						typeof runtimeAssets === 'string'
							? runtimeAssets
							: (runtimeAssets as BashRuntimeAssetConfig)?.rootUrl || '';
					const normalizedRoot = rootUrl.endsWith('/') ? rootUrl.slice(0, -1) : rootUrl;
					const nextWebcUrl = configured || `${normalizedRoot}/wasm-bash/bash.webc`;
					const resolvedWebcUrl = currentUrl
						? new URL(nextWebcUrl, currentUrl).href
						: nextWebcUrl;
					const sdkModuleUrl =
						bashAssets?.moduleUrl || `${normalizedRoot}/wasm-bash/sdk/index.mjs`;
					const sdkWorkerUrl =
						bashAssets?.workerUrl || `${normalizedRoot}/wasm-bash/sdk/worker.mjs`;
					const resolvedSdkUrl = currentUrl
						? new URL(sdkModuleUrl, currentUrl).href
						: sdkModuleUrl;
					const resolvedThreadWorkerUrl = currentUrl
						? new URL(sdkWorkerUrl, currentUrl).href
						: sdkWorkerUrl;
					const nextSdkCacheKey = `${resolvedSdkUrl}\n${resolvedThreadWorkerUrl}`;

					progress?.set?.(0.1, 'Loading Bash runtime');
					if (!sdkPromise || sdkCacheKey !== nextSdkCacheKey) {
						sdkCacheKey = nextSdkCacheKey;
						sdkPromise = importRuntimeModule<WasmerSdk>(resolvedSdkUrl).then(
							async (sdk) => {
								await sdk.init({
									sdkUrl: resolvedSdkUrl,
									workerUrl: resolvedThreadWorkerUrl
								});
								return sdk;
							}
						);
					}
					const [webcBytes, sdk] = await Promise.all([
						fetchRuntimeAssetBytes({
							url: resolvedWebcUrl,
							label: 'Bash WEBc package',
							maxAssetBytes: options.limits?.maxAssetBytes,
							signal: options.signal
						}),
						sdkPromise
					]);
					if (
						this.activeLoadCleanup !== cleanup ||
						loadGeneration !== this.loadGeneration
					) {
						return;
					}
					nextPackage = await sdk.Wasmer.fromFile(webcBytes);
					if (
						this.activeLoadCleanup !== cleanup ||
						loadGeneration !== this.loadGeneration
					) {
						nextPackage.free();
						nextPackage = null;
						return;
					}
					progress?.set?.(1, 'Bash runtime ready');
					if (
						this.activeLoadCleanup !== cleanup ||
						loadGeneration !== this.loadGeneration
					) {
						nextPackage.free();
						nextPackage = null;
						return;
					}
					const previousPackage = this.runtimePackage;
					this.runtimePackage = nextPackage;
					nextPackage = null;
					this.webcUrl = resolvedWebcUrl;
					previousPackage?.free();
					cleanup();
					resolve();
				} catch (error) {
					try {
						nextPackage?.free();
					} catch {
						// Preserve the startup failure.
					}
					if (
						this.activeLoadCleanup !== cleanup ||
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
			if (this.stdinWriter === writer) this.stdinWriter = null;
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
		if (this.activeLoadCleanup || this.activeRunCleanup) {
			throw new BusyError('Bash runtime already has an active operation', {
				runtimeId: 'BASH',
				phase: this.activeLoadCleanup ? 'startup' : 'execute'
			});
		}
		if (prepare) return true;
		if (!this.runtimePackage) throw new Error('Bash runtime is not loaded');
		const signal = options.signal;
		if (signal?.aborted) {
			throw signal.reason ?? new DOMException('Bash execution aborted', 'AbortError');
		}
		const { programArgs } = resolveSandboxExecutionArgs('BASH', args, options);
		const activePath = options.activePath || 'main.sh';
		const mountedFiles: Record<string, string> = {};
		for (const file of options.workspaceFiles || []) {
			const path = file.path.replace(/^\/+/, '');
			if (!path || path.split('/').includes('..')) {
				throw new Error(`Invalid Bash workspace path: ${file.path}`);
			}
			mountedFiles[path] = file.content;
		}
		const mountedActivePath = activePath.replace(/^\/+/, '');
		if (!mountedActivePath || mountedActivePath.split('/').includes('..')) {
			throw new Error(`Invalid Bash active path: ${activePath}`);
		}
		mountedFiles[mountedActivePath] = code;
		const queuedStdin = this.pendingInput.length > 0 ? this.pendingInput.join('') : undefined;
		const suppliedStdin = options.stdin ?? (this.pendingEof ? queuedStdin || '' : undefined);
		if (signal?.aborted) {
			throw signal.reason ?? new DOMException('Bash execution aborted', 'AbortError');
		}

		this.exit = false;
		this.begin = Date.now();
		const runUid = ++this.uid;
		if (suppliedStdin !== undefined) {
			this.pendingInput = [];
			this.pendingEof = false;
		}

		return new Promise<boolean | string>((resolve, reject) => {
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
				if (this.activeRunCleanup === cleanup) this.activeRunCleanup = null;
			};
			const onAbort = signal
				? () => {
						if (runUid !== this.uid) {
							cleanup();
							return;
						}
						this.terminate(
							signal.reason ??
								new DOMException('Bash execution aborted', 'AbortError')
						);
					}
				: undefined;
			this.activeReject = reject;
			this.activeRunCleanup = cleanup;
			if (signal && onAbort) {
				signal.addEventListener('abort', onAbort, { once: true });
				if (signal.aborted) onAbort();
			}
			if (runUid !== this.uid) return;
			void (async () => {
				try {
					const command = this.runtimePackage?.entrypoint;
					if (!command) throw new Error('Bash WEBc package has no entrypoint');
					const instance = await command.run({
						args: ['-c', code, mountedActivePath, ...programArgs],
						mount: { '/workspace': mountedFiles },
						cwd: '/workspace',
						...(suppliedStdin === undefined ? {} : { stdin: suppliedStdin })
					});
					if (runUid !== this.uid) {
						try {
							instance.free();
						} catch {
							// The cancelled caller has already received its reason.
						}
						return;
					}
					let writer: WritableStreamDefaultWriter | null = null;
					try {
						writer =
							suppliedStdin === undefined
								? instance.stdin?.getWriter() || null
								: null;
					} catch (error) {
						try {
							instance.free();
						} catch {
							// Preserve the writer acquisition failure.
						}
						throw error;
					}
					if (runUid !== this.uid) {
						if (writer) {
							try {
								void Promise.resolve(writer.abort(signal?.reason)).catch(
									() => undefined
								);
							} catch {
								// The cancelled caller has already received its reason.
							}
						}
						try {
							instance.free();
						} catch {
							// The cancelled caller has already received its reason.
						}
						return;
					}
					this.instance = instance;
					this.stdinWriter = writer;
					await this.flushPendingInput();
					if (runUid !== this.uid) return;

					const stdoutDone = instance.stdout.pipeTo(
						new WritableStream({
							write: (chunk) => {
								if (runUid === this.uid) {
									this.output?.(new TextDecoder().decode(chunk));
								}
							}
						})
					);
					const stderrDone = instance.stderr.pipeTo(
						new WritableStream({
							write: (chunk) => {
								if (runUid === this.uid) {
									this.output?.(new TextDecoder().decode(chunk));
								}
							}
						})
					);
					const outputDone = Promise.allSettled([stdoutDone, stderrDone]);
					const result = await instance.wait();
					await outputDone;
					if (runUid !== this.uid) return;

					this.elapse = Date.now() - this.begin;
					this.exit = true;
					if (this.activeReject === reject) this.activeReject = null;
					this.stdinWriter = null;
					this.instance = null;
					if (!result.ok) {
						reject(`Bash exited with status ${result.code}.`);
						return;
					}
					resolve(true);
				} catch (error) {
					if (runUid !== this.uid) return;
					this.exit = true;
					if (this.activeReject === reject) this.activeReject = null;
					this.stdinWriter = null;
					this.instance = null;
					reject(error instanceof Error ? error.message : String(error));
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
		const loadReject = this.activeLoadReject;
		const loadCleanup = this.activeLoadCleanup;
		const reject = this.activeReject;
		const cleanup = this.activeRunCleanup;
		const writer = this.stdinWriter;
		const instance = this.instance;
		this.activeLoadReject = null;
		this.activeLoadCleanup = null;
		this.activeReject = null;
		this.activeRunCleanup = null;
		this.loadGeneration += 1;
		this.uid += 1;
		this.stdinWriter = null;
		this.instance = null;
		this.pendingInput = [];
		this.pendingEof = false;
		this.exit = true;
		loadCleanup?.();
		cleanup?.();
		loadReject?.(reason);
		reject?.(reason);
		if (writer) {
			try {
				void Promise.resolve(writer.abort(reason)).catch(() => undefined);
			} catch {
				// Preserve the termination reason.
			}
		}
		try {
			instance?.free();
		} catch {
			// Preserve the termination reason.
		}
	}

	async clear() {
		this.terminate();
		this.runtimePackage?.free();
		this.runtimePackage = null;
	}
}

export default Bash;
