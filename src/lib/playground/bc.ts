import { RuntimeConfigurationError } from '@wasm-idle/core';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from './options';
import type { SandboxProgress } from './sandbox';
import Wasm from './wasm';
import { WASM_BC_INTERPRETER } from './wasmBcVersion';

/** Runs the original bc implementation with source isolated from read() input. */
export default class Bc extends Wasm {
	constructor() {
		super(WASM_BC_INTERPRETER);
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
			const execution = resolveSandboxExecutionArgs('BC', args, options);
			if (execution.compileArgs.length)
				throw new RuntimeConfigurationError('bc has no compiler arguments', {
					runtimeId: 'BC'
				});
			return super.run(code, prepare, log, progress, execution.programArgs, options);
		} catch (error) {
			return Promise.reject(error);
		}
	}
}
