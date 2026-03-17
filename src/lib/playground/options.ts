export type DebugCommand = 'continue' | 'stepInto' | 'nextLine' | 'stepOut';
export type DebugPauseReason = 'breakpoint' | 'entry' | 'step' | 'nextLine' | 'stepOut';

export interface DebugVariable {
	name: string;
	value: string;
}

export type CompilerDiagnosticSeverity = 'error' | 'warning' | 'other';

export interface CompilerDiagnostic {
	fileName?: string | null;
	lineNumber: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity: CompilerDiagnosticSeverity;
	message: string;
}

export type DebugVariableKind = 'number' | 'bool' | 'array' | 'text';
export type DebugArrayElementKind = 'int' | 'float' | 'double' | 'bool' | 'char';

export interface DebugVariableMetadata {
	slot: number;
	name: string;
	kind: DebugVariableKind;
	fromLine: number;
	toLine: number;
	elementKind?: DebugArrayElementKind;
	length?: number;
	dimensions?: number[];
}

export interface DebugFrame {
	functionName: string;
	line: number;
}

export type DebugSessionEvent =
	| {
			type: 'pause';
			line: number;
			reason: DebugPauseReason;
			locals: DebugVariable[];
			callStack: DebugFrame[];
	  }
	| { type: 'resume'; command: DebugCommand }
	| { type: 'stop' };

export interface SandboxExecutionOptions {
	debug?: boolean;
	breakpoints?: number[];
	pauseOnEntry?: boolean;
	stdin?: string;
	compileArgs?: string[];
	programArgs?: string[];
	cppVersion?: string;
	cVersion?: string;
}

export interface ResolvedSandboxExecutionArgs {
	compileArgs: string[];
	programArgs: string[];
}

function cloneArgs(value?: string[]) {
	return Array.isArray(value) ? [...value] : [];
}

export function resolveSandboxExecutionArgs(
	language: string,
	args: string[] = [],
	options: SandboxExecutionOptions = {}
): ResolvedSandboxExecutionArgs {
	if (language === 'C' || language === 'CPP') {
		return {
			compileArgs: cloneArgs(options.compileArgs ?? args),
			programArgs: cloneArgs(options.programArgs)
		};
	}

	return {
		compileArgs: cloneArgs(options.compileArgs),
		programArgs: cloneArgs(options.programArgs ?? args)
	};
}
