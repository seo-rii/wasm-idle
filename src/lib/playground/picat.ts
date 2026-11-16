import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import { preflightPicatRuntimeAssets, resolvePicatRuntimeAssetConfig } from './picatAssets';

/** The real upstream browser Picat VM, isolated in a fresh Worker for every run. */
export default class Picat extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'Picat',
			languageId: 'PICAT',
			defaultActivePath: 'main.pi',
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			inlineVerifiedWorker: true,
			requireExactWorkerResponseUrl: true,
			moduleWorker: true,
			includeExecutionLimits: true,
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:read|read_line|read_int|read_char|read_byte)\b/i
			},
			resolveRuntimeAssets: resolvePicatRuntimeAssetConfig,
			async preflightRuntimeAssets(urls, context) {
				return context.createOwnedDelivery(
					await preflightPicatRuntimeAssets(urls.baseUrl, context)
				);
			}
		});
	}
}
