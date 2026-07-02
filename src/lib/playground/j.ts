import { resolveJRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class J extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'J',
			displayName: 'J',
			defaultActivePath: 'main.ijs',
			moduleWorker: true,
			readStdinPattern: /1!:\s*1|\/dev\/stdin|\bstdin\b/iu,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				return resolveJRuntimeAssetConfig(runtimeAssets, currentUrl);
			}
		});
	}
}

export default J;
