import { resolveJanetRuntimeAssetConfig } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Janet extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'Janet',
			languageId: 'JANET',
			defaultActivePath: 'main.janet',
			moduleWorker: true,
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:getline|stdin|file\/read)\b/i
			},
			resolveRuntimeAssets: resolveJanetRuntimeAssetConfig
		});
	}
}

export default Janet;
