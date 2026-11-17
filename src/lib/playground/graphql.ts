import { resolveGraphqlRuntimeAssetConfig } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';

/** The official graphql-js reference implementation executes in a verified, disposable Worker. */
class Graphql extends StaticWorkerRuntimeSandbox {
	constructor() {
		super({
			languageId: 'GRAPHQL',
			displayName: 'GraphQL',
			defaultActivePath: 'main.graphql',
			workerLifetime: { mode: 'per-run' },
			inlineVerifiedWorker: true,
			enforcePhaseTimeouts: true,
			stdin: { mode: 'prebuffered', sourceHintPattern: /[\s\S]*/u },
			resolveRuntimeAssets: resolveGraphqlRuntimeAssetConfig
		});
	}
}

export default Graphql;
