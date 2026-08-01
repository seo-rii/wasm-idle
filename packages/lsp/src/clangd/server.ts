import { BrowserMessageReader, BrowserMessageWriter } from '../jsonrpc.js';
import {
	CLANGD_ASSETS,
	loadLanguageToolAsset,
	type ResolvedLanguageToolAssetConfig
} from '../assets.js';
import { waitForLanguageServerStartup } from '../lifecycle.js';
import { resolveCppLanguageServerRuntimeAssetConfig } from '../runtime.js';
import type {
	EditorLanguageServerHandle,
	EditorLanguageServerOptions,
	EditorLanguageServerRuntimeOptions
} from '../types.js';
import { createLanguageServerProgressReporter } from '../worker-client.js';
import type { ClangdStatus } from './config.js';
import type { ClangdPreloadedAssets, ClangdWorkerOutboundMessage } from './protocol.js';
import { ClangdWorkspaceFileRegistry } from './workspace.js';

export interface ClangdLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	currentUrl?: string;
	onStatus?: (status: ClangdStatus) => void;
}

const currentUrl = () => globalThis.location?.href || '';

const createDefaultClangdWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function isClangdLanguageServerOptions(
	options: EditorLanguageServerOptions | ClangdLanguageServerOptions | undefined
): options is ClangdLanguageServerOptions {
	return typeof options === 'object' && !!options;
}

function transferBuffer(bytes: Uint8Array) {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

async function preloadClangdAssets(
	assetConfig: ResolvedLanguageToolAssetConfig,
	onStatus: ((status: ClangdStatus) => void) | undefined,
	lifecycle: Pick<EditorLanguageServerRuntimeOptions, 'signal' | 'assetTimeoutMs'>
): Promise<{ assets: ClangdPreloadedAssets; transfer: Transferable[] }> {
	const fractions = new Map<string, number>();
	for (const asset of CLANGD_ASSETS) fractions.set(asset, 0);
	const emitProgress = () => {
		let loaded = 0;
		for (const fraction of fractions.values()) loaded += fraction;
		onStatus?.({ state: 'loading', loaded: loaded / fractions.size, total: 1 });
	};

	const load = async (asset: (typeof CLANGD_ASSETS)[number]) => {
		const loaded = await loadLanguageToolAsset(
			'clangd',
			asset,
			assetConfig,
			(value, total) => {
				fractions.set(
					asset,
					total && total > 0 ? Math.min(value / total, 1) : value > 0 ? 1 : 0
				);
				emitProgress();
			},
			{ signal: lifecycle.signal, timeoutMs: lifecycle.assetTimeoutMs }
		);
		return transferBuffer(loaded.bytes);
	};

	const clangdJs = await load('clangd.js');
	const clangdWasmGz = await load('clangd.wasm.gz');
	const configuredWasmIntegrity = assetConfig.integrity?.['clangd.wasm.gz'];
	const runtimeIntegrity =
		configuredWasmIntegrity &&
		typeof configuredWasmIntegrity === 'object' &&
		(configuredWasmIntegrity.uncompressedSha256 !== undefined ||
			configuredWasmIntegrity.uncompressedBytes !== undefined)
			? configuredWasmIntegrity
			: undefined;
	return {
		assets: {
			clangdJs,
			clangdWasmGz,
			...(runtimeIntegrity ? { clangdWasmIntegrity: runtimeIntegrity } : {})
		},
		transfer: [clangdJs, clangdWasmGz]
	};
}

async function createServer(
	assetConfig: ResolvedLanguageToolAssetConfig,
	createWorker: () => Worker,
	onStatus: ((status: ClangdStatus) => void) | undefined,
	lifecycle: Pick<
		EditorLanguageServerRuntimeOptions,
		'signal' | 'assetTimeoutMs' | 'startupTimeoutMs'
	>,
	debug = false
) {
	const status = createLanguageServerProgressReporter(onStatus);
	status.loading();
	let preloaded: Awaited<ReturnType<typeof preloadClangdAssets>>;
	try {
		preloaded = await preloadClangdAssets(assetConfig, onStatus, lifecycle);
	} catch (error) {
		status.error(error instanceof Error ? error.message : String(error));
		throw error;
	}
	let worker: Worker | undefined;
	let cleanup = () => {};
	try {
		await waitForLanguageServerStartup(
			() =>
				new Promise<void>((resolve, reject) => {
					const activeWorker = createWorker();
					worker = activeWorker;
					const readyListener = (event: MessageEvent<ClangdWorkerOutboundMessage>) => {
						switch (event.data?.type) {
							case 'progress': {
								status.progress({
									loaded: event.data.value,
									total: event.data.max
								});
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
									new Error(event.data?.message || 'clangd failed to initialize')
								);
								break;
							}
						}
					};
					const errorListener = (event: ErrorEvent) => {
						cleanup();
						reject(event.error || new Error(event.message || 'clangd worker failed'));
					};
					cleanup = () => {
						activeWorker.removeEventListener('message', readyListener);
						activeWorker.removeEventListener('error', errorListener);
					};
					activeWorker.addEventListener('message', readyListener);
					activeWorker.addEventListener('error', errorListener);
					activeWorker.postMessage(
						{
							type: 'init',
							baseUrl: assetConfig.baseUrl,
							...(debug ? { debug } : {}),
							assets: preloaded.assets
						},
						preloaded.transfer
					);
				}),
			{ signal: lifecycle.signal, timeoutMs: lifecycle.startupTimeoutMs }
		);
	} catch (error) {
		worker?.terminate();
		status.error(error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		cleanup();
	}
	if (!worker) throw new Error('clangd worker did not start');
	return worker;
}

export async function createClangdLanguageServer(
	options?: EditorLanguageServerOptions | ClangdLanguageServerOptions
): Promise<EditorLanguageServerHandle> {
	const hostOptions = isClangdLanguageServerOptions(options) ? options : undefined;
	const current = hostOptions?.currentUrl ?? currentUrl();
	const assetConfig = resolveCppLanguageServerRuntimeAssetConfig(options, current);
	const debug = (() => {
		try {
			return new URL(current).searchParams.get('lsp-test') === '1';
		} catch {
			return false;
		}
	})();
	const worker = await createServer(
		assetConfig,
		hostOptions?.createWorker || createDefaultClangdWorker,
		hostOptions?.onStatus,
		{
			signal: hostOptions?.signal,
			assetTimeoutMs: hostOptions?.assetTimeoutMs,
			startupTimeoutMs: hostOptions?.startupTimeoutMs
		},
		debug
	);
	const reader = new BrowserMessageReader(worker);
	const writer = new BrowserMessageWriter(worker);
	const workspaceFiles = new ClangdWorkspaceFileRegistry();

	let disposed = false;
	return {
		transport: { reader, writer },
		syncFile: (path: string) => {
			const registered = workspaceFiles.register(path);
			try {
				worker.postMessage({ type: 'sync-file', name: registered.path });
			} catch (error) {
				if (registered.added) workspaceFiles.unregister(registered.path);
				throw error;
			}
		},
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

export const getCppLanguageServer = createClangdLanguageServer;
