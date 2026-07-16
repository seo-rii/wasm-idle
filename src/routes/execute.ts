import { isDeferredProgressLanguage } from '@wasm-idle/core';
import type { SandboxExecutionOptions } from '$lib/playground/options';

interface TerminalRunner {
	clear: () => Promise<void>;
	prepare: (
		language: string,
		code: string,
		log?: boolean,
		prog?: { set?: (value: number, stage?: string) => void },
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean>;
	run: (
		language: string,
		code: string,
		log?: boolean,
		prog?: { set?: (value: number, stage?: string) => void },
		args?: string[],
		options?: SandboxExecutionOptions
	) => Promise<boolean | string>;
}

interface ExecuteTerminalRunOptions {
	terminal: TerminalRunner;
	language: string;
	code: string;
	log?: boolean;
	progress?: { set?: (value: number, stage?: string) => void };
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
	const deferredProgress = isDeferredProgressLanguage(language);
	if (!deferredProgress) progress?.set?.(1, `${language} runtime ready`);
	const result = await terminal.run(
		language,
		code,
		log,
		deferredProgress ? progress : undefined,
		args,
		options
	);
	if (deferredProgress) progress?.set?.(1, `${language} run ready`);
	return result;
}
