import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import {
	preflightCommonLispRuntimeAssets,
	resolveCommonLispRuntimeAssetConfig
} from './commonlispAssets';

/** Real upstream ECL (Embeddable Common-Lisp) built to Wasm by the wasm-llvm producer. */
export default class CommonLisp extends StaticWorkerRuntimeSandbox {
	readonly evidence: { current: unknown };

	constructor() {
		const evidence = { current: undefined as unknown };
		super({
			displayName: 'Common Lisp',
			languageId: 'COMMONLISP',
			defaultActivePath: 'main.lisp',
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			inlineVerifiedWorker: true,
			requireExactWorkerResponseUrl: true,
			moduleWorker: true,
			includeExecutionLimits: true,
			onEvidence(value) {
				evidence.current = value;
			},
			stdin: {
				mode: 'streaming',
				sourceHintPattern:
					/\(\s*(?:read|read-line|read-char|read-byte|peek-char)\b|\*standard-input\*/i
			},
			resolveRuntimeAssets: resolveCommonLispRuntimeAssetConfig,
			async preflightRuntimeAssets(urls, context) {
				evidence.current = undefined;
				return context.createOwnedDelivery(
					await preflightCommonLispRuntimeAssets(urls.baseUrl, context)
				);
			}
		});
		this.evidence = evidence;
	}
}
