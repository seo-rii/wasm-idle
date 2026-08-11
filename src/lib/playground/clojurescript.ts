import {
	resolveClojureScriptRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class ClojureScript extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'CLOJURESCRIPT',
			displayName: 'ClojureScript',
			defaultActivePath: 'main.cljs',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:wasm-idle\.runtime\/)?(?:read-line|stdin)\b|\bread-line\b/
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveClojureScriptRuntimeAssetConfig(runtimeAssets, currentUrl);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'ClojureScript runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'CLOJURESCRIPT' }
					);
				}
				return resolved;
			}
		});
	}
}

export default ClojureScript;
