import type { DebugMemory as CoreDebugMemory } from '@wasm-idle/core';

export type DebugAdapterKind = 'trace' | 'lldb';

export interface DebugCapabilities {
	readonly supportsConfigurationDone: boolean;
	readonly supportsBreakpoints: boolean;
	readonly supportsConditionalBreakpoints: boolean;
	readonly supportsLogPoints: boolean;
	readonly supportsContinue: boolean;
	readonly supportsPause: boolean;
	readonly supportsStepIn: boolean;
	readonly supportsStepOver: boolean;
	readonly supportsStepOut: boolean;
	readonly supportsThreads: boolean;
	readonly supportsStackTrace: boolean;
	readonly supportsScopes: boolean;
	readonly supportsVariables: boolean;
	readonly supportsEvaluate: boolean;
	readonly supportsEvaluateForHovers: boolean;
	readonly supportsReadMemory: boolean;
	readonly supportsWriteMemory: boolean;
	readonly supportsDataBreakpoints: boolean;
	readonly supportsSetVariable: boolean;
	readonly supportsRestart: boolean;
	readonly supportsTerminate: boolean;
}

export interface DebugSource {
	name?: string;
	path?: string;
	sourceReference?: number;
	presentationHint?: 'normal' | 'emphasize' | 'deemphasize';
	origin?: string;
	adapterData?: unknown;
}

export interface DebugLaunchConfig {
	program?: string;
	cwd?: string;
	args?: string[];
	environment?: Record<string, string>;
	stopOnEntry?: boolean;
	source?: DebugSource;
	[key: string]: unknown;
}

export interface DebugDisconnectOptions {
	terminateTarget?: boolean;
}

export interface ResolvedBreakpoint {
	id?: number;
	verified: boolean;
	source: DebugSource;
	requestedLine: number;
	line: number;
	column?: number;
	endLine?: number;
	endColumn?: number;
	message?: string;
	instructionReference?: string;
	offset?: number;
}

export interface DebugThread {
	id: number;
	name: string;
}

export interface DebugStackFrame {
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
}

export interface DebugScope {
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
}

export interface DebugVariablePresentationHint {
	kind?:
		| 'property'
		| 'method'
		| 'class'
		| 'data'
		| 'event'
		| 'baseClass'
		| 'innerClass'
		| 'interface'
		| 'mostDerivedClass'
		| 'virtual'
		| 'dataBreakpoint';
	attributes?: Array<
		| 'static'
		| 'constant'
		| 'readOnly'
		| 'rawString'
		| 'hasObjectId'
		| 'canHaveObjectId'
		| 'hasSideEffects'
		| 'hasDataBreakpoint'
	>;
	visibility?: 'public' | 'private' | 'protected' | 'internal' | 'final';
	lazy?: boolean;
}

export interface DebugVariable {
	name: string;
	value: string;
	type?: string;
	presentationHint?: DebugVariablePresentationHint;
	evaluateName?: string;
	variablesReference: number;
	namedVariables?: number;
	indexedVariables?: number;
	memoryReference?: string;
}

export type DebugMemory = CoreDebugMemory;

export interface DebugWriteMemoryResult {
	offset?: number;
	bytesWritten: number;
}

export interface DebugEvaluateResult {
	result: string;
	type?: string;
	presentationHint?: DebugVariablePresentationHint;
	variablesReference: number;
	namedVariables?: number;
	indexedVariables?: number;
	memoryReference?: string;
}

export type DebugAdapterEvent =
	| { type: 'initialized' }
	| {
			type: 'stopped';
			reason: string;
			description?: string;
			threadId?: number;
			preserveFocusHint?: boolean;
			text?: string;
			allThreadsStopped?: boolean;
			hitBreakpointIds?: number[];
	  }
	| {
			type: 'continued';
			threadId: number;
			allThreadsContinued?: boolean;
	  }
	| {
			type: 'output';
			category?: string;
			output: string;
			group?: 'start' | 'startCollapsed' | 'end';
			variablesReference?: number;
			source?: DebugSource;
			line?: number;
			column?: number;
			data?: unknown;
	  }
	| { type: 'exited'; exitCode: number }
	| { type: 'terminated'; restart?: unknown }
	| {
			type: 'breakpoint';
			reason: 'new' | 'changed' | 'removed';
			breakpoint: ResolvedBreakpoint;
	  }
	| { type: 'thread'; reason: 'started' | 'exited'; threadId: number }
	| {
			type: 'process';
			name: string;
			systemProcessId?: number;
			isLocalProcess?: boolean;
			startMethod?: 'launch' | 'attach' | 'attachForSuspendedLaunch';
			pointerSize?: number;
	  }
	| { type: 'dap'; event: string; body?: unknown };

export interface DebugAdapter {
	readonly kind: DebugAdapterKind;
	readonly capabilities: DebugCapabilities | null;

	initialize(): Promise<DebugCapabilities>;
	launch(config: DebugLaunchConfig): Promise<void>;
	disconnect(options?: DebugDisconnectOptions): Promise<void>;

	setBreakpoints(source: DebugSource, lines: number[]): Promise<ResolvedBreakpoint[]>;

	continue(threadId: number): Promise<void>;
	pause(threadId: number): Promise<void>;
	next(threadId: number): Promise<void>;
	stepIn(threadId: number): Promise<void>;
	stepOut(threadId: number): Promise<void>;

	threads(): Promise<DebugThread[]>;
	stackTrace(threadId: number, startFrame?: number, levels?: number): Promise<DebugStackFrame[]>;
	scopes(frameId: number): Promise<DebugScope[]>;
	variables(variablesReference: number, start?: number, count?: number): Promise<DebugVariable[]>;

	readMemory(memoryReference: string, offset: number, count: number): Promise<DebugMemory>;
	writeMemory(
		memoryReference: string,
		offset: number,
		data: Uint8Array,
		allowPartial?: boolean
	): Promise<DebugWriteMemoryResult>;
	evaluate(expression: string, frameId?: number): Promise<DebugEvaluateResult>;

	onEvent(listener: (event: DebugAdapterEvent) => void): () => void;
}

export class UnsupportedDebugOperationError extends Error {
	readonly operation: string;

	constructor(operation: string) {
		super(`The debug adapter does not support ${operation}.`);
		this.name = 'UnsupportedDebugOperationError';
		this.operation = operation;
	}
}

export class DebugAdapterStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DebugAdapterStateError';
	}
}

export class DebugAdapterProtocolError extends Error {
	readonly command: string;
	readonly path: string;

	constructor(command: string, path: string, expectation: string) {
		super(`Invalid DAP ${command} response at ${path}: ${expectation}.`);
		this.name = 'DebugAdapterProtocolError';
		this.command = command;
		this.path = path;
	}
}
