import { verifyRuntimeAssetIntegrity, requestPreparedRuntimeWasmModule } from '@wasm-idle/core';
import {
	compilePinnedTools, createToolHost, invalid, LlvmToolHostError, tools,
	type CreateLlvmToolHostOptions, type CreateLlvmToolHostFromServicesOptions, type LlvmToolHost
} from './tool-host-execution.js';

export { LlvmToolHostError } from './tool-host-execution.js';
export type {
	CreateLlvmToolHostFromServicesOptions, CreateLlvmToolHostOptions, LlvmToolBindingContext,
	LlvmToolBindings, LlvmToolExecutable, LlvmToolHost, LlvmToolHostErrorCode, LlvmToolIdentity,
	LlvmToolInvocation, LlvmToolInvocationProvenance, LlvmToolModuleService, LlvmToolResult
} from './tool-host-execution.js';

/** Prepare trusted bytes once; execution and child exec imports remain synchronous. */
export function createLlvmToolHost(options: CreateLlvmToolHostOptions): Promise<LlvmToolHost> {
	return createToolHost(options, async () => {
		// Snapshot both inputs before the first await, including caller-owned Buffer views.
		const pinned = tools.map((executable) => {
			const tool = options.tools?.[executable];
			if (!tool || !(tool.bytes instanceof Uint8Array) || !/^[a-f0-9]{64}$/u.test(tool.sha256)) invalid(`Invalid pinned tool ${executable}`);
			return { executable, bytes: Uint8Array.from(tool.bytes), sha256: tool.sha256 };
		});
		for (const tool of pinned) {
			try { await verifyRuntimeAssetIntegrity({ asset: tool.executable, bytes: tool.bytes, expected: tool.sha256 }); }
			catch (cause) { throw new LlvmToolHostError('INTEGRITY', `Pinned ${tool.executable} failed integrity verification`, { cause }); }
		}
		return compilePinnedTools(pinned);
	});
}

/**
 * Only trusted owner endpoints authorize modules. No raw Module/claimed-hash input
 * is accepted. The owner verifies actual source bytes and enforces memory policy;
 * this worker still performs its import/export/cwd admission for every host.
 */
export function createLlvmToolHostFromServices(options: CreateLlvmToolHostFromServicesOptions): Promise<LlvmToolHost> {
	const endpoints = tools.map(executable => options?.services?.[executable]?.port);
	const controller = new AbortController(), signal = options?.signal;
	const abort = () => controller.abort(signal?.reason);
	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) abort();
	return createToolHost(options, async () => {
		const services = tools.map(executable => {
			const source = options.services?.[executable];
			if (!source || !source.port || typeof source.port.postMessage !== 'function' || !/^[a-f0-9]{64}$/u.test(source.sha256) ||
				!Number.isSafeInteger(source.bytes) || source.bytes < 8) invalid(`Invalid ${executable} module service`);
			return { port: source.port, profile: { identity: source.identity, compileKey: source.compileKey, maxAssetBytes: source.maxAssetBytes },
				identity: Object.freeze({ executable, sha256: source.sha256, bytes: source.bytes }) };
		});
		return await Promise.all(services.map(async source => ({ identity: source.identity,
			module: await requestPreparedRuntimeWasmModule(source.port, { ...source.profile, receipt: source.identity,
				signal: controller.signal, timeoutMs: options.timeoutMs }) })));
	}).finally(() => {
		controller.abort(); signal?.removeEventListener('abort', abort);
		for (const port of endpoints) { try { port?.postMessage({ type: 'cancel' }); } catch {} try { port?.close(); } catch {} }
	});
}
