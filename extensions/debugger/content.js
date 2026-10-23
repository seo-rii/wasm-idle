(() => {
	if (globalThis.__wasmIdleDebuggerBridge) return;
	globalThis.__wasmIdleDebuggerBridge = true;
	const channel = 'wasm-idle-cdp-v1';
	const origin = location.origin;
	window.addEventListener('message', async (event) => {
		const message = event.data;
		if (
			event.source !== window ||
			event.origin !== origin ||
			message?.channel !== channel ||
			message.direction !== 'request' ||
			typeof message.id !== 'string'
		)
			return;
		try {
			const response = await chrome.runtime.sendMessage(message);
			window.postMessage(
				{ channel, direction: 'response', id: message.id, ...response },
				origin
			);
		} catch (error) {
			window.postMessage(
				{
					channel,
					direction: 'response',
					id: message.id,
					error: error?.message || String(error)
				},
				origin
			);
		}
	});
	chrome.runtime.onMessage.addListener((message) => {
		if (message?.channel === channel && message.direction === 'event') {
			window.postMessage(message, origin);
		}
	});
})();
