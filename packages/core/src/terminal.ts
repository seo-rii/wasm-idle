import type { DebugCommand } from './debug.js';
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
	stop?: () => Promise<void>;
	debugCommand?: (command: DebugCommand) => Promise<void>;
	setBreakpoints?: (lines: number[]) => Promise<void>;
	debugEvaluate?: (expression: string) => Promise<string>;
	waitForInput?: () => Promise<void>;
	write: (input: string) => Promise<void>;
	eof?: () => Promise<void>;
}
