import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import { preflightPariGpRuntimeAssets, resolvePariGpRuntimeAssetConfig } from './parigpAssets';

/** Real upstream PARI/GP, using the pinned official Emscripten wasm32 build. */
export default class PariGp extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			displayName: 'PARI/GP',
			languageId: 'PARIGP',
			defaultActivePath: 'main.gp',
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			inlineVerifiedWorker: true,
			requireExactWorkerResponseUrl: true,
			moduleWorker: true,
			includeExecutionLimits: true,
			stdin: {
				mode: 'streaming',
				sourceHintPattern: /\b(?:input|readstr|readvec)\s*\(/i
			},
			resolveRuntimeAssets: resolvePariGpRuntimeAssetConfig,
			async preflightRuntimeAssets(urls, context) {
				return context.createOwnedDelivery(
					await preflightPariGpRuntimeAssets(urls.baseUrl, context)
				);
			}
		});
	}
}
