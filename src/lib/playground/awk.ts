import { resolveAwkRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Awk extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'AWK',
			displayName: 'AWK',
			defaultActivePath: 'main.awk',
			stdin: {
				mode: 'streaming',
				sourceHintPattern:
					/\bgetline\b|\$[0-9]|\b(NR|FNR|NF)\b|(^|\n)\s*(?:\/|[!$({]|[A-Za-z_]\w*\s*(?:\(|==|!=|~|!~|<|>|<=|>=))/
			},
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				return resolveAwkRuntimeAssetConfig(runtimeAssets, currentUrl);
			}
		});
	}
}

export default Awk;
