import type {
	CompilerDiagnostic,
	DebugCommand,
	DebugSessionEvent,
	SandboxExecutionOptions
} from '$lib/playground/options';
import type { Writable } from 'svelte/store';

type ProgressLike = Writable<number> | { set?: (value: number) => void };

export interface Sandbox {
	constructor: any;
	eof: () => void;
	load: (
		path: string,
		code?: string,
		log?: boolean,
		args?: string[],
		options?: SandboxExecutionOptions
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
	image?: (data: { mime: string; b64: string; ts?: number }) => void;
	elapse?: number;
}
