import { RuntimeConfigurationError } from '@wasm-idle/core';
import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import { WASM_MOONBIT_RUNTIME } from './wasmMoonbitVersion';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from './options';
import type { SandboxProgress, SandboxRuntimeAssets } from './sandbox';
import { assertMoonbitLocalResearch, type MoonbitResearchOptions } from './moonbitServicePolicy';

/** Runs the original MoonBit compiler and compiled core. */
export default class Moonbit extends StaticWorkerRuntimeSandbox {
	constructor(private readonly researchOptions: MoonbitResearchOptions = {}) {
		super({
			languageId: 'MOONBIT',
			displayName: 'MoonBit',
			defaultActivePath: 'main.mbt',
			moduleWorker: true,
			inlineVerifiedWorker: true,
			includeExecutionLimits: true,
			enforcePhaseTimeouts: true,
			workerLifetime: { mode: 'per-run' },
			stdin: { mode: 'streaming', sourceHintPattern: /\bread_(?:byte|char)\b/ },
			resolveRuntimeAssets(runtimeAssets, currentUrl) {
				const root =
					typeof runtimeAssets === 'string' ? runtimeAssets : runtimeAssets.rootUrl || '';
				const base = new URL(root.replace(/\/$/u, '') + '/wasm-moonbit/', currentUrl);
				if (!['http:', 'https:'].includes(base.protocol))
					throw new RuntimeConfigurationError(
						'MoonBit runtime assets require an HTTP(S) URL',
						{ runtimeId: 'MOONBIT' }
					);
				return {
					baseUrl: base.href,
					workerUrl: new URL('runner-worker.js', base).href,
					workerReceipt: WASM_MOONBIT_RUNTIME.worker
				};
			}
		});
	}

	override async load(
		runtimeAssets: SandboxRuntimeAssets = '',
		code = '',
		log = true,
		args: string[] = [],
		options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		assertMoonbitLocalResearch(this.researchOptions);
		return super.load(runtimeAssets, code, log, args, options, progress);
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
			assertMoonbitLocalResearch(this.researchOptions);
			if (resolveSandboxExecutionArgs('MOONBIT', args, options).compileArgs.length)
				throw new RuntimeConfigurationError(
					'MoonBit uses the pinned browser compiler and does not accept compiler arguments',
					{ runtimeId: 'MOONBIT' }
				);
			return super.run(code, prepare, log, progress, args, options);
		} catch (error) {
			return Promise.reject(error);
		}
	}
}
