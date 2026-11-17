import { RuntimeConfigurationError } from '@wasm-idle/core';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from './options';
import type { SandboxProgress } from './sandbox';
import Wasm from './wasm';
import { WASM_UIUA_INTERPRETER } from './wasmUiuaVersion';

/** Executes the upstream Uiua interpreter; source and standard input stay separate. */
export default class Uiua extends Wasm {
	constructor() {
		super(WASM_UIUA_INTERPRETER);
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
			const executionArgs = resolveSandboxExecutionArgs('UIUA', args, options);
			if (executionArgs.compileArgs.length) {
				throw new RuntimeConfigurationError('Uiua has no compiler arguments', {
					runtimeId: 'UIUA'
				});
			}
			return super.run(code, prepare, log, progress, executionArgs.programArgs, options);
		} catch (error) {
			return Promise.reject(error);
		}
	}
}
