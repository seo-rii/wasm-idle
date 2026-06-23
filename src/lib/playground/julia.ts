import { resolveJuliaRuntimeAssetConfig } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Julia extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'Julia',
			languageId: 'JULIA',
			defaultActivePath: 'main.jl',
			readStdinPattern: /\b(?:readline|readlines|read|eachline|stdin)\b/i,
			resolveRuntimeAssets: resolveJuliaRuntimeAssetConfig
		});
	}
}

export default Julia;
