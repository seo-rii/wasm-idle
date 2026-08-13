import { resolveTclRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

class Tcl extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'TCL',
			displayName: 'Tcl',
			defaultActivePath: 'main.tcl',
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(gets|read)\s+(stdin|file\d*)\b|\bstdin\b/
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveTclRuntimeAssetConfig(runtimeAssets, currentUrl);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Tcl runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'TCL' }
					);
				}
				return resolved;
			}
		});
	}
}

export default Tcl;
