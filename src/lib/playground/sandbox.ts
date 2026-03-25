import type {
	CompilerDiagnostic,
	DebugCommand,
	DebugSessionEvent,
	SandboxExecutionOptions
} from '$lib/playground/options';
import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
import type { Writable } from 'svelte/store';

type ProgressLike = Writable<number> | { set?: (value: number) => void };

export interface Sandbox {
	constructor: any;
	eof: () => void;
	load: (
		runtimeAssets?: string | PlaygroundRuntimeAssets,
		code?: string,
		log?: boolean,
		args?: string[],
		options?: SandboxExecutionOptions,
		progress?: ProgressLike
	) => Promise<void>;
	run: (
		code: string,
		prepare: boolean,
		log?: boolean,
		prog?: ProgressLike,
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
