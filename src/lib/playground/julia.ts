import {
	resolveJuliaRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class Julia extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'Julia',
			languageId: 'JULIA',
			defaultActivePath: 'main.jl',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:readline|readlines|read|eachline|stdin)\b/i
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveJuliaRuntimeAssetConfig(runtimeAssets, currentUrl);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Julia runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'JULIA' }
					);
				}
				return resolved;
			}
		});
	}
}

export default Julia;
