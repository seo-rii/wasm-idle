export type DebugCommand = 'continue' | 'stepInto' | 'nextLine' | 'stepOut';
export type DebugPauseReason = 'breakpoint' | 'entry' | 'step' | 'nextLine' | 'stepOut';

export interface DebugVariable {
	name: string;
	value: string;
}

export type DebugVariableKind = 'number' | 'bool' | 'array';
export type DebugArrayElementKind = 'int' | 'float' | 'double' | 'bool' | 'char';

export interface DebugVariableMetadata {
	slot: number;
	name: string;
	kind: DebugVariableKind;
	fromLine: number;
	toLine: number;
	elementKind?: DebugArrayElementKind;
	length?: number;
}

export interface DebugFrame {
	functionName: string;
	line: number;
}

export type DebugSessionEvent =
	| { type: 'pause'; line: number; reason: DebugPauseReason; locals: DebugVariable[]; callStack: DebugFrame[] }
	| { type: 'resume'; command: DebugCommand }
	| { type: 'stop' };

export interface SandboxExecutionOptions {
	debug?: boolean;
	breakpoints?: number[];
	pauseOnEntry?: boolean;
}
