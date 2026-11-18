import type { ProgressLike } from '@wasm-idle/core';
import type { ContainerPlaygroundBinding } from '$lib/container/binding';
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
	playground: Pick<ContainerPlaygroundBinding, 'beginTerminalExecution' | 'endTerminalExecution'>;
	language: string;
	code: string;
	log?: boolean;
	progress?: ProgressLike;
	args?: string[];
	options?: SandboxExecutionOptions;
}

export async function executeTerminalRun({
	terminal,
	playground,
	language,
	code,
	log = true,
	progress,
	args = [],
	options = {}
}: ExecuteTerminalRunOptions) {
	const signal = options.signal;
	signal?.throwIfAborted();
	await playground.beginTerminalExecution(signal);
	try {
		signal?.throwIfAborted();
		await terminal.clear();
		signal?.throwIfAborted();
		const prepared = await terminal.prepare(language, code, log, progress, args, options);
		signal?.throwIfAborted();
		if (!prepared) return prepared;
		const result = await terminal.run(language, code, log, progress, args, options);
		signal?.throwIfAborted();
		return result;
	} finally {
		await playground.endTerminalExecution();
	}
}
