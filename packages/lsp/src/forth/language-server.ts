import { loadLanguageToolAsset, resolveRootToolBaseUrl } from '../assets.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import {
	createLanguageServerProgressReporter,
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';
import { FORTH_LSP_WASM_ASSET, FORTH_LSP_WASM_RECEIPT } from './assets.js';

export interface ForthLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

export async function getForthLanguageServer(
	options?: EditorLanguageServerOptions | ForthLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as ForthLanguageServerOptions) : undefined;
	const currentUrl = hostOptions?.currentUrl || globalThis.location?.href || '';
	const rootUrl = typeof options === 'string' ? options : hostOptions?.rootUrl;
	const configured = hostOptions?.forth;
	if (!configured?.wasmUrl && rootUrl === undefined) {
		throw new Error('Forth LSP requires forth.wasmUrl or rootUrl');
	}
	const url = new URL(
		configured?.wasmUrl ||
			`${resolveRootToolBaseUrl(rootUrl || '', '/wasm-forth-lsp/', currentUrl)}${FORTH_LSP_WASM_ASSET}`,
		currentUrl || undefined
	);
	const receipt = { ...(configured?.wasmReceipt || FORTH_LSP_WASM_RECEIPT) };
	if (!url.search) url.searchParams.set('v', receipt.sha256);
	if (hostOptions?.maxAssetBytes !== undefined) {
		if (!Number.isSafeInteger(hostOptions.maxAssetBytes) || hostOptions.maxAssetBytes <= 0) {
			throw new TypeError(
				'Forth language server maxAssetBytes must be a positive safe integer'
			);
		}
		if (receipt.bytes === undefined || receipt.bytes > hostOptions.maxAssetBytes) {
			throw new Error('Forth LSP WASM exceeds maxAssetBytes');
		}
	}
	const status = createLanguageServerProgressReporter(hostOptions?.onStatus);
	status.loading('forth-lsp-download');
	let wasmBytes: Uint8Array;
	try {
		const loaded = await loadLanguageToolAsset(
			'forth',
			FORTH_LSP_WASM_ASSET,
			{
				baseUrl: new URL('./', url).href,
				loader: () => url,
				integrity: { [FORTH_LSP_WASM_ASSET]: receipt },
				persistentCache: hostOptions?.persistentCache
			},
			(loaded, total) => status.progress({ stage: 'forth-lsp-download', loaded, total }),
			{ signal: hostOptions?.signal, timeoutMs: hostOptions?.assetTimeoutMs }
		);
		wasmBytes = Uint8Array.from(loaded.bytes);
	} catch (error) {
		status.error(error instanceof Error ? error.message : String(error));
		throw error;
	}
	return await createWorkerLanguageServerClient({
		createWorker:
			hostOptions?.createWorker ||
			(() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })),
		initOptions: { wasmBytes },
		initTransfer: [wasmBytes.buffer as ArrayBuffer],
		onStatus: hostOptions?.onStatus,
		lifecycle: { ...hostOptions, rootUrl }
	});
}
