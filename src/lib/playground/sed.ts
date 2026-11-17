import { RuntimeConfigurationError } from '@wasm-idle/core';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from './options';
import type { SandboxProgress } from './sandbox';
import Wasm from './wasm';
import type { WasiInterpreterProfile } from './wasiInterpreters';

/** The same immutable, reviewed BusyBox build distributed by the container release. */
export const SED_INTERPRETER = Object.freeze({
	id: 'SED',
	folder: 'wasm-sed',
	fileName: 'busybox.wasm',
	sourcePath: 'main.sed',
	command: 'sed',
	args: ['-f'],
	forwardProgramArgs: true,
	hostProfile: 'busybox-text-v1',
	sha256: '30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40',
	bytes: 634885
} as const satisfies WasiInterpreterProfile);

/** Executes the original BusyBox sed applet; source is always a script file. */
export default class Sed extends Wasm {
	constructor() {
		super(SED_INTERPRETER);
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
			const executionArgs = resolveSandboxExecutionArgs('SED', args, options);
			if (executionArgs.compileArgs.length) {
				throw new RuntimeConfigurationError('sed has no compiler arguments', {
					runtimeId: 'SED'
				});
			}
			return super.run(code, prepare, log, progress, executionArgs.programArgs, options);
		} catch (error) {
			return Promise.reject(error);
		}
	}
}
