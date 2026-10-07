import { BrowserMessageReader, BrowserMessageWriter } from '../jsonrpc.js';
import {
	CLANGD_ASSETS,
	loadLanguageToolAsset,
	requireAllowedAssetUrl,
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
import { createClangdRequestPolicy, type ClangdRequestTrace } from './request-policy.js';
import { ClangdWorkspaceFileRegistry } from './workspace.js';
import { prepareClangdWasm } from './wasm.js';
import { parseClangdHeaders } from './headers.js';
import { decompressGzip } from '@wasm-idle/llvm-core';
import { verifyRuntimeAssetIntegrity } from '@wasm-idle/core';

export interface ClangdLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	currentUrl?: string;
	onStatus?: (status: ClangdStatus) => void;
	compileProfile?: { cppVersion?: string; cVersion?: string };
	objectiveC?: {
		baseUrl: string;
		headersUrl: string;
		foundationHeadersUrl: string;
		integrity: ResolvedLanguageToolAssetConfig['integrity'];
	};
	requestTimeoutMs?: number;
	onRequestDelay?: (method: string | null) => void;
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
	const headers =
		assetConfig.headerAsset === false
			? undefined
			: assetConfig.headerAsset ||
				(assetConfig.integrity?.['clangd.headers.json.gz']
					? 'clangd.headers.json.gz'
					: undefined);
	if (headers) requireAllowedAssetUrl(headers, headers, assetConfig);
	if (headers) fractions.set(headers, 0);
	// Custom workers can supply Web Crypto even when the host realm cannot.
	// Keep the legacy transport for unreceipted assets in that configuration.
	const legacyWasm =
		typeof globalThis.crypto?.subtle?.digest !== 'function' &&
		assetConfig.integrity?.['clangd.wasm.gz'] === undefined;
	const controller = new AbortController();
	const abort = () => controller.abort(lifecycle.signal?.reason);
	lifecycle.signal?.addEventListener('abort', abort, { once: true });
	if (lifecycle.signal?.aborted) abort();
	const signal = controller.signal;
	const emitProgress = () => {
		let loaded = 0;
		for (const fraction of fractions.values()) loaded += fraction;
		onStatus?.({
			state: 'loading',
			stage: 'asset-download',
			loaded: loaded / fractions.size,
			total: 1
		});
	};

	const progress = (asset: string) => (value: number, total?: number) => {
		fractions.set(asset, total && total > 0 ? Math.min(value / total, 1) : value > 0 ? 1 : 0);
		emitProgress();
	};
	const load = async (asset: string) => {
		const loaded = await loadLanguageToolAsset('clangd', asset, assetConfig, progress(asset), {
			signal,
			timeoutMs: lifecycle.assetTimeoutMs
		});
		return loaded.bytes;
	};

	try {
		const [js, wasm, headerTree] = await Promise.all([
			load('clangd.js'),
			legacyWasm
				? load('clangd.wasm.gz').then((bytes) => ({ compressed: transferBuffer(bytes) }))
				: prepareClangdWasm(assetConfig, progress('clangd.wasm.gz'), {
						signal,
						timeoutMs: lifecycle.assetTimeoutMs
					}),
			headers
				? (async () => {
						const bytes = await decompressGzip(
							await load(headers),
							headers,
							128 * 1024 * 1024,
							signal
						);
						const expected = assetConfig.integrity?.[headers];
						if (
							typeof expected === 'object' &&
							(expected.uncompressedSha256 !== undefined ||
								expected.uncompressedBytes !== undefined)
						)
							await verifyRuntimeAssetIntegrity({
								asset: headers,
								bytes,
								expected,
								stage: 'uncompressed',
								runtimeId: 'clangd'
							});
						return parseClangdHeaders(bytes);
					})()
				: undefined
		]);
		signal.throwIfAborted();
		const clangdJs = transferBuffer(js);
		return {
			assets: {
				clangdJs,
				...('compressed' in wasm
					? { clangdWasmGz: wasm.compressed }
					: {
							clangdModule: wasm.module,
							clangdWasmBytes: wasm.bytes,
							clangdWasmSha256: wasm.sha256
						}),
				...(headerTree ? { clangdHeaders: headerTree } : {})
			},
			transfer: [clangdJs, ...('compressed' in wasm ? [wasm.compressed] : [])]
		};
	} catch (error) {
		// A failed parallel branch must release downloads and compilation still in progress.
		controller.abort(error);
		throw error;
	} finally {
		lifecycle.signal?.removeEventListener('abort', abort);
	}
}

async function createServer(
	assetConfig: ResolvedLanguageToolAssetConfig,
	createWorker: () => Worker,
	onStatus: ((status: ClangdStatus) => void) | undefined,
	lifecycle: Pick<
		EditorLanguageServerRuntimeOptions,
		'signal' | 'assetTimeoutMs' | 'startupTimeoutMs'
	>,
	debug = false,
	hostOptions?: ClangdLanguageServerOptions
) {
	const status = createLanguageServerProgressReporter(onStatus);
	status.loading();
	let preloaded: Awaited<ReturnType<typeof preloadClangdAssets>>;
	try {
		preloaded = await preloadClangdAssets(assetConfig, onStatus, lifecycle);
		if (hostOptions?.objectiveC) {
			const config = hostOptions.objectiveC;
			const headers: Record<string, string> = Object.create(null);
			for (const [asset, url] of [
				['headers.json', config.headersUrl],
				['foundation-headers.json', config.foundationHeadersUrl]
			]) {
				const loaded = await loadLanguageToolAsset(
					'objectivec',
					asset,
					{
						baseUrl: config.baseUrl,
						persistentCache: assetConfig.persistentCache,
						integrity: config.integrity,
						loader: () => new URL(url)
					},
					() => {},
					{ signal: lifecycle.signal, timeoutMs: lifecycle.assetTimeoutMs }
				);
				const parsed = JSON.parse(new TextDecoder().decode(loaded.bytes));
				if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
					throw new Error(`Invalid Objective-C ${asset}`);
				Object.assign(headers, parsed);
			}
			preloaded.assets.objectiveCHeaders = headers;
		}
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
									stage: event.data.stage,
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
							compileProfile: hostOptions?.compileProfile,
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
): Promise<
	EditorLanguageServerHandle & {
		getDiagnosticTrace: () => ClangdRequestTrace[];
		cancelEditorRequests: () => void;
	}
> {
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
	const startupTrace: ClangdRequestTrace[] = [];
	let startupStage: ClangdRequestTrace | undefined;
	const reportStatus = (status: ClangdStatus) => {
		const stage = status.state === 'loading' ? status.stage : `worker-${status.state}`;
		if (stage && stage !== startupStage?.method) {
			if (startupStage) startupStage.finishedAt = Date.now();
			startupStage = { method: stage, sentAt: Date.now() };
			startupTrace.push(startupStage);
		}
		hostOptions?.onStatus?.(status);
	};
	const worker = await createServer(
		assetConfig,
		hostOptions?.createWorker || createDefaultClangdWorker,
		reportStatus,
		{
			signal: hostOptions?.signal,
			assetTimeoutMs: hostOptions?.assetTimeoutMs,
			startupTimeoutMs: hostOptions?.startupTimeoutMs
		},
		debug,
		hostOptions
	);
	const reader = new BrowserMessageReader(worker);
	const writer = new BrowserMessageWriter(worker);
	const policy = createClangdRequestPolicy(
		{ reader, writer },
		{ requestTimeoutMs: hostOptions?.requestTimeoutMs, onDelay: hostOptions?.onRequestDelay }
	);
	policy.trace.push(...startupTrace);
	const workspaceFiles = new ClangdWorkspaceFileRegistry();

	let disposed = false;
	return {
		transport: policy.transport,
		cancelEditorRequests: policy.cancelEditorRequests,
		getDiagnosticTrace: () => policy.trace.map((entry) => ({ ...entry })),
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
			policy.dispose();
			worker.terminate();
			reader.dispose();
			writer.dispose();
			hostOptions?.onStatus?.({ state: 'disabled' });
		}
	};
}

export const getCppLanguageServer = createClangdLanguageServer;
