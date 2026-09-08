import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import {
	preflightLfortranRuntimeAssets,
	resolveLfortranRuntimeAssetConfig
} from './lfortranAssets';

/** Real upstream FortranEvaluator using LLVM and Emscripten dynamic side modules. */
export default class LFortran extends StaticWorkerRuntimeSandbox {
	readonly memoryEvidence: { current: unknown };

	constructor() {
		const memoryEvidence = { current: undefined as unknown };
		super({
			displayName: 'LFortran',
			languageId: 'LFORTRAN',
			defaultActivePath: 'main.f90',
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			inlineVerifiedWorker: true,
			requireExactWorkerResponseUrl: true,
			moduleWorker: true,
			includeExecutionLimits: true,
			onEvidence(evidence) {
				memoryEvidence.current = evidence;
			},
			stdin: { mode: 'streaming', sourceHintPattern: /\bread\b/i },
			resolveRuntimeAssets: resolveLfortranRuntimeAssetConfig,
			async preflightRuntimeAssets(urls, context) {
				memoryEvidence.current = undefined;
				return context.createOwnedDelivery(
					await preflightLfortranRuntimeAssets(urls.baseUrl, context)
				);
			}
		});
		this.memoryEvidence = memoryEvidence;
	}
}
