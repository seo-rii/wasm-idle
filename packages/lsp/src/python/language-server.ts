import { BrowserMessageReader, BrowserMessageWriter } from '../jsonrpc.js';
import { waitForLanguageServerStartup } from '../lifecycle.js';
import { resolvePythonLanguageServerBaseUrl } from '../runtime.js';
import type {
	EditorLanguageServerHandle,
	EditorLanguageServerOptions,
	EditorLanguageServerRuntimeOptions
} from '../types.js';
import { createLanguageServerProgressReporter } from '../worker-client.js';
import type { PythonLspStatus, PythonLspWorkerOutboundMessage } from './protocol.js';
import { compilePythonRuntimeModule, resolveRuntimeAssetCacheOptions } from '@wasm-idle/core';
import { resolveLanguageToolPersistentReceipt } from '../persistent-assets.js';
import { fetchBoundedExternalAsset } from '../external-asset.js';

export interface PythonLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	currentUrl?: string;
	onStatus?: (status: PythonLspStatus) => void;
}

const currentUrl = () => globalThis.location?.href || '';

const createDefaultPythonLspWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function isPythonLanguageServerOptions(
	options: EditorLanguageServerOptions | PythonLanguageServerOptions | undefined
): options is PythonLanguageServerOptions {
	return typeof options === 'object' && !!options;
}

async function createServer(
	pyodideBaseUrl: string,
	createWorker: () => Worker,
	onStatus: ((status: PythonLspStatus) => void) | undefined,
	lifecycle: Pick<
		EditorLanguageServerRuntimeOptions,
		'signal' | 'startupTimeoutMs' | 'persistentCache' | 'rootUrl' | 'currentUrl'
	>
) {
	const status = createLanguageServerProgressReporter(onStatus);
	status.loading();
	let worker: Worker | undefined;
	let cleanup = () => {};
	const controller = new AbortController();
	const abort = () => controller.abort(lifecycle.signal?.reason);
	lifecycle.signal?.addEventListener('abort', abort, { once: true });
	const assetRoot = lifecycle.rootUrl
		? new URL(lifecycle.rootUrl, lifecycle.currentUrl || globalThis.location?.href).href
		: undefined;
	const moduleUrl = new URL('pyodide.asm.wasm', pyodideBaseUrl).href;
	const moduleReceipt = resolveLanguageToolPersistentReceipt(moduleUrl, { assetRoot });
	try {
		await waitForLanguageServerStartup(
			() =>
				new Promise<void>((resolve, reject) => {
					const activeWorker = createWorker();
					worker = activeWorker;
					const readyListener = (event: MessageEvent<PythonLspWorkerOutboundMessage>) => {
						switch (event.data?.type) {
							case 'runtime-module-request': {
								if (!moduleReceipt?.sha256) return;
								void fetchBoundedExternalAsset({
									url: moduleUrl,
									assetRoot,
									integrity: moduleReceipt,
									persistentCache: lifecycle.persistentCache,
									signal: controller.signal,
									maxBytes: moduleReceipt.bytes,
									label: 'Python LSP runtime module'
								})
									.then((bytes) => compilePythonRuntimeModule(bytes))
									.then((module) => {
										if (!controller.signal.aborted)
											activeWorker.postMessage({
												type: 'runtime-module',
												module
											});
									})
									.catch((error) => {
										if (!controller.signal.aborted)
											activeWorker.postMessage({
												type: 'runtime-module',
												error: String(error)
											});
									});
								break;
							}
							case 'progress': {
								status.progress({ stage: event.data.stage });
								break;
							}
							case 'ready': {
								cleanup();
								status.ready();
								resolve();
								break;
							}
							case 'error': {
								cleanup();
								reject(
									new Error(
										event.data?.error || 'Python LSP failed to initialize'
									)
								);
								break;
							}
						}
					};
					const errorListener = (event: ErrorEvent) => {
						cleanup();
						reject(
							event.error || new Error(event.message || 'Python LSP worker failed')
						);
					};
					cleanup = () => {
						activeWorker.removeEventListener('message', readyListener);
						activeWorker.removeEventListener('error', errorListener);
					};
					activeWorker.addEventListener('message', readyListener);
					activeWorker.addEventListener('error', errorListener);
					activeWorker.postMessage({
						type: 'init',
						pyodideBaseUrl,
						...(moduleReceipt?.sha256 ? { runtimeModuleBridge: true } : {}),
						persistentAssets: {
							persistentCache: resolveRuntimeAssetCacheOptions(
								lifecycle.persistentCache
							),
							assetRoot: lifecycle.rootUrl
								? new URL(
										lifecycle.rootUrl,
										lifecycle.currentUrl || globalThis.location?.href
									).href
								: undefined
						}
					});
				}),
			{ signal: lifecycle.signal, timeoutMs: lifecycle.startupTimeoutMs }
		);
	} catch (error) {
		controller.abort(error);
		worker?.terminate();
		status.error(error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		lifecycle.signal?.removeEventListener('abort', abort);
		cleanup();
	}
	if (!worker) throw new Error('Python LSP worker did not start');
	return worker;
}

export async function createPythonLanguageServer(
	options?: EditorLanguageServerOptions | PythonLanguageServerOptions
): Promise<EditorLanguageServerHandle> {
	const hostOptions = isPythonLanguageServerOptions(options) ? options : undefined;
	const pyodideBaseUrl = resolvePythonLanguageServerBaseUrl(
		options,
		hostOptions?.currentUrl ?? currentUrl()
	);
	const worker = await createServer(
		pyodideBaseUrl,
		hostOptions?.createWorker || createDefaultPythonLspWorker,
		hostOptions?.onStatus,
		{
			signal: hostOptions?.signal,
			startupTimeoutMs: hostOptions?.startupTimeoutMs,
			persistentCache: hostOptions?.persistentCache,
			currentUrl: hostOptions?.currentUrl,
			rootUrl:
				typeof options === 'string'
					? options
					: hostOptions?.python?.baseUrl
						? undefined
						: hostOptions?.rootUrl
		}
	);
	const reader = new BrowserMessageReader(worker);
	const writer = new BrowserMessageWriter(worker);

	let disposed = false;
	return {
		transport: { reader, writer },
		dispose: () => {
			if (disposed) return;
			disposed = true;
			worker.terminate();
			reader.dispose();
			writer.dispose();
			hostOptions?.onStatus?.({ state: 'disabled' });
		}
	};
}

export const getPythonLanguageServer = createPythonLanguageServer;
