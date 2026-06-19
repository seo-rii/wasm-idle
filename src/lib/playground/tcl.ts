import { resolveTclRuntimeAssetConfig, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Tcl extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'TCL',
			displayName: 'Tcl',
			defaultActivePath: 'main.tcl',
			readStdinPattern: /\b(gets|read)\s+(stdin|file\d*)\b|\bstdin\b/,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				return resolveTclRuntimeAssetConfig(runtimeAssets, currentUrl);
			}
		});
	}
}

export default Tcl;
