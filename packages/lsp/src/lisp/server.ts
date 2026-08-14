import {
	verifyLispRuntimeAssets,
	type LispRuntimeLogicalAsset,
	type LispRuntimeStorageAsset
} from '@wasm-idle/core';
import { fetchBoundedExternalAsset } from '../external-asset.js';
import { runWithSignalAndTimeout } from '../lifecycle.js';
import {
	resolveLispLanguageServerManifestFingerprint,
	resolveLispLanguageServerManifestUrl,
	resolveLispLanguageServerModuleUrl
} from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import {
	createLanguageServerProgressReporter,
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';

export interface LispLanguageServerConfig {
	moduleUrl?: string;
	manifestUrl?: string;
	manifestFingerprint?: string;
}

export interface LispLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

const MAX_LISP_MANIFEST_BYTES = 1024 * 1024;
const DEFAULT_LISP_ASSET_TIMEOUT_MS = 120_000;
const decoder = new TextDecoder('utf-8', { fatal: true });

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function parseManifest(bytes: Uint8Array) {
	try {
		return JSON.parse(decoder.decode(bytes)) as unknown;
	} catch (error) {
		throw new TypeError(
			`Scheme LSP manifest is not valid UTF-8 JSON: ${error instanceof Error ? error.message : error}`
		);
	}
}

export async function getLispLanguageServer(
	options?: EditorLanguageServerOptions | LispLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as LispLanguageServerOptions) : undefined;
	const currentUrl = hostOptions?.currentUrl || globalThis.location?.href || '';
	const moduleUrl = resolveLispLanguageServerModuleUrl(options, currentUrl);
	const manifestUrl = resolveLispLanguageServerManifestUrl(options, currentUrl);
	const manifestFingerprint = resolveLispLanguageServerManifestFingerprint(options);
	const module = new URL(moduleUrl, currentUrl || undefined);
	const assetBaseUrl = new URL('./', module);
	const status = createLanguageServerProgressReporter(hostOptions?.onStatus);
	status.loading('lisp-assets');
	let reportProgress = true;
	const fractions = new Map<string, number>([['manifest', 0]]);
	const updateProgress = (asset: string, loaded: number, total?: number) => {
		if (!reportProgress) return;
		fractions.set(asset, total && total > 0 ? Math.min(loaded / total, 1) : loaded > 0 ? 1 : 0);
		status.progress({
			stage: 'lisp-assets',
			loaded: [...fractions.values()].reduce((sum, value) => sum + value, 0),
			total: fractions.size
		});
	};
	let verified;
	try {
		verified = await runWithSignalAndTimeout(
			async (signal) => {
				const manifestBytes = await fetchBoundedExternalAsset({
					url: manifestUrl,
					label: 'Scheme LSP runtime manifest',
					maxBytes: MAX_LISP_MANIFEST_BYTES,
					cache: 'no-cache',
					signal,
					reportProgress: (loaded, total) => updateProgress('manifest', loaded, total)
				});
				updateProgress('manifest', manifestBytes.byteLength, manifestBytes.byteLength);
				return await verifyLispRuntimeAssets({
					manifest: parseManifest(manifestBytes),
					expectedFingerprint: manifestFingerprint,
					loadStorageAsset: async (
						asset: LispRuntimeStorageAsset,
						assetSignal,
						logicalAsset: LispRuntimeLogicalAsset
					) => {
						fractions.set(asset.path, 0);
						const url = new URL(asset.path, assetBaseUrl);
						url.search = module.search;
						return await fetchBoundedExternalAsset({
							url,
							label: `Scheme LSP runtime asset ${asset.logicalPath}`,
							maxBytes: Math.max(asset.size, logicalAsset.size),
							cache: 'force-cache',
							signal: assetSignal,
							reportProgress: (loaded, total) =>
								updateProgress(asset.path, loaded, total)
						});
					},
					signal
				});
			},
			{
				signal: hostOptions?.signal,
				timeoutMs: hostOptions?.assetTimeoutMs ?? DEFAULT_LISP_ASSET_TIMEOUT_MS,
				operationName: 'Scheme LSP runtime asset load',
				timeoutError: () => new Error('Scheme LSP runtime asset load timed out')
			}
		);
	} catch (error) {
		reportProgress = false;
		status.error(error instanceof Error ? error.message : String(error));
		throw error;
	}
	reportProgress = false;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			manifest: verified.manifest,
			manifestFingerprint,
			storageAssets: Object.fromEntries(verified.storageAssets)
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
