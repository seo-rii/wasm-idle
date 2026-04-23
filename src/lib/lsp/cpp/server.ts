import type {
	EditorLanguageServerRuntimeOptions,
	EditorLanguageServerHandle
} from '$lib/lsp/types';
import { resolveCppLanguageServerRuntimeAssetConfig } from '$lib/lsp/runtime';
import ClangdWorker from '$lib/clangd/worker?worker';
import { WorkerAssetBridge } from '$lib/playground/assetBridge';
import type { ResolvedRuntimeAssetConfig } from '$lib/playground/assets';
import { BrowserMessageReader, BrowserMessageWriter } from '$lib/utils/vscodeJsonrpcBrowser';

const currentUrl = () => globalThis.location?.href || '';

async function createServer(assetConfig: ResolvedRuntimeAssetConfig) {
	let resolveReady = () => {};
	let rejectReady = (_error: Error) => {};
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const worker = new ClangdWorker();
	const assetBridge = new WorkerAssetBridge(worker, 'clangd', assetConfig);
	const cleanup = () => {
		worker.removeEventListener('message', readyListener);
		worker.removeEventListener('error', errorListener);
	};
	const readyListener = (event: MessageEvent<any>) => {
		if (assetBridge.handleMessage(event)) return;
		switch (event.data?.type) {
			case 'ready': {
				cleanup();
				resolveReady();
				break;
			}
			case 'error': {
				cleanup();
				rejectReady(new Error(event.data?.message || 'clangd failed to initialize'));
				break;
			}
		}
	};
	const errorListener = (event: ErrorEvent) => {
		cleanup();
		rejectReady(event.error || new Error(event.message || 'clangd worker failed'));
	};
	worker.addEventListener('message', readyListener);
	worker.addEventListener('error', errorListener);
	worker.postMessage({
		type: 'init',
		baseUrl: assetConfig.baseUrl,
		assets: {
			baseUrl: assetConfig.baseUrl,
			useAssetBridge: assetConfig.useAssetBridge
		}
	});
	await ready;
	return worker;
}

export async function getCppLanguageServer(
	options?: string | EditorLanguageServerRuntimeOptions
): Promise<EditorLanguageServerHandle> {
	const assetConfig = resolveCppLanguageServerRuntimeAssetConfig(options, currentUrl());
	const worker = await createServer(assetConfig);
	const reader = new BrowserMessageReader(worker);
	const writer = new BrowserMessageWriter(worker);

	return {
		transport: { reader, writer },
		syncFile: (path: string) => {
			worker.postMessage({ type: 'sync-file', name: path });
		},
		dispose: () => {
			worker.terminate();
			reader.dispose();
			writer.dispose();
		}
	};
}
