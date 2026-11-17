import {
	serveRuntimeWasmModule,
	type RuntimeWasmModuleService,
	type RuntimeWasmModuleServiceOptions
} from './runtime-wasm-module-service.js';

// Kept outside the service module: generated runtime Workers embed the minified request
// client from that module, and their committed receipts pin its exact bytes.

/** The session-cache key under which serveRuntimeWasmModule retains a compiled module. */
export function runtimeWasmModuleCacheKey(
	options: Pick<
		RuntimeWasmModuleServiceOptions,
		'identity' | 'receipt' | 'compileKey' | 'maxAssetBytes'
	>
): string {
	return JSON.stringify([
		'runtime-wasm-module-v1',
		options.identity,
		options.receipt.bytes,
		options.receipt.sha256,
		options.compileKey,
		options.maxAssetBytes
	]);
}

const isLookup = (message: unknown) =>
	!!message &&
	typeof message === 'object' &&
	(message as { type?: unknown }).type === 'lookup' &&
	Object.keys(message).length === 1;

/**
 * Serve a module port whose peer may first ask, once, whether a compiled module is retained.
 *
 * A retained module was compiled from bytes that passed this exact receipt and key, so a
 * hit needs no new copy of those (public) bytes. A miss, or any other first message, hands
 * the same port to serveRuntimeWasmModule, which then handles the ordinary verified request.
 */
export function serveRuntimeWasmModuleWithLookup(
	port: MessagePort,
	options: RuntimeWasmModuleServiceOptions
): Pick<RuntimeWasmModuleService, 'close'> {
	let service: Pick<RuntimeWasmModuleService, 'close'> | undefined;
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		options.signal?.removeEventListener('abort', close);
		if (service) service.close();
		else {
			port.onmessage = null;
			port.close();
		}
	};
	const handOver = () => {
		options.signal?.removeEventListener('abort', close);
		try {
			service = serveRuntimeWasmModule(port, options);
			return true;
		} catch (error) {
			try {
				port.postMessage({
					type: 'error',
					message: error instanceof Error ? error.message : String(error)
				});
			} finally {
				close();
			}
			return false;
		}
	};
	port.onmessageerror = close;
	port.onmessage = (event: MessageEvent<unknown>) => {
		if (closed || service) return;
		if (!isLookup(event.data)) {
			// Peers that skip the lookup keep the ordinary protocol for this same message.
			if (handOver()) port.onmessage?.call(port, event);
			return;
		}
		const module = options.cache?.get<WebAssembly.Module>(runtimeWasmModuleCacheKey(options));
		if (module instanceof WebAssembly.Module) {
			port.postMessage({ type: 'module', module });
			close();
			return;
		}
		port.postMessage({ type: 'miss' });
		handOver();
	};
	options.signal?.addEventListener('abort', close, { once: true });
	if (options.signal?.aborted) close();
	return { close };
}
