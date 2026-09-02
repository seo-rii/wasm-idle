// Emscripten 6.0.0 invokes a modularized pthread build with an empty
// moduleArg. Wait for the parent module to provide shared-ring-v1 first, then
// publish it in this realm before importing the generated module. Importing
// lldb-web-dap.js installs Emscripten's real pthread message handler.

const bootstrapType = 'wasm-lldb-shared-ring-v1-bootstrap';
const pendingMessages = [];
let bootstrapStarted = false;

async function startPthreadRuntime(message) {
	const registry = message.registry;
	if (!registry || registry.protocol !== 'shared-ring-v1') {
		throw new Error('invalid shared-ring-v1 pthread bootstrap registry');
	}

	globalThis.wasmLldbSharedRingV1 = registry;
	const bootstrapHandler = globalThis.onmessage;
	await import('./lldb-web-dap.js');

	const runtimeHandler = globalThis.onmessage;
	if (typeof runtimeHandler !== 'function' || runtimeHandler === bootstrapHandler) {
		throw new Error('Emscripten pthread runtime did not install its message handler');
	}

	for (const event of pendingMessages.splice(0)) {
		runtimeHandler.call(globalThis, event);
	}
}

globalThis.onmessage = (event) => {
	if (!bootstrapStarted && event.data?.type === bootstrapType) {
		bootstrapStarted = true;
		startPthreadRuntime(event.data).catch((error) => {
			queueMicrotask(() => {
				throw error;
			});
		});
		return;
	}
	pendingMessages.push(event);
};
