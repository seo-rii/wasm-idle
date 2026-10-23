import { loadLanguageToolAsset, resolveRootToolBaseUrl } from '../assets.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import {
	createLanguageServerProgressReporter,
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';
import { C3_LSP_ASSET_RECEIPTS } from './assets.js';

export interface C3LanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}
export async function getC3LanguageServer(
	options?: EditorLanguageServerOptions | C3LanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as C3LanguageServerOptions) : undefined;
	const currentUrl = hostOptions?.currentUrl || globalThis.location?.href || '';
	const rootUrl = typeof options === 'string' ? options : hostOptions?.rootUrl;
	if (!hostOptions?.c3?.baseUrl && rootUrl === undefined)
		throw new Error('C3 LSP requires c3.baseUrl or rootUrl');
	const baseUrl = new URL(
		hostOptions?.c3?.baseUrl ||
			resolveRootToolBaseUrl(rootUrl || '', '/wasm-c3-lsp/', currentUrl),
		currentUrl || undefined
	);
	if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
	const receipts = Object.fromEntries(
		Object.entries(hostOptions?.c3?.integrity || C3_LSP_ASSET_RECEIPTS).map(
			([name, receipt]) => [name, { ...receipt }]
		)
	);
	if (hostOptions?.maxAssetBytes !== undefined) {
		if (!Number.isSafeInteger(hostOptions.maxAssetBytes) || hostOptions.maxAssetBytes <= 0)
			throw new TypeError('C3 language server maxAssetBytes must be a positive safe integer');
		if (
			Object.values(receipts).some((receipt) => receipt.bytes === undefined) ||
			Object.values(receipts).reduce((total, receipt) => total + (receipt.bytes || 0), 0) >
				hostOptions.maxAssetBytes
		)
			throw new Error('C3 LSP assets exceed maxAssetBytes');
	}
	const status = createLanguageServerProgressReporter(hostOptions?.onStatus);
	status.loading('c3-lsp-assets');
	const controller = new AbortController();
	const abortFromCaller = () => controller.abort(hostOptions?.signal?.reason);
	hostOptions?.signal?.addEventListener('abort', abortFromCaller, { once: true });
	if (hostOptions?.signal?.aborted) abortFromCaller();
	let reportProgress = true;
	let moduleBytes: Uint8Array, wasmBytes: Uint8Array, stdlibBytes: Uint8Array;
	try {
		[moduleBytes, wasmBytes, stdlibBytes] = await Promise.all(
			['c3_lsp.mjs', 'c3_lsp.wasm', 'stdlib.json.gz.bin'].map(async (name) => {
				const receipt = receipts[name];
				if (!receipt) throw new Error(`C3 LSP is missing a receipt for ${name}`);
				const url = new URL(name, baseUrl);
				url.searchParams.set('v', receipt.sha256);
				const loaded = await loadLanguageToolAsset(
					'c3',
					name,
					{
						baseUrl: baseUrl.href,
						loader: () => url,
						integrity: { [name]: receipt },
						persistentCache: hostOptions?.persistentCache
					},
					(loaded, total) => {
						if (reportProgress)
							status.progress({ stage: `c3-lsp-${name}`, loaded, total });
					},
					{ signal: controller.signal, timeoutMs: hostOptions?.assetTimeoutMs }
				);
				return Uint8Array.from(loaded.bytes);
			})
		);
	} catch (error) {
		reportProgress = false;
		controller.abort(error);
		status.error(error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		reportProgress = false;
		hostOptions?.signal?.removeEventListener('abort', abortFromCaller);
	}
	return await createWorkerLanguageServerClient({
		createWorker:
			hostOptions?.createWorker ||
			(() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })),
		initOptions: { moduleBytes, wasmBytes, stdlibBytes },
		initTransfer: [
			moduleBytes.buffer as ArrayBuffer,
			wasmBytes.buffer as ArrayBuffer,
			stdlibBytes.buffer as ArrayBuffer
		],
		onStatus: hostOptions?.onStatus,
		lifecycle: { ...hostOptions, rootUrl }
	});
}
