import { loadLanguageToolAsset, type LanguageToolAssetRuntime } from './assets.js';
import { verifyRuntimeAssetIntegrity, type RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export interface RuntimeWorkerDiagnosticRequest {
	runtime?: LanguageToolAssetRuntime;
	workerAsset?: string;
	workerUrl?: string;
	workerReceipt?: RuntimeAssetIntegrityEntry;
	workerBytes?: Uint8Array;
	message: Record<string, unknown>;
	messageTransfer?: readonly Transferable[];
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
	const workerAsset = request.workerAsset ?? 'runner-worker.js';
	let workerUrl = request.workerUrl || '';
	let blobUrl = '';
	if (request.workerBytes && !request.workerReceipt) {
		throw new Error('Runtime diagnostic worker bytes require an integrity receipt');
	}
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
		let loadedBytes: Uint8Array;
		if (request.workerBytes) {
			if (
				!ArrayBuffer.isView(request.workerBytes) ||
				Object.getOwnPropertyDescriptor(
					Object.getPrototypeOf(Uint8Array.prototype),
					Symbol.toStringTag
				)?.get?.call(request.workerBytes) !== 'Uint8Array'
			) {
				throw new Error('Runtime diagnostic worker bytes are invalid');
			}
			await verifyRuntimeAssetIntegrity({
				asset: workerAsset,
				bytes: request.workerBytes,
				expected: request.workerReceipt,
				stage: 'compressed',
				runtimeId: runtime
			});
			loadedBytes = request.workerBytes;
		} else {
			if (!request.workerUrl) {
				throw new Error('Runtime diagnostic worker URL is required');
			}
			let requestedWorkerUrl: URL;
			try {
				requestedWorkerUrl = new URL(request.workerUrl, globalThis.location?.href);
			} catch {
				throw new Error('Runtime diagnostic worker URL is invalid');
			}
			const loaded = await loadLanguageToolAsset(
				runtime,
				workerAsset,
				{
					baseUrl: new URL('.', requestedWorkerUrl).href,
					loader: () => requestedWorkerUrl,
					integrity: { [workerAsset]: request.workerReceipt },
					cache: 'no-store',
					redirect: 'error',
					requireExactResponseUrl: true
				},
				() => undefined,
				{ timeoutMs: request.timeoutMs ?? 5000 }
			);
			loadedBytes = loaded.bytes;
		}
		try {
			new TextDecoder('utf-8', { fatal: true }).decode(loadedBytes);
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
		const workerBytes = Uint8Array.from(loadedBytes);
		blobUrl = URL.createObjectURL(new Blob([workerBytes.buffer], { type: 'text/javascript' }));
		workerUrl = blobUrl;
	}
	if (!workerUrl) {
		throw new Error('Runtime diagnostic worker URL or verified bytes are required');
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
			if (request.messageTransfer?.length) {
				worker.postMessage(request.message, [...request.messageTransfer]);
			} else {
				worker.postMessage(request.message);
			}
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
