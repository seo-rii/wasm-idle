import { RuntimeConfigurationError } from '@wasm-idle/core';
import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import { WASM_DART_RUNTIME } from './wasmDartVersion';
import { resolveSandboxExecutionArgs, type SandboxExecutionOptions } from './options';
import type { SandboxProgress } from './sandbox';

/** Runs the original DartPad DDC compiler and official web runtime. */
export default class Dart extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'DART',
			displayName: 'Dart',
			defaultActivePath: 'main.dart',
			moduleWorker: true,
			inlineVerifiedWorker: true,
			includeExecutionLimits: true,
			enforcePhaseTimeouts: true,
			workerLifetime: { mode: 'per-run' },
			stdin: { mode: 'streaming', sourceHintPattern: /\bstdin\b/ },
			resolveRuntimeAssets(runtimeAssets, currentUrl) {
				const root =
					typeof runtimeAssets === 'string' ? runtimeAssets : runtimeAssets.rootUrl || '';
				const base = new URL(root.replace(/\/$/u, '') + '/wasm-dart/', currentUrl);
				if (!['http:', 'https:'].includes(base.protocol))
					throw new RuntimeConfigurationError(
						'Dart runtime assets require an HTTP(S) URL',
						{ runtimeId: 'DART' }
					);
				return {
					baseUrl: base.href,
					workerUrl: new URL('runner-worker.js', base).href,
					workerReceipt: WASM_DART_RUNTIME.worker
				};
			}
		});
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
			if (resolveSandboxExecutionArgs('DART', args, options).compileArgs.length)
				throw new RuntimeConfigurationError(
					'Dart uses the pinned browser compiler and does not accept compiler arguments',
					{ runtimeId: 'DART' }
				);
			return super.run(code, prepare, log, progress, args, options);
		} catch (error) {
			return Promise.reject(error);
		}
	}
}
