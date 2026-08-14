import {
	resolvePerlRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class Perl extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'PERL',
			displayName: 'Perl',
			defaultActivePath: 'main.pl',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /<\s*STDIN\s*>|\bSTDIN\b|\breadline\b|<\s*>/
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolvePerlRuntimeAssetConfig(runtimeAssets, currentUrl);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Perl runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'PERL' }
					);
				}
				return resolved;
			}
		});
	}
}

export default Perl;
