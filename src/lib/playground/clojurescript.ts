import {
	resolveClojureScriptRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class ClojureScript extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'CLOJURESCRIPT',
			displayName: 'ClojureScript',
			defaultActivePath: 'main.cljs',
			readStdinPattern: /\b(?:wasm-idle\.runtime\/)?(?:read-line|stdin)\b|\bread-line\b/,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				return resolveClojureScriptRuntimeAssetConfig(runtimeAssets, currentUrl);
			}
		});
	}
}

export default ClojureScript;
