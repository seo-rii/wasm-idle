import { RuntimeConfigurationError } from '@wasm-idle/core';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from './options';
import type { SandboxProgress } from './sandbox';
import Wasm from './wasm';
import { WASM_APL_INTERPRETER } from './wasmAplVersion';

/** Runs GNU APL's original CLI with separate source and standard input. */
export default class Apl extends Wasm {
	constructor() {
		super(WASM_APL_INTERPRETER);
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
			const executionArgs = resolveSandboxExecutionArgs('APL', args, options);
			if (executionArgs.compileArgs.length) {
				throw new RuntimeConfigurationError('GNU APL has no compiler arguments', {
					runtimeId: 'APL'
				});
			}
			return super.run(code, prepare, log, progress, executionArgs.programArgs, options);
		} catch (error) {
			return Promise.reject(error);
		}
	}
}
