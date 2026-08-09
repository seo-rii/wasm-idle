import {
	resolveForthRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class Forth extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'FORTH',
			displayName: 'Forth',
			defaultActivePath: 'main.fth',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:KEY|ACCEPT|REFILL)\b/i
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveForthRuntimeAssetConfig(runtimeAssets, currentUrl);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Forth runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'FORTH' }
					);
				}
				return resolved;
			}
		});
	}
}

export default Forth;
