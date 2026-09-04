import type { ProgressLike } from '@wasm-idle/core';
import type { SandboxExecutionOptions } from '$lib/playground/options';

interface TerminalRunner {
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
}

interface ExecuteTerminalRunOptions {
	terminal: TerminalRunner;
	language: string;
	code: string;
	log?: boolean;
	progress?: ProgressLike;
	args?: string[];
	options?: SandboxExecutionOptions;
}

export async function executeTerminalRun({
	terminal,
	language,
	code,
	log = true,
	progress,
	args = [],
	options = {}
}: ExecuteTerminalRunOptions) {
	await terminal.clear();
	const prepared = await terminal.prepare(language, code, log, progress, args, options);
	if (!prepared) return prepared;
	return await terminal.run(language, code, log, progress, args, options);
}
