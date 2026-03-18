import type { SandboxExecutionOptions } from '$lib/playground/options';

interface TerminalRunner {
	clear: () => Promise<void>;
	prepare: (
		language: string,
		code: string,
		log?: boolean,
		prog?: { set?: (value: number) => void },
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean>;
	run: (
		language: string,
		code: string,
		log?: boolean,
		prog?: { set?: (value: number) => void },
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean | string>;
}

interface ExecuteTerminalRunOptions {
	terminal: TerminalRunner;
	language: string;
	code: string;
	log?: boolean;
	progress?: { set?: (value: number) => void };
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
	progress?.set?.(1);
	return await terminal.run(language, code, log, undefined, args, options);
}
