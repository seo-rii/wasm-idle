import type {
	DapCapabilities,
	DapEvent,
	DapInitializeRequestArguments,
	DapSession
} from './dap.js';
import { createDebugAdapterEventChannel } from './event-channel.js';
import { cloneDebugSource, debugSourceKey, validateBreakpointLines } from './source.js';
import {
	DebugAdapterStateError,
	UnsupportedDebugOperationError,
	type DebugAdapter,
	type DebugAdapterEvent,
	type DebugCapabilities,
	type DebugDisconnectOptions,
	type DebugEvaluateResult,
	type DebugLaunchConfig,
	type DebugMemory,
	type DebugScope,
	type DebugSource,
	type DebugStackFrame,
	type DebugThread,
	type DebugVariable,
	type DebugVariablePresentationHint,
	type ResolvedBreakpoint
} from './types.js';

export interface LldbDapAdapterOptions {
	initializeArguments?: Partial<DapInitializeRequestArguments>;
	featureSupport?: {
		/**
		 * WebAssembly expression evaluation is not assumed merely because a DAP
		 * transport exists. Set this only when the linked LLDB build supports it.
		 */
		evaluate?: boolean;
	};
}

interface DapBreakpoint {
	id?: number;
	verified?: boolean;
	message?: string;
	source?: DebugSource;
	line?: number;
	column?: number;
	endLine?: number;
	endColumn?: number;
	instructionReference?: string;
	offset?: number;
}

interface DapSetBreakpointsResponse {
	breakpoints?: DapBreakpoint[];
}

interface DapThreadsResponse {
	threads?: Array<{ id: number; name: string }>;
}

interface DapStackTraceResponse {
	stackFrames?: Array<{
		id: number;
		name: string;
		source?: DebugSource;
		line: number;
		column: number;
		endLine?: number;
		endColumn?: number;
		canRestart?: boolean;
		instructionPointerReference?: string;
		moduleId?: number | string;
		presentationHint?: 'normal' | 'label' | 'subtle';
	}>;
}

interface DapScopesResponse {
	scopes?: Array<{
		name: string;
		presentationHint?: 'arguments' | 'locals' | 'registers' | 'returnValue';
		variablesReference: number;
		namedVariables?: number;
		indexedVariables?: number;
		expensive: boolean;
		source?: DebugSource;
		line?: number;
		column?: number;
		endLine?: number;
		endColumn?: number;
	}>;
}

interface DapVariable {
	name: string;
	value: string;
	type?: string;
	presentationHint?: DebugVariablePresentationHint;
	evaluateName?: string;
	variablesReference?: number;
	namedVariables?: number;
	indexedVariables?: number;
	memoryReference?: string;
}

interface DapVariablesResponse {
	variables?: DapVariable[];
}

interface DapReadMemoryResponse {
	address?: string;
	data?: string;
	unreadableBytes?: number;
}

interface DapEvaluateResponse {
	result: string;
	type?: string;
	presentationHint?: DebugVariablePresentationHint;
	variablesReference?: number;
	namedVariables?: number;
	indexedVariables?: number;
	memoryReference?: string;
}

const defaultInitializeArguments: DapInitializeRequestArguments = {
	clientID: 'wasm-idle',
	clientName: 'wasm-idle',
	adapterID: 'lldb-web-dap',
	linesStartAt1: true,
	columnsStartAt1: true,
	pathFormat: 'path',
	supportsVariableType: true,
	supportsVariablePaging: true,
	supportsRunInTerminalRequest: false,
	supportsMemoryReferences: true,
	supportsProgressReporting: false,
	supportsInvalidatedEvent: false,
	supportsMemoryEvent: false
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function eventBody<T>(event: DapEvent) {
	return (isObject(event.body) ? event.body : {}) as Partial<T>;
}

function assertPositiveInteger(value: number, name: string) {
	if (!Number.isInteger(value) || value < 1) {
		throw new RangeError(`${name} must be a positive integer.`);
	}
}

function assertNonNegativeInteger(value: number, name: string) {
	if (!Number.isInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative integer.`);
	}
}

function decodeBase64(data: string) {
	const binary = globalThis.atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function cloneResolvedBreakpoints(breakpoints: readonly ResolvedBreakpoint[]) {
	return breakpoints.map((breakpoint) => ({
		...breakpoint,
		source: cloneDebugSource(breakpoint.source)
	}));
}

function mapCapabilities(
	capabilities: DapCapabilities,
	options: LldbDapAdapterOptions
): DebugCapabilities {
	const supportsEvaluate = options.featureSupport?.evaluate === true;

	return Object.freeze({
		supportsConfigurationDone: capabilities.supportsConfigurationDoneRequest === true,
		supportsBreakpoints: true,
		supportsConditionalBreakpoints: false,
		supportsLogPoints: false,
		supportsContinue: true,
		supportsPause: true,
		supportsStepIn: true,
		supportsStepOver: true,
		supportsStepOut: true,
		supportsThreads: true,
		supportsStackTrace: true,
		supportsScopes: true,
		supportsVariables: true,
		supportsEvaluate,
		supportsEvaluateForHovers:
			supportsEvaluate && capabilities.supportsEvaluateForHovers === true,
		supportsReadMemory: capabilities.supportsReadMemoryRequest === true,
		supportsDataBreakpoints: false,
		supportsSetVariable: false,
		supportsRestart: false,
		supportsTerminate: false
	});
}

export class LldbDapAdapter implements DebugAdapter {
	readonly kind = 'lldb' as const;

	readonly #session: DapSession;
	readonly #options: LldbDapAdapterOptions;
	readonly #events = createDebugAdapterEventChannel();
	readonly #breakpointsById = new Map<number, ResolvedBreakpoint>();
	readonly #breakpointsBySource = new Map<string, ResolvedBreakpoint[]>();
	readonly #breakpointIdsBySource = new Map<string, Set<number>>();
	readonly #breakpointRequestVersions = new Map<string, number>();
	#capabilities: DebugCapabilities | null = null;
	#initializeRequest: Promise<DebugCapabilities> | null = null;

	constructor(session: DapSession, options: LldbDapAdapterOptions = {}) {
		this.#session = session;
		this.#options = options;
		session.onEvent((event) => {
			this.#handleDapEvent(event);
		});
	}

	get capabilities() {
		return this.#capabilities;
	}

	initialize() {
		if (this.#capabilities) return Promise.resolve(this.#capabilities);
		if (this.#initializeRequest) return this.#initializeRequest;

		const options: LldbDapAdapterOptions = {
			...this.#options,
			...(this.#options.initializeArguments
				? { initializeArguments: { ...this.#options.initializeArguments } }
				: {}),
			...(this.#options.featureSupport
				? { featureSupport: { ...this.#options.featureSupport } }
				: {})
		};
		const initializeArguments = {
			...defaultInitializeArguments,
			...options.initializeArguments
		};
		this.#initializeRequest = this.#session
			.request<DapCapabilities>('initialize', initializeArguments)
			.then((capabilities) => {
				this.#capabilities = mapCapabilities(capabilities || {}, options);
				return this.#capabilities;
			})
			.catch((error: unknown) => {
				this.#initializeRequest = null;
				throw error;
			});
		return this.#initializeRequest;
	}

	async launch(config: DebugLaunchConfig) {
		this.#requireInitialized();
		await this.#session.request('launch', { ...config });
	}

	async disconnect(options: DebugDisconnectOptions = {}) {
		this.#requireInitialized();
		await this.#session.request('disconnect', {
			terminateDebuggee: options.terminateTarget === true
		});
	}

	async setBreakpoints(source: DebugSource, lines: number[]) {
		this.#requireInitialized();
		const requestedLines = validateBreakpointLines(lines);
		const requestSource = cloneDebugSource(source);
		const sourceKey = debugSourceKey(requestSource);
		const requestVersion = (this.#breakpointRequestVersions.get(sourceKey) ?? 0) + 1;
		this.#breakpointRequestVersions.set(sourceKey, requestVersion);
		let response: DapSetBreakpointsResponse;
		try {
			response = await this.#session.request<DapSetBreakpointsResponse>('setBreakpoints', {
				source: requestSource,
				breakpoints: requestedLines.map((line) => ({ line })),
				lines: requestedLines
			});
		} catch (error) {
			if (this.#breakpointRequestVersions.get(sourceKey) !== requestVersion) {
				return cloneResolvedBreakpoints(this.#breakpointsBySource.get(sourceKey) ?? []);
			}
			throw error;
		}
		const dapBreakpoints = response?.breakpoints || [];
		const resolved = requestedLines.map((requestedLine, index) =>
			this.#normalizeBreakpoint(dapBreakpoints[index], requestSource, requestedLine)
		);
		if (this.#breakpointRequestVersions.get(sourceKey) === requestVersion) {
			this.#replaceTrackedBreakpoints(requestSource, resolved);
		}
		return cloneResolvedBreakpoints(this.#breakpointsBySource.get(sourceKey) ?? []);
	}

	async continue(threadId: number) {
		await this.#threadRequest('continue', threadId);
	}

	async pause(threadId: number) {
		await this.#threadRequest('pause', threadId);
	}

	async next(threadId: number) {
		await this.#threadRequest('next', threadId);
	}

	async stepIn(threadId: number) {
		await this.#threadRequest('stepIn', threadId);
	}

	async stepOut(threadId: number) {
		await this.#threadRequest('stepOut', threadId);
	}

	async threads() {
		this.#requireInitialized();
		const response = await this.#session.request<DapThreadsResponse>('threads');
		return (response?.threads || []).map<DebugThread>((thread) => ({
			id: thread.id,
			name: thread.name
		}));
	}

	async stackTrace(threadId: number, startFrame?: number, levels?: number) {
		this.#requireInitialized();
		assertPositiveInteger(threadId, 'threadId');
		if (startFrame !== undefined) assertNonNegativeInteger(startFrame, 'startFrame');
		if (levels !== undefined) assertNonNegativeInteger(levels, 'levels');

		const response = await this.#session.request<DapStackTraceResponse>('stackTrace', {
			threadId,
			...(startFrame === undefined ? {} : { startFrame }),
			...(levels === undefined ? {} : { levels })
		});
		return (response?.stackFrames || []).map<DebugStackFrame>((frame) => ({
			...frame,
			...(frame.source ? { source: cloneDebugSource(frame.source) } : {})
		}));
	}

	async scopes(frameId: number) {
		this.#requireInitialized();
		assertPositiveInteger(frameId, 'frameId');
		const response = await this.#session.request<DapScopesResponse>('scopes', { frameId });
		return (response?.scopes || []).map<DebugScope>((scope) => ({
			...scope,
			...(scope.source ? { source: cloneDebugSource(scope.source) } : {})
		}));
	}

	async variables(variablesReference: number, start?: number, count?: number) {
		this.#requireInitialized();
		assertPositiveInteger(variablesReference, 'variablesReference');
		if (start !== undefined) assertNonNegativeInteger(start, 'start');
		if (count !== undefined) assertNonNegativeInteger(count, 'count');

		const response = await this.#session.request<DapVariablesResponse>('variables', {
			variablesReference,
			...(start === undefined ? {} : { start }),
			...(count === undefined ? {} : { count })
		});
		return (response?.variables || []).map<DebugVariable>((variable) => ({
			...variable,
			variablesReference: variable.variablesReference || 0
		}));
	}

	async readMemory(memoryReference: string, offset: number, count: number) {
		this.#requireCapability('supportsReadMemory', 'read memory');
		if (!Number.isInteger(offset)) throw new RangeError('offset must be an integer.');
		assertNonNegativeInteger(count, 'count');

		const response = await this.#session.request<DapReadMemoryResponse>('readMemory', {
			memoryReference,
			offset,
			count
		});
		return {
			address: response?.address,
			data: decodeBase64(response?.data || ''),
			unreadableBytes: response?.unreadableBytes || 0
		} satisfies DebugMemory;
	}

	async evaluate(expression: string, frameId?: number) {
		this.#requireCapability('supportsEvaluate', 'evaluate expressions');
		if (frameId !== undefined) assertPositiveInteger(frameId, 'frameId');
		const response = await this.#session.request<DapEvaluateResponse>('evaluate', {
			expression,
			context: 'watch',
			...(frameId === undefined ? {} : { frameId })
		});
		return {
			...response,
			result: response.result,
			variablesReference: response.variablesReference || 0
		} satisfies DebugEvaluateResult;
	}

	onEvent(listener: (event: DebugAdapterEvent) => void) {
		return this.#events.subscribe(listener);
	}

	async #threadRequest(command: string, threadId: number) {
		this.#requireInitialized();
		assertPositiveInteger(threadId, 'threadId');
		await this.#session.request(command, { threadId });
	}

	#requireInitialized() {
		if (!this.#capabilities) {
			throw new DebugAdapterStateError('The LLDB DAP adapter has not been initialized.');
		}
		return this.#capabilities;
	}

	#requireCapability(capability: 'supportsEvaluate' | 'supportsReadMemory', operation: string) {
		const capabilities = this.#requireInitialized();
		if (!capabilities[capability]) throw new UnsupportedDebugOperationError(operation);
	}

	#normalizeBreakpoint(
		breakpoint: DapBreakpoint | undefined,
		fallbackSource: DebugSource,
		requestedLine: number
	): ResolvedBreakpoint {
		return {
			...(breakpoint?.id === undefined ? {} : { id: breakpoint.id }),
			verified: breakpoint?.verified === true,
			source: cloneDebugSource(breakpoint?.source || fallbackSource),
			requestedLine,
			line: breakpoint?.line || requestedLine,
			...(breakpoint?.column === undefined ? {} : { column: breakpoint.column }),
			...(breakpoint?.endLine === undefined ? {} : { endLine: breakpoint.endLine }),
			...(breakpoint?.endColumn === undefined ? {} : { endColumn: breakpoint.endColumn }),
			...(breakpoint?.message === undefined ? {} : { message: breakpoint.message }),
			...(breakpoint?.instructionReference === undefined
				? {}
				: { instructionReference: breakpoint.instructionReference }),
			...(breakpoint?.offset === undefined ? {} : { offset: breakpoint.offset })
		};
	}

	#replaceTrackedBreakpoints(source: DebugSource, breakpoints: ResolvedBreakpoint[]) {
		const sourceKey = debugSourceKey(source);
		for (const id of this.#breakpointIdsBySource.get(sourceKey) || []) {
			this.#breakpointsById.delete(id);
		}

		const snapshot = cloneResolvedBreakpoints(breakpoints);
		this.#breakpointsBySource.set(sourceKey, snapshot);
		const ids = new Set<number>();
		for (const breakpoint of snapshot) {
			if (breakpoint.id === undefined) continue;
			ids.add(breakpoint.id);
			this.#breakpointsById.set(breakpoint.id, breakpoint);
		}
		this.#breakpointIdsBySource.set(sourceKey, ids);
	}

	#handleDapEvent(event: DapEvent) {
		const mapped = this.#mapDapEvent(event);
		if (mapped) this.#events.emit(mapped);
	}

	#mapDapEvent(event: DapEvent): DebugAdapterEvent | null {
		if (event.event === 'initialized') return { type: 'initialized' };

		if (event.event === 'stopped') {
			const body = eventBody<{
				reason: string;
				description: string;
				threadId: number;
				preserveFocusHint: boolean;
				text: string;
				allThreadsStopped: boolean;
				hitBreakpointIds: number[];
			}>(event);
			return {
				type: 'stopped',
				reason: body.reason || 'unknown',
				...(body.description === undefined ? {} : { description: body.description }),
				...(body.threadId === undefined ? {} : { threadId: body.threadId }),
				...(body.preserveFocusHint === undefined
					? {}
					: { preserveFocusHint: body.preserveFocusHint }),
				...(body.text === undefined ? {} : { text: body.text }),
				...(body.allThreadsStopped === undefined
					? {}
					: { allThreadsStopped: body.allThreadsStopped }),
				...(body.hitBreakpointIds === undefined
					? {}
					: { hitBreakpointIds: [...body.hitBreakpointIds] })
			};
		}

		if (event.event === 'continued') {
			const body = eventBody<{
				threadId: number;
				allThreadsContinued: boolean;
			}>(event);
			if (body.threadId === undefined) {
				return { type: 'dap', event: event.event, body: event.body };
			}
			return {
				type: 'continued',
				threadId: body.threadId,
				...(body.allThreadsContinued === undefined
					? {}
					: { allThreadsContinued: body.allThreadsContinued })
			};
		}

		if (event.event === 'output') {
			const body = eventBody<{
				category: string;
				output: string;
				group: 'start' | 'startCollapsed' | 'end';
				variablesReference: number;
				source: DebugSource;
				line: number;
				column: number;
				data: unknown;
			}>(event);
			return {
				type: 'output',
				output: body.output || '',
				...(body.category === undefined ? {} : { category: body.category }),
				...(body.group === undefined ? {} : { group: body.group }),
				...(body.variablesReference === undefined
					? {}
					: { variablesReference: body.variablesReference }),
				...(body.source === undefined ? {} : { source: cloneDebugSource(body.source) }),
				...(body.line === undefined ? {} : { line: body.line }),
				...(body.column === undefined ? {} : { column: body.column }),
				...(body.data === undefined ? {} : { data: body.data })
			};
		}

		if (event.event === 'exited') {
			const body = eventBody<{ exitCode: number }>(event);
			return { type: 'exited', exitCode: body.exitCode || 0 };
		}

		if (event.event === 'terminated') {
			const body = eventBody<{ restart: unknown }>(event);
			return {
				type: 'terminated',
				...(body.restart === undefined ? {} : { restart: body.restart })
			};
		}

		if (event.event === 'thread') {
			const body = eventBody<{ reason: 'started' | 'exited'; threadId: number }>(event);
			if (
				(body.reason !== 'started' && body.reason !== 'exited') ||
				body.threadId === undefined
			) {
				return { type: 'dap', event: event.event, body: event.body };
			}
			return { type: 'thread', reason: body.reason, threadId: body.threadId };
		}

		if (event.event === 'process') {
			const body = eventBody<{
				name: string;
				systemProcessId: number;
				isLocalProcess: boolean;
				startMethod: 'launch' | 'attach' | 'attachForSuspendedLaunch';
				pointerSize: number;
			}>(event);
			if (body.name === undefined) {
				return { type: 'dap', event: event.event, body: event.body };
			}
			return {
				type: 'process',
				name: body.name,
				...(body.systemProcessId === undefined
					? {}
					: { systemProcessId: body.systemProcessId }),
				...(body.isLocalProcess === undefined
					? {}
					: { isLocalProcess: body.isLocalProcess }),
				...(body.startMethod === undefined ? {} : { startMethod: body.startMethod }),
				...(body.pointerSize === undefined ? {} : { pointerSize: body.pointerSize })
			};
		}

		if (event.event === 'breakpoint') {
			const body = eventBody<{
				reason: 'new' | 'changed' | 'removed';
				breakpoint: DapBreakpoint;
			}>(event);
			if (
				(body.reason !== 'new' && body.reason !== 'changed' && body.reason !== 'removed') ||
				!body.breakpoint
			) {
				return { type: 'dap', event: event.event, body: event.body };
			}
			const tracked =
				body.breakpoint.id === undefined
					? undefined
					: this.#breakpointsById.get(body.breakpoint.id);
			if (body.breakpoint.id !== undefined && !tracked && body.reason !== 'new') {
				return null;
			}
			const fallbackSource = body.breakpoint.source || tracked?.source || {};
			const requestedLine = tracked?.requestedLine || body.breakpoint.line || 1;
			const breakpoint = this.#normalizeBreakpoint(
				body.breakpoint,
				fallbackSource,
				requestedLine
			);
			if (breakpoint.id !== undefined) {
				const storedBreakpoint = cloneResolvedBreakpoints([breakpoint])[0]!;
				const sourceKey = debugSourceKey(breakpoint.source);
				const previousSourceKey = tracked ? debugSourceKey(tracked.source) : sourceKey;
				if (previousSourceKey !== sourceKey) {
					this.#breakpointIdsBySource.get(previousSourceKey)?.delete(breakpoint.id);
					const previousBreakpoints =
						this.#breakpointsBySource.get(previousSourceKey) ?? [];
					this.#breakpointsBySource.set(
						previousSourceKey,
						previousBreakpoints.filter((candidate) => candidate.id !== breakpoint.id)
					);
				}
				if (body.reason === 'removed') {
					this.#breakpointsById.delete(breakpoint.id);
					this.#breakpointIdsBySource.get(previousSourceKey)?.delete(breakpoint.id);
					const current = this.#breakpointsBySource.get(previousSourceKey) ?? [];
					this.#breakpointsBySource.set(
						previousSourceKey,
						current.filter((candidate) => candidate.id !== breakpoint.id)
					);
				} else {
					this.#breakpointsById.set(breakpoint.id, storedBreakpoint);
					const ids = this.#breakpointIdsBySource.get(sourceKey) ?? new Set<number>();
					ids.add(breakpoint.id);
					this.#breakpointIdsBySource.set(sourceKey, ids);
					const current = this.#breakpointsBySource.get(sourceKey) ?? [];
					const index = current.findIndex((candidate) => candidate.id === breakpoint.id);
					const next = [...current];
					if (index < 0) next.push(storedBreakpoint);
					else next[index] = storedBreakpoint;
					this.#breakpointsBySource.set(sourceKey, next);
				}
			}
			return { type: 'breakpoint', reason: body.reason, breakpoint };
		}

		return { type: 'dap', event: event.event, body: event.body };
	}
}

export function createLldbDapAdapter(session: DapSession, options: LldbDapAdapterOptions = {}) {
	return new LldbDapAdapter(session, options);
}
