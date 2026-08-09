import { resolveDLanguageServerModuleUrl } from '../runtime.js';
import {
	loadLanguageToolAsset,
	type LanguageToolAssetIntegrityMap,
	type ResolvedLanguageToolAssetConfig
} from '../assets.js';
import { D_OUTER_ASSETS, snapshotDOuterAssetReceipts, type DOuterAssetReceipts } from './assets.js';
import { BUNDLED_D_OUTER_ASSET_RECEIPTS } from '../bundledDRuntimeIntegrity.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import {
	createLanguageServerProgressReporter,
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';

export interface DLanguageServerConfig {
	moduleUrl?: string;
	manifestUrl?: string;
	integrity?: DOuterAssetReceipts;
	compileArgs?: string[];
}

export interface DLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

const resolveConfig = (
	options: EditorLanguageServerOptions | DLanguageServerOptions | undefined
) => (typeof options === 'object' ? options.d || {} : {});

export async function getDLanguageServer(
	options?: EditorLanguageServerOptions | DLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as DLanguageServerOptions) : undefined;
	const config = resolveConfig(options);
	const currentUrl = hostOptions?.currentUrl || globalThis.location?.href || '';
	const moduleUrl = resolveDLanguageServerModuleUrl(options, currentUrl);
	const module = currentUrl ? new URL(moduleUrl, currentUrl) : new URL(moduleUrl);
	const manifestUrl = config.manifestUrl
		? new URL(config.manifestUrl, currentUrl || moduleUrl).href
		: (() => {
				const manifest = new URL('runtime/runtime-manifest.v1.json', module);
				manifest.search = module.search;
				return manifest.href;
			})();
	const expectedAssets = D_OUTER_ASSETS;
	const configuredIntegrity =
		config.integrity ||
		(!config.moduleUrl && !config.manifestUrl ? BUNDLED_D_OUTER_ASSET_RECEIPTS : undefined);
	if (
		!configuredIntegrity ||
		Object.keys(configuredIntegrity).length !== expectedAssets.length ||
		expectedAssets.some((asset) => !Object.hasOwn(configuredIntegrity, asset))
	) {
		throw new TypeError('D language server requires both outer asset receipts');
	}
	const integrity = snapshotDOuterAssetReceipts(configuredIntegrity);
	const loaderIntegrity: LanguageToolAssetIntegrityMap = {
		'index.js': integrity['index.js'],
		'runtime/runtime-manifest.v1.json': integrity['runtime/runtime-manifest.v1.json']
	};
	const moduleBaseUrl = new URL('./', moduleUrl).href;
	const manifestBaseUrl = new URL('./', manifestUrl).href;
	const assetConfig: ResolvedLanguageToolAssetConfig = {
		baseUrl: moduleBaseUrl,
		allowedBaseUrls: [manifestBaseUrl],
		integrity: loaderIntegrity,
		cache: 'no-store',
		redirect: 'error',
		requireExactResponseUrl: true,
		loader: ({ asset }) => ({
			url: asset === 'index.js' ? moduleUrl : manifestUrl
		})
	};
	const status = createLanguageServerProgressReporter(hostOptions?.onStatus);
	status.loading('d-assets');
	const fractions = new Map(expectedAssets.map((asset) => [asset, 0]));
	let loadedAssets: Awaited<ReturnType<typeof loadLanguageToolAsset>>[];
	try {
		loadedAssets = await Promise.all(
			expectedAssets.map((asset) =>
				loadLanguageToolAsset(
					'd',
					asset,
					assetConfig,
					(loaded, total) => {
						fractions.set(
							asset,
							total && total > 0 ? Math.min(loaded / total, 1) : loaded > 0 ? 1 : 0
						);
						const completed = [...fractions.values()].reduce(
							(sum, value) => sum + value,
							0
						);
						status.progress({
							stage: 'd-assets',
							loaded: completed,
							total: expectedAssets.length
						});
					},
					{
						signal: hostOptions?.signal,
						timeoutMs: hostOptions?.assetTimeoutMs
					}
				)
			)
		);
	} catch (error) {
		status.error(error instanceof Error ? error.message : String(error));
		throw error;
	}
	const [moduleAsset, manifestAsset] = loadedAssets;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			moduleUrl,
			manifestUrl,
			integrity,
			moduleBytes: moduleAsset.bytes,
			manifestBytes: manifestAsset.bytes,
			compileArgs: config.compileArgs
		},
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
