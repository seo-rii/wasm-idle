import type {
	DebugCommand,
	DebugDataBreakpoint,
	DebugDataBreakpointInfo,
	DebugDataBreakpointInfoArguments,
	DebugMemory,
	DebugResolvedDataBreakpoint,
	DebugScope,
	DebugVariable,
	DebugWriteMemoryResult
} from './debug.js';
import type { ProgressLike } from './progress.js';
import type { SandboxExecutionOptions } from './sandbox.js';

export interface TerminalControl {
	clear: () => Promise<void>;
	prepare: (
		language: string,
		code: string,
		log?: boolean,
		progress?: ProgressLike,
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean>;
	run: (
		language: string,
		code: string,
		log?: boolean,
		progress?: ProgressLike,
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean | string>;
	destroy: () => Promise<void>;
	restartRuntime: () => Promise<void>;
	stop?: () => Promise<void>;
	debugCommand?: (command: DebugCommand) => Promise<void>;
	debugPause?: () => Promise<void>;
	setBreakpoints?: (lines: number[], sourcePath?: string) => Promise<void>;
	debugEvaluate?: (expression: string) => Promise<string>;
	debugVariables?: (
		variablesReference: number,
		start?: number,
		count?: number
	) => Promise<DebugVariable[]>;
	debugScopes?: (frameId: number) => Promise<DebugScope[]>;
	debugReadMemory?: (
		memoryReference: string,
		offset: number,
		count: number
	) => Promise<DebugMemory | null>;
	debugWriteMemory?: (
		memoryReference: string,
		offset: number,
		data: Uint8Array,
		allowPartial?: boolean
	) => Promise<DebugWriteMemoryResult | null>;
	debugDataBreakpointInfo?: (
		arguments_: DebugDataBreakpointInfoArguments
	) => Promise<DebugDataBreakpointInfo | null>;
	debugSetDataBreakpoints?: (
		breakpoints: DebugDataBreakpoint[]
	) => Promise<DebugResolvedDataBreakpoint[]>;
	waitForInput?: () => Promise<void>;
	write: (input: string) => Promise<void>;
	eof?: () => Promise<void>;
}
