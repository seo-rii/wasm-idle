import { resolveJRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class J extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'J',
			displayName: 'J',
			defaultActivePath: 'main.ijs',
			moduleWorker: true,
			inlineVerifiedWorker: true,
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /1!:\s*1|\/dev\/stdin|\bstdin\b/iu
			},
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveJRuntimeAssetConfig(runtimeAssets, currentUrl);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'J runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'J' }
					);
				}
				return resolved;
			}
		});
	}
}

export default J;
