import { resolveC3BaseUrl } from '$lib/playground/assets';
import { StaticWorkerRuntimeSandbox } from '$lib/playground/staticWorkerRuntime';
import { bundledC3Profile as profile, bundledC3WorkerReceipt } from '$lib/playground/wasmC3Version';
import {
	preflightRuntimeAssets,
	RuntimeConfigurationError,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';
import type { SandboxExecutionOptions } from '$lib/playground/options';

export const C3_DEFAULT_WASM_MEMORY_BYTES = 1024 ** 3;

function c3ExecutionOptions(options: SandboxExecutionOptions = {}): SandboxExecutionOptions {
	if (options.compileArgs?.length)
		throw new RuntimeConfigurationError(
			'C3 uses fixed wasm32 compiler flags; compileArgs are unsupported.',
			{ runtimeId: 'C3' }
		);
	return {
		...options,
		limits: {
			...options.limits,
			maxWasmMemoryBytes: options.limits?.maxWasmMemoryBytes ?? C3_DEFAULT_WASM_MEMORY_BYTES
		}
	};
}

const registry: RuntimeRegistryManifest = {
	schemaVersion: 2,
	manifestId: 'wasm-idle/c3-preflight',
	revision: profile.producerReceipt.sha256,
	runtimes: [
		{
			runtimeId: 'C3',
			identity: {
				languageId: 'C3',
				implementationId: 'c3c',
				implementationVersion: '0.8.3',
				profile: {
					profileId: profile.profileId,
					manifestSchemaVersion: 1,
					manifestSha256: profile.producerReceipt.sha256,
					protocolVersion: 1,
					trustProfileId: 'wasm-idle-static-worker-v1',
					trustProfileSchemaVersion: 1
				}
			},
			capabilities: {
				stdin: 'streaming',
				workspace: true,
				abort: true,
				artifacts: false,
				streamingOutput: true
			},
			workerLifetime: { mode: 'per-run' },
			requiredBrowserFeatures: ['wasm'],
			assetRoot: '.',
			assets: [
				[
					'compilerJavaScriptBytes',
					'c3c.mjs',
					'text/javascript',
					profile.compilerJavaScriptReceipt
				],
				['compilerWasmBytes', 'c3c.wasm', 'application/wasm', profile.compilerWasmReceipt],
				[
					'producerReceiptBytes',
					'producer-receipt.json',
					'application/json',
					profile.producerReceipt
				]
			].map(([key, path, mediaType, receipt]) => {
				const integrity = receipt as { bytes: number; sha256: string };
				return {
					key: key as string,
					path: path as string,
					mediaType: mediaType as string,
					compressedSha256: integrity.sha256,
					uncompressedSha256: integrity.sha256,
					compressedBytes: integrity.bytes,
					uncompressedBytes: integrity.bytes,
					encoding: 'identity' as const
				};
			}),
			contracts: {
				routeId: 'c3',
				runtimeAssetKey: 'c3',
				documentationId: 'C3',
				syncTarget: 'sync:wasm-c3',
				browserTestId: 'browser:c3'
			}
		}
	]
};

/** Real c3c + builtin LLD; guest I/O is the documented env byte ABI. */
class C3 extends StaticWorkerRuntimeSandbox {
	readonly defaultExecutionLimits = Object.freeze({
		maxWasmMemoryBytes: C3_DEFAULT_WASM_MEMORY_BYTES
	});
	readonly memoryEvidence: { current: unknown };

	constructor() {
		const memoryEvidence = { current: undefined as unknown };
		super({
			displayName: 'C3',
			languageId: 'C3',
			defaultActivePath: 'main.c3',
			workerLifetime: { mode: 'per-run' },
			runtimePreflightDelivery: 'transfer-owned',
			stdin: { mode: 'streaming', sourceHintPattern: /\breadByte\b/u },
			inlineVerifiedWorker: true,
			moduleWorker: true,
			includeExecutionLimits: true,
			enforcePhaseTimeouts: true,
			onEvidence(evidence) {
				memoryEvidence.current = evidence;
			},
			resolveRuntimeAssets(runtimeAssets, currentUrl) {
				const baseUrl = resolveC3BaseUrl(runtimeAssets, currentUrl);
				return {
					baseUrl,
					workerUrl: new URL('runner-worker.js', baseUrl).href,
					manifestUrl: new URL('producer-receipt.json', baseUrl).href,
					manifestFingerprint: profile.producerReceipt.sha256,
					preflightKey: profile.producerReceipt.sha256,
					workerReceipt: bundledC3WorkerReceipt
				};
			},
			async preflightRuntimeAssets(urls, context) {
				memoryEvidence.current = undefined;
				const result = await preflightRuntimeAssets({
					manifest: registry,
					runtimeId: 'C3',
					rootUrl: urls.baseUrl,
					limits: context.limits,
					signal: context.signal,
					redirect: 'error',
					requireExactResponseUrl: true,
					maxTotalDeliveryBytes:
						profile.compilerJavaScriptReceipt.bytes +
						profile.compilerWasmReceipt.bytes +
						profile.producerReceipt.bytes,
					reportProgress(progress) {
						context.reportProgress(0.1, `Preflighting C3 ${progress.assetKey}`);
					}
				});
				return context.createOwnedDelivery(
					Object.freeze({
						protocol: 'wasm-idle-c3-preflight',
						profileId: profile.profileId,
						compilerJavaScriptBytes: result.assets.compilerJavaScriptBytes.bytes,
						compilerWasmBytes: result.assets.compilerWasmBytes.bytes,
						producerReceiptBytes: result.assets.producerReceiptBytes.bytes
					})
				);
			}
		});
		this.memoryEvidence = memoryEvidence;
	}

	async load(...args: Parameters<StaticWorkerRuntimeSandbox['load']>) {
		args[4] = c3ExecutionOptions(args[4]);
		return super.load(...args);
	}

	async run(...args: Parameters<StaticWorkerRuntimeSandbox['run']>) {
		args[5] = c3ExecutionOptions(args[5]);
		return super.run(...args);
	}
}

export default C3;
