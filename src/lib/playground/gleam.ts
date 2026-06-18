import {
	resolveGleamRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Gleam extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'GLEAM',
			displayName: 'Gleam',
			defaultActivePath: 'main.gleam',
			moduleWorker: true,
			readStdinPattern: /\bwasm_idle\/stdin\b|\bstdin\.read_line\s*\(/,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				return resolveGleamRuntimeAssetConfig(runtimeAssets, currentUrl);
			}
		});
	}
}

export default Gleam;
