import { RuntimeConfigurationError } from '@wasm-idle/core';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from './options';
import type { SandboxProgress } from './sandbox';
import Wasm from './wasm';
import { WASM_SML_INTERPRETER } from './wasmSmlVersion';

/** Executes the upstream Sml interpreter; source and standard input stay separate. */
export default class Sml extends Wasm {
	constructor() {
		super(WASM_SML_INTERPRETER);
	}

	override run(
		code: string,
		prepare: boolean,
		log = true,
		progress?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	) {
		try {
			const executionArgs = resolveSandboxExecutionArgs('SML', args, options);
			if (executionArgs.compileArgs.length) {
				throw new RuntimeConfigurationError('Sml has no compiler arguments', {
					runtimeId: 'SML'
				});
			}
			if (
				[
					options.activePath ?? '',
					...(options.workspaceFiles ?? []).map((file) => file.path)
				].some((path) => /^\/?\.wasm-idle-sml-basis(?:\/|$)/u.test(path))
			) {
				throw new RuntimeConfigurationError('The Standard ML Basis directory is reserved', {
					runtimeId: 'SML'
				});
			}
			return super.run(code, prepare, log, progress, executionArgs.programArgs, options);
		} catch (error) {
			return Promise.reject(error);
		}
	}
}
