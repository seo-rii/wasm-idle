import type {
	CompilerDiagnostic,
	DebugCommand,
	DebugMemory,
	DebugSessionEvent,
	SandboxExecutionOptions
} from '$lib/playground/options';
import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import type { SandboxProgress as CoreSandboxProgress } from '@wasm-idle/core';

export type SandboxRuntimeAssets = string | PlaygroundRuntimeAssets;
export type SandboxProgress = CoreSandboxProgress;

export interface Sandbox {
	constructor: any;
	eof: () => void;
	load: (
		runtimeAssets?: SandboxRuntimeAssets,
		code?: string,
		log?: boolean,
		args?: string[],
		options?: SandboxExecutionOptions,
		progress?: SandboxProgress
	) => Promise<void>;
	run: (
		code: string,
		prepare: boolean,
		log?: boolean,
		prog?: SandboxProgress,
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean | string>;
	terminate: () => void | Promise<void>;
	clear: () => Promise<void>;

	kill?: () => void | Promise<void>;
	write?: (data: string) => void;
	output?: (data: string) => void;
	ondebug?: (event: DebugSessionEvent) => void;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	debugCommand?: (command: DebugCommand) => void | Promise<void>;
	debugPause?: () => void | Promise<void>;
	setBreakpoints?: (lines: number[], sourcePath?: string) => void | Promise<void>;
	debugEvaluate?: (expression: string) => Promise<string>;
	debugReadMemory?: (
		memoryReference: string,
		offset: number,
		count: number
	) => Promise<DebugMemory | null>;
	image?: (data: { mime: string; b64: string; ts?: number }) => void;
	elapse?: number;
}

export interface BoundSandbox extends Omit<Sandbox, 'load'> {
	load: (
		code?: string,
		log?: boolean,
		args?: string[],
		options?: SandboxExecutionOptions,
		progress?: SandboxProgress
	) => Promise<void>;
	runtimeAssets: SandboxRuntimeAssets;
}

export interface PlaygroundTerminalProps {
	playground: PlaygroundBinding;
	runtimeAssets: SandboxRuntimeAssets;
}

export interface PlaygroundBinding {
	runtimeAssets: SandboxRuntimeAssets;
	terminalProps: PlaygroundTerminalProps;
	load: (language: string) => Promise<BoundSandbox>;
}
