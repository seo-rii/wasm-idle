import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';
import type { SandboxExecutionOptions } from './options';
import {
	LEAN4_DEFAULT_WASM_MEMORY_BYTES,
	preflightLean4RuntimeAssets,
	resolveLean4RuntimeAssetConfig
} from './lean4Assets';

function lean4ExecutionOptions(options: SandboxExecutionOptions = {}): SandboxExecutionOptions {
	return {
		...options,
		limits: {
			...options.limits,
			maxWasmMemoryBytes:
				options.limits?.maxWasmMemoryBytes ?? LEAN4_DEFAULT_WASM_MEMORY_BYTES
		}
	};
}

/** Upstream Lean 4 frontend and IR interpreter (`lean --run`) compiled to wasm32 Emscripten. */
export default class Lean4 extends StaticWorkerRuntimeSandbox {
	readonly defaultExecutionLimits = Object.freeze({
		maxWasmMemoryBytes: LEAN4_DEFAULT_WASM_MEMORY_BYTES
	});
	readonly evidence: { current: unknown };

	constructor() {
		const evidence = { current: undefined as unknown };
		super({
			displayName: 'Lean 4',
			languageId: 'LEAN4',
			defaultActivePath: 'Main.lean',
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			inlineVerifiedWorker: true,
			requireExactWorkerResponseUrl: true,
			moduleWorker: true,
			includeExecutionLimits: true,
			onEvidence(value) {
				evidence.current = value;
			},
			stdin: { mode: 'streaming', sourceHintPattern: /\b(?:getStdin|getLine|readToEnd)\b/u },
			resolveRuntimeAssets: resolveLean4RuntimeAssetConfig,
			async preflightRuntimeAssets(urls, context) {
				evidence.current = undefined;
				return context.createOwnedDelivery(
					await preflightLean4RuntimeAssets(urls.baseUrl, context)
				);
			}
		});
		this.evidence = evidence;
	}

	async load(...args: Parameters<StaticWorkerRuntimeSandbox['load']>) {
		args[4] = lean4ExecutionOptions(args[4]);
		return super.load(...args);
	}

	async run(...args: Parameters<StaticWorkerRuntimeSandbox['run']>) {
		args[5] = lean4ExecutionOptions(args[5]);
		return super.run(...args);
	}
}
