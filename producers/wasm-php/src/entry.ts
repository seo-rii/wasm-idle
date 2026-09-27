import { PHP, loadPHPRuntime } from '@php-wasm/universal';
import { jspi } from '@php-wasm/web-8-4';
import { phpEngineAssets } from 'virtual:wasm-idle-php-engines';
import { createPhpEngineBootstrap, type PhpAsyncMode } from './startup';

const prepareEngine = createPhpEngineBootstrap(phpEngineAssets, jspi);

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

export async function createPhp84(options: { asyncMode?: 'auto' | PhpAsyncMode } = {}) {
	if (!('setImmediate' in globalThis)) {
		(globalThis as any).setImmediate = (callback: (...args: any[]) => void) =>
			setTimeout(callback, 0);
	}
	const { mode: phpWasmAsyncMode, loader, module } = await prepareEngine(options.asyncMode);
	let failInstantiation!: (error: unknown) => void;
	const failed = new Promise<never>((_, reject) => {
		failInstantiation = reject;
	});
	const initializing = loadPHPRuntime(loader, {
		...disabledWebSocketOptions,
		phpWasmAsyncMode,
		instantiateWasm(
			imports: WebAssembly.Imports,
			receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
		) {
			// Reuse compiled code, but instantiate fresh globals/memory for every PHP VM.
			void WebAssembly.instantiate(module, imports)
				.then((instance) => receive(instance, module))
				.catch(failInstantiation);
			return {};
		}
	});
	const runtimeId = await Promise.race([initializing, failed]);
	return new PHP(runtimeId);
}

export { PHP };
