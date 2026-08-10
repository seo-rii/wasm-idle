import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import {
	loadLanguageToolAsset,
	type LanguageToolAssetIntegrityMap,
	type ResolvedLanguageToolAssetConfig
} from '../assets.js';
import { RUBY_RUNTIME_ASSET_PATH, RUBY_RUNTIME_ASSET_RECEIPTS } from '@wasm-idle/core';
import {
	resolveRubyLanguageServerModuleUrl,
	resolveRubyLanguageServerWasmUrl
} from '../runtime.js';
import {
	createLanguageServerProgressReporter,
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';
import {
	RUBY_RUNTIME_ASSETS,
	snapshotRubyRuntimeAssetReceipts,
	type RubyRuntimeAssetReceipts
} from './assets.js';

export interface RubyLanguageServerConfig {
	moduleUrl?: string;
	wasmUrl?: string;
	integrity?: RubyRuntimeAssetReceipts;
}

export interface RubyLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const requireAbsoluteAssetUrl = (value: string, label: string, currentUrl: string) => {
	let url: URL;
	try {
		url = currentUrl ? new URL(value, currentUrl) : new URL(value);
	} catch {
		throw new TypeError(`${label} must resolve to an absolute URL`);
	}
	if (
		(url.protocol !== 'https:' && url.protocol !== 'http:') ||
		url.username ||
		url.password ||
		url.hash ||
		/%2f|%5c/iu.test(url.pathname)
	) {
		throw new TypeError(`${label} is unsafe`);
	}
	return url.href;
};

export async function getRubyLanguageServer(
	options?: EditorLanguageServerOptions | RubyLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as RubyLanguageServerOptions) : undefined;
	const config = typeof options === 'object' ? options.ruby || {} : {};
	const currentUrl = hostOptions?.currentUrl || globalThis.location?.href || '';
	const configuredIntegrity = config.integrity;
	const integrity = snapshotRubyRuntimeAssetReceipts(
		configuredIntegrity === undefined ? RUBY_RUNTIME_ASSET_RECEIPTS : configuredIntegrity
	);
	const moduleUrl = requireAbsoluteAssetUrl(
		resolveRubyLanguageServerModuleUrl(options, currentUrl),
		'Ruby language server module URL',
		currentUrl
	);
	const wasmUrl = requireAbsoluteAssetUrl(
		resolveRubyLanguageServerWasmUrl(options, currentUrl),
		'Ruby language server Wasm URL',
		currentUrl
	);
	const moduleBaseUrl = new URL('./', moduleUrl).href;
	const wasmBaseUrl = new URL('./', wasmUrl).href;
	const loaderIntegrity: LanguageToolAssetIntegrityMap = {
		'runtime.mjs': integrity['runtime.mjs'],
		[RUBY_RUNTIME_ASSET_PATH]: integrity[RUBY_RUNTIME_ASSET_PATH]
	};
	const assetConfig: ResolvedLanguageToolAssetConfig = {
		baseUrl: moduleBaseUrl,
		allowedBaseUrls: [wasmBaseUrl],
		integrity: loaderIntegrity,
		cache: 'no-store',
		redirect: 'error',
		requireExactResponseUrl: true,
		loader: ({ asset }) => ({
			url: asset === 'runtime.mjs' ? moduleUrl : wasmUrl
		})
	};
	const status = createLanguageServerProgressReporter(hostOptions?.onStatus);
	status.loading('ruby-assets');
	const fractions = new Map(RUBY_RUNTIME_ASSETS.map((asset) => [asset, 0]));
	let loadedAssets: Awaited<ReturnType<typeof loadLanguageToolAsset>>[];
	const controller = new AbortController();
	let reportAssetProgress = true;
	const abortFromHost = () => controller.abort(hostOptions?.signal?.reason);
	if (hostOptions?.signal?.aborted) abortFromHost();
	else hostOptions?.signal?.addEventListener('abort', abortFromHost, { once: true });
	try {
		loadedAssets = await Promise.all(
			RUBY_RUNTIME_ASSETS.map((asset) =>
				loadLanguageToolAsset(
					'ruby',
					asset,
					assetConfig,
					(loaded, total) => {
						if (!reportAssetProgress) return;
						fractions.set(
							asset,
							total && total > 0 ? Math.min(loaded / total, 1) : loaded > 0 ? 1 : 0
						);
						status.progress({
							stage: 'ruby-assets',
							loaded: [...fractions.values()].reduce((sum, value) => sum + value, 0),
							total: RUBY_RUNTIME_ASSETS.length
						});
					},
					{
						signal: controller.signal,
						timeoutMs: hostOptions?.assetTimeoutMs
					}
				)
			)
		);
	} catch (error) {
		reportAssetProgress = false;
		controller.abort(error);
		status.error(error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		hostOptions?.signal?.removeEventListener('abort', abortFromHost);
	}
	const [moduleAsset, wasmAsset] = loadedAssets;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			moduleUrl,
			wasmUrl,
			integrity,
			moduleBytes: moduleAsset.bytes,
			wasmBytes: wasmAsset.bytes
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
