import { resolveBqnRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class Bqn extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'BQN',
			displayName: 'BQN',
			defaultActivePath: 'main.bqn',
			moduleWorker: true,
			inlineVerifiedWorker: true,
			stdin: { mode: 'streaming', sourceHintPattern: /•GetLine|stdin/iu },
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveBqnRuntimeAssetConfig(runtimeAssets, currentUrl);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'BQN runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'BQN' }
					);
				}
				return resolved;
			}
		});
	}
}

export default Bqn;
