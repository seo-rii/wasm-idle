import {
	resolveGleamRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { RuntimeConfigurationError } from '@wasm-idle/core';

export const GLEAM_WORKER_IDLE_TIMEOUT_MS = 60_000;

class Gleam extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'GLEAM',
			displayName: 'Gleam',
			defaultActivePath: 'main.gleam',
			moduleWorker: true,
			workerLifetime: {
				mode: 'persistent',
				idleTimeoutMs: GLEAM_WORKER_IDLE_TIMEOUT_MS,
				evictOnMemoryPressure: true
			},
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\bwasm_idle\/stdin\b|\bstdin\.read_line\s*\(/
			},
			inlineVerifiedWorker: true,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				const resolved = resolveGleamRuntimeAssetConfig(runtimeAssets, currentUrl);
				if (
					!/^[a-f0-9]{64}$/u.test(resolved.manifestFingerprint || '') ||
					!resolved.workerReceipt
				) {
					throw new RuntimeConfigurationError(
						'Custom Gleam runtime URLs require a manifest fingerprint and worker receipt.',
						{ runtimeId: 'GLEAM' }
					);
				}
				return resolved;
			}
		});
	}
}

export default Gleam;
