import type { DebugCommand, DebugSessionEvent } from '@wasm-idle/core';

import { createDebugAdapterEventChannel } from './event-channel.js';
import { cloneDebugSource, sameDebugSource, validateBreakpointLines } from './source.js';
import {
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
	type DebugWriteMemoryResult,
	type ResolvedBreakpoint
} from './types.js';

type MaybePromise<T> = T | Promise<T>;

export interface TraceDebugControl {
	debugCommand(command: DebugCommand): MaybePromise<void>;
	setBreakpoints(lines: number[]): MaybePromise<void>;
	debugEvaluate?(expression: string): MaybePromise<string>;
	stop(): MaybePromise<void>;
}

export interface TraceDebugAdapterOptions {
	control: TraceDebugControl;
	launch(config: DebugLaunchConfig): MaybePromise<void>;
	subscribe?(listener: (event: DebugSessionEvent) => void): (() => void) | void;
	source?: DebugSource;
}

const traceThread: DebugThread = {
	id: 1,
	name: 'Main Thread'
};

function assertTraceThread(threadId: number) {
	if (threadId !== traceThread.id) {
		throw new RangeError(`Trace debugging only exposes thread ${traceThread.id}.`);
	}
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

export class TraceDebugAdapter implements DebugAdapter {
	readonly kind = 'trace' as const;

	readonly #options: TraceDebugAdapterOptions;
	readonly #events = createDebugAdapterEventChannel();
	readonly #capabilities: DebugCapabilities;
	#source: DebugSource | null;
	#active = false;
	#frames: DebugStackFrame[] = [];
	#framesById = new Map<number, DebugStackFrame>();
	#scopeReferenceByFrameId = new Map<number, number>();
	#variablesByReference = new Map<number, DebugVariable[]>();
	#nextFrameId = 1;
	#nextVariablesReference = 1;

	constructor(options: TraceDebugAdapterOptions) {
		this.#options = options;
		this.#source = options.source ? cloneDebugSource(options.source) : null;
		this.#capabilities = Object.freeze({
			supportsConfigurationDone: false,
			supportsBreakpoints: true,
			supportsConditionalBreakpoints: false,
			supportsLogPoints: false,
			supportsContinue: true,
			supportsPause: false,
			supportsStepIn: true,
			supportsStepOver: true,
			supportsStepOut: true,
			supportsThreads: true,
			supportsStackTrace: true,
			supportsScopes: true,
			supportsVariables: true,
			supportsEvaluate: typeof options.control.debugEvaluate === 'function',
			supportsEvaluateForHovers: false,
			supportsReadMemory: false,
			supportsWriteMemory: false,
			supportsDataBreakpoints: false,
			supportsSetVariable: false,
			supportsRestart: false,
			supportsTerminate: true
		});
		options.subscribe?.((event) => {
			this.handleEvent(event);
		});
	}

	get capabilities() {
		return this.#capabilities;
	}

	async initialize() {
		return this.#capabilities;
	}

	async launch(config: DebugLaunchConfig) {
		this.#clearPauseState();
		if (config.source) this.#source = cloneDebugSource(config.source);
		await this.#options.launch(config);
		this.#active = true;
	}

	async disconnect(_options: DebugDisconnectOptions = {}) {
		await this.#options.control.stop();
		this.#active = false;
		this.#clearPauseState();
	}

	async setBreakpoints(source: DebugSource, lines: number[]) {
		const requestedLines = validateBreakpointLines(lines);
		if (this.#source && !sameDebugSource(this.#source, source)) {
			return requestedLines.map<ResolvedBreakpoint>((line) => ({
				verified: false,
				source: cloneDebugSource(source),
				requestedLine: line,
				line,
				message: 'Trace debugging supports breakpoints in only one source file.'
			}));
		}

		if (!this.#source) this.#source = cloneDebugSource(source);
		await this.#options.control.setBreakpoints(requestedLines);
		return requestedLines.map<ResolvedBreakpoint>((line) => ({
			verified: true,
			source: cloneDebugSource(source),
			requestedLine: line,
			line
		}));
	}

	async continue(threadId: number) {
		await this.#sendCommand(threadId, 'continue');
	}

	async pause(threadId: number) {
		assertTraceThread(threadId);
		throw new UnsupportedDebugOperationError('pause');
	}

	async next(threadId: number) {
		await this.#sendCommand(threadId, 'nextLine');
	}

	async stepIn(threadId: number) {
		await this.#sendCommand(threadId, 'stepInto');
	}

	async stepOut(threadId: number) {
		await this.#sendCommand(threadId, 'stepOut');
	}

	async threads() {
		return this.#active ? [{ ...traceThread }] : [];
	}

	async stackTrace(threadId: number, startFrame = 0, levels = 0) {
		assertTraceThread(threadId);
		assertNonNegativeInteger(startFrame, 'startFrame');
		assertNonNegativeInteger(levels, 'levels');
		const endFrame = levels === 0 ? undefined : startFrame + levels;
		return this.#frames.slice(startFrame, endFrame).map((frame) => ({
			...frame,
			...(frame.source ? { source: cloneDebugSource(frame.source) } : {})
		}));
	}

	async scopes(frameId: number) {
		assertPositiveInteger(frameId, 'frameId');
		if (!this.#framesById.has(frameId)) return [];
		const variablesReference = this.#scopeReferenceByFrameId.get(frameId);
		if (!variablesReference) return [];
		const variables = this.#variablesByReference.get(variablesReference) || [];
		return [
			{
				name: 'Locals',
				presentationHint: 'locals',
				variablesReference,
				namedVariables: variables.length,
				expensive: false
			}
		] satisfies DebugScope[];
	}

	async variables(variablesReference: number, start = 0, count?: number) {
		assertPositiveInteger(variablesReference, 'variablesReference');
		assertNonNegativeInteger(start, 'start');
		if (count !== undefined) assertNonNegativeInteger(count, 'count');
		const variables = this.#variablesByReference.get(variablesReference) || [];
		const end = count === undefined ? undefined : start + count;
		return variables.slice(start, end).map((variable) => ({ ...variable }));
	}

	async readMemory(
		_memoryReference: string,
		_offset: number,
		_count: number
	): Promise<DebugMemory> {
		throw new UnsupportedDebugOperationError('read memory');
	}

	async writeMemory(
		_memoryReference: string,
		_offset: number,
		_data: Uint8Array,
		_allowPartial = false
	): Promise<DebugWriteMemoryResult> {
		throw new UnsupportedDebugOperationError('write memory');
	}

	async evaluate(expression: string, frameId?: number): Promise<DebugEvaluateResult> {
		const evaluate = this.#options.control.debugEvaluate;
		if (!evaluate) throw new UnsupportedDebugOperationError('evaluate expressions');
		if (frameId !== undefined) {
			assertPositiveInteger(frameId, 'frameId');
			if (!this.#framesById.has(frameId)) {
				throw new RangeError(`Unknown trace frame ${frameId}.`);
			}
		}
		return {
			result: await evaluate(expression),
			variablesReference: 0
		};
	}

	onEvent(listener: (event: DebugAdapterEvent) => void) {
		return this.#events.subscribe(listener);
	}

	handleEvent(event: DebugSessionEvent) {
		if (event.type === 'pause') {
			this.#active = true;
			this.#populatePauseState(event);
			this.#events.emit({
				type: 'stopped',
				reason: event.reason,
				threadId: traceThread.id,
				allThreadsStopped: true
			});
			return;
		}

		if (event.type === 'resume') {
			this.#clearPauseState();
			this.#events.emit({
				type: 'continued',
				threadId: traceThread.id,
				allThreadsContinued: true
			});
			return;
		}

		this.#active = false;
		this.#clearPauseState();
		this.#events.emit({ type: 'terminated' });
	}

	async #sendCommand(threadId: number, command: DebugCommand) {
		assertTraceThread(threadId);
		await this.#options.control.debugCommand(command);
	}

	#populatePauseState(event: Extract<DebugSessionEvent, { type: 'pause' }>) {
		this.#clearPauseState();
		const variables = event.locals.map<DebugVariable>((variable) => ({
			name: variable.name,
			value: variable.value,
			variablesReference: 0
		}));
		const variablesReference = variables.length ? this.#nextVariablesReference++ : 0;
		if (variablesReference) this.#variablesByReference.set(variablesReference, variables);

		const source = this.#source ? cloneDebugSource(this.#source) : undefined;
		const traceFrames = event.callStack.length
			? event.callStack
			: [{ functionName: '<trace>', line: event.line }];
		this.#frames = traceFrames.map((frame, index) => {
			const debugFrame: DebugStackFrame = {
				id: this.#nextFrameId++,
				name: frame.functionName,
				...(source ? { source: cloneDebugSource(source) } : {}),
				line: frame.line,
				column: 1
			};
			this.#framesById.set(debugFrame.id, debugFrame);
			if (index === 0 && variablesReference) {
				this.#scopeReferenceByFrameId.set(debugFrame.id, variablesReference);
			}
			return debugFrame;
		});
	}

	#clearPauseState() {
		this.#frames = [];
		this.#framesById.clear();
		this.#scopeReferenceByFrameId.clear();
		this.#variablesByReference.clear();
	}
}

export function createTraceDebugAdapter(options: TraceDebugAdapterOptions) {
	return new TraceDebugAdapter(options);
}
