import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import {
	preflightLfortranRuntimeAssets,
	resolveLfortranRuntimeAssetConfig
} from './lfortranAssets';
import { WASM_LFORTRAN_PROFILE as profile } from './wasmLfortranVersion';

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
			compilerModules() {
				return {
					compiler: {
						receipt: profile.assets['lfortran.wasm'],
						// Defined memories live in fresh instances; the compiler imports the job's bounded memory.
						compileKey: 'lfortran-native-imported-memory-v1'
					}
				};
			},
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
