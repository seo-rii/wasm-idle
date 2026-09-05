import {
	resolveOcamlManifestUrl,
	resolveOcamlModuleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import {
	type CompilerDiagnostic,
	type OcamlBackend,
	type OcamlWasmBinaryenMode,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerInputReady, reportWorkerProgress } from '$lib/playground/workerProgress';
import { WASM_OCAML_RUNTIME_PROFILE } from '$lib/playground/wasmOcamlVersion';
import {
	BusyError,
	CancelledError,
	DEFAULT_WORKSPACE_LIMITS,
	DiagnosticLimitError,
	OutputLimitError,
	ProtocolError,
	RuntimeConfigurationError,
	TimeoutError,
	WorkspaceValidationError,
	resolveExecutionLimits,
	validateExecutionWorkspace,
	type ExecutionLimits,
	type RuntimeAssetIntegrityEntry,
	type WorkspaceLimits
} from '@wasm-idle/core';

const OCAML_EXECUTION_LIMIT_KEYS = [
	'assetTimeoutMs',
	'startupTimeoutMs',
	'compileTimeoutMs',
	'runTimeoutMs',
	'maxOutputBytes',
	'maxDiagnostics',
	'maxWorkspaceBytes',
	'maxAssetBytes',
	'maxWasmMemoryBytes',
	'maxWorkers',
	'maxThreads'
] as const satisfies readonly (keyof ExecutionLimits)[];

const OCAML_WORKSPACE_LIMIT_KEYS = [
	'maxFiles',
	'maxFileBytes',
	'maxTotalBytes',
	'maxPathBytes',
	'caseSensitive'
] as const satisfies readonly (keyof WorkspaceLimits)[];

const OUTPUT_ENCODER = new TextEncoder();

type OcamlOuterAssetReceipt = Readonly<
	Required<Pick<RuntimeAssetIntegrityEntry, 'bytes' | 'sha256'>>
>;

function snapshotOuterAssetReceipt(
	value: RuntimeAssetIntegrityEntry | undefined,
	label: 'module' | 'manifest'
): OcamlOuterAssetReceipt {
	if (
		!value ||
		!Number.isSafeInteger(value.bytes) ||
		(value.bytes as number) <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new RuntimeConfigurationError(`OCaml ${label} receipt is invalid`, {
			phase: 'startup',
			runtimeId: 'OCAML'
		});
	}
	return Object.freeze({ bytes: value.bytes as number, sha256: value.sha256 });
}

const receiptIdentity = (receipt: OcamlOuterAssetReceipt) => `${receipt.bytes}:${receipt.sha256}`;

type OcamlOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	explicitStdin: boolean;
	sessionActive: boolean;
	abortReasonReading: boolean;
	buffer?: ArrayBufferLike;
	timeout?: ReturnType<typeof setTimeout>;
	signal?: AbortSignal;
	onAbort?: () => void;
};

class Ocaml implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	manifestUrl = '';
	private moduleReceiptIdentity = '';
	private manifestReceiptIdentity = '';
	private maxAssetBytes = 0;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeOperation: OcamlOperation | null = null;
	private disposed = false;
	private disposePromise: Promise<void> | null = null;
	private readonly disposeCancellation = new CancelledError('OCaml sandbox disposed', {
		phase: 'dispose',
		runtimeId: 'OCAML',
		recoverable: false
	});
	private readonly workerSession = new WorkerSession({
		label: 'OCaml',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	private disposedConfigurationError() {
		return new RuntimeConfigurationError('OCaml sandbox is disposed', {
			phase: 'dispose',
			runtimeId: 'OCAML'
		});
	}

	private beginOperation(phase: OcamlOperation['phase']) {
		if (this.disposed) throw this.disposedConfigurationError();
		if (this.activeOperation) {
			throw new BusyError('OCaml runtime already has an active operation', {
				runtimeId: 'OCAML',
				phase: this.activeOperation.phase
			});
		}
		const operation: OcamlOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			explicitStdin: false,
			sessionActive: false,
			abortReasonReading: false
		};
		this.activeOperation = operation;
		return operation;
	}

	private completeOperation(operation: OcamlOperation) {
		if (this.activeOperation?.token === operation.token) this.activeOperation = null;
		const timeout = operation.timeout;
		operation.timeout = undefined;
		if (timeout !== undefined) {
			try {
				clearTimeout(timeout);
			} catch {
				// Timer cleanup must not replace the operation result.
			}
		}
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

	private isOperationActive(operation: OcamlOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private ownsWorkerOperation(
		operation: OcamlOperation,
		worker: Worker,
		handler: unknown,
		uid?: number
	) {
		return (
			this.isOperationActive(operation) &&
			this.worker === worker &&
			worker.onmessage === handler &&
			(uid === undefined || uid === this.uid)
		);
	}

	private releaseBeforeSession(operation: OcamlOperation, fallback: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : fallback;
		this.completeOperation(operation);
		return outcome;
	}

	private resolveOperationLimits(
		operation: OcamlOperation,
		configured: Partial<ExecutionLimits> | undefined
	) {
		if (configured === undefined) return resolveExecutionLimits();
		if (configured === null || typeof configured !== 'object') {
			throw new TypeError('OCaml execution limits must be an object');
		}
		const snapshot: Partial<ExecutionLimits> = {};
		for (const key of OCAML_EXECUTION_LIMIT_KEYS) {
			const value = configured[key];
			if (!this.isOperationActive(operation)) {
				throw operation.cancellationReason ?? 'OCaml operation cancelled';
			}
			if (value !== undefined) snapshot[key] = value;
		}
		return resolveExecutionLimits(snapshot);
	}

	private resetExplicitStdinState(buffer: ArrayBufferLike) {
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
		try {
			resetBufferedStdin(buffer);
		} catch {
			// Explicit stdin never consumes the shared terminal buffer.
		}
	}

	private finishExplicitStdin(operation: OcamlOperation) {
		if (!operation.explicitStdin) return;
		operation.explicitStdin = false;
		const buffer = operation.buffer;
		if (buffer) this.resetExplicitStdinState(buffer);
	}

	private abortReason(signal: AbortSignal, phase: OcamlOperation['phase']) {
		const reason = signal.reason;
		if (reason !== undefined) return reason;
		return new DOMException(
			phase === 'startup' ? 'OCaml runtime startup aborted' : 'OCaml execution aborted',
			'AbortError'
		);
	}

	private bindAbortSignal(operation: OcamlOperation, signal?: AbortSignal) {
		if (!signal || !this.isOperationActive(operation)) return;
		const onAbort = () => {
			if (this.disposed || !this.isOperationActive(operation) || operation.abortReasonReading)
				return;
			operation.abortReasonReading = true;
			let reason: unknown;
			try {
				reason = this.abortReason(signal, operation.phase);
			} catch (error) {
				reason = error;
			} finally {
				operation.abortReasonReading = false;
			}
			if (!this.isOperationActive(operation)) return;
			if (operation.sessionActive) this.abortOperation(operation, reason);
			else this.cancelBeforeSession(operation, reason);
		};
		operation.signal = signal;
		operation.onAbort = onAbort;
		try {
			signal.addEventListener('abort', onAbort, { once: true });
		} catch (error) {
			if (!this.isOperationActive(operation)) return;
			let signalAborted = false;
			try {
				signalAborted = signal.aborted;
			} catch {
				if (!this.isOperationActive(operation)) return;
			}
			if (signalAborted) onAbort();
			else this.cancelBeforeSession(operation, error);
			return;
		}
		if (!this.isOperationActive(operation)) return;
		try {
			if (signal.aborted) onAbort();
		} catch (error) {
			if (this.isOperationActive(operation)) this.cancelBeforeSession(operation, error);
		}
	}

	private bindOperationTimeout(operation: OcamlOperation, timeoutMs: number) {
		if (!this.isOperationActive(operation)) return;
		let timeout: ReturnType<typeof setTimeout>;
		try {
			timeout = setTimeout(() => {
				if (operation.timeout === timeout) operation.timeout = undefined;
				if (!this.isOperationActive(operation)) return;
				const label = operation.phase === 'startup' ? 'startup' : 'execution';
				this.abortOperation(
					operation,
					new TimeoutError(`OCaml ${label} timed out after ${timeoutMs} ms`, {
						phase: operation.phase,
						runtimeId: 'OCAML',
						timeoutMs
					})
				);
			}, timeoutMs);
		} catch (error) {
			this.abortOperation(operation, error);
			return;
		}
		if (!this.isOperationActive(operation)) {
			try {
				clearTimeout(timeout);
			} catch {
				// The superseded timer can no longer own the operation.
			}
			return;
		}
		operation.timeout = timeout;
	}

	private cancelBeforeSession(operation: OcamlOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.completeOperation(operation);
	}

	private abortOperation(operation: OcamlOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.finishExplicitStdin(operation);
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
		this.completeOperation(operation);
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let operation: OcamlOperation;
		try {
			operation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let signal: AbortSignal | undefined;
		let limits: ExecutionLimits;
		let nextModuleUrl: string;
		let nextManifestUrl: string;
		let nextModuleReceipt: OcamlOuterAssetReceipt;
		let nextManifestReceipt: OcamlOuterAssetReceipt;
		let buffer: ArrayBufferLike;
		try {
			signal = options.signal;
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			this.bindAbortSignal(operation, signal);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			const configuredLimits = options.limits;
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			limits = this.resolveOperationLimits(operation, configuredLimits);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			let resolverAssets: string | PlaygroundRuntimeAssets = runtimeAssets;
			let configuredModuleReceipt: RuntimeAssetIntegrityEntry | undefined;
			let configuredManifestReceipt: RuntimeAssetIntegrityEntry | undefined;
			if (runtimeAssets === null) {
				resolverAssets = {};
			} else if (typeof runtimeAssets === 'object') {
				const source = runtimeAssets.ocaml;
				if (!this.isOperationActive(operation)) {
					return Promise.reject(
						this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
					);
				}
				const moduleUrl = source?.moduleUrl;
				if (!this.isOperationActive(operation)) {
					return Promise.reject(
						this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
					);
				}
				const manifestUrl = source?.manifestUrl;
				if (!this.isOperationActive(operation)) {
					return Promise.reject(
						this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
					);
				}
				configuredModuleReceipt = source?.moduleReceipt;
				if (!this.isOperationActive(operation)) {
					return Promise.reject(
						this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
					);
				}
				configuredManifestReceipt = source?.manifestReceipt;
				if (!this.isOperationActive(operation)) {
					return Promise.reject(
						this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
					);
				}
				let rootUrl: string | undefined;
				let rootUrlRead = false;
				resolverAssets = { ocaml: source ? { moduleUrl, manifestUrl } : undefined };
				Object.defineProperty(resolverAssets, 'rootUrl', {
					get: () => {
						if (!rootUrlRead) {
							rootUrlRead = true;
							rootUrl = runtimeAssets.rootUrl;
						}
						if (!this.isOperationActive(operation)) {
							throw operation.cancellationReason;
						}
						return rootUrl;
					}
				});
			}
			nextModuleUrl = resolveOcamlModuleUrl(resolverAssets, currentUrl);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			nextManifestUrl = resolveOcamlManifestUrl(resolverAssets, currentUrl);
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
			if (!nextModuleUrl || !nextManifestUrl) {
				throw 'OCaml runtime is not configured. Set runtimeAssets.ocaml.moduleUrl and runtimeAssets.ocaml.manifestUrl or sync the bundled wasm-of-js-of-ocaml assets.';
			}
			const hasConfiguredReceipt =
				configuredModuleReceipt !== undefined || configuredManifestReceipt !== undefined;
			if (
				hasConfiguredReceipt &&
				(configuredModuleReceipt === undefined || configuredManifestReceipt === undefined)
			) {
				throw new RuntimeConfigurationError(
					'OCaml custom runtime assets require both module and manifest receipts',
					{ phase: 'startup', runtimeId: 'OCAML' }
				);
			}
			nextModuleReceipt = snapshotOuterAssetReceipt(
				configuredModuleReceipt ?? WASM_OCAML_RUNTIME_PROFILE.moduleReceipt,
				'module'
			);
			nextManifestReceipt = snapshotOuterAssetReceipt(
				configuredManifestReceipt ?? WASM_OCAML_RUNTIME_PROFILE.manifestReceipt,
				'manifest'
			);
			if (
				nextModuleReceipt.bytes > limits.maxAssetBytes ||
				nextManifestReceipt.bytes > limits.maxAssetBytes
			) {
				throw new RuntimeConfigurationError(
					`OCaml outer runtime asset exceeds the ${limits.maxAssetBytes} byte limit`,
					{ phase: 'startup', runtimeId: 'OCAML' }
				);
			}
			buffer = this.buffer;
			if (!this.isOperationActive(operation)) {
				return Promise.reject(
					this.releaseBeforeSession(operation, 'OCaml runtime startup cancelled')
				);
			}
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(operation, error));
		}
		operation.sessionActive = true;
		const loading = this.workerSession.load(async (resolve, reject) => {
			if (!this.isOperationActive(operation)) return;
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			resetBufferedStdin(buffer);
			if (!this.isOperationActive(operation)) return;
			const needsWorkerReset =
				!this.worker ||
				this.moduleUrl !== nextModuleUrl ||
				this.manifestUrl !== nextManifestUrl ||
				this.moduleReceiptIdentity !== receiptIdentity(nextModuleReceipt) ||
				this.manifestReceiptIdentity !== receiptIdentity(nextManifestReceipt) ||
				this.maxAssetBytes !== limits.maxAssetBytes;
			if (needsWorkerReset) {
				const WorkerConstructor = (await import('$lib/playground/worker/ocaml?worker'))
					.default;
				if (!this.isOperationActive(operation)) return;
				const worker = new WorkerConstructor();
				if (!this.isOperationActive(operation)) {
					worker.terminate();
					return;
				}
				this.worker = worker;
				this.workerSession.attach(worker);
				if (!this.isOperationActive(operation) || this.worker !== worker) {
					if (this.worker === worker) delete this.worker;
					this.workerSession.release(worker);
					return;
				}
				const handler = (event: MessageEvent<any>) => {
					if (!this.ownsWorkerOperation(operation, worker, handler)) return;
					try {
						const message = event.data;
						if (!this.ownsWorkerOperation(operation, worker, handler)) return;
						const loaded = message?.load;
						if (!this.ownsWorkerOperation(operation, worker, handler)) return;
						const error = message?.error;
						if (!this.ownsWorkerOperation(operation, worker, handler)) return;
						if (loaded) {
							progress?.set?.(1);
							if (!this.ownsWorkerOperation(operation, worker, handler)) return;
							worker.onmessage = null;
							this.moduleUrl = nextModuleUrl;
							this.manifestUrl = nextManifestUrl;
							this.moduleReceiptIdentity = receiptIdentity(nextModuleReceipt);
							this.manifestReceiptIdentity = receiptIdentity(nextManifestReceipt);
							this.maxAssetBytes = limits.maxAssetBytes;
							resolve();
							this.completeOperation(operation);
							return;
						}
						if (error !== undefined) reject(error);
					} catch (error) {
						reject(error);
					}
				};
				worker.onmessage = handler;
				worker.postMessage({
					load: true,
					moduleUrl: nextModuleUrl,
					manifestUrl: nextManifestUrl,
					moduleReceipt: nextModuleReceipt,
					manifestReceipt: nextManifestReceipt,
					maxAssetBytes: limits.maxAssetBytes
				});
			} else {
				progress?.set?.(1);
				if (!this.isOperationActive(operation)) return;
				resolve();
				this.completeOperation(operation);
			}
		});
		this.bindOperationTimeout(
			operation,
			Math.min(2_147_483_647, limits.assetTimeoutMs + limits.startupTimeoutMs)
		);
		return loading.finally(() => this.completeOperation(operation));
	}

	write(input: string) {
		if (this.disposed) return;
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.flushPendingInput();
	}

	eof() {
		if (this.disposed) return;
		this.pendingEof = true;
		this.flushPendingInput();
	}

	private flushPendingInput(buffer = this.activeOperation?.buffer ?? this.buffer) {
		if (!this.waitingForInput) return;
		if (flushQueuedStdin(this.pendingInput, buffer)) {
			this.waitingForInput = false;
			return;
		}
		if (this.pendingEof) {
			flushBufferedEof(buffer);
			this.pendingEof = false;
			this.waitingForInput = false;
		}
	}

	async run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const operation = this.beginOperation('execute');
		let signal: AbortSignal | undefined;
		let worker: Worker;
		let target: OcamlBackend;
		let wasmBinaryenMode: OcamlWasmBinaryenMode;
		let limits: ExecutionLimits;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		let stdin: SandboxExecutionOptions['stdin'];
		let buffer: ArrayBufferLike;
		let outputCallback: any;
		let onDiagnostic: ((diagnostic: CompilerDiagnostic) => void) | undefined;
		try {
			signal = options.signal;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			this.bindAbortSignal(operation, signal);
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			const configuredWorker = this.worker;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			if (!configuredWorker) throw 'Worker not loaded';
			worker = configuredWorker;
			const configuredTarget = options.ocamlBackend;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			target = configuredTarget || 'wasm';
			const configuredBinaryenMode = options.ocamlWasmBinaryenMode;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			wasmBinaryenMode = configuredBinaryenMode || 'fast';
			const configuredLimits = options.limits;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			limits = this.resolveOperationLimits(operation, configuredLimits);
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			const configuredWorkspaceLimits = options.workspaceLimits;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			if (
				configuredWorkspaceLimits !== undefined &&
				(configuredWorkspaceLimits === null ||
					typeof configuredWorkspaceLimits !== 'object')
			) {
				throw new TypeError('OCaml workspace limits must be an object');
			}
			const workspaceLimitSnapshot: Partial<WorkspaceLimits> = {};
			if (configuredWorkspaceLimits !== undefined) {
				for (const key of OCAML_WORKSPACE_LIMIT_KEYS) {
					const value = configuredWorkspaceLimits[key];
					if (!this.isOperationActive(operation)) {
						throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
					}
					if (value !== undefined) {
						Object.assign(workspaceLimitSnapshot, { [key]: value });
					}
				}
			}
			validateExecutionWorkspace('', [], 'main.ml', workspaceLimitSnapshot);
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			const workspaceFilesSource = options.workspaceFiles;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			if (workspaceFilesSource !== undefined && !Array.isArray(workspaceFilesSource)) {
				throw new TypeError('OCaml workspace files must be an array');
			}
			const workspaceFileCount = workspaceFilesSource?.length ?? 0;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			const maxFiles = workspaceLimitSnapshot.maxFiles ?? DEFAULT_WORKSPACE_LIMITS.maxFiles;
			if (workspaceFileCount > maxFiles) {
				throw new WorkspaceValidationError(
					'file-count-limit',
					`Workspace contains ${workspaceFileCount} files; limit is ${maxFiles}`,
					{ limit: maxFiles, actual: workspaceFileCount }
				);
			}
			const workspaceFiles: Array<{ path: string; content: string }> = [];
			for (let index = 0; index < workspaceFileCount; index += 1) {
				const file = workspaceFilesSource?.[index];
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
				}
				if (file === null || typeof file !== 'object' || Array.isArray(file)) {
					throw new TypeError('OCaml workspace file must be an object');
				}
				const path = file.path;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
				}
				const content = file.content;
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
				}
				if (typeof content !== 'string') {
					throw new TypeError('OCaml workspace file content must be a string');
				}
				workspaceFiles.push({ path, content });
			}
			const configuredActivePath = options.activePath;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			workspace = validateExecutionWorkspace(
				code,
				workspaceFiles,
				configuredActivePath ?? 'main.ml',
				{
					...workspaceLimitSnapshot,
					maxFileBytes: Math.min(
						workspaceLimitSnapshot.maxFileBytes ??
							DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
						limits.maxWorkspaceBytes
					),
					maxTotalBytes: Math.min(
						workspaceLimitSnapshot.maxTotalBytes ??
							DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
						limits.maxWorkspaceBytes
					)
				}
			);
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			stdin = options.stdin;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			buffer = this.buffer;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			outputCallback = this.output;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			onDiagnostic = this.oncompilerdiagnostic;
			if (!this.isOperationActive(operation)) {
				throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
			}
			operation.buffer = buffer;
			if (stdin !== undefined) {
				operation.explicitStdin = true;
				this.resetExplicitStdinState(buffer);
				if (!this.isOperationActive(operation)) {
					throw this.releaseBeforeSession(operation, 'OCaml execution cancelled');
				}
			}
		} catch (error) {
			throw this.releaseBeforeSession(operation, error);
		}
		const hasExplicitStdin = stdin !== undefined;
		operation.sessionActive = true;
		try {
			this.exit = false;
			return await new Promise<boolean | string>((resolve, reject) => {
				const runUid = ++this.uid;
				let outputBytes = 0;
				let diagnosticCount = 0;
				const workerOperation = this.workerSession.beginRun(worker, reject);
				this.bindOperationTimeout(
					operation,
					Math.min(2_147_483_647, limits.compileTimeoutMs + limits.runTimeoutMs)
				);
				if (!this.isOperationActive(operation)) return;
				let handler: (event: Event & { data: any }) => void;
				const ownsRun = () => this.ownsWorkerOperation(operation, worker, handler, runUid);
				const failRun = (error: unknown, disposeWorker = false) => {
					if (!ownsRun()) return;
					this.finishExplicitStdin(operation);
					if (worker.onmessage === handler) worker.onmessage = null;
					this.workerSession.complete(workerOperation);
					if (disposeWorker && this.worker === worker) this.workerSession.reset();
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.completeOperation(operation);
					reject(error);
				};
				handler = (event) => {
					if (!ownsRun()) {
						return;
					}
					try {
						const message = event.data;
						if (!ownsRun()) return;
						const output = message?.output;
						if (!ownsRun()) return;
						const results = message?.results;
						if (!ownsRun()) return;
						const error = message?.error;
						if (!ownsRun()) return;
						const diagnostic = message?.diagnostic;
						if (!ownsRun()) return;
						const progress = message?.progress;
						if (!ownsRun()) return;
						const runtime = message?.runtime;
						if (!ownsRun()) return;
						const requestsInput = message?.buffer;
						if (!ownsRun()) return;
						reportWorkerProgress(_prog, progress);
						if (!ownsRun()) {
							return;
						}
						if (requestsInput && !hasExplicitStdin) {
							this.waitingForInput = true;
							if (!prepare) {
								reportWorkerInputReady(_prog, 'OCaml runtime ready for input');
								if (!ownsRun()) return;
							}
							this.flushPendingInput(buffer);
							if (!ownsRun()) {
								return;
							}
						}
						if (output) {
							const actual =
								outputBytes + OUTPUT_ENCODER.encode(String(output)).byteLength;
							if (actual > limits.maxOutputBytes) {
								failRun(
									new OutputLimitError(
										`OCaml output exceeded ${limits.maxOutputBytes} bytes`,
										{
											actual,
											limit: limits.maxOutputBytes,
											phase: 'execute',
											runtimeId: 'OCAML'
										}
									),
									true
								);
								return;
							}
							outputBytes = actual;
							if (outputCallback != null) {
								Reflect.apply(outputCallback, this, [output]);
							}
							if (!ownsRun()) {
								return;
							}
						}
						if (diagnostic) {
							const actual = diagnosticCount + 1;
							if (actual > limits.maxDiagnostics) {
								failRun(
									new DiagnosticLimitError(
										`OCaml diagnostics exceeded ${limits.maxDiagnostics} messages`,
										{
											actual,
											limit: limits.maxDiagnostics,
											phase: 'execute',
											runtimeId: 'OCAML'
										}
									),
									true
								);
								return;
							}
							diagnosticCount = actual;
							if (onDiagnostic != null)
								Reflect.apply(onDiagnostic, this, [diagnostic]);
							if (!ownsRun()) {
								return;
							}
						}
						if (runtime) {
							failRun(
								new ProtocolError('Unexpected OCaml page runtime message', {
									phase: 'execute',
									runtimeId: 'OCAML'
								}),
								true
							);
							return;
						}
						if (results !== undefined) {
							this.finishExplicitStdin(operation);
							if (worker.onmessage === handler) worker.onmessage = null;
							this.elapse = Date.now() - this.begin;
							this.exit = true;
							this.waitingForInput = false;
							this.pendingEof = false;
							this.workerSession.complete(workerOperation);
							this.completeOperation(operation);
							resolve(results as boolean | string);
							return;
						}
						if (error !== undefined) failRun(error);
					} catch (error) {
						failRun(error, true);
					}
				};
				worker.onmessage = handler;
				if (!ownsRun()) {
					return;
				}
				this.begin = Date.now();
				try {
					worker.postMessage({
						code,
						prepare,
						target,
						wasmBinaryenMode,
						log: _log,
						buffer,
						stdin,
						activePath: workspace.activePath,
						workspaceFiles: workspace.workspaceFiles
					});
				} catch (error) {
					failRun(error);
				}
			});
		} finally {
			this.finishExplicitStdin(operation);
			this.completeOperation(operation);
		}
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		if (this.disposed) return;
		const operation = this.activeOperation;
		if (operation) {
			if (operation.sessionActive) this.abortOperation(operation, reason);
			else this.cancelBeforeSession(operation, reason);
			return;
		}
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		if (this.disposed) return;
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		if (this.activeOperation || !this.exit) {
			this.terminate();
		}
	}

	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.disposePromise = Promise.resolve();

		const operation = this.activeOperation;
		const operationBuffer = operation?.buffer;
		delete this.worker;
		this.moduleUrl = '';
		this.manifestUrl = '';
		this.moduleReceiptIdentity = '';
		this.manifestReceiptIdentity = '';
		this.maxAssetBytes = 0;
		this.output = undefined;
		this.oncompilerdiagnostic = undefined;
		this.resetExplicitStdinState(this.buffer);
		if (operationBuffer && operationBuffer !== this.buffer) {
			try {
				resetBufferedStdin(operationBuffer);
			} catch {
				// A detached operation buffer is already outside the live host state.
			}
		}
		if (operation) {
			this.abortOperation(operation, this.disposeCancellation);
		} else {
			this.uid += 1;
			this.workerSession.terminate(this.disposeCancellation);
			this.exit = true;
		}
		return this.disposePromise;
	}
}

export default Ocaml;
