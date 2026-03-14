import type {
	CompilerDiagnostic,
	DebugCommand,
	DebugFrame,
	DebugSessionEvent,
	DebugVariable,
	SandboxExecutionOptions
} from '$lib/playground/options';

export interface ProgressLike {
	set?: (value: number) => void;
}

export interface TerminalControl {
	clear: () => Promise<void>;
	prepare: (
		language: string,
		code: string,
		log?: boolean,
		prog?: ProgressLike,
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean>;
	run: (
		language: string,
		code: string,
		log?: boolean,
		prog?: ProgressLike,
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean | string>;
	destroy: () => Promise<void>;
	debugCommand: (command: DebugCommand) => Promise<void>;
	debugEvaluate?: (expression: string) => Promise<string>;
	write: (input: string) => Promise<void>;
}

export type {
	CompilerDiagnostic,
	DebugCommand,
	DebugFrame,
	DebugSessionEvent,
	DebugVariable,
	SandboxExecutionOptions
};
