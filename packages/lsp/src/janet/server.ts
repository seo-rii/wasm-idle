import { resolveJanetLanguageServerAssetConfig } from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { DEFAULT_LANGUAGE_TOOL_ASSET_TIMEOUT_MS, loadLanguageToolAsset } from '../assets.js';
import {
	createLanguageServerProgressReporter,
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';
import {
	JANET_MAX_ASSET_BYTES,
	preflightJanetRuntimeAssets,
	type JanetRuntimePreflightPayload,
	type RuntimeAssetIntegrityEntry
} from '@wasm-idle/core';

export interface JanetLanguageServerConfig {
	workerReceipt: RuntimeAssetIntegrityEntry;
	runnerWorkerBytes: Uint8Array;
	runtimePreflight: JanetRuntimePreflightPayload;
	maxAssetBytes: number;
}

export interface JanetLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
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
		throw new TypeError('Janet language server runner receipt is invalid');
	}
	return Object.freeze({ bytes: value.bytes, sha256: value.sha256 });
}

function abortReason(signal: AbortSignal): unknown {
	return (
		signal.reason ?? new DOMException('Janet language server startup cancelled', 'AbortError')
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
		throw new TypeError(`Janet language server ${label} bytes are not exclusively owned`);
	}
	return bytes.buffer;
}

export async function getJanetLanguageServer(
	options?: EditorLanguageServerOptions | JanetLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as JanetLanguageServerOptions) : undefined;
	const currentUrl = hostOptions?.currentUrl || globalThis.location?.href || '';
	const resolved = resolveJanetLanguageServerAssetConfig(options, currentUrl);
	const workerReceipt = snapshotRunnerReceipt(resolved.workerReceipt);
	const configuredMaxAssetBytes = hostOptions?.maxAssetBytes ?? JANET_MAX_ASSET_BYTES;
	if (!Number.isSafeInteger(configuredMaxAssetBytes) || configuredMaxAssetBytes <= 0) {
		throw new TypeError('Janet language server maxAssetBytes must be a positive safe integer');
	}
	const maxAssetBytes = Math.min(configuredMaxAssetBytes, JANET_MAX_ASSET_BYTES);
	if ((workerReceipt.bytes as number) > maxAssetBytes) {
		throw new TypeError('Janet language server runner exceeds maxAssetBytes');
	}
	const assetTimeoutMs = hostOptions?.assetTimeoutMs ?? DEFAULT_LANGUAGE_TOOL_ASSET_TIMEOUT_MS;
	const status = createLanguageServerProgressReporter(hostOptions?.onStatus);
	status.loading('janet-assets');
	const controller = new AbortController();
	const abortFromCaller = () =>
		controller.abort(hostOptions?.signal ? abortReason(hostOptions.signal) : undefined);
	hostOptions?.signal?.addEventListener('abort', abortFromCaller, { once: true });
	if (hostOptions?.signal?.aborted) abortFromCaller();
	let reportProgress = true;
	const fractions = new Map([
		['manifest', 0],
		['javascript', 0],
		['wasm', 0],
		['runner', 0]
	]);
	const updateProgress = (asset: string, loaded: number, total?: number) => {
		if (!reportProgress) return;
		fractions.set(asset, total && total > 0 ? Math.min(loaded / total, 1) : loaded > 0 ? 1 : 0);
		status.progress({
			stage: `preflight-janet-${asset}`,
			loaded: [...fractions.values()].reduce((sum, value) => sum + value, 0),
			total: fractions.size
		});
	};
	let runtimePreflight: JanetRuntimePreflightPayload;
	let runnerWorkerBytes: Uint8Array;
	let transfer: ArrayBuffer[];
	const runnerUrl = new URL(resolved.workerUrl, currentUrl || undefined);
	const runtimePreflightPromise = preflightJanetRuntimeAssets({
		baseUrl: resolved.baseUrl,
		manifestUrl: resolved.manifestUrl,
		profile: resolved.profile,
		signal: controller.signal,
		limits: { assetTimeoutMs, maxAssetBytes },
		reportProgress(progress) {
			updateProgress(progress.assetKey, progress.loadedBytes, progress.totalBytes);
		}
	});
	const runnerPreflightPromise = loadLanguageToolAsset(
		'janet',
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
			ownedTransferBuffer(runtimePreflight.javascriptBytes, 'JavaScript'),
			ownedTransferBuffer(runtimePreflight.wasmBytes, 'Wasm'),
			ownedTransferBuffer(runnerWorkerBytes, 'runner')
		];
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
