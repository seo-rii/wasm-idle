import {
	resolvePrologRuntimeAssetConfig,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Prolog extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'PROLOG',
			displayName: 'Prolog',
			defaultActivePath: 'main.prolog',
			readStdinPattern:
				/\b(read_line_to_string|read_line_to_codes|get_char|get_code|read\s*\(|read_string)\b/,
			resolveRuntimeAssets(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl) {
				return resolvePrologRuntimeAssetConfig(runtimeAssets, currentUrl);
			}
		});
	}
}

export default Prolog;
