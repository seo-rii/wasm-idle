import {
	resolvePascalRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Pascal extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'PASCAL',
			displayName: 'Pascal',
			defaultActivePath: 'main.pas',
			readStdinPattern: /\bReadLn\s*\(/i,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				return resolvePascalRuntimeAssetConfig(runtimeAssets, currentUrl);
			}
		});
	}
}

export default Pascal;
