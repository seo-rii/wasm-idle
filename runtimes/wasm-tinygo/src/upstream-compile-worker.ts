/// <reference lib="webworker" />

import binaryen from 'binaryen';

import {
	compileUpstreamTinyGo,
	createBinaryenTinyGoOptimizer,
	prepareTinyGoUpstreamToolchain,
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
		const toolchain = await prepareTinyGoUpstreamToolchain(event.data.assets, {
			maxWasmMemoryBytes: event.data.maxWasmMemoryBytes
		});
		const result = await compileUpstreamTinyGo(
			toolchain,
			{
				...event.data.request,
				onPhase: postPhase
			},
			createBinaryenTinyGoOptimizer({
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
			})
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
