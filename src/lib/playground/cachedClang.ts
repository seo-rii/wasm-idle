import {
	resolveExecutionLimits,
	type Sandbox,
	type SandboxExecutionOptions,
	type SandboxProgress,
	type SandboxRuntimeAssets
} from '@wasm-idle/core';
import {
	resolveRuntimeAssetConfig,
	type PlaygroundRuntimeAssets,
	type ResolvedRuntimeAssetConfig
} from './assets';
import { WorkerAssetBridge } from './assetBridge';
import { shouldStreamBundledClang } from './clangStreamingPolicy';
import type { RuntimeAssetCache } from './runtimeAssetCache';
import type { BrowserClangArtifact, BrowserClangCompileRequest } from '@wasm-idle/llvm-core/clang';
import { CompiledArtifactCache, clangCompileKey } from './compiledArtifactCache';

type WorkerFactories = { compile(): Worker | Promise<Worker>; execute(): Worker | Promise<Worker> };
const workers: WorkerFactories = {
	async compile() {
		const { default: CompileWorker } = await import('./worker/cachedClangCompile?worker');
		return new CompileWorker();
	},
	async execute() {
		const { default: ExecuteWorker } = await import('./worker/cachedClangExecute?worker');
		return new ExecuteWorker();
	}
};

/** Wrap the public sandbox contract; all other languages and debugger operations stay unchanged. */
export function createCachedClangSandbox(
	legacy: Sandbox,
	language: 'C' | 'CPP',
	runtimeCache: RuntimeAssetCache,
	cache = new CompiledArtifactCache(),
	factories = workers
): Sandbox {
	let cached = false;
	let loadedAssets: SandboxRuntimeAssets = '';
	let runtimeBaseUrl = '';
	let assetConfig: ResolvedRuntimeAssetConfig;
	let maxAssetBytes = 0;
	let languageSysroots = false;
	let activeWorker: Worker | undefined;
	let cancelWorker: ((error: Error) => void) | undefined;
	let generation = 0;
	let running = false;
	let disposed = false;
	let disposal: Promise<void> | undefined;
	let inputBuffer: SharedArrayBuffer | undefined;
	let inputRequested = false;
	let pendingEof = false;
	const pendingInput: Uint8Array[] = [];
	const encoder = new TextEncoder();

	function resetInput() {
		pendingInput.length = 0;
		pendingEof = false;
		inputRequested = false;
		inputBuffer = undefined;
	}

	function flushInput() {
		if (!inputRequested || !inputBuffer) return;
		const control = new Int32Array(inputBuffer, 0, 2);
		const payload = new Uint8Array(inputBuffer, 8);
		const next = pendingInput[0];
		if (next) {
			const length = Math.min(next.byteLength, payload.byteLength);
			payload.set(next.subarray(0, length));
			if (length === next.byteLength) pendingInput.shift();
			else pendingInput[0] = next.subarray(length);
			Atomics.store(control, 1, length);
			Atomics.store(control, 0, 1);
		} else if (pendingEof) {
			Atomics.store(control, 1, 0);
			Atomics.store(control, 0, 2);
		} else return;
		inputRequested = false;
		Atomics.notify(control, 0);
	}

	function stop() {
		generation++;
		running = false;
		cancelWorker?.(new Error('Process terminated'));
		resetInput();
	}

	async function workerOperation<T>(
		factory: () => Worker | Promise<Worker>,
		message: unknown,
		token: number,
		progress?: SandboxProgress,
		compileLimit = 0,
		signal?: AbortSignal
	) {
		const worker = await factory();
		if (token !== generation || signal?.aborted) {
			worker.terminate();
			throw signal?.reason ?? new Error('Process terminated');
		}
		return new Promise<T>((resolve, reject) => {
			let bridge: WorkerAssetBridge | undefined;
			try {
				if (compileLimit)
					bridge = new WorkerAssetBridge(
						worker,
						'clang',
						assetConfig,
						progress,
						compileLimit,
						languageSysroots,
						runtimeCache
					);
			} catch (error) {
				worker.terminate();
				reject(error);
				return;
			}
			activeWorker = worker;
			const abort = () =>
				finish(
					signal?.reason instanceof Error
						? signal.reason
						: new Error('Process terminated')
				);
			const finish = (error?: Error, value?: T) => {
				if (activeWorker !== worker) return;
				activeWorker = undefined;
				cancelWorker = undefined;
				signal?.removeEventListener('abort', abort);
				bridge?.dispose();
				worker.onmessage = null;
				worker.onerror = null;
				worker.onmessageerror = null;
				worker.terminate();
				if (error) reject(error);
				else resolve(value!);
			};
			cancelWorker = finish;
			signal?.addEventListener('abort', abort, { once: true });
			worker.onerror = (event) => finish(new Error(event.message || 'C/C++ worker failed'));
			worker.onmessageerror = () =>
				finish(new Error('C/C++ worker message could not be decoded'));
			worker.onmessage = (event) => {
				if (activeWorker !== worker) return;
				try {
					if (bridge?.handleMessage(event)) return;
					const { data } = event;
					if (data.type === 'output') legacy.output?.(data.output);
					else if (data.type === 'progress') {
						progress?.set?.(data.progress.percent / 100);
						progress?.report?.({
							kind: 'activity',
							phase: 'compiling',
							label: data.progress.message
						});
					} else if (data.type === 'stdin') {
						inputRequested = true;
						progress?.report?.({
							kind: 'ready',
							state: 'waiting-input',
							reason: 'stdin-request',
							label: 'Runtime ready for input'
						});
						flushInput();
					} else if (data.type === 'compiled' || data.type === 'error') {
						if (data.stdout) legacy.output?.(data.stdout);
						if (data.stderr) legacy.output?.(data.stderr);
						if (data.type === 'error') finish(new Error(data.error));
						else finish(undefined, data.artifact);
					} else if (data.type === 'done') {
						if (data.exitCode !== 0 && data.exitCode !== null)
							finish(new Error(`Program exited with code ${data.exitCode}`));
						else finish(undefined, true as T);
					}
				} catch (error) {
					finish(error instanceof Error ? error : new Error(String(error)));
				}
			};
			try {
				worker.postMessage(message);
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	const overrides = {
		async load(
			assets: SandboxRuntimeAssets = '',
			code = '',
			log = true,
			args: string[] = [],
			options: SandboxExecutionOptions = {},
			progress?: SandboxProgress
		) {
			if (disposed) throw new Error('C/C++ sandbox was disposed');
			loadedAssets = assets;
			const config =
				typeof assets === 'object' ? (assets as PlaygroundRuntimeAssets) : undefined;
			assetConfig = resolveRuntimeAssetConfig(
				'clang',
				assets as string | PlaygroundRuntimeAssets,
				globalThis.location?.href || 'http://localhost/'
			);
			const debugMode = options.debugMode || (options.debug ? 'trace' : 'none');
			const cacheEligible =
				debugMode === 'none' &&
				shouldStreamBundledClang(assetConfig) &&
				!options.workspaceFiles?.some((file) => typeof file.content !== 'string') &&
				(options.stdin === undefined || typeof options.stdin === 'string') &&
				typeof SharedArrayBuffer !== 'undefined';
			if (!cached) await legacy.clear();
			if (disposed) throw new Error('C/C++ sandbox was disposed');
			stop();
			cached = cacheEligible;
			if (!cached) return legacy.load(assets, code, log, args, options, progress);
			runtimeBaseUrl = assetConfig.baseUrl;
			maxAssetBytes = resolveExecutionLimits(options.limits).maxAssetBytes;
			languageSysroots = config?.clang?.bundledLanguageSysroots === true;
		},
		async run(
			code: string,
			prepare: boolean,
			log = true,
			progress?: SandboxProgress,
			args: string[] = [],
			options: SandboxExecutionOptions = {}
		) {
			if (disposed) throw new Error('C/C++ sandbox was disposed');
			if (
				cached &&
				((options.debugMode || (options.debug ? 'trace' : 'none')) !== 'none' ||
					(options.stdin !== undefined && typeof options.stdin !== 'string') ||
					options.workspaceFiles?.some((file) => typeof file.content !== 'string'))
			) {
				await overrides.load(loadedAssets, code, log, args, options, progress);
			}
			if (!cached) return legacy.run(code, prepare, log, progress, args, options);
			if (running) throw new Error('C/C++ sandbox is already running');
			options.signal?.throwIfAborted();
			const token = ++generation;
			// Reactive UI arrays/records are Proxies and cannot cross postMessage.
			// Snapshot known fields before awaiting compilation, so the cache key,
			// compiler and executor also observe the same input values.
			const request: BrowserClangCompileRequest = {
				code,
				language,
				activePath: options.activePath,
				workspaceFiles:
					options.workspaceFiles === undefined
						? undefined
						: Array.from(options.workspaceFiles, (file) => ({
								path: file.path,
								content: file.content as string
							})),
				compileArgs: Array.from((options.compileArgs as string[] | undefined) ?? args),
				cVersion: options.cVersion as string | undefined,
				cppVersion: options.cppVersion as string | undefined
			};
			const programArgs = Array.from((options.programArgs as string[] | undefined) ?? []);
			const env =
				options.env === undefined
					? undefined
					: Object.fromEntries(Object.entries(options.env));
			const stdin = options.stdin;
			const limit = Math.min(
				maxAssetBytes,
				resolveExecutionLimits(options.limits).maxAssetBytes
			);
			const key = clangCompileKey(runtimeBaseUrl, limit, request, languageSysroots);
			let artifact = cache.get(key);
			running = true;
			try {
				if (!artifact) {
					artifact = await workerOperation<BrowserClangArtifact>(
						() => factories.compile(),
						{
							request,
							runtimeBaseUrl,
							maxAssetBytes: limit,
							languageSysroots,
							log,
							assets: {
								baseUrl: runtimeBaseUrl,
								maxAssetBytes: limit,
								useAssetBridge: assetConfig.useAssetBridge,
								useModuleBridge: true
							}
						},
						token,
						progress,
						limit,
						options.signal
					);
					if (token !== generation) throw new Error('Process terminated');
					cache.set(key, artifact);
				}
				progress?.set?.(1);
				if (prepare) return true;
				inputBuffer = new SharedArrayBuffer(65536 + 8);
				return await workerOperation<boolean>(
					() => factories.execute(),
					{
						artifact,
						code,
						activePath: request.activePath,
						workspaceFiles: request.workspaceFiles,
						programArgs,
						env,
						stdin,
						inputBuffer
					},
					token,
					progress,
					0,
					options.signal
				);
			} finally {
				if (token === generation) {
					running = false;
					if (!prepare) resetInput();
				}
			}
		},
		write(input: string) {
			if (!cached) return legacy.write?.(input);
			if (input) pendingInput.push(encoder.encode(input));
			flushInput();
		},
		eof() {
			if (!cached) return legacy.eof();
			pendingEof = true;
			flushInput();
		},
		async clear() {
			stop();
			if (!cached) await legacy.clear();
		},
		async terminate() {
			stop();
			if (!cached) await legacy.terminate();
		},
		async kill() {
			await overrides.terminate();
		},
		async cancel() {
			await overrides.terminate();
		},
		dispose() {
			if (disposal) return disposal;
			disposed = true;
			stop();
			disposal = Promise.resolve(legacy.dispose ? legacy.dispose() : legacy.terminate());
			return disposal;
		}
	};
	return new Proxy(legacy, {
		get(target, property) {
			if (Object.hasOwn(overrides, property))
				return overrides[property as keyof typeof overrides];
			const value = Reflect.get(target, property);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
}
