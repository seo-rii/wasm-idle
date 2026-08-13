import { loadLanguageToolAsset, type LanguageToolAssetRuntime } from './assets.js';
import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export interface RuntimeWorkerDiagnosticRequest {
	runtime?: LanguageToolAssetRuntime;
	workerUrl: string;
	workerReceipt?: RuntimeAssetIntegrityEntry;
	message: Record<string, unknown>;
	timeoutMs?: number;
	timeoutMessage: string;
}

export interface RuntimeWorkerDiagnosticResult {
	error?: string;
	output?: string;
}

export async function runRuntimeWorkerDiagnostics(
	request: RuntimeWorkerDiagnosticRequest
): Promise<RuntimeWorkerDiagnosticResult> {
	let workerUrl = request.workerUrl;
	let blobUrl = '';
	if (request.workerReceipt) {
		const runtime = request.runtime ?? 'prolog';
		if (
			!Number.isSafeInteger(request.workerReceipt.bytes) ||
			(request.workerReceipt.bytes as number) <= 0 ||
			typeof request.workerReceipt.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(request.workerReceipt.sha256)
		) {
			throw new Error('Runtime diagnostic worker receipt is invalid');
		}
		let requestedWorkerUrl: URL;
		try {
			requestedWorkerUrl = new URL(request.workerUrl, globalThis.location?.href);
		} catch {
			throw new Error('Runtime diagnostic worker URL is invalid');
		}
		const loaded = await loadLanguageToolAsset(
			runtime,
			'runner-worker.js',
			{
				baseUrl: new URL('.', requestedWorkerUrl).href,
				loader: () => requestedWorkerUrl,
				integrity: { 'runner-worker.js': request.workerReceipt },
				cache: 'no-store',
				redirect: 'error',
				requireExactResponseUrl: true
			},
			() => undefined,
			{ timeoutMs: request.timeoutMs ?? 5000 }
		);
		try {
			new TextDecoder('utf-8', { fatal: true }).decode(loaded.bytes);
		} catch {
			throw new Error('Runtime diagnostic worker is not valid UTF-8 JavaScript');
		}
		if (
			typeof Blob !== 'function' ||
			typeof URL.createObjectURL !== 'function' ||
			typeof URL.revokeObjectURL !== 'function'
		) {
			throw new Error('Verified runtime diagnostic worker bootstrap is unavailable');
		}
		const workerBytes = new Uint8Array(loaded.bytes.byteLength);
		workerBytes.set(loaded.bytes);
		blobUrl = URL.createObjectURL(new Blob([workerBytes.buffer], { type: 'text/javascript' }));
		workerUrl = blobUrl;
	}

	let worker: Worker;
	try {
		worker = new Worker(workerUrl);
	} finally {
		if (blobUrl) {
			try {
				URL.revokeObjectURL(blobUrl);
			} catch {
				// Blob cleanup must not replace worker construction.
			}
		}
	}
	return await new Promise((resolve, reject) => {
		let output = '';
		const timeout = setTimeout(() => {
			try {
				worker.terminate();
			} catch {
				// Preserve the diagnostic timeout.
			}
			reject(new Error(request.timeoutMessage));
		}, request.timeoutMs ?? 5000);
		worker.onerror = (event) => {
			clearTimeout(timeout);
			try {
				worker.terminate();
			} catch {
				// Preserve the worker failure.
			}
			reject(event.error || new Error(event.message || 'Runtime worker failed'));
		};
		worker.onmessage = (
			event: MessageEvent<RuntimeWorkerDiagnosticResult & { results?: boolean }>
		) => {
			if (typeof event.data?.output === 'string') {
				output += event.data.output;
				return;
			}
			if (!event.data?.results && !event.data?.error) return;
			clearTimeout(timeout);
			try {
				worker.terminate();
			} catch {
				// Preserve the runtime result.
			}
			resolve({ error: event.data.error, output });
		};
		try {
			worker.postMessage(request.message);
		} catch (error) {
			clearTimeout(timeout);
			try {
				worker.terminate();
			} catch {
				// Preserve the postMessage failure.
			}
			reject(error);
		}
	});
}
