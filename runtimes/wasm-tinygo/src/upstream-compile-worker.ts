/// <reference lib="webworker" />

import { requestRuntimeWasmModule } from '@wasm-idle/core/runtime-wasm-module-service';

import {
	compileUpstreamTinyGo,
	createBinaryenTinyGoOptimizer,
	prepareTinyGoUpstreamToolchain,
	type TinyGoToolchainModuleKind,
	type TinyGoUpstreamCompileRequest,
	type TinyGoUpstreamToolchainAssets
} from './upstream-runtime.ts';
import type { TinyGoWorkerPhase } from './upstream-worker.ts';

declare const self: DedicatedWorkerGlobalScope;

interface CompileMessage {
	type: 'compile';
	assets: TinyGoUpstreamToolchainAssets;
	request: Omit<TinyGoUpstreamCompileRequest, 'signal' | 'onPhase'>;
	maxWasmMemoryBytes: number;
	modulePorts?: Readonly<Record<TinyGoToolchainModuleKind, MessagePort>>;
}

function postPhase(phase: TinyGoWorkerPhase) {
	self.postMessage({ type: 'phase', phase });
}

self.onmessage = async (event: MessageEvent<CompileMessage>) => {
	try {
		if (event.data?.type !== 'compile') {
			throw new Error('TinyGo compiler worker expected one compile request');
		}
		postPhase('prepare');
		const modulePorts = event.data.modulePorts;
		const toolchain = await prepareTinyGoUpstreamToolchain(event.data.assets, {
			maxWasmMemoryBytes: event.data.maxWasmMemoryBytes,
			...(modulePorts
				? {
						compileModule: (bytes: Uint8Array, kind: TinyGoToolchainModuleKind) =>
							requestRuntimeWasmModule(bytes, modulePorts[kind], {
								timeoutMs: 300_000
							})
					}
				: {})
		});
		const result = await compileUpstreamTinyGo(
			toolchain,
			{
				...event.data.request,
				onPhase: postPhase
			},
			async (request) => {
				const { default: binaryen } = await import('binaryen');
				return createBinaryenTinyGoOptimizer({
					readBinary(bytes) {
						const module = binaryen.readBinary(bytes);
						return {
							runPasses: (passes) => module.runPasses(passes),
							optimize: () => module.optimize(),
							validate: () => Boolean(module.validate()),
							emitBinary: () => Uint8Array.from(module.emitBinary()),
							dispose: () => module.dispose()
						};
					},
					getOptimizeLevel: () => binaryen.getOptimizeLevel(),
					setOptimizeLevel: (level) => binaryen.setOptimizeLevel(level),
					getShrinkLevel: () => binaryen.getShrinkLevel(),
					setShrinkLevel: (level) => binaryen.setShrinkLevel(level),
					getDebugInfo: () => binaryen.getDebugInfo(),
					setDebugInfo: (enabled) => binaryen.setDebugInfo(enabled)
				})(request);
			}
		);
		const buffers = new Set<ArrayBuffer>();
		for (const bytes of [
			result.wasm,
			result.unoptimizedWasm,
			result.object,
			...result.objects,
			result.compilerStdout,
			result.compilerStderr,
			result.linkerStdout,
			result.linkerStderr
		]) {
			if (bytes.buffer instanceof ArrayBuffer) buffers.add(bytes.buffer);
		}
		self.postMessage({ type: 'result', result }, [...buffers]);
	} catch (error) {
		self.postMessage({
			type: 'error',
			error: error instanceof Error ? (error.stack ?? error.message) : String(error)
		});
	}
};
