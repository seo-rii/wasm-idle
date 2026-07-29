import { resolveNimRuntimeAssetConfig } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Nim extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'Nim',
			languageId: 'NIM',
			defaultActivePath: 'main.nim',
			stdin: {
				mode: 'prebuffered',
				sourceHintPattern: /\b(?:stdin|readLine|readAll|lines)\b/i
			},
			resolveRuntimeAssets: resolveNimRuntimeAssetConfig
		});
	}
}

export default Nim;
