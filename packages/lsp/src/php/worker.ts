import { createPhpantomHost } from './host.js';

const scope = globalThis as unknown as {
	addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	postMessage(message: unknown): void;
};
let host: Awaited<ReturnType<typeof createPhpantomHost>> | undefined;
let initializing = false;

scope.addEventListener('message', async (event) => {
	const message = event.data;
	try {
		if (message?.type === 'init') {
			if (initializing) throw new Error('PHPantom worker was already initialized');
			initializing = true;
			if (!(message.options?.wasmBytes instanceof Uint8Array)) {
				throw new Error('PHPantom worker requires verified WASM bytes');
			}
			scope.postMessage({ type: 'progress', stage: 'phpantom-initialize' });
			host = await createPhpantomHost(message.options.wasmBytes);
			scope.postMessage({ type: 'ready' });
			return;
		}
		if (!host || message?.jsonrpc !== '2.0') return;
		const response = host.dispatch(message);
		if (response !== null) scope.postMessage(response);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		if (message?.jsonrpc === '2.0' && message.id !== undefined) {
			scope.postMessage({
				jsonrpc: '2.0',
				id: message.id,
				error: { code: -32603, message: detail }
			});
		} else {
			scope.postMessage({ type: 'error', message: detail });
		}
	}
});
