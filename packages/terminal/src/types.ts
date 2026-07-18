import type {
	BoundSandbox as CoreBoundSandbox,
	DebugCommand,
	PlaygroundBinding as CorePlaygroundBinding,
	ProgressLike,
	SandboxExecutionOptions as CoreSandboxExecutionOptions,
	TerminalControl as CoreTerminalControl
} from '@wasm-idle/core';

export type CompilerDiagnosticSeverity = 'error' | 'warning' | 'other';

export interface CompilerDiagnostic {
	fileName?: string | null;
	lineNumber: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity: CompilerDiagnosticSeverity;
	message: string;
}

export type RustTargetTriple = 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3';
export type GoTarget = 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' | 'js/wasm';
export type TinyGoTarget = 'wasm' | 'wasip1' | 'wasip2' | 'wasip3';
export type OcamlBackend = 'js' | 'wasm';
export type OcamlWasmBinaryenMode = 'fast' | 'full';
export type ZigTargetTriple = 'wasm64-wasi';

export interface SandboxWorkspaceFile {
	path: string;
	content: string;
}

export interface SandboxExecutionOptions {
	debug?: boolean;
	breakpoints?: number[];
	pauseOnEntry?: boolean;
	stdin?: string;
	activePath?: string;
	debugPath?: string;
	workspaceFiles?: SandboxWorkspaceFile[];
	compileArgs?: string[];
	programArgs?: string[];
	cppVersion?: string;
	cVersion?: string;
	rustTargetTriple?: RustTargetTriple;
	goTarget?: GoTarget;
	tinygoTarget?: TinyGoTarget;
	ocamlBackend?: OcamlBackend;
	ocamlWasmBinaryenMode?: OcamlWasmBinaryenMode;
	zigTargetTriple?: ZigTargetTriple;
}

export type TerminalExecutionOptions = SandboxExecutionOptions | CoreSandboxExecutionOptions;

export interface BoundSandbox extends Omit<
	CoreBoundSandbox,
	'load' | 'run' | 'oncompilerdiagnostic'
> {
	load(
		code?: string,
		log?: boolean,
		args?: string[],
		options?: TerminalExecutionOptions,
		progress?: ProgressLike
	): Promise<void>;
	run(
		code: string,
		prepare: boolean,
		log?: boolean,
		progress?: ProgressLike,
		args?: string[],
		options?: TerminalExecutionOptions
	): Promise<boolean | string>;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
}

export interface PlaygroundBinding extends Pick<CorePlaygroundBinding, 'runtimeAssets'> {
	load: (language: string) => Promise<BoundSandbox>;
}

export interface TerminalControl extends Omit<
	CoreTerminalControl,
	'prepare' | 'run' | 'debugCommand'
> {
	prepare: (
		language: string,
		code: string,
		log?: boolean,
		progress?: ProgressLike,
		args?: string[],
		options?: TerminalExecutionOptions
	) => Promise<boolean>;
	run: (
		language: string,
		code: string,
		log?: boolean,
		progress?: ProgressLike,
		args?: string[],
		options?: TerminalExecutionOptions
	) => Promise<boolean | string>;
	debugCommand: (command: DebugCommand) => Promise<void>;
}

export type {
	DebugCommand,
	DebugFrame,
	DebugSessionEvent,
	DebugVariable,
	ProgressLike
} from '@wasm-idle/core';
