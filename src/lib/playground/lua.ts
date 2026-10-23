import { resolveLuaModuleUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	BusyError,
	CancelledError,
	DEFAULT_WORKSPACE_LIMITS,
	DiagnosticLimitError,
	OutputLimitError,
	RuntimeConfigurationError,
	TimeoutError,
	resolveExecutionLimits,
	validateExecutionWorkspace
} from '@wasm-idle/core';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type DebugCommand,
	type DebugFrame,
	type DebugScope,
	type DebugSessionEvent,
	type DebugVariable,
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
import { LuaDebugMailbox } from '$lib/playground/luaDebug';
import { requireSharedArrayBuffer } from '$lib/playground/sharedBuffer';
import type { LuaDebugEvent } from '../../../runtimes/wasm-lua/src/mobdebug';

type LuaOperation = {
	token: symbol;
	phase: 'startup' | 'execute';
	cancelled: boolean;
	cancellationReason?: unknown;
	cleanedUp: boolean;
	cleanups: Array<() => void>;
	explicitStdin: boolean;
	timer?: ReturnType<typeof setTimeout>;
	timerStartedAt?: number;
	timeoutRemainingMs?: number;
};

const OUTPUT_ENCODER = new TextEncoder();

const abortReason = (signal: AbortSignal, phase: LuaOperation['phase'], label: string) =>
	signal.reason !== undefined
		? signal.reason
		: new DOMException(
				phase === 'startup'
					? `${label} runtime startup aborted`
					: `${label} execution aborted`,
				'AbortError'
			);

/**
 * Describes a language that runs on the wasm-lua (wasmoon) VM. Lua itself uses the
 * default dialect; Fennel reuses this sandbox and worker with the pinned fennel.lua compiler.
 */
export interface LuaSandboxDialect {
	label: string;
	runtimeId: string;
	defaultActivePath: string;
	/**
	 * Extra worker load fields. The value is also part of the worker identity, so a change
	 * replaces the loaded worker.
	 */
	resolveWorkerLoadExtras?: (
		runtimeAssets: string | PlaygroundRuntimeAssets,
		currentUrl: string
	) => Record<string, unknown>;
}

const LUA_DIALECT: LuaSandboxDialect = {
	label: 'Lua',
	runtimeId: 'LUA',
	defaultActivePath: 'main.lua'
};

class Lua implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	ondebug?: (event: DebugSessionEvent) => void;
	waitingForInput = false;
	pendingEof = false;
	private activeOperation: LuaOperation | null = null;
	private disposed = false;
	private disposePromise: Promise<void> | null = null;
	private readonly dialect: LuaSandboxDialect;
	private readonly label: string;
	private readonly runtimeId: string;
	private workerIdentity = '';
	private readonly disposeCancellation: CancelledError;
	private readonly workerSession: WorkerSession;
	private readonly debugMailbox = new LuaDebugMailbox();
	private debugEnabled = false;
	private debugPaused = false;
	private debugPath = 'main.lua';
	private debugFrames: Array<DebugFrame & { locals: DebugVariable[] }> = [];
	private selectedDebugFrame = 1;
	private evaluationId = 0;
	private pendingEvaluations = new Map<
		number,
		{
			resolve: (value: string) => void;
			reject: (reason: unknown) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();

	constructor(dialect: LuaSandboxDialect = LUA_DIALECT) {
		this.dialect = dialect;
		this.label = dialect.label;
		this.runtimeId = dialect.runtimeId;
		this.disposeCancellation = new CancelledError(`${this.label} sandbox disposed`, {
			phase: 'dispose',
			runtimeId: this.runtimeId,
			recoverable: false
		});
		this.workerSession = new WorkerSession({
			label: this.label,
			onDispose: (worker) => {
				if (this.worker === worker) delete this.worker;
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				this.finishDebug();
			}
		});
	}

	private requireOperationIdle() {
		if (!this.activeOperation) return;
		throw new BusyError(`${this.label} runtime already has an active operation`, {
			runtimeId: this.runtimeId,
			phase: this.activeOperation.phase
		});
	}

	private beginOperation(phase: LuaOperation['phase']) {
		if (this.disposed) {
			throw new RuntimeConfigurationError(`${this.label} sandbox is disposed`, {
				phase: 'dispose',
				runtimeId: this.runtimeId
			});
		}
		this.requireOperationIdle();
		const operation: LuaOperation = {
			token: Symbol(phase),
			phase,
			cancelled: false,
			cleanedUp: false,
			cleanups: [],
			explicitStdin: false
		};
		operation.cleanups.push(() => {
			if (operation.timer !== undefined) clearTimeout(operation.timer);
			operation.timer = undefined;
		});
		this.activeOperation = operation;
		return operation;
	}

	private isOperationActive(operation: LuaOperation) {
		return this.activeOperation?.token === operation.token && !operation.cancelled;
	}

	private releaseOperation(operation: LuaOperation) {
		if (this.activeOperation?.token !== operation.token) return false;
		this.activeOperation = null;
		return true;
	}

	private cleanupOperation(operation: LuaOperation) {
		if (operation.cleanedUp) return;
		operation.cleanedUp = true;
		const cleanups = operation.cleanups.splice(0);
		for (const cleanup of cleanups) {
			try {
				cleanup();
			} catch {
				// Caller-owned lifecycle cleanup must not replace the operation result.
			}
		}
	}

	private releaseBeforeSession(operation: LuaOperation, reason: unknown) {
		const outcome = operation.cancelled ? operation.cancellationReason : reason;
		if (operation.phase === 'execute') this.finishDebug();
		this.releaseOperation(operation);
		this.cleanupOperation(operation);
		return outcome;
	}

	private bindPreSessionAbort(operation: LuaOperation, signal: AbortSignal | undefined) {
		if (!signal || !this.isOperationActive(operation)) return () => undefined;
		let registered = false;
		let unbound = false;
		const unbind = () => {
			if (unbound) return;
			unbound = true;
			if (registered) signal.removeEventListener('abort', onAbort);
		};
		const onAbort = () => {
			if (!this.isOperationActive(operation)) return;
			let reason: unknown;
			try {
				reason = abortReason(signal, operation.phase, this.label);
			} catch (error) {
				reason = error;
			}
			operation.cancelled = true;
			operation.cancellationReason = reason;
			this.releaseOperation(operation);
			this.cleanupOperation(operation);
		};
		operation.cleanups.push(unbind);
		try {
			registered = true;
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		} catch (error) {
			if (this.isOperationActive(operation)) {
				operation.cancelled = true;
				operation.cancellationReason = error;
				this.releaseOperation(operation);
				this.cleanupOperation(operation);
			}
		}
		return unbind;
	}

	private bindAbortSignal(operation: LuaOperation, signal: AbortSignal | undefined) {
		if (!signal || !this.isOperationActive(operation)) return;
		let registered = false;
		const onAbort = () => {
			if (!this.isOperationActive(operation)) return;
			let reason: unknown;
			try {
				reason = abortReason(signal, operation.phase, this.label);
			} catch (error) {
				reason = error;
			}
			this.cancelOperation(operation, reason);
		};
		operation.cleanups.push(() => {
			if (!registered) return;
			try {
				signal.removeEventListener('abort', onAbort);
			} catch {
				// Listener cleanup must not replace the operation result.
			}
		});
		try {
			registered = true;
			signal.addEventListener('abort', onAbort, { once: true });
			if (signal.aborted) onAbort();
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private bindOperationTimeout(operation: LuaOperation, timeoutMs: number) {
		if (!this.isOperationActive(operation)) return;
		if (operation.timer !== undefined) clearTimeout(operation.timer);
		operation.timerStartedAt = Date.now();
		operation.timeoutRemainingMs = timeoutMs;
		try {
			operation.timer = setTimeout(() => {
				if (!this.isOperationActive(operation)) return;
				const label = operation.phase === 'startup' ? 'startup' : 'execution';
				this.cancelOperation(
					operation,
					new TimeoutError(`${this.label} ${label} timed out after ${timeoutMs} ms`, {
						phase: operation.phase,
						runtimeId: this.runtimeId,
						timeoutMs
					})
				);
			}, timeoutMs);
			if (operation.cleanedUp) clearTimeout(operation.timer);
		} catch (error) {
			this.cancelOperation(operation, error);
		}
	}

	private pauseDebugTimeout() {
		const operation = this.activeOperation;
		if (!operation || operation.timer === undefined) return;
		clearTimeout(operation.timer);
		operation.timer = undefined;
		operation.timeoutRemainingMs = Math.max(
			1,
			(operation.timeoutRemainingMs ?? 1) -
				(Date.now() - (operation.timerStartedAt ?? Date.now()))
		);
	}

	private finishDebug() {
		const wasEnabled = this.debugEnabled;
		this.debugEnabled = false;
		this.debugPaused = false;
		this.debugFrames = [];
		this.debugMailbox.close();
		for (const pending of this.pendingEvaluations.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Lua debugger is no longer paused.'));
		}
		this.pendingEvaluations.clear();
		if (wasEnabled) {
			try {
				this.ondebug?.({ type: 'stop' });
			} catch (error) {
				console.error('Lua debugger stop listener failed', error);
			}
		}
	}

	private handleDebugEvent(event: LuaDebugEvent) {
		if (!this.debugEnabled) return;
		if (event.type === 'evaluate') {
			const pending = this.pendingEvaluations.get(event.id);
			if (!pending) return;
			this.pendingEvaluations.delete(event.id);
			clearTimeout(pending.timer);
			if (event.error) pending.reject(new Error(event.error));
			else pending.resolve(event.value ?? 'nil');
			return;
		}
		this.debugPaused = true;
		this.pauseDebugTimeout();
		this.selectedDebugFrame = 1;
		this.debugFrames = event.frames.map((frame, index) => ({
			...frame,
			id: index + 1,
			sourcePath: `/workspace/${frame.sourcePath}`
		}));
		this.ondebug?.({
			type: 'pause',
			line: event.line,
			reason: event.reason,
			sourcePath: `/workspace/${event.sourcePath}`,
			frameId: 1,
			locals: this.debugFrames[0]?.locals ?? [],
			callStack: this.debugFrames.map(({ locals: _locals, ...frame }) => frame)
		});
	}

	debugCommand(command: DebugCommand) {
		if (!this.debugEnabled || !this.debugPaused) throw new Error('Lua debugger is not paused.');
		this.debugMailbox.send(
			`${command === 'stepInto' ? 'STEP' : command === 'nextLine' ? 'OVER' : command === 'stepOut' ? 'OUT' : 'RUN'}\n`
		);
		this.debugPaused = false;
		this.debugFrames = [];
		for (const pending of this.pendingEvaluations.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Lua debugger resumed.'));
		}
		this.pendingEvaluations.clear();
		const operation = this.activeOperation;
		if (operation) this.bindOperationTimeout(operation, operation.timeoutRemainingMs ?? 1);
		this.ondebug?.({ type: 'resume', command });
	}

	setBreakpoints(lines: number[], sourcePath?: string) {
		if (!this.debugEnabled) return;
		if (sourcePath && sourcePath.replace(/^\/workspace\//u, '') !== this.debugPath) return;
		const next = [
			...new Set(lines.filter((line) => Number.isSafeInteger(line) && line > 0))
		].slice(0, 1024);
		this.debugMailbox.send(
			`DELB * 0\n${next.map((line) => `SETB ${this.debugPath} ${line}\n`).join('')}`
		);
	}

	debugEvaluate(expression: string): Promise<string> {
		if (!this.debugEnabled || !this.debugPaused)
			return Promise.reject(new Error('Lua debugger is not paused.'));
		if (this.selectedDebugFrame !== 1)
			return Promise.reject(
				new Error('Lua evaluation currently supports the top frame only.')
			);
		if (!expression || expression.length > 4096 || this.pendingEvaluations.size >= 64) {
			return Promise.reject(new RangeError('Lua debugger expression limit exceeded.'));
		}
		const id = ++this.evaluationId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pendingEvaluations.delete(id);
				reject(new Error('Lua debugger evaluation timed out.'));
			}, 5000);
			this.pendingEvaluations.set(id, { resolve, reject, timer });
			try {
				this.debugMailbox.send(
					`EXEC return (${expression.replace(/[\r\n]/gu, '\f')}) --{stack=${this.selectedDebugFrame},requestId=${id},metatostring=false,maxlevel=2,maxnum=25,maxlength=1024}\n`
				);
			} catch (error) {
				clearTimeout(timer);
				this.pendingEvaluations.delete(id);
				reject(error);
			}
		});
	}

	async debugScopes(frameId = this.selectedDebugFrame): Promise<DebugScope[]> {
		this.selectedDebugFrame = frameId;
		return this.debugFrameScopes(frameId);
	}

	async debugFrameScopes(frameId: number): Promise<DebugScope[]> {
		if (!this.debugPaused) return [];
		const frame = this.debugFrames[frameId - 1];
		return frame
			? [
					{
						name: 'Locals',
						variablesReference: frameId,
						expensive: false,
						namedVariables: frame.locals.length,
						variables: frame.locals
					}
				]
			: [];
	}

	async debugFrameName(frameId: number): Promise<string | null> {
		return this.debugPaused ? (this.debugFrames[frameId - 1]?.functionName ?? null) : null;
	}

	async debugVariables(reference: number, start = 0, count?: number): Promise<DebugVariable[]> {
		const variables = this.debugPaused ? (this.debugFrames[reference - 1]?.locals ?? []) : [];
		return variables.slice(start, count === undefined ? undefined : start + count);
	}

	private resetExplicitStdinState() {
		this.pendingInput = [];
		this.pendingEof = false;
		this.waitingForInput = false;
		try {
			resetBufferedStdin(this.buffer);
		} catch {
			// Explicit stdin never consumes the shared terminal buffer.
		}
	}

	private finishExplicitStdin(operation: LuaOperation) {
		if (!operation.explicitStdin) return;
		operation.explicitStdin = false;
		this.resetExplicitStdinState();
	}

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		let activeOperation: LuaOperation;
		try {
			activeOperation = this.beginOperation('startup');
		} catch (error) {
			return Promise.reject(error);
		}
		let signal: AbortSignal | undefined;
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let unbindPreSessionAbort: () => void = () => undefined;
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(
						activeOperation,
						`${this.label} runtime startup cancelled`
					)
				);
			}
			limits = resolveExecutionLimits(options.limits);
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(
						activeOperation,
						`${this.label} runtime startup cancelled`
					)
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(
					activeOperation,
					`${this.label} runtime startup cancelled`
				)
			);
		}
		const loadPromise = this.workerSession.load(async (resolve, reject) => {
			const resolveLoad = () => {
				if (!this.releaseOperation(activeOperation)) return;
				resolve();
				this.cleanupOperation(activeOperation);
			};
			const rejectLoad = (reason?: unknown) => {
				if (!this.releaseOperation(activeOperation)) return;
				reject(reason);
				this.cleanupOperation(activeOperation);
			};
			try {
				if (!this.isOperationActive(activeOperation)) return;
				this.pendingInput = [];
				this.waitingForInput = false;
				this.pendingEof = false;
				const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
				const nextModuleUrl = resolveLuaModuleUrl(runtimeAssets, currentUrl);
				if (!this.isOperationActive(activeOperation)) return;
				if (!nextModuleUrl) {
					return rejectLoad(
						'Lua runtime is not configured. Set runtimeAssets.lua.moduleUrl.'
					);
				}
				const loadExtras =
					this.dialect.resolveWorkerLoadExtras?.(runtimeAssets, currentUrl) ?? {};
				if (!this.isOperationActive(activeOperation)) return;
				const nextWorkerIdentity = JSON.stringify([nextModuleUrl, loadExtras]);
				const needsWorkerReset = !this.worker || this.workerIdentity !== nextWorkerIdentity;
				this.moduleUrl = nextModuleUrl;
				this.workerIdentity = nextWorkerIdentity;
				if (needsWorkerReset && this.worker) {
					this.workerSession.reset();
				}
				if (!this.worker) {
					const WorkerConstructor = (await import('$lib/playground/worker/lua?worker'))
						.default;
					if (!this.isOperationActive(activeOperation)) return;
					const worker = new WorkerConstructor();
					if (!this.isOperationActive(activeOperation)) {
						worker.terminate();
						return;
					}
					this.worker = worker;
					this.workerSession.attach(worker);
					let handler: (event: MessageEvent<any>) => void;
					const ownsLoad = () =>
						this.isOperationActive(activeOperation) &&
						this.worker === worker &&
						worker.onmessage === handler;
					const failLoad = (error: unknown) => {
						if (!ownsLoad()) return;
						rejectLoad(error);
					};
					handler = (event: MessageEvent<any>) => {
						if (!ownsLoad()) return;
						try {
							if (event.data?.load) {
								progress?.set?.(1);
								if (!ownsLoad()) return;
								resolveLoad();
								return;
							}
							if (event.data?.error) rejectLoad(event.data.error);
						} catch (error) {
							failLoad(error);
						}
					};
					worker.onmessage = handler;
					worker.postMessage({
						...loadExtras,
						load: true,
						moduleUrl: this.moduleUrl
					});
				} else {
					const worker = this.worker;
					progress?.set?.(1);
					if (!this.isOperationActive(activeOperation) || this.worker !== worker) return;
					resolveLoad();
				}
			} catch (error) {
				rejectLoad(error);
			}
		});
		const timeoutMs = Math.min(2_147_483_647, limits.assetTimeoutMs + limits.startupTimeoutMs);
		this.bindOperationTimeout(activeOperation, timeoutMs);
		this.bindAbortSignal(activeOperation, signal);
		return loadPromise.finally(() => {
			this.releaseOperation(activeOperation);
			this.cleanupOperation(activeOperation);
		});
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

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		let activeOperation: LuaOperation;
		try {
			activeOperation = this.beginOperation('execute');
		} catch (error) {
			return Promise.reject(error);
		}
		const worker = this.worker;
		if (!worker) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, 'Worker not loaded'));
		}
		let signal: AbortSignal | undefined;
		let unbindPreSessionAbort: () => void = () => undefined;
		let executionArgs: ReturnType<typeof resolveSandboxExecutionArgs>;
		let limits: ReturnType<typeof resolveExecutionLimits>;
		let workspace: ReturnType<typeof validateExecutionWorkspace>;
		let stdin: SandboxExecutionOptions['stdin'];
		try {
			signal = options.signal;
			unbindPreSessionAbort = this.bindPreSessionAbort(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, `${this.label} execution cancelled`)
				);
			}
			executionArgs = resolveSandboxExecutionArgs(this.runtimeId, args, options);
			limits = resolveExecutionLimits(options.limits);
			const workspaceFiles = options.workspaceFiles ?? [];
			const activePath = options.activePath ?? this.dialect.defaultActivePath;
			const workspaceLimits = options.workspaceLimits;
			workspace = validateExecutionWorkspace(code, workspaceFiles, activePath, {
				...workspaceLimits,
				maxFileBytes: Math.min(
					workspaceLimits?.maxFileBytes ?? DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
					limits.maxWorkspaceBytes
				),
				maxTotalBytes: Math.min(
					workspaceLimits?.maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
					limits.maxWorkspaceBytes
				)
			});
			stdin = options.stdin;
			const debugMode = options.debugMode ?? (options.debug ? 'mobdebug' : 'none');
			if (!['none', 'trace', 'mobdebug'].includes(debugMode)) {
				throw new RuntimeConfigurationError('Lua debugging uses the MobDebug backend.');
			}
			if (!prepare && debugMode !== 'none') {
				if (this.runtimeId !== 'LUA')
					throw new RuntimeConfigurationError(
						`${this.label} source debugging is not supported.`
					);
				requireSharedArrayBuffer('Lua debugging');
				this.debugEnabled = true;
				this.debugPaused = false;
				this.debugPath = workspace.activePath ?? this.dialect.defaultActivePath;
				this.debugMailbox.reset();
			}
			if (!this.isOperationActive(activeOperation) || signal?.aborted) {
				return Promise.reject(
					this.releaseBeforeSession(activeOperation, `${this.label} execution cancelled`)
				);
			}
			unbindPreSessionAbort();
		} catch (error) {
			return Promise.reject(this.releaseBeforeSession(activeOperation, error));
		}
		if (!this.isOperationActive(activeOperation)) {
			return Promise.reject(
				this.releaseBeforeSession(activeOperation, `${this.label} execution cancelled`)
			);
		}
		const hasExplicitStdin = stdin !== undefined;
		if (hasExplicitStdin) {
			activeOperation.explicitStdin = true;
			this.resetExplicitStdinState();
		}
		this.exit = false;
		const running = new Promise<boolean | string>((resolve, reject) => {
			const _uid = ++this.uid;
			let diagnosticCount = 0;
			let outputBytes = 0;
			const operation = this.workerSession.beginRun(worker, reject);
			const timeoutMs = Math.min(
				2_147_483_647,
				limits.compileTimeoutMs + limits.runTimeoutMs
			);
			this.bindOperationTimeout(activeOperation, timeoutMs);
			this.bindAbortSignal(activeOperation, signal);
			if (!this.isOperationActive(activeOperation)) return;
			let handler: (event: Event & { data: any }) => void;
			const ownsRun = () =>
				this.isOperationActive(activeOperation) &&
				this.worker === worker &&
				worker.onmessage === handler &&
				_uid === this.uid;
			const claimRun = () => {
				if (!ownsRun()) return false;
				this.finishExplicitStdin(activeOperation);
				this.elapse = Date.now() - this.begin;
				this.exit = true;
				this.waitingForInput = false;
				this.pendingEof = false;
				this.finishDebug();
				this.workerSession.complete(operation);
				this.releaseOperation(activeOperation);
				this.cleanupOperation(activeOperation);
				try {
					if (worker.onmessage === handler) worker.onmessage = null;
				} catch {
					// Handler cleanup must not replace the operation result.
				}
				return true;
			};
			const failRun = (error: unknown, disposeWorker = false) => {
				if (!ownsRun()) return;
				if (disposeWorker) {
					this.cancelOperation(activeOperation, error);
					return;
				}
				if (!claimRun()) return;
				reject(error);
			};
			handler = (event: Event & { data: any }) => {
				if (!ownsRun()) return;
				try {
					const {
						output,
						results,
						error,
						buffer,
						diagnostic,
						progress,
						luaDebug,
						debugCommandConsumed
					} = event.data;
					if (debugCommandConsumed) this.debugMailbox.flush();
					if (luaDebug) this.handleDebugEvent(luaDebug);
					if (buffer && !hasExplicitStdin) {
						this.waitingForInput = true;
						if (!prepare) {
							reportWorkerInputReady(_prog, `${this.label} runtime ready for input`);
							if (!ownsRun()) return;
						}
						this.flushPendingInput();
						if (!ownsRun()) return;
					}
					reportWorkerProgress(_prog, progress);
					if (!ownsRun()) return;
					if (output) {
						const actual =
							outputBytes + OUTPUT_ENCODER.encode(String(output)).byteLength;
						if (actual > limits.maxOutputBytes) {
							failRun(
								new OutputLimitError(
									`${this.label} output exceeded ${limits.maxOutputBytes} bytes`,
									{
										actual,
										limit: limits.maxOutputBytes,
										phase: 'execute',
										runtimeId: this.runtimeId
									}
								),
								true
							);
							return;
						}
						outputBytes = actual;
						this.output?.(output);
					}
					if (!ownsRun()) return;
					if (diagnostic) {
						const actual = diagnosticCount + 1;
						if (actual > limits.maxDiagnostics) {
							failRun(
								new DiagnosticLimitError(
									`${this.label} diagnostics exceeded ${limits.maxDiagnostics} messages`,
									{
										actual,
										limit: limits.maxDiagnostics,
										phase: 'execute',
										runtimeId: this.runtimeId
									}
								),
								true
							);
							return;
						}
						diagnosticCount = actual;
						this.oncompilerdiagnostic?.(diagnostic);
					}
					if (!ownsRun()) return;
					if (results) {
						if (!claimRun()) return;
						resolve(results as string);
						return;
					}
					if (error) failRun(error);
				} catch (error) {
					failRun(error, true);
				}
			};
			worker.onmessage = handler;
			if (!ownsRun()) return;
			this.begin = Date.now();
			try {
				worker.postMessage({
					code,
					prepare,
					buffer: this.buffer,
					args: executionArgs.programArgs,
					stdin,
					activePath: workspace.activePath,
					workspaceFiles: workspace.workspaceFiles,
					debug: this.debugEnabled,
					debugBuffer: this.debugEnabled ? this.debugMailbox.buffer : undefined,
					breakpoints: options.breakpoints ?? [],
					pauseOnEntry: options.pauseOnEntry !== false,
					log: _log
				});
			} catch (error) {
				failRun(error, true);
			}
		});
		return running.finally(() => {
			if (this.releaseOperation(activeOperation)) {
				this.finishExplicitStdin(activeOperation);
				this.exit = true;
			}
			this.cleanupOperation(activeOperation);
		});
	}

	private cancelOperation(operation: LuaOperation, reason: unknown) {
		if (!this.isOperationActive(operation)) return;
		operation.cancelled = true;
		operation.cancellationReason = reason;
		this.activeOperation = null;
		this.uid += 1;
		this.finishExplicitStdin(operation);
		this.waitingForInput = false;
		this.pendingEof = false;
		this.exit = true;
		this.finishDebug();
		this.workerSession.terminate(reason);
		this.cleanupOperation(operation);
	}

	kill() {
		this.terminate();
	}

	terminate(reason: unknown = 'Process terminated') {
		if (this.disposed) return;
		const activeOperation = this.activeOperation;
		if (activeOperation) {
			this.cancelOperation(activeOperation, reason);
			return;
		}
		this.waitingForInput = false;
		this.pendingEof = false;
		this.finishDebug();
		this.uid += 1;
		this.workerSession.terminate(reason);
		this.exit = true;
	}

	async clear() {
		if (this.disposed) return;
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		resetBufferedStdin(this.buffer);
		if (this.activeOperation) {
			this.terminate();
			return;
		}
		if (this.worker) this.worker.onmessage = null;
	}

	dispose() {
		if (this.disposePromise) return this.disposePromise;
		this.disposed = true;
		this.disposePromise = Promise.resolve();

		const activeOperation = this.activeOperation;
		delete this.worker;
		this.moduleUrl = '';
		this.workerIdentity = '';
		this.output = null;
		this.oncompilerdiagnostic = undefined;
		this.resetExplicitStdinState();
		if (activeOperation) {
			this.cancelOperation(activeOperation, this.disposeCancellation);
		} else {
			this.uid += 1;
			this.workerSession.terminate(this.disposeCancellation);
			this.exit = true;
		}
		return this.disposePromise;
	}
}

export default Lua;
