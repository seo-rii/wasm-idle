import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	BASH_WORKER_PROTOCOL_VERSION,
	isBashWorkerToHostMessage,
	type BashHostToWorkerMessage,
	type BashSerializedError,
	type BashWorkerAssetConfig,
	type BashWorkerToHostMessage
} from '$lib/playground/bashWorkerProtocol';
import { WASM_BASH_WEBC_RECEIPT } from '$lib/playground/wasmBashVersion';
import {
	AssetTooLargeError,
	AssetIntegrityError,
	AssetNotFoundError,
	BusyError,
	CancelledError,
	CompileError,
	DEFAULT_WORKSPACE_LIMITS,
	DiagnosticLimitError,
	OutputLimitError,
	ProtocolError,
	ResourceLimitError,
	RuntimeConfigurationError,
	RuntimeExecutionError,
	TimeoutError,
	UnsupportedBrowserFeatureError,
	UnsupportedLanguageError,
	WasmIdleError,
	WorkerStartupError,
	resolveExecutionLimits,
	validateExecutionWorkspace,
	type ExecutionLimits,
	type RuntimeAssetIntegrityEntry,
	type RuntimePhase,
	type WorkspaceLimits
} from '@wasm-idle/core';

type BashRuntimeAssetConfig = PlaygroundRuntimeAssets & {
	bash?: {
		moduleUrl?: string;
		webcUrl?: string;
		workerUrl?: string;
		webcReceipt?: RuntimeAssetIntegrityEntry;
	};
};

type ResolvedBashConfig = {
	assets: BashWorkerAssetConfig;
	identity: string;
	limits: ExecutionLimits;
};

type BashWorkerHandle = {
	identity: string;
	ready: boolean;
	retired: boolean;
	sessionId: number;
	worker: Worker;
};

type BashRunRequest = {
	activePath: string;
	code: string;
	limits: ExecutionLimits;
	log: boolean;
	programArgs: string[];
	stdin?: string;
	workspaceFiles: Array<{ path: string; content: string }>;
	workspaceLimits: WorkspaceLimits;
};

type BashOperation = {
	config: ResolvedBashConfig;
	decoders: Readonly<{
		stderr: TextDecoder;
		stdout: TextDecoder;
	}>;
	handle: BashWorkerHandle | null;
	kind: 'load' | 'run';
	onAbort?: () => void;
	outputBytes: number;
	progress?: SandboxProgress;
	reject: (reason?: unknown) => void;
	requestId: number;
	resolve: (value?: boolean | string | void) => void;
	runRequest?: BashRunRequest;
	settled: boolean;
	started: boolean;
	signal?: AbortSignal;
	stage: 'startup' | 'execute';
	stdinReady: boolean;
	timeout?: ReturnType<typeof setTimeout>;
	token: symbol;
};

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const textEncoder = new TextEncoder();

const abortReason = (signal: AbortSignal, phase: BashOperation['stage']) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup' ? 'Bash runtime startup aborted' : 'Bash execution aborted',
				'AbortError'
			);

class Bash implements Sandbox {
	output?: (data: string) => void;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	webcUrl = '';
	pendingInput: string[] = [];
	pendingEof = false;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	private activeOperation: BashOperation | null = null;
	private readyWorker: BashWorkerHandle | null = null;
	private loadedConfig: ResolvedBashConfig | null = null;
	private requestUid = 0;
	private sessionUid = 0;

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	): Promise<void> {
		if (this.activeOperation) {
			return Promise.reject(
				new BusyError('Bash runtime already has an active operation', {
					phase: this.activeOperation.stage,
					runtimeId: 'BASH'
				})
			);
		}

		let resolvePromise!: () => void;
		let rejectPromise!: (reason?: unknown) => void;
		const promise = new Promise<void>((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		});
		const provisionalConfig = {
			assets: {
				sdkModuleUrl: '',
				sdkThreadWorkerUrl: '',
				webcUrl: '',
				webcReceipt: WASM_BASH_WEBC_RECEIPT
			},
			identity: '',
			limits: resolveExecutionLimits()
		} satisfies ResolvedBashConfig;
		const operation: BashOperation = {
			config: provisionalConfig,
			decoders: { stderr: new TextDecoder(), stdout: new TextDecoder() },
			handle: null,
			kind: 'load',
			outputBytes: 0,
			progress,
			reject: rejectPromise,
			requestId: 0,
			resolve: () => resolvePromise(),
			settled: false,
			started: false,
			stage: 'startup',
			stdinReady: false,
			token: Symbol('bash-load')
		};
		this.activeOperation = operation;

		try {
			const signal = options.signal;
			this.requireActive(operation);
			if (signal?.aborted) throw abortReason(signal, 'startup');
			const limits = resolveExecutionLimits(options.limits);
			this.requireActive(operation);

			let configuredWebcUrl: string | undefined;
			let configuredSdkUrl: string | undefined;
			let configuredWorkerUrl: string | undefined;
			let configuredWebcReceipt: RuntimeAssetIntegrityEntry | undefined;
			let rootUrl = '';
			if (runtimeAssets && typeof runtimeAssets === 'object') {
				const bashAssets = (runtimeAssets as BashRuntimeAssetConfig).bash;
				this.requireActive(operation);
				if (bashAssets) {
					configuredWebcUrl = bashAssets.webcUrl;
					configuredSdkUrl = bashAssets.moduleUrl;
					configuredWorkerUrl = bashAssets.workerUrl;
					configuredWebcReceipt = bashAssets.webcReceipt;
					this.requireActive(operation);
				}
				if (!configuredWebcUrl || !configuredSdkUrl || !configuredWorkerUrl) {
					rootUrl = (runtimeAssets as BashRuntimeAssetConfig).rootUrl || '';
					this.requireActive(operation);
				}
			} else {
				rootUrl = typeof runtimeAssets === 'string' ? runtimeAssets : '';
			}
			const normalizedRoot = rootUrl.endsWith('/') ? rootUrl.slice(0, -1) : rootUrl;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const resolveUrl = (value: string) =>
				currentUrl ? new URL(value, currentUrl).href : value;
			const receipt = configuredWebcReceipt ?? WASM_BASH_WEBC_RECEIPT;
			const receiptBytes = receipt.bytes;
			const receiptSha256 = receipt.sha256;
			if (
				receiptBytes === undefined ||
				!Number.isSafeInteger(receiptBytes) ||
				receiptBytes <= 0 ||
				typeof receiptSha256 !== 'string' ||
				!/^[a-f0-9]{64}$/u.test(receiptSha256)
			) {
				throw new RuntimeConfigurationError(
					'Bash WEBc receipt must provide a positive byte size and lowercase SHA-256 digest',
					{ phase: 'asset', runtimeId: 'BASH' }
				);
			}
			if (receiptBytes > limits.maxAssetBytes) {
				throw new AssetTooLargeError(
					`Bash WEBc receipt exceeds the ${limits.maxAssetBytes} byte limit`,
					{
						actual: receiptBytes,
						limit: limits.maxAssetBytes,
						runtimeId: 'BASH'
					}
				);
			}
			const assets: BashWorkerAssetConfig = Object.freeze({
				sdkModuleUrl: resolveUrl(
					configuredSdkUrl || `${normalizedRoot}/wasm-bash/sdk/index.mjs`
				),
				sdkThreadWorkerUrl: resolveUrl(
					configuredWorkerUrl || `${normalizedRoot}/wasm-bash/sdk/worker.mjs`
				),
				webcUrl: resolveUrl(configuredWebcUrl || `${normalizedRoot}/wasm-bash/bash.webc`),
				webcReceipt: Object.freeze({ bytes: receiptBytes, sha256: receiptSha256 })
			});
			const config: ResolvedBashConfig = {
				assets,
				identity: JSON.stringify([assets, limits.maxAssetBytes]),
				limits
			};
			operation.config = config;
			operation.signal = signal;
			this.bindAbort(operation);
			this.requireActive(operation);

			if (this.readyWorker?.ready && this.readyWorker.identity === config.identity) {
				progress?.set?.(1, 'Bash runtime ready');
				this.requireActive(operation);
				this.loadedConfig = config;
				this.webcUrl = config.assets.webcUrl;
				this.finishOperation(operation);
				return promise;
			}

			this.bindTimeout(
				operation,
				Math.min(MAX_TIMER_DELAY_MS, limits.assetTimeoutMs + limits.startupTimeoutMs)
			);
			this.requireActive(operation);
			void this.createWorker(operation)
				.then((handle) => {
					if (!this.isActive(operation)) {
						this.retireWorker(handle);
						return;
					}
					this.dispatchLoad(operation, handle, log);
				})
				.catch(() => undefined);
		} catch (error) {
			this.failOperation(operation, error, false);
		}
		return promise;
	}

	run(
		code: string,
		prepare: boolean,
		log = true,
		progress?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (this.activeOperation) {
			return Promise.reject(
				new BusyError('Bash runtime already has an active operation', {
					phase: this.activeOperation.stage,
					runtimeId: 'BASH'
				})
			);
		}
		if (prepare) return Promise.resolve(true);
		if (!this.loadedConfig) return Promise.reject(new Error('Bash runtime is not loaded'));

		let resolvePromise!: (value: boolean | string) => void;
		let rejectPromise!: (reason?: unknown) => void;
		const promise = new Promise<boolean | string>((resolve, reject) => {
			resolvePromise = resolve;
			rejectPromise = reject;
		});
		const operation: BashOperation = {
			config: this.loadedConfig,
			decoders: { stderr: new TextDecoder(), stdout: new TextDecoder() },
			handle: null,
			kind: 'run',
			outputBytes: 0,
			progress,
			reject: rejectPromise,
			requestId: 0,
			resolve: (value) => resolvePromise(value as boolean | string),
			settled: false,
			started: false,
			stage: this.readyWorker ? 'execute' : 'startup',
			stdinReady: false,
			token: Symbol('bash-run')
		};
		this.activeOperation = operation;

		try {
			const signal = options.signal;
			this.requireActive(operation);
			if (signal?.aborted) throw abortReason(signal, operation.stage);
			const limits = resolveExecutionLimits(options.limits);
			this.requireActive(operation);
			const programArgsSource = options.programArgs ?? args;
			if (!Array.isArray(programArgsSource)) {
				throw new TypeError('Bash program arguments must be an array');
			}
			const programArgs = [...programArgsSource];
			const workspaceFilesSource = options.workspaceFiles ?? [];
			if (!Array.isArray(workspaceFilesSource)) {
				throw new TypeError('Bash workspace files must be an array');
			}
			const workspaceFiles = workspaceFilesSource.map((file) => ({
				path: file.path,
				content: file.content
			}));
			const activePath = options.activePath ?? 'main.sh';
			const workspaceLimitSource = options.workspaceLimits ?? {};
			const workspaceLimits: WorkspaceLimits = {
				maxFiles: workspaceLimitSource.maxFiles ?? DEFAULT_WORKSPACE_LIMITS.maxFiles,
				maxFileBytes: Math.min(
					workspaceLimitSource.maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
					limits.maxWorkspaceBytes
				),
				maxTotalBytes: Math.min(
					workspaceLimitSource.maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
					limits.maxWorkspaceBytes
				),
				maxPathBytes:
					workspaceLimitSource.maxPathBytes ?? DEFAULT_WORKSPACE_LIMITS.maxPathBytes,
				caseSensitive:
					workspaceLimitSource.caseSensitive ?? DEFAULT_WORKSPACE_LIMITS.caseSensitive
			};
			const workspace = validateExecutionWorkspace(
				code,
				workspaceFiles,
				activePath,
				workspaceLimits
			);
			this.requireActive(operation);
			const stdin = options.stdin;
			this.requireActive(operation);
			operation.signal = signal;
			operation.runRequest = {
				activePath: workspace.activePath ?? 'main.sh',
				code,
				limits,
				log,
				programArgs,
				stdin,
				workspaceFiles: workspace.workspaceFiles,
				workspaceLimits
			};
			this.bindAbort(operation);
			this.requireActive(operation);
			const needsStartup = !this.readyWorker;
			const timeoutMs = Math.min(
				MAX_TIMER_DELAY_MS,
				limits.compileTimeoutMs +
					limits.runTimeoutMs +
					(needsStartup
						? operation.config.limits.assetTimeoutMs +
							operation.config.limits.startupTimeoutMs
						: 0)
			);
			this.bindTimeout(operation, timeoutMs);
			this.requireActive(operation);
			operation.started = true;
			this.begin = Date.now();
			this.exit = false;
			if (stdin !== undefined) {
				this.pendingInput = [];
				this.pendingEof = false;
			}

			if (this.readyWorker) {
				operation.handle = this.readyWorker;
				operation.stage = 'execute';
				this.dispatchRun(operation, this.readyWorker);
			} else {
				void this.createWorker(operation)
					.then((handle) => {
						if (!this.isActive(operation)) {
							this.retireWorker(handle);
							return;
						}
						this.dispatchLoad(operation, handle, false);
					})
					.catch(() => undefined);
			}
		} catch (error) {
			this.failOperation(operation, error, false);
		}
		return promise;
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		const operation = this.activeOperation;
		if (operation?.kind === 'run' && operation.stdinReady) this.flushStdin(operation);
	}

	eof() {
		this.pendingEof = true;
		const operation = this.activeOperation;
		if (operation?.kind === 'run' && operation.stdinReady) this.flushStdin(operation);
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		const operation = this.activeOperation;
		if (operation) {
			this.failOperation(operation, reason, true);
			return;
		}
		const readyWorker = this.readyWorker;
		if (readyWorker) this.retireWorker(readyWorker);
		this.pendingInput = [];
		this.pendingEof = false;
		this.exit = true;
	}

	async clear() {
		this.terminate();
		const readyWorker = this.readyWorker;
		if (readyWorker) this.retireWorker(readyWorker);
		this.pendingInput = [];
		this.pendingEof = false;
		this.loadedConfig = null;
		this.webcUrl = '';
	}

	async dispose() {
		await this.clear();
	}

	private isActive(operation: BashOperation) {
		return this.activeOperation?.token === operation.token && !operation.settled;
	}

	private requireActive(operation: BashOperation) {
		if (!this.isActive(operation)) throw new Error('Bash operation was superseded');
	}

	private bindAbort(operation: BashOperation) {
		const signal = operation.signal;
		if (!signal) return;
		const onAbort = () => {
			if (!this.isActive(operation)) return;
			let reason: unknown;
			try {
				reason = abortReason(signal, operation.stage);
			} catch (error) {
				reason = error;
			}
			if (this.isActive(operation)) this.failOperation(operation, reason, true);
		};
		operation.onAbort = onAbort;
		try {
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		} catch (error) {
			if (this.isActive(operation)) this.failOperation(operation, error, true);
		}
	}

	private bindTimeout(operation: BashOperation, timeoutMs: number) {
		try {
			operation.timeout = setTimeout(() => {
				if (!this.isActive(operation)) return;
				const phase: RuntimePhase = operation.stage === 'startup' ? 'startup' : 'execute';
				this.failOperation(
					operation,
					new TimeoutError(`Bash ${operation.stage} timed out after ${timeoutMs} ms`, {
						phase,
						runtimeId: 'BASH',
						timeoutMs
					}),
					true
				);
			}, timeoutMs);
		} catch (error) {
			this.failOperation(operation, error, false);
		}
	}

	private cleanupOperation(operation: BashOperation) {
		if (operation.timeout !== undefined) {
			try {
				clearTimeout(operation.timeout);
			} catch {
				// Timer cleanup must not replace the operation result.
			}
			operation.timeout = undefined;
		}
		if (operation.signal && operation.onAbort) {
			try {
				operation.signal.removeEventListener('abort', operation.onAbort);
			} catch {
				// Listener cleanup must not replace the operation result.
			}
			operation.onAbort = undefined;
		}
	}

	private finishOperation(operation: BashOperation, value?: boolean | string | void) {
		if (!this.isActive(operation)) return;
		operation.settled = true;
		this.activeOperation = null;
		this.cleanupOperation(operation);
		if (operation.kind === 'run') {
			if (operation.runRequest?.stdin !== undefined) {
				this.pendingInput = [];
				this.pendingEof = false;
			}
			this.elapse = Date.now() - this.begin;
			this.exit = true;
		}
		operation.resolve(value);
	}

	private failOperation(operation: BashOperation, reason: unknown, retireHandle: boolean) {
		if (!this.isActive(operation)) return;
		operation.settled = true;
		this.activeOperation = null;
		this.cleanupOperation(operation);
		if (retireHandle && operation.handle) this.retireWorker(operation.handle);
		if (operation.kind === 'run' && operation.started) {
			this.pendingInput = [];
			this.pendingEof = false;
			this.elapse = Date.now() - this.begin;
			this.exit = true;
		}
		operation.reject(reason);
	}

	private async createWorker(operation: BashOperation) {
		let WorkerConstructor: new () => Worker;
		try {
			WorkerConstructor = (await import('$lib/playground/worker/bash?worker')).default;
		} catch (cause) {
			const error = new WorkerStartupError('Failed to load the Bash outer worker module', {
				cause,
				runtimeId: 'BASH'
			});
			this.failOperation(operation, error, false);
			throw error;
		}
		if (!this.isActive(operation)) throw new Error('Bash operation was cancelled');

		let worker: Worker;
		try {
			worker = new WorkerConstructor();
		} catch (cause) {
			const error = new WorkerStartupError('Failed to start the Bash outer worker', {
				cause,
				runtimeId: 'BASH'
			});
			this.failOperation(operation, error, false);
			throw error;
		}
		const handle: BashWorkerHandle = {
			identity: operation.config.identity,
			ready: false,
			retired: false,
			sessionId: ++this.sessionUid,
			worker
		};
		operation.handle = handle;
		worker.onmessage = (event: MessageEvent<unknown>) => {
			this.handleWorkerMessage(handle, event.data);
		};
		worker.onerror = (event: ErrorEvent) => {
			this.handleWorkerFailure(handle, event);
		};
		worker.onmessageerror = (event: MessageEvent<unknown>) => {
			this.handleWorkerProtocolFailure(handle, event);
		};
		return handle;
	}

	private dispatchLoad(operation: BashOperation, handle: BashWorkerHandle, log: boolean) {
		if (!this.isActive(operation) || operation.handle !== handle) return;
		operation.stage = 'startup';
		operation.requestId = ++this.requestUid;
		const message: BashHostToWorkerMessage = {
			type: 'load',
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			sessionId: handle.sessionId,
			requestId: operation.requestId,
			assets: operation.config.assets,
			limits: operation.config.limits,
			log
		};
		this.postMessage(operation, handle, message);
	}

	private dispatchRun(operation: BashOperation, handle: BashWorkerHandle) {
		const request = operation.runRequest;
		if (!request || !this.isActive(operation) || operation.handle !== handle) return;
		operation.stage = 'execute';
		operation.requestId = ++this.requestUid;
		const message: BashHostToWorkerMessage = {
			type: 'run',
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			sessionId: handle.sessionId,
			requestId: operation.requestId,
			code: request.code,
			activePath: request.activePath,
			workspaceFiles: request.workspaceFiles,
			programArgs: request.programArgs,
			stdin: request.stdin,
			limits: request.limits,
			workspaceLimits: request.workspaceLimits,
			log: request.log
		};
		this.postMessage(operation, handle, message);
	}

	private postMessage(
		operation: BashOperation,
		handle: BashWorkerHandle,
		message: BashHostToWorkerMessage,
		transfer: Transferable[] = []
	) {
		if (!this.isActive(operation) || operation.handle !== handle) return;
		try {
			handle.worker.postMessage(message, transfer);
		} catch (cause) {
			this.failOperation(
				operation,
				new ProtocolError(`Failed to send Bash worker ${message.type} message`, {
					cause,
					runtimeId: 'BASH'
				}),
				true
			);
		}
	}

	private handleWorkerMessage(handle: BashWorkerHandle, message: unknown) {
		const operation = this.activeOperation;
		if (!operation || operation.handle !== handle || handle.retired) return;
		if (!message || typeof message !== 'object') {
			this.failProtocol(operation, 'Bash worker returned a non-object message', message);
			return;
		}
		const envelope = message as Record<string, unknown>;
		if (envelope.protocolVersion !== BASH_WORKER_PROTOCOL_VERSION) {
			this.failProtocol(
				operation,
				`Unsupported Bash worker protocol version: ${String(envelope.protocolVersion)}`,
				message
			);
			return;
		}
		if (
			!Number.isSafeInteger(envelope.sessionId) ||
			(envelope.sessionId as number) <= 0 ||
			!Number.isSafeInteger(envelope.requestId) ||
			(envelope.requestId as number) <= 0
		) {
			this.failProtocol(
				operation,
				'Bash worker returned an invalid request identity',
				message
			);
			return;
		}
		if (envelope.sessionId !== handle.sessionId) {
			this.failProtocol(
				operation,
				'Bash worker returned an unexpected session identity',
				message
			);
			return;
		}
		if (operation.requestId === 0) {
			this.failProtocol(operation, 'Bash worker responded before request dispatch', message);
			return;
		}
		if ((envelope.requestId as number) < operation.requestId) return;
		if (envelope.requestId !== operation.requestId) {
			this.failProtocol(operation, 'Bash worker returned a future request identity', message);
			return;
		}
		if (!isBashWorkerToHostMessage(message)) {
			this.failProtocol(operation, 'Bash worker returned an invalid message', message);
			return;
		}

		switch (message.type) {
			case 'progress':
				try {
					operation.progress?.set?.(message.value, message.stage);
				} catch (error) {
					this.failOperation(operation, error, true);
				}
				return;
			case 'loaded': {
				if (operation.stage !== 'startup') {
					this.failProtocol(operation, 'Bash worker loaded outside startup', message);
					return;
				}
				if (operation.kind === 'run') {
					handle.ready = true;
					this.readyWorker = handle;
					this.dispatchRun(operation, handle);
					return;
				}
				try {
					operation.progress?.set?.(1, 'Bash runtime ready');
				} catch (error) {
					this.failOperation(operation, error, true);
					return;
				}
				if (!this.isActive(operation)) return;
				const previousWorker = this.readyWorker;
				handle.ready = true;
				this.readyWorker = handle;
				this.loadedConfig = operation.config;
				this.webcUrl = operation.config.assets.webcUrl;
				this.finishOperation(operation);
				if (previousWorker && previousWorker !== handle) this.retireWorker(previousWorker);
				return;
			}
			case 'stdin-ready':
				if (operation.kind !== 'run' || operation.stage !== 'execute') {
					this.failProtocol(
						operation,
						'Bash worker requested stdin outside execution',
						message
					);
					return;
				}
				operation.stdinReady = true;
				this.flushStdin(operation);
				return;
			case 'output':
				this.handleOutput(operation, message.stream, message.bytes);
				return;
			case 'result':
				if (operation.kind !== 'run' || operation.stage !== 'execute') {
					this.failProtocol(
						operation,
						'Bash worker returned a result outside execution',
						message
					);
					return;
				}
				this.flushDecodedOutput(operation);
				if (this.isActive(operation)) this.finishOperation(operation, message.result);
				return;
			case 'error':
				this.failOperation(
					operation,
					this.deserializeWorkerError(message.error, message.phase),
					true
				);
				return;
			default:
				this.failProtocol(operation, 'Bash worker returned an unknown message', message);
		}
	}

	private handleOutput(operation: BashOperation, stream: 'stdout' | 'stderr', bytes: Uint8Array) {
		if (operation.kind !== 'run' || operation.stage !== 'execute') {
			this.failProtocol(operation, 'Bash worker emitted output outside execution', bytes);
			return;
		}
		if (
			!ArrayBuffer.isView(bytes) ||
			Object.prototype.toString.call(bytes) !== '[object Uint8Array]'
		) {
			this.failProtocol(operation, 'Bash worker output must be Uint8Array bytes', bytes);
			return;
		}
		const actual = operation.outputBytes + bytes.byteLength;
		const limit = operation.runRequest?.limits.maxOutputBytes ?? 0;
		if (actual > limit) {
			this.failOperation(
				operation,
				new OutputLimitError(`Bash output exceeded ${limit} bytes`, {
					actual,
					limit,
					phase: 'execute',
					runtimeId: 'BASH'
				}),
				true
			);
			return;
		}
		operation.outputBytes = actual;
		const output = operation.decoders[stream].decode(bytes, { stream: true });
		if (!output) return;
		try {
			this.output?.(output);
		} catch (error) {
			this.failOperation(operation, error, true);
		}
	}

	private flushDecodedOutput(operation: BashOperation) {
		for (const stream of ['stdout', 'stderr'] as const) {
			let output: string;
			try {
				output = operation.decoders[stream].decode();
			} catch (error) {
				this.failProtocol(operation, 'Bash output was not valid streaming UTF-8', error);
				return;
			}
			if (!output) continue;
			try {
				this.output?.(output);
			} catch (error) {
				this.failOperation(operation, error, true);
				return;
			}
		}
	}

	private flushStdin(operation: BashOperation) {
		const handle = operation.handle;
		if (!handle || !this.isActive(operation) || !operation.stdinReady) return;
		while (this.pendingInput.length > 0 && this.isActive(operation)) {
			const input = this.pendingInput.shift()!;
			const bytes = textEncoder.encode(input);
			const message: BashHostToWorkerMessage = {
				type: 'stdin',
				protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
				sessionId: handle.sessionId,
				requestId: operation.requestId,
				bytes
			};
			this.postMessage(operation, handle, message, [bytes.buffer]);
		}
		if (this.pendingEof && this.isActive(operation)) {
			this.pendingEof = false;
			this.postMessage(operation, handle, {
				type: 'stdin-eof',
				protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
				sessionId: handle.sessionId,
				requestId: operation.requestId
			});
		}
	}

	private handleWorkerFailure(handle: BashWorkerHandle, event: ErrorEvent) {
		const operation = this.activeOperation;
		if (handle.retired) return;
		if (!operation || operation.handle !== handle) {
			if (this.readyWorker === handle) this.retireWorker(handle);
			return;
		}
		const location =
			event.filename && event.lineno
				? ` (${event.filename}:${event.lineno}:${event.colno})`
				: '';
		const message = `Bash outer worker script error: ${event.message || 'unknown error'}${location}`;
		const error =
			operation.stage === 'startup'
				? new WorkerStartupError(message, { cause: event, runtimeId: 'BASH' })
				: new RuntimeExecutionError(message, {
						cause: event,
						phase: 'execute',
						runtimeId: 'BASH'
					});
		this.failOperation(operation, error, true);
	}

	private handleWorkerProtocolFailure(handle: BashWorkerHandle, cause: unknown) {
		const operation = this.activeOperation;
		if (handle.retired) return;
		if (!operation || operation.handle !== handle) {
			if (this.readyWorker === handle) this.retireWorker(handle);
			return;
		}
		this.failOperation(
			operation,
			new ProtocolError('Bash worker message deserialization failed', {
				cause,
				runtimeId: 'BASH'
			}),
			true
		);
	}

	private failProtocol(operation: BashOperation, message: string, cause: unknown) {
		this.failOperation(
			operation,
			new ProtocolError(message, { cause, runtimeId: 'BASH' }),
			true
		);
	}

	private deserializeWorkerError(error: BashSerializedError, phase: RuntimePhase) {
		const context = {
			cause: error,
			phase,
			...(error.profileId ? { profileId: error.profileId } : {}),
			...(error.recoverable === undefined ? {} : { recoverable: error.recoverable }),
			runtimeId: 'BASH'
		};
		let deserialized: Error;
		if (phase === 'protocol' || error.code === 'protocol') {
			deserialized = new ProtocolError(error.message, context);
		} else {
			switch (error.code) {
				case 'unsupported-language':
					deserialized = error.languageId
						? new UnsupportedLanguageError(error.languageId, context)
						: new WasmIdleError(error.message, {
								...context,
								code: 'unsupported-language'
							});
					break;
				case 'busy':
					deserialized = new BusyError(error.message, context);
					break;
				case 'runtime-configuration':
					deserialized = new RuntimeConfigurationError(error.message, context);
					break;
				case 'asset-not-found':
					deserialized = new AssetNotFoundError(error.message, context);
					break;
				case 'asset-integrity':
					deserialized = new AssetIntegrityError(error.message, context);
					break;
				case 'asset-too-large':
					deserialized = new AssetTooLargeError(error.message, {
						...context,
						actual: error.actual,
						limit: error.limit
					});
					break;
				case 'worker-startup':
					deserialized = new WorkerStartupError(error.message, context);
					break;
				case 'compile':
					deserialized = new CompileError(error.message, context);
					break;
				case 'runtime':
					deserialized = new RuntimeExecutionError(error.message, context);
					break;
				case 'timeout':
					deserialized =
						error.timeoutMs === undefined
							? new WasmIdleError(error.message, { ...context, code: 'timeout' })
							: new TimeoutError(error.message, {
									...context,
									timeoutMs: error.timeoutMs
								});
					break;
				case 'cancelled':
					deserialized = new CancelledError(error.message, context);
					break;
				case 'resource-limit':
					deserialized =
						error.actual === undefined ||
						error.limit === undefined ||
						error.resource === undefined
							? new WasmIdleError(error.message, {
									...context,
									code: 'resource-limit'
								})
							: new ResourceLimitError(error.message, {
									...context,
									actual: error.actual,
									limit: error.limit,
									resource: error.resource
								});
					break;
				case 'output-limit':
					deserialized =
						error.actual === undefined || error.limit === undefined
							? new WasmIdleError(error.message, {
									...context,
									code: 'output-limit'
								})
							: new OutputLimitError(error.message, {
									...context,
									actual: error.actual,
									limit: error.limit
								});
					break;
				case 'diagnostic-limit':
					deserialized =
						error.actual === undefined || error.limit === undefined
							? new WasmIdleError(error.message, {
									...context,
									code: 'diagnostic-limit'
								})
							: new DiagnosticLimitError(error.message, {
									...context,
									actual: error.actual,
									limit: error.limit
								});
					break;
				case 'unsupported-browser-feature':
					deserialized = error.feature
						? new UnsupportedBrowserFeatureError(error.feature, context)
						: new WasmIdleError(error.message, {
								...context,
								code: 'unsupported-browser-feature'
							});
					break;
				default:
					deserialized =
						phase === 'execute'
							? new RuntimeExecutionError(error.message, context)
							: new WorkerStartupError(error.message, context);
			}
		}
		if (deserialized.name === 'WasmIdleError' && error.name) {
			deserialized.name = error.name;
		}
		if (error.stack) deserialized.stack = error.stack;
		return deserialized;
	}

	private retireWorker(handle: BashWorkerHandle) {
		if (handle.retired) return;
		handle.retired = true;
		if (this.readyWorker === handle) this.readyWorker = null;
		try {
			handle.worker.onmessage = null;
		} catch {
			// Handler cleanup remains best effort.
		}
		try {
			handle.worker.onerror = null;
		} catch {
			// Handler cleanup remains best effort.
		}
		try {
			handle.worker.onmessageerror = null;
		} catch {
			// Handler cleanup remains best effort.
		}
		try {
			handle.worker.terminate();
		} catch {
			// The worker may already be detached.
		}
	}
}

export default Bash;
