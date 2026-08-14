import {
	resolveJanetRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class Janet extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'Janet',
			languageId: 'JANET',
			defaultActivePath: 'main.janet',
			moduleWorker: true,
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:getline|stdin|file\/read)\b/i
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveJanetRuntimeAssetConfig(runtimeAssets, currentUrl);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Janet runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'JANET' }
					);
				}
				return resolved;
			}
		});
	}
}

export default Janet;
