import {
	resolveExecutionLimits,
	resolveRuntimeAssetCacheOptions,
	OutputLimitError,
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
import type {
	BrowserClangArtifact,
	BrowserClangCompileRequest,
	BrowserClangPrecompiledHeader
} from '@wasm-idle/llvm-core/clang';
import type { CompilerDiagnostic } from '@wasm-idle/llvm-core/clang';
import { CompiledArtifactCache, clangCompileKey } from './compiledArtifactCache';
import { CLANG_STDIN_DATA, CLANG_STDIN_EOF, CLANG_STDIN_HEADER_BYTES } from './clangWorkerProtocol';

const MAX_BUFFERED_INPUT_BYTES = 128 * 1024;
const MAX_HEADER_BUILD_TIMEOUT_MS = 30_000;

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
	let maxWasmMemoryBytes = 0;
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
	let loadedMaxInputBytes = MAX_BUFFERED_INPUT_BYTES;
	let maxBufferedInputBytes = loadedMaxInputBytes;
	let pendingInputBytes = 0;
	let loadedHeaderTimeoutMs = MAX_HEADER_BUILD_TIMEOUT_MS;
	let headerTimeoutMs = loadedHeaderTimeoutMs;
	let loadedMaxWorkers = 1;
	let maxWorkers = loadedMaxWorkers;
	const pendingInput: Uint8Array[] = [];
	const encoder = new TextEncoder();
	// Header builds survive ordinary cancellation, within their own deadline and Worker budget.
	let precompiledHeader: BrowserClangPrecompiledHeader | undefined;
	let headerWorker: { worker: Worker; dispose(): void } | undefined;

	function disposeWorker(worker: Worker, bridge?: WorkerAssetBridge) {
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		try {
			bridge?.dispose();
		} catch {
			// Cleanup must preserve the primary result and still attempt Worker termination.
		}
		try {
			worker.terminate();
		} catch {
			// Preserve the primary result even if a custom Worker fails to terminate.
		}
	}

	function adoptHeaderWorker(worker: Worker, bridge?: WorkerAssetBridge) {
		headerWorker?.dispose();
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const dispose = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (headerWorker?.worker === worker) headerWorker = undefined;
			disposeWorker(worker, bridge);
		};
		headerWorker = { worker, dispose };
		timeout = setTimeout(dispose, headerTimeoutMs);
		worker.onerror = dispose;
		worker.onmessageerror = dispose;
		worker.onmessage = (event) => {
			if (settled || disposed || headerWorker?.worker !== worker) return;
			try {
				if (bridge?.handleMessage(event)) return;
				if (event.data?.type === 'error' && event.data.code === 'output-limit') {
					dispose();
					return;
				}
				if (event.data?.type !== 'precompiled-header') return;
				if (event.data.header) precompiledHeader = event.data.header;
				dispose();
			} catch {
				dispose();
			}
		};
	}

	function resetInput() {
		pendingInput.length = 0;
		pendingInputBytes = 0;
		pendingEof = false;
		inputRequested = false;
		inputBuffer = undefined;
		maxBufferedInputBytes = loadedMaxInputBytes;
	}

	function bufferedInputBytes() {
		const control = inputBuffer && new Int32Array(inputBuffer, 0, 2);
		// DATA remains owned by the consumer until it requests its next chunk.
		const publishedBytes =
			control && Atomics.load(control, 0) === CLANG_STDIN_DATA ? Atomics.load(control, 1) : 0;
		return pendingInputBytes + publishedBytes;
	}

	function assertInputCapacity(actual: number, limit = maxBufferedInputBytes) {
		if (actual > limit) {
			throw new RangeError(`C/C++ stdin buffered bytes exceed ${limit}`);
		}
	}

	function flushInput() {
		if (!inputRequested || !inputBuffer) return;
		const control = new Int32Array(inputBuffer, 0, 2);
		const payload = new Uint8Array(inputBuffer, CLANG_STDIN_HEADER_BYTES);
		const next = pendingInput[0];
		if (next) {
			const length = Math.min(next.byteLength, payload.byteLength);
			payload.set(next.subarray(0, length));
			if (length === next.byteLength) pendingInput.shift();
			else pendingInput[0] = next.slice(length);
			pendingInputBytes -= length;
			Atomics.store(control, 1, length);
			Atomics.store(control, 0, CLANG_STDIN_DATA);
		} else if (pendingEof) {
			Atomics.store(control, 1, 0);
			Atomics.store(control, 0, CLANG_STDIN_EOF);
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
		signal?: AbortSignal,
		executionAssetConfig = assetConfig
	) {
		// The background compiler and the next foreground Worker share one budget.
		if (headerWorker && maxWorkers < 2) headerWorker.dispose();
		const worker = await factory();
		if (token !== generation || signal?.aborted) {
			disposeWorker(worker);
			throw signal?.reason ?? new Error('Process terminated');
		}
		return new Promise<T>((resolve, reject) => {
			let bridge: WorkerAssetBridge | undefined;
			try {
				if (compileLimit)
					bridge = new WorkerAssetBridge(
						worker,
						'clang',
						executionAssetConfig,
						progress,
						compileLimit,
						languageSysroots,
						runtimeCache
					);
			} catch (error) {
				disposeWorker(worker);
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
			const finish = (error?: Error, value?: T, keepForHeader = false) => {
				if (activeWorker !== worker) return;
				activeWorker = undefined;
				cancelWorker = undefined;
				signal?.removeEventListener('abort', abort);
				if (keepForHeader) adoptHeaderWorker(worker, bridge);
				else disposeWorker(worker, bridge);
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
						if (data.type === 'error' && data.code === 'output-limit') {
							finish(
								new OutputLimitError(data.error, {
									limit: data.limit,
									actual: data.actual,
									phase: 'compile'
								})
							);
							return;
						}
						for (const diagnostic of data.diagnostics ?? []) {
							legacy.oncompilerdiagnostic?.({ ...diagnostic });
						}
						if (data.stdout) legacy.output?.(data.stdout);
						if (data.stderr) legacy.output?.(data.stderr);
						const keepForHeader = data.precompiledHeader === 'building';
						if (data.type === 'error')
							finish(new Error(data.error), undefined, keepForHeader);
						else
							finish(
								undefined,
								{
									artifact: data.artifact,
									diagnostics: data.diagnostics ?? []
								} as T,
								keepForHeader
							);
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
				globalThis.location?.href || 'http://localhost/',
				options.persistentCache
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
			maxWasmMemoryBytes = resolveExecutionLimits(options.limits).maxWasmMemoryBytes;
			loadedMaxInputBytes = Math.min(
				MAX_BUFFERED_INPUT_BYTES,
				resolveExecutionLimits(options.limits).maxWorkspaceBytes
			);
			maxBufferedInputBytes = loadedMaxInputBytes;
			loadedHeaderTimeoutMs = Math.min(
				MAX_HEADER_BUILD_TIMEOUT_MS,
				resolveExecutionLimits(options.limits).compileTimeoutMs
			);
			loadedMaxWorkers = resolveExecutionLimits(options.limits).maxWorkers;
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
			if (running) throw new Error('C/C++ sandbox is already running');
			if (
				cached &&
				((options.debugMode || (options.debug ? 'trace' : 'none')) !== 'none' ||
					(options.stdin !== undefined && typeof options.stdin !== 'string') ||
					options.workspaceFiles?.some((file) => typeof file.content !== 'string'))
			) {
				await overrides.load(
					loadedAssets,
					code,
					log,
					args,
					{
						...options,
						persistentCache: assetConfig.persistentCache
					},
					progress
				);
			}
			if (!cached) return legacy.run(code, prepare, log, progress, args, options);
			const executionAssetConfig = {
				...assetConfig,
				persistentCache: resolveRuntimeAssetCacheOptions(
					assetConfig.persistentCache,
					options.persistentCache
				)
			};
			options.signal?.throwIfAborted();
			const token = ++generation;
			headerTimeoutMs = Math.min(
				loadedHeaderTimeoutMs,
				resolveExecutionLimits(options.limits).compileTimeoutMs
			);
			maxWorkers = Math.min(
				loadedMaxWorkers,
				resolveExecutionLimits(options.limits).maxWorkers
			);
			// Reactive UI arrays/records are Proxies and cannot cross postMessage.
			// Snapshot known fields before awaiting compilation, so the cache key,
			// compiler and executor also observe the same input values.
			const request: BrowserClangCompileRequest = {
				maxWasmMemoryBytes: Math.min(
					maxWasmMemoryBytes,
					resolveExecutionLimits(options.limits).maxWasmMemoryBytes
				),
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
			const inputLimit = Math.min(
				loadedMaxInputBytes,
				resolveExecutionLimits(options.limits).maxWorkspaceBytes
			);
			if (!prepare && typeof stdin === 'string') {
				// A string stdin is a complete input stream and replaces any queued writes.
				// Check UTF-16 length first to avoid encoding an arbitrarily large write.
				assertInputCapacity(stdin.length, inputLimit);
				assertInputCapacity(encoder.encode(stdin).byteLength, inputLimit);
				resetInput();
				pendingEof = true;
			} else {
				assertInputCapacity(bufferedInputBytes(), inputLimit);
			}
			const limit = Math.min(
				maxAssetBytes,
				resolveExecutionLimits(options.limits).maxAssetBytes
			);
			const key = clangCompileKey(runtimeBaseUrl, limit, request, languageSysroots);
			let artifact = cache.get(key);
			// Per-run backpressure starts only after admission and ends with this run.
			maxBufferedInputBytes = inputLimit;
			running = true;
			try {
				if (artifact) {
					for (const diagnostic of cache.getDiagnostics(key))
						legacy.oncompilerdiagnostic?.(diagnostic);
					if (token !== generation) throw new Error('Process terminated');
				} else {
					const compiled = await workerOperation<{
						artifact: BrowserClangArtifact;
						diagnostics: CompilerDiagnostic[];
					}>(
						() => factories.compile(),
						{
							request,
							runtimeBaseUrl,
							maxAssetBytes: limit,
							maxOutputBytes: resolveExecutionLimits(options.limits).maxOutputBytes,
							languageSysroots,
							log,
							persistentCache: executionAssetConfig.persistentCache,
							...(language === 'CPP' && precompiledHeader
								? { precompiledHeader }
								: {}),
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
						options.signal,
						executionAssetConfig
					);
					if (token !== generation) throw new Error('Process terminated');
					artifact = compiled.artifact;
					cache.set(key, artifact, compiled.diagnostics);
				}
				progress?.set?.(1);
				if (prepare) return true;
				inputBuffer = new SharedArrayBuffer(
					Math.min(65536, maxBufferedInputBytes) + CLANG_STDIN_HEADER_BYTES
				);
				return await workerOperation<boolean>(
					() => factories.execute(),
					{
						artifact,
						maxWasmMemoryBytes: request.maxWasmMemoryBytes,
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
					maxBufferedInputBytes = loadedMaxInputBytes;
					if (!prepare) resetInput();
				}
			}
		},
		write(input: string) {
			if (disposed) throw new Error('C/C++ sandbox was disposed');
			if (!cached) return legacy.write?.(input);
			if (pendingEof) throw new Error('C/C++ stdin is closed');
			if (input) {
				const buffered = bufferedInputBytes();
				assertInputCapacity(buffered + input.length);
				const bytes = encoder.encode(input);
				assertInputCapacity(buffered + bytes.byteLength);
				pendingInput.push(bytes);
				pendingInputBytes += bytes.byteLength;
			}
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
			headerWorker?.dispose();
			precompiledHeader = undefined;
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
