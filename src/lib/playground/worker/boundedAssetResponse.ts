interface BoundedAssetResponseOptions {
	asset: string;
	maxAssetBytes: number;
	total?: number;
	signal?: AbortSignal;
	onProgress?: (loaded: number, total?: number) => void;
}

const abortReason = (signal: AbortSignal) =>
	signal.reason ?? new DOMException('Runtime asset load aborted', 'AbortError');

const bestEffortCancel = (source: { cancel(reason?: unknown): Promise<unknown> }, reason?: unknown) => {
	try {
		void Promise.resolve(source.cancel(reason)).catch(() => undefined);
	} catch {
		// Cancellation must not replace the original failure or hold up a consumer.
	}
};

/**
 * Wrap an already-authorized response without assembling the entire Wasm file in JS.
 * URL, HTTP status and integrity checks belong to the caller. Count browser-decoded
 * bytes before forwarding each chunk; transport Content-Length is not a size bound.
 */
export async function createBoundedAssetResponse(
	response: Response,
	{ asset, maxAssetBytes, total, signal, onProgress }: BoundedAssetResponseOptions
): Promise<Response> {
	const sizeError = () =>
		new Error(`Runtime asset ${asset} exceeds the ${maxAssetBytes} byte limit`);
	try {
		if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
			throw new TypeError('Runtime asset maxAssetBytes must be a positive safe integer');
		}
		if (total !== undefined && (!Number.isSafeInteger(total) || total < 0)) {
			throw new TypeError('Runtime asset total must be a non-negative safe integer');
		}
		if (total !== undefined && total > maxAssetBytes) throw sizeError();
		if (signal?.aborted) throw abortReason(signal);
	} catch (error) {
		if (response.body) bestEffortCancel(response.body, error);
		throw error;
	}

	// Preserve the old synthesized-response headers. In particular, do not propagate
	// transport Content-Encoding or a compressed Content-Length onto decoded bytes.
	const mimeType = response.headers.get('content-type');
	const init = { status: 200, headers: mimeType ? { 'Content-Type': mimeType } : undefined };
	if (!response.body) {
		let cancelOnAbort: (() => void) | undefined;
		const aborted = signal
			? new Promise<never>((_resolve, reject) => {
					cancelOnAbort = () => reject(abortReason(signal));
					signal.addEventListener('abort', cancelOnAbort, { once: true });
				})
			: undefined;
		try {
			const pending = response.arrayBuffer();
			const bytes = aborted ? await Promise.race([pending, aborted]) : await pending;
			if (signal?.aborted) throw abortReason(signal);
			if (bytes.byteLength > maxAssetBytes) throw sizeError();
			onProgress?.(bytes.byteLength, total ?? bytes.byteLength);
			if (signal?.aborted) throw abortReason(signal);
			return new Response(bytes, init);
		} finally {
			if (cancelOnAbort) signal?.removeEventListener('abort', cancelOnAbort);
		}
	}

	const reader = response.body.getReader();
	let settled = false;
	let released = false;
	let receivedLength = 0;
	let outputController: ReadableStreamDefaultController<Uint8Array>;
	const release = () => {
		if (released) return;
		released = true;
		reader.releaseLock();
	};
	const detach = () => signal?.removeEventListener('abort', onAbort);
	const stop = (reason?: unknown) => {
		if (settled) return;
		settled = true;
		detach();
		bestEffortCancel(reader, reason);
		try {
			release();
		} catch {
			// Keep the cancellation, stream failure, or size violation authoritative.
		}
	};
	const fail = (reason: unknown) => {
		if (settled) return;
		stop(reason);
		outputController.error(reason);
	};
	const onAbort = () => {
		if (signal) fail(abortReason(signal));
	};

	const body = new ReadableStream<Uint8Array>(
		{
			start(controller) {
				outputController = controller;
				signal?.addEventListener('abort', onAbort, { once: true });
				if (signal?.aborted) onAbort();
			},
			async pull(controller) {
				if (settled) return;
				try {
					const { done, value } = await reader.read();
					// A cancelled reader may settle an outstanding read later. It must not
					// enqueue bytes or emit successful completion after cancellation.
					if (settled) return;
					if (signal?.aborted) throw abortReason(signal);
					if (done) {
						release();
						onProgress?.(receivedLength, total ?? receivedLength);
						if (settled) return;
						settled = true;
						detach();
						controller.close();
						return;
					}
					if (!value) return;
					const nextLength = receivedLength + value.byteLength;
					if (!Number.isSafeInteger(nextLength) || nextLength > maxAssetBytes) {
						throw sizeError();
					}
					receivedLength = nextLength;
					onProgress?.(receivedLength, total);
					if (!settled) controller.enqueue(value);
				} catch (error) {
					fail(signal?.aborted ? abortReason(signal) : error);
				}
			},
			cancel(reason) {
				stop(reason);
			}
		},
		// Pull only when the Wasm consumer asks for data; no eager read-ahead or tee.
		{ highWaterMark: 0 }
	);
	return new Response(body, init);
}
