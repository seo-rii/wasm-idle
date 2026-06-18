import {
	resolvePerlRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Perl extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'PERL',
			displayName: 'Perl',
			defaultActivePath: 'main.pl',
			readStdinPattern: /<\s*STDIN\s*>|\bSTDIN\b|\breadline\b|<\s*>/,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				return resolvePerlRuntimeAssetConfig(runtimeAssets, currentUrl);
			}
		});
	}
}

export default Perl;
