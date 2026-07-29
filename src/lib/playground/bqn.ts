import { resolveBqnRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Bqn extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'BQN',
			displayName: 'BQN',
			defaultActivePath: 'main.bqn',
			moduleWorker: true,
			stdin: { mode: 'streaming', sourceHintPattern: /•GetLine|stdin/iu },
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				return resolveBqnRuntimeAssetConfig(runtimeAssets, currentUrl);
			}
		});
	}
}

export default Bqn;
