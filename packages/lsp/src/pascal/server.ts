import { resolvePascalLanguageServerAssetConfig } from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { DEFAULT_LANGUAGE_TOOL_ASSET_TIMEOUT_MS, loadLanguageToolAsset } from '../assets.js';
import {
	createLanguageServerProgressReporter,
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';
import {
	PASCAL_MAX_ASSET_BYTES,
	preflightPascalRuntimeAssets,
	type PascalRuntimePreflightPayload,
	type RuntimeAssetIntegrityEntry
} from '@wasm-idle/core';

export interface PascalLanguageServerConfig {
	workerReceipt: RuntimeAssetIntegrityEntry;
	runnerWorkerBytes: Uint8Array;
	runtimePreflight: PascalRuntimePreflightPayload;
	maxAssetBytes: number;
}

export interface PascalLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function snapshotRunnerReceipt(value: RuntimeAssetIntegrityEntry): RuntimeAssetIntegrityEntry {
	if (
		!value ||
		typeof value !== 'object' ||
		Object.keys(value).sort().join('\n') !== 'bytes\nsha256' ||
		!Number.isSafeInteger(value.bytes) ||
		(value.bytes as number) <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new TypeError('Pascal language server runner receipt is invalid');
	}
	return Object.freeze({ bytes: value.bytes, sha256: value.sha256 });
}

function abortReason(signal: AbortSignal): unknown {
	return (
		signal.reason ?? new DOMException('Pascal language server startup cancelled', 'AbortError')
	);
}

function ownedTransferBuffer(bytes: Uint8Array, label: string): ArrayBuffer {
	if (
		!ArrayBuffer.isView(bytes) ||
		Object.prototype.toString.call(bytes) !== '[object Uint8Array]' ||
		!(bytes.buffer instanceof ArrayBuffer) ||
		bytes.byteOffset !== 0 ||
		bytes.byteLength !== bytes.buffer.byteLength
	) {
		throw new TypeError(`Pascal language server ${label} bytes are not exclusively owned`);
	}
	return bytes.buffer;
}

export async function getPascalLanguageServer(
	options?: EditorLanguageServerOptions | PascalLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as PascalLanguageServerOptions) : undefined;
	const currentUrl = hostOptions?.currentUrl || globalThis.location?.href || '';
	const resolved = resolvePascalLanguageServerAssetConfig(options, currentUrl);
	const workerReceipt = snapshotRunnerReceipt(resolved.workerReceipt);
	const configuredMaxAssetBytes = hostOptions?.maxAssetBytes ?? PASCAL_MAX_ASSET_BYTES;
	if (!Number.isSafeInteger(configuredMaxAssetBytes) || configuredMaxAssetBytes <= 0) {
		throw new TypeError('Pascal language server maxAssetBytes must be a positive safe integer');
	}
	const maxAssetBytes = Math.min(configuredMaxAssetBytes, PASCAL_MAX_ASSET_BYTES);
	if ((workerReceipt.bytes as number) > maxAssetBytes) {
		throw new TypeError('Pascal language server runner exceeds maxAssetBytes');
	}
	const assetTimeoutMs = hostOptions?.assetTimeoutMs ?? DEFAULT_LANGUAGE_TOOL_ASSET_TIMEOUT_MS;
	const status = createLanguageServerProgressReporter(hostOptions?.onStatus);
	status.loading('pascal-assets');
	const controller = new AbortController();
	const abortFromCaller = () =>
		controller.abort(hostOptions?.signal ? abortReason(hostOptions.signal) : undefined);
	hostOptions?.signal?.addEventListener('abort', abortFromCaller, { once: true });
	if (hostOptions?.signal?.aborted) abortFromCaller();
	let reportProgress = true;
	const fractions = new Map([
		['manifest', 0],
		['compilerJavaScript', 0],
		['rtlJavaScript', 0],
		['systemPascal', 0],
		['runner', 0]
	]);
	const updateProgress = (asset: string, loaded: number, total?: number) => {
		if (!reportProgress) return;
		fractions.set(asset, total && total > 0 ? Math.min(loaded / total, 1) : loaded > 0 ? 1 : 0);
		status.progress({
			stage: `preflight-pascal-${asset}`,
			loaded: [...fractions.values()].reduce((sum, value) => sum + value, 0),
			total: fractions.size
		});
	};
	let runtimePreflight: PascalRuntimePreflightPayload;
	let runnerWorkerBytes: Uint8Array;
	let transfer: ArrayBuffer[];
	const runnerUrl = new URL(resolved.workerUrl, currentUrl || undefined);
	const runtimePreflightPromise = preflightPascalRuntimeAssets({
		baseUrl: resolved.baseUrl,
		manifestUrl: resolved.manifestUrl,
		compilerJavaScriptUrl: resolved.compilerJavaScriptUrl,
		rtlJavaScriptUrl: resolved.rtlJavaScriptUrl,
		systemPascalUrl: resolved.systemPascalUrl,
		profile: resolved.profile,
		signal: controller.signal,
		limits: { assetTimeoutMs, maxAssetBytes },
		reportProgress(progress) {
			updateProgress(progress.assetKey, progress.loadedBytes, progress.totalBytes);
		}
	});
	const runnerPreflightPromise = loadLanguageToolAsset(
		'pascal',
		'runner-worker.js',
		{
			baseUrl: new URL('./', runnerUrl).href,
			loader: () => runnerUrl,
			integrity: { 'runner-worker.js': workerReceipt },
			cache: 'no-store',
			redirect: 'error',
			requireExactResponseUrl: true
		},
		(loaded, total) => updateProgress('runner', loaded, total ?? workerReceipt.bytes),
		{ signal: controller.signal, timeoutMs: assetTimeoutMs }
	).then((loaded) => Uint8Array.from(loaded.bytes));
	const pendingPreflights = [runtimePreflightPromise, runnerPreflightPromise] as const;
	try {
		[runtimePreflight, runnerWorkerBytes] = await Promise.all(pendingPreflights);
		transfer = [
			ownedTransferBuffer(runtimePreflight.manifestBytes, 'manifest'),
			ownedTransferBuffer(runtimePreflight.compilerJavaScriptBytes, 'compiler JavaScript'),
			ownedTransferBuffer(runtimePreflight.rtlJavaScriptBytes, 'RTL JavaScript'),
			ownedTransferBuffer(runtimePreflight.systemPascalBytes, 'system Pascal'),
			ownedTransferBuffer(runnerWorkerBytes, 'runner')
		];
		if (new Set(transfer).size !== transfer.length) {
			throw new TypeError('Pascal language server preflight buffers are not uniquely owned');
		}
	} catch (error) {
		reportProgress = false;
		const rejection = hostOptions?.signal?.aborted ? abortReason(hostOptions.signal) : error;
		controller.abort(rejection);
		await Promise.allSettled(pendingPreflights);
		status.error(rejection instanceof Error ? rejection.message : String(rejection));
		throw rejection;
	} finally {
		hostOptions?.signal?.removeEventListener('abort', abortFromCaller);
	}
	reportProgress = false;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			workerReceipt,
			runnerWorkerBytes,
			runtimePreflight,
			maxAssetBytes
		},
		initTransfer: transfer,
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
