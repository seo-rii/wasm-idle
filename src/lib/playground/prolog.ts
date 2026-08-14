import {
	resolvePrologRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

export const PROLOG_WORKER_IDLE_TIMEOUT_MS = 60_000;

class Prolog extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'PROLOG',
			displayName: 'Prolog',
			defaultActivePath: 'main.prolog',
			stdin: {
				mode: 'streaming',
				sourceHintPattern:
					/\b(read_line_to_string|read_line_to_codes|get_char|get_code|read\s*\(|read_string)\b/
			},
			workerLifetime: {
				mode: 'persistent',
				idleTimeoutMs: PROLOG_WORKER_IDLE_TIMEOUT_MS,
				evictOnMemoryPressure: true
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolvePrologRuntimeAssetConfig(runtimeAssets, currentUrl);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Prolog runtime requires a manifest fingerprint and worker receipt.',
						{ runtimeId: 'PROLOG' }
					);
				}
				return resolved;
			}
		});
	}
}

export default Prolog;
