import { resolveNimRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class Nim extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'Nim',
			languageId: 'NIM',
			defaultActivePath: 'main.nim',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:stdin|readLine|readAll|lines)\b/i
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveNimRuntimeAssetConfig(runtimeAssets, currentUrl);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Nim runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'NIM' }
					);
				}
				return resolved;
			}
		});
	}
}

export default Nim;
