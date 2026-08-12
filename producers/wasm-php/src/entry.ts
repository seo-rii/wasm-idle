import { PHP, loadPHPRuntime } from '@php-wasm/universal';
import { getPHPLoaderModule, jspi } from '@php-wasm/web-8-4';

const disabledWebSocketOptions = {
	websocket: {
		decorator: (Base: new (...args: any[]) => any) =>
			class extends Base {
				constructor() {
					try {
						super();
					} catch {
						// PHP CLI execution does not expose WebSocket networking.
					}
				}

				send() {
					return null;
				}
			}
	}
};

export async function createPhp84() {
	if (!('setImmediate' in globalThis)) {
		(globalThis as any).setImmediate = (callback: (...args: any[]) => void) =>
			setTimeout(callback, 0);
	}
	const phpWasmAsyncMode = (await jspi()) ? 'jspi' : 'asyncify';
	const runtimeId = await loadPHPRuntime(await getPHPLoaderModule(), {
		...disabledWebSocketOptions,
		phpWasmAsyncMode
	});
	return new PHP(runtimeId);
}

export { PHP };
