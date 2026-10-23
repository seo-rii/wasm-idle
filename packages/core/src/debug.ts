export type DebugCommand = 'continue' | 'stepInto' | 'nextLine' | 'stepOut';
export type DebugPauseReason =
	'breakpoint' | 'dataBreakpoint' | 'entry' | 'pause' | 'step' | 'nextLine' | 'stepOut';

/** DAP presentation metadata; values are kept extensible for adapter-specific hints. */
export interface DebugVariablePresentationHint {
	kind?: string;
	attributes?: string[];
	visibility?: string;
	lazy?: boolean;
}

export interface DebugEvaluateOptions {
	frameId?: number;
	context?: 'watch' | 'hover';
}

export interface DebugEvaluateResult {
	result: string;
	type?: string;
	variablesReference: number;
	namedVariables?: number;
	indexedVariables?: number;
	memoryReference?: string;
	presentationHint?: DebugVariablePresentationHint;
}

export interface DebugSourceBreakpoint {
	line: number;
	enabled?: boolean;
	condition?: string;
	/** Positive decimal N stops on the Nth and every subsequent hit; empty clears. */
	hitCondition?: string;
	logMessage?: string;
}

/** Fixed debugger policy, never a user-supplied LLDB command. */
export interface DebugSteppingOptions {
	skipLibraryCode: boolean;
}

export interface DebugVariable {
	name: string;
	value: string;
	type?: string;
	presentationHint?: DebugVariablePresentationHint;
	evaluateName?: string;
	variablesReference?: number;
	memoryReference?: string;
	namedVariables?: number;
	indexedVariables?: number;
}

export type DebugVariableKind = 'number' | 'bool' | 'array' | 'text';
export type DebugArrayElementKind = 'int' | 'float' | 'double' | 'bool' | 'char';

export interface DebugStructFieldMetadata {
	name: string;
	kind: DebugArrayElementKind;
	offset: number;
}

export interface DebugVariableMetadata {
	slot: number;
	name: string;
	kind: DebugVariableKind;
	fromLine: number;
	toLine: number;
	elementKind?: DebugArrayElementKind;
	length?: number;
	dimensions?: number[];
	structFields?: DebugStructFieldMetadata[];
	structSize?: number;
}

export interface DebugFrame {
	functionName: string;
	/** Current stopped-frame argument values, when the adapter distinguishes arguments. */
	argumentsSummary?: string;
	/** Adapter-formatted stopped-frame name including argument values, when supported. */
	displayName?: string;
	line: number;
	id?: number;
	column?: number;
	sourcePath?: string;
	sourceContentSha256?: string;
}

export interface DebugScope {
	name: string;
	/** DAP scope meaning; adapters may supply additional implementation-specific hints. */
	presentationHint?: string;
	variablesReference: number;
	namedVariables?: number;
	indexedVariables?: number;
	expensive: boolean;
	variables: DebugVariable[];
}

export interface DebugMemory {
	address?: string;
	data: Uint8Array;
	unreadableBytes: number;
}

export interface DebugWriteMemoryResult {
	offset?: number;
	bytesWritten: number;
}

export type DebugDataBreakpointAccessType = 'read' | 'write' | 'readWrite';

export interface DebugDataBreakpointInfoArguments {
	name: string;
	variablesReference?: number;
	frameId?: number;
	asAddress?: boolean;
	bytes?: number;
}

export interface DebugDataBreakpointInfo {
	dataId?: string;
	description: string;
	accessTypes?: DebugDataBreakpointAccessType[];
	canPersist?: boolean;
}

export interface DebugDataBreakpoint {
	dataId: string;
	accessType?: DebugDataBreakpointAccessType;
}

export interface DebugResolvedDataBreakpoint {
	id?: number;
	verified: boolean;
	message?: string;
}

export interface DebugResolvedBreakpoint {
	requestedLine: number;
	line: number;
	verified: boolean;
	message?: string;
}

export interface DebugSessionCapabilities {
	readMemory: boolean;
	writeMemory: boolean;
	dataBreakpoints: boolean;
	/** Optional additions default to unsupported for older runtimes. */
	evaluateValues?: boolean;
	evaluateForHovers?: boolean;
	conditionalBreakpoints?: boolean;
	hitConditionalBreakpoints?: boolean;
	logPoints?: boolean;
	skipLibraryCode?: boolean;
	returnValues?: boolean;
}

export interface DebugSourceBreakpoints {
	sourcePath: string;
	lines: number[];
	/** When supplied, this specification is authoritative over the legacy lines. */
	breakpoints?: DebugSourceBreakpoint[];
}

export type DebugSessionEvent =
	| {
			type: 'pause';
			/** IDs are scoped to one runtime session and one real stop. */
			sessionId?: string;
			stopId?: number;
			line: number;
			reason: DebugPauseReason;
			locals: DebugVariable[];
			callStack: DebugFrame[];
			/** False for pending or capped caller stacks; omitted means complete. */
			callStackComplete?: boolean;
			threadId?: number;
			frameId?: number;
			scopes?: DebugScope[];
			stoppedReason?: string;
			sourcePath?: string;
			sourceContentSha256?: string;
			sourceRevisionStale?: boolean;
			capabilities?: DebugSessionCapabilities;
	  }
	| {
			type: 'pauseDetails';
			sessionId?: string;
			stopId: number;
			callStack?: DebugFrame[];
			callStackComplete?: boolean;
			frameId?: number;
			scopes?: DebugScope[];
	  }
	| { type: 'resume'; command: DebugCommand }
	| {
			type: 'breakpoints';
			sourcePath: string;
			sourceContentSha256?: string;
			breakpoints: DebugResolvedBreakpoint[];
	  }
	| { type: 'stop' };
