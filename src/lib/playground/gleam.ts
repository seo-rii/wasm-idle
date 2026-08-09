import {
	resolveGleamRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

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
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				return resolveGleamRuntimeAssetConfig(runtimeAssets, currentUrl);
			}
		});
	}
}

export default Gleam;
