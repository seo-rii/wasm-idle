import {
	resolveForthRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Forth extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'FORTH',
			displayName: 'Forth',
			defaultActivePath: 'main.fth',
			readStdinPattern: /\b(?:KEY|ACCEPT|REFILL)\b/i,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				return resolveForthRuntimeAssetConfig(runtimeAssets, currentUrl);
			}
		});
	}
}

export default Forth;
