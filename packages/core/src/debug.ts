export type DebugCommand = 'continue' | 'stepInto' | 'nextLine' | 'stepOut';
export type DebugPauseReason = 'breakpoint' | 'entry' | 'pause' | 'step' | 'nextLine' | 'stepOut';

export interface DebugVariable {
	name: string;
	value: string;
	type?: string;
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
	line: number;
	id?: number;
	column?: number;
	sourcePath?: string;
	sourceContentSha256?: string;
}

export interface DebugScope {
	name: string;
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

export interface DebugResolvedBreakpoint {
	requestedLine: number;
	line: number;
	verified: boolean;
	message?: string;
}

export interface DebugSourceBreakpoints {
	sourcePath: string;
	lines: number[];
}

export type DebugSessionEvent =
	| {
			type: 'pause';
			line: number;
			reason: DebugPauseReason;
			locals: DebugVariable[];
			callStack: DebugFrame[];
			threadId?: number;
			frameId?: number;
			scopes?: DebugScope[];
			stoppedReason?: string;
			sourcePath?: string;
			sourceContentSha256?: string;
			sourceRevisionStale?: boolean;
	  }
	| { type: 'resume'; command: DebugCommand }
	| {
			type: 'breakpoints';
			sourcePath: string;
			sourceContentSha256?: string;
			breakpoints: DebugResolvedBreakpoint[];
	  }
	| { type: 'stop' };
