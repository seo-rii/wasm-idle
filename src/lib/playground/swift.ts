import { resolveSwiftRuntimeAssetConfig } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

class Swift extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'Swift',
			languageId: 'SWIFT',
			defaultActivePath: 'main.swift',
			stdin: {
				mode: 'prebuffered',
				sourceHintPattern: /\b(?:readLine|FileHandle\.standardInput|stdin)\b/
			},
			resolveRuntimeAssets: resolveSwiftRuntimeAssetConfig
		});
	}
}

export default Swift;
