type WasmerThreadMessage = {
	id: number;
	memory: WebAssembly.Memory;
	module: WebAssembly.Module;
	sdkUrl: string;
	type: 'init';
};

type WasmerThreadWorker = {
	handle(message: unknown): Promise<unknown>;
};

type WasmerThreadSdk = typeof import('@wasmer/sdk') & {
	ThreadPoolWorker: new (id: number) => WasmerThreadWorker;
};

let threadWorker: WasmerThreadWorker | null = null;
const pendingMessages: unknown[] = [];

globalThis.addEventListener('message', async (event: MessageEvent<unknown>) => {
	const message = event.data;
	if (
		typeof message === 'object' &&
		message !== null &&
		'type' in message &&
		message.type === 'init' &&
		'sdkUrl' in message &&
		typeof message.sdkUrl === 'string'
	) {
		const initialization = message as WasmerThreadMessage;
		const sdk = (await import(/* @vite-ignore */ initialization.sdkUrl)) as WasmerThreadSdk;
		await sdk.init({
			memory: initialization.memory,
			module: initialization.module,
			sdkUrl: initialization.sdkUrl,
			workerUrl: import.meta.url
		});
		const initializedThreadWorker = new sdk.ThreadPoolWorker(initialization.id);
		threadWorker = initializedThreadWorker;
		for (const pendingMessage of pendingMessages.splice(0)) {
			await initializedThreadWorker.handle(pendingMessage);
		}
		return;
	}

	if (threadWorker) {
		await threadWorker.handle(message);
	} else {
		pendingMessages.push(message);
	}
});
