import type {
	CompilerDiagnostic,
	DebugCommand,
	DebugSessionEvent,
	SandboxExecutionOptions
} from '$lib/playground/options';
import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import type { Writable } from 'svelte/store';

export type SandboxRuntimeAssets = string | PlaygroundRuntimeAssets;
export type SandboxProgress = Writable<number> | { set?: (value: number) => void };

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
	terminate: () => void;
	clear: () => Promise<void>;

	kill?: () => void;
	write?: (data: string) => void;
	output?: (data: string) => void;
	ondebug?: (event: DebugSessionEvent) => void;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	debugCommand?: (command: DebugCommand) => void;
	setBreakpoints?: (lines: number[]) => void;
	debugEvaluate?: (expression: string) => Promise<string>;
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
