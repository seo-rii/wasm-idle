import { jspi } from '@php-wasm/web-8-4';
import { assets, loadLoader } from 'virtual:php-startup-assets';
import { createPhpEngineBootstrap } from './startup-loader';

export interface PhpStartupOptions {
	asyncMode?: 'auto' | 'jspi' | 'asyncify';
}
const prepareEngine = createPhpEngineBootstrap(
	{
		jspi: { ...assets.jspi, load: () => loadLoader('jspi') },
		asyncify: { ...assets.asyncify, load: () => loadLoader('asyncify') }
	},
	jspi
);

/** Importing this bootstrap never downloads or initializes a PHP runtime. */
export async function createPhp84(options: PhpStartupOptions = {}) {
	const requested = options.asyncMode ?? 'auto';
	// These three operations are independent. Native compilation and checksum
	// validation finish before Emscripten is allowed to instantiate the module.
	const [api, { mode, loader, module }] = await Promise.all([
		import('./startup-runtime-api'),
		prepareEngine(requested)
	]);
	if (!('setImmediate' in globalThis)) {
		(globalThis as any).setImmediate = (callback: (...args: any[]) => void) =>
			setTimeout(callback, 0);
	}
	let rejectInitialization!: (error: unknown) => void;
	const failed = new Promise<never>((_, reject) => {
		rejectInitialization = reject;
	});
	void failed.catch(() => {});
	const runtime = api.loadPHPRuntime(loader, {
		phpWasmAsyncMode: mode,
		websocket: {
			decorator: (Base: new (...args: any[]) => any) =>
				class extends Base {
					constructor() {
						try {
							super();
						} catch {
							/* No WebSocket networking in CLI execution. */
						}
					}
					send() {
						return null;
					}
				}
		},
		onAbort: (reason: unknown) =>
			rejectInitialization(new Error(`PHP runtime aborted: ${String(reason)}`)),
		instantiateWasm(
			imports: WebAssembly.Imports,
			receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void
		) {
			void WebAssembly.instantiate(module, imports)
				.then((instance) => receive(instance, module))
				.catch(rejectInitialization);
			return {};
		}
	});
	return new api.PHP(await Promise.race([runtime, failed]));
}
