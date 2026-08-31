import { resolveAwkLanguageServerAssetConfig } from '../runtime.js';
import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { DEFAULT_LANGUAGE_TOOL_ASSET_TIMEOUT_MS, loadLanguageToolAsset } from '../assets.js';
import {
	createLanguageServerProgressReporter,
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';
import {
	AWK_MAX_ASSET_BYTES,
	AWK_RUNTIME_WORKER_PATH,
	preflightAwkRuntimeAssets,
	type AwkRuntimePreflightPayload,
	type AwkRuntimePreflightProfile,
	type RuntimeAssetIntegrityEntry
} from '@wasm-idle/core';

export interface AwkLanguageServerConfig {
	manifestUrl: string;
	profile: AwkRuntimePreflightProfile;
	workerReceipt: RuntimeAssetIntegrityEntry;
	runnerWorkerBytes: Uint8Array;
	runtimePreflight: AwkRuntimePreflightPayload;
	maxAssetBytes: number;
}

export interface AwkLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () => {
	// This module Worker is trusted application code and part of the LSP TCB. Receipt-pinned
	// runner code remains inert bytes until the outer Worker re-verifies it before execution.
	return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
};

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
		throw new TypeError('AWK language server runner receipt is invalid');
	}
	return Object.freeze({ bytes: value.bytes, sha256: value.sha256 });
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException('AWK language server startup cancelled', 'AbortError');
}

function ownedTransferBuffer(bytes: Uint8Array, label: string): ArrayBuffer {
	if (
		!ArrayBuffer.isView(bytes) ||
		Object.getOwnPropertyDescriptor(
			Object.getPrototypeOf(Uint8Array.prototype),
			Symbol.toStringTag
		)?.get?.call(bytes) !== 'Uint8Array' ||
		!(bytes.buffer instanceof ArrayBuffer) ||
		bytes.byteOffset !== 0 ||
		bytes.byteLength !== bytes.buffer.byteLength
	) {
		throw new TypeError(`AWK language server ${label} bytes are not exclusively owned`);
	}
	return bytes.buffer;
}

function requireUtf8JavaScript(bytes: Uint8Array, label: string): Uint8Array {
	try {
		new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new TypeError(`AWK language server ${label} is not valid UTF-8 JavaScript`);
	}
	return bytes;
}

export async function getAwkLanguageServer(
	options?: EditorLanguageServerOptions | AwkLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as AwkLanguageServerOptions) : undefined;
	const currentUrl = hostOptions?.currentUrl || globalThis.location?.href || '';
	const resolved = resolveAwkLanguageServerAssetConfig(options, currentUrl);
	const profile = resolved.profile;
	const workerReceipt = snapshotRunnerReceipt(profile.workerReceipt);
	const configuredMaxAssetBytes = hostOptions?.maxAssetBytes ?? AWK_MAX_ASSET_BYTES;
	if (!Number.isSafeInteger(configuredMaxAssetBytes) || configuredMaxAssetBytes <= 0) {
		throw new TypeError('AWK language server maxAssetBytes must be a positive safe integer');
	}
	const maxAssetBytes = Math.min(configuredMaxAssetBytes, AWK_MAX_ASSET_BYTES);
	if ((workerReceipt.bytes as number) > maxAssetBytes) {
		throw new TypeError('AWK language server runner exceeds maxAssetBytes');
	}
	const assetTimeoutMs = hostOptions?.assetTimeoutMs ?? DEFAULT_LANGUAGE_TOOL_ASSET_TIMEOUT_MS;
	const status = createLanguageServerProgressReporter(hostOptions?.onStatus);
	status.loading('awk-assets');
	const controller = new AbortController();
	const abortFromCaller = () =>
		controller.abort(hostOptions?.signal ? abortReason(hostOptions.signal) : undefined);
	hostOptions?.signal?.addEventListener('abort', abortFromCaller, { once: true });
	if (hostOptions?.signal?.aborted) abortFromCaller();
	let reportProgress = true;
	const fractions = new Map([
		['manifest', 0],
		['goShim', 0],
		['wasm', 0],
		['runner', 0]
	]);
	const updateProgress = (asset: string, loaded: number, total?: number) => {
		if (!reportProgress) return;
		fractions.set(asset, total && total > 0 ? Math.min(loaded / total, 1) : loaded > 0 ? 1 : 0);
		status.progress({
			stage: `preflight-awk-${asset}`,
			loaded: [...fractions.values()].reduce((sum, value) => sum + value, 0),
			total: fractions.size
		});
	};
	let runtimePreflight: AwkRuntimePreflightPayload;
	let runnerWorkerBytes: Uint8Array;
	let transfer: ArrayBuffer[];
	const runnerUrl = new URL(resolved.workerUrl, currentUrl || undefined);
	const runtimePreflightPromise = preflightAwkRuntimeAssets({
		baseUrl: resolved.baseUrl,
		manifestUrl: resolved.manifestUrl,
		profile,
		signal: controller.signal,
		limits: { assetTimeoutMs, maxAssetBytes },
		reportProgress(progress) {
			updateProgress(progress.assetKey, progress.loadedBytes, progress.totalBytes);
		}
	});
	const runnerPreflightPromise = loadLanguageToolAsset(
		'awk',
		AWK_RUNTIME_WORKER_PATH,
		{
			baseUrl: new URL('./', runnerUrl).href,
			loader: () => runnerUrl,
			integrity: { [AWK_RUNTIME_WORKER_PATH]: workerReceipt },
			cache: 'no-store',
			redirect: 'error',
			requireExactResponseUrl: true
		},
		(loaded, total) => updateProgress('runner', loaded, total ?? workerReceipt.bytes),
		{ signal: controller.signal, timeoutMs: assetTimeoutMs }
	).then((loaded) => requireUtf8JavaScript(Uint8Array.from(loaded.bytes), 'runner worker'));
	const pendingPreflights = [runtimePreflightPromise, runnerPreflightPromise] as const;
	try {
		[runtimePreflight, runnerWorkerBytes] = await Promise.all(pendingPreflights);
		transfer = [
			ownedTransferBuffer(runtimePreflight.goShimBytes, 'Go shim'),
			ownedTransferBuffer(runtimePreflight.wasmBytes, 'Wasm'),
			ownedTransferBuffer(runnerWorkerBytes, 'runner')
		];
		if (new Set(transfer).size !== transfer.length) {
			throw new TypeError('AWK language server preflight buffers are not uniquely owned');
		}
	} catch (error) {
		reportProgress = false;
		const rejection = hostOptions?.signal?.aborted ? abortReason(hostOptions.signal) : error;
		controller.abort(rejection);
		// Suppress late sibling rejection without delaying the public startup failure.
		void Promise.allSettled(pendingPreflights);
		status.error(rejection instanceof Error ? rejection.message : String(rejection));
		throw rejection;
	} finally {
		hostOptions?.signal?.removeEventListener('abort', abortFromCaller);
	}
	reportProgress = false;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: {
			manifestUrl: resolved.manifestUrl,
			profile,
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
