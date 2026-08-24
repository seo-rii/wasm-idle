import type { EditorLanguageServerOptions, EditorLanguageServerRuntimeOptions } from '../types.js';
import { DEFAULT_LANGUAGE_TOOL_ASSET_TIMEOUT_MS } from '../assets.js';
import { resolveRubyLanguageServerAssetConfig } from '../runtime.js';
import {
	createLanguageServerProgressReporter,
	createWorkerLanguageServerClient,
	type LanguageServerStatus
} from '../worker-client.js';
import {
	RUBY_MAX_ASSET_BYTES,
	preflightRubyRuntimeAssets,
	type RubyRuntimePreflightPayload
} from '@wasm-idle/core';

export type RubyLanguageServerConfig = NonNullable<EditorLanguageServerRuntimeOptions['ruby']>;

export interface RubyLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	createWorker?: () => Worker;
	onStatus?: (status: LanguageServerStatus) => void;
}

const createDefaultWorker = () =>
	new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

function abortReason(signal: AbortSignal): unknown {
	return (
		signal.reason ?? new DOMException('Ruby language server startup cancelled', 'AbortError')
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
		throw new TypeError(`Ruby language server ${label} bytes are not exclusively owned`);
	}
	return bytes.buffer;
}

export async function getRubyLanguageServer(
	options?: EditorLanguageServerOptions | RubyLanguageServerOptions
) {
	const hostOptions =
		typeof options === 'object' ? (options as RubyLanguageServerOptions) : undefined;
	const currentUrl = hostOptions?.currentUrl || globalThis.location?.href || '';
	const resolved = resolveRubyLanguageServerAssetConfig(options, currentUrl);
	const configuredMaxAssetBytes = hostOptions?.maxAssetBytes ?? RUBY_MAX_ASSET_BYTES;
	if (!Number.isSafeInteger(configuredMaxAssetBytes) || configuredMaxAssetBytes <= 0) {
		throw new TypeError('Ruby language server maxAssetBytes must be a positive safe integer');
	}
	const maxAssetBytes = Math.min(configuredMaxAssetBytes, RUBY_MAX_ASSET_BYTES);
	const assetTimeoutMs = hostOptions?.assetTimeoutMs ?? DEFAULT_LANGUAGE_TOOL_ASSET_TIMEOUT_MS;
	const status = createLanguageServerProgressReporter(hostOptions?.onStatus);
	status.loading('ruby-assets');
	const controller = new AbortController();
	const abortFromCaller = () =>
		controller.abort(hostOptions?.signal ? abortReason(hostOptions.signal) : undefined);
	hostOptions?.signal?.addEventListener('abort', abortFromCaller, { once: true });
	if (hostOptions?.signal?.aborted) abortFromCaller();
	let reportProgress = true;
	let runtimePreflight: RubyRuntimePreflightPayload;
	let transfer: ArrayBuffer[];
	try {
		runtimePreflight = await preflightRubyRuntimeAssets({
			baseUrl: resolved.baseUrl,
			manifestUrl: resolved.manifestUrl,
			moduleUrl: resolved.moduleUrl,
			wasmUrl: resolved.wasmUrl,
			profile: resolved.profile,
			signal: controller.signal,
			timeoutMs: assetTimeoutMs,
			maxAssetBytes,
			progress(progress) {
				if (!reportProgress) return;
				status.progress({
					stage: `preflight-ruby-${progress.assetKey}`,
					loaded: progress.loadedBytes,
					total: progress.totalBytes
				});
			}
		});
		transfer = [
			ownedTransferBuffer(runtimePreflight.manifestBytes, 'manifest'),
			ownedTransferBuffer(runtimePreflight.moduleJavaScriptBytes, 'module JavaScript'),
			ownedTransferBuffer(runtimePreflight.wasmBytes, 'Wasm')
		];
		if (new Set(transfer).size !== transfer.length) {
			throw new TypeError('Ruby language server preflight buffers are not uniquely owned');
		}
	} catch (error) {
		reportProgress = false;
		const rejection = hostOptions?.signal?.aborted ? abortReason(hostOptions.signal) : error;
		controller.abort(rejection);
		status.error(rejection instanceof Error ? rejection.message : String(rejection));
		throw rejection;
	} finally {
		hostOptions?.signal?.removeEventListener('abort', abortFromCaller);
	}
	reportProgress = false;
	return await createWorkerLanguageServerClient({
		createWorker: hostOptions?.createWorker || createDefaultWorker,
		initOptions: { runtimePreflight },
		initTransfer: transfer,
		onStatus: hostOptions?.onStatus,
		lifecycle: hostOptions
	});
}
