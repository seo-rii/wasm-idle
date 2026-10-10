import {
	readPersistentRuntimeAsset,
	writePersistentRuntimeAsset,
	type RuntimeAssetCacheOptions
} from '@wasm-idle/core';

/** Receipts describe transport bytes and the exact Wasm bytes consumed by the engine. */
export interface VerifiedWasmReceipt {
	readonly bytes: number;
	readonly sha256: string;
	readonly uncompressedBytes: number;
	readonly uncompressedSha256: string;
}

export interface VerifiedWasmOptions {
	persistentCache?: RuntimeAssetCacheOptions;
	fetch: typeof globalThis.fetch;
	maxAssetBytes: number;
	signal?: AbortSignal;
	onProgress?: (loaded: number, total: number) => void;
	/** A host with its own URL policy may validate redirects before consuming the body. */
	validateResponse?: (response: Response, requestedUrl: URL) => void;
	/** Separates persisted bytes admitted by different host validation policies. */
	validationKey?: string;
}

function reason(signal: AbortSignal) {
	return signal.reason ?? new DOMException('Runtime loading aborted', 'AbortError');
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener('abort', abort);
			reject(reason(signal));
		};
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

/**
 * Capture an exact private snapshot while forwarding owned chunks. EOF is withheld
 * until the receipt passes, so downstream consumers cannot receive an unverified module.
 */
function verifiedStream(
	source: ReadableStream<Uint8Array>,
	bytes: number,
	sha256: string,
	signal: AbortSignal,
	onProgress?: (loaded: number, total: number) => void
) {
	const reader = source.getReader();
	const snapshot = new Uint8Array(bytes);
	let received = 0;
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		signal.removeEventListener('abort', abort);
		try {
			reader.releaseLock();
		} catch {
			/* A cancelled pending read releases later. */
		}
	};
	const cancel = (error?: unknown) => {
		if (released) return;
		void reader
			.cancel(error)
			.catch(() => {})
			.finally(release);
	};
	const abort = () => cancel(reason(signal));
	signal.addEventListener('abort', abort, { once: true });
	let resolveVerified!: () => void;
	let rejectVerified!: (error: unknown) => void;
	const verified = new Promise<void>((resolve, reject) => {
		resolveVerified = resolve;
		rejectVerified = reject;
	});
	// A downstream compiler may reject before reading this stream. Always observe it.
	void verified.catch(() => {});
	const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
		async pull(controller) {
			try {
				signal.throwIfAborted();
				const { done, value } = await abortable(reader.read(), signal);
				signal.throwIfAborted();
				if (done) {
					if (received !== bytes) throw new Error('Runtime Wasm receipt length mismatch');
					const digest = await abortable(
						crypto.subtle.digest('SHA-256', snapshot),
						signal
					);
					const actual = Array.from(new Uint8Array(digest), (b) =>
						b.toString(16).padStart(2, '0')
					).join('');
					if (actual !== sha256) throw new Error('Runtime Wasm receipt SHA-256 mismatch');
					signal.throwIfAborted();
					release();
					resolveVerified();
					controller.close();
					return;
				}
				if (value.byteLength > bytes - received)
					throw new Error('Runtime Wasm exceeds receipt byte limit');
				// Own before both hashing and enqueueing: producer views may be mutated later.
				const chunk = Uint8Array.from(value);
				snapshot.set(chunk, received);
				received += chunk.byteLength;
				controller.enqueue(chunk);
				onProgress?.(received, bytes);
			} catch (error) {
				rejectVerified(error);
				controller.error(error);
				cancel(error);
			}
		},
		cancel(error) {
			rejectVerified(error ?? new Error('Runtime Wasm stream cancelled'));
			cancel(error);
		}
	});
	return { body, verified, snapshot };
}

/** Native fetch only; callers must select this path from their trusted asset profile. */
export async function compileVerifiedWasmAsset(
	url: string,
	sourceReceipt: VerifiedWasmReceipt,
	options: VerifiedWasmOptions
): Promise<WebAssembly.Module> {
	const receipt = { ...sourceReceipt };
	const limit = options.maxAssetBytes;
	if (
		!Number.isSafeInteger(limit) ||
		limit <= 0 ||
		![receipt.bytes, receipt.uncompressedBytes].every(
			(n) => Number.isSafeInteger(n) && n > 0 && n <= limit
		) ||
		![receipt.sha256, receipt.uncompressedSha256].every((hash) => /^[a-f0-9]{64}$/.test(hash))
	) {
		throw new Error('Runtime Wasm receipt exceeds asset limit or is invalid');
	}
	const assetUrl = new URL(url);
	if (
		!['http:', 'https:'].includes(assetUrl.protocol) ||
		assetUrl.username ||
		assetUrl.password ||
		assetUrl.hash
	) {
		throw new Error('Runtime Wasm asset requires an uncredentialed HTTP(S) URL');
	}
	if (!globalThis.crypto?.subtle)
		throw new Error('Runtime Wasm verification requires Web Crypto');
	const controller = new AbortController();
	const signal = controller.signal;
	const parent = options.signal;
	const abort = () => controller.abort(reason(parent!));
	parent?.addEventListener('abort', abort, { once: true });
	if (parent?.aborted) abort();
	let response: Response | undefined;
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	try {
		signal.throwIfAborted();
		const identity = {
			url: assetUrl.href,
			sha256: receipt.sha256,
			bytes: receipt.bytes,
			validationKey: options.validationKey
				? JSON.stringify(['verified-wasm-v1', options.validationKey])
				: 'verified-wasm-v1'
		};
		const cached = await readPersistentRuntimeAsset({
			identity,
			cache: options.persistentCache,
			signal
		});
		const fetching = cached
			? Promise.resolve(new Response(Uint8Array.from(cached)))
			: Promise.resolve().then(() =>
					options.fetch(assetUrl.href, {
						credentials: 'omit',
						redirect: 'error',
						referrerPolicy: 'no-referrer',
						signal
					})
				);
		void fetching.then(
			(late) => {
				if (signal.aborted) void late.body?.cancel(reason(signal)).catch(() => {});
			},
			() => {}
		);
		response = await abortable(fetching, signal);
		if (!response.ok || !response.body)
			throw new Error(`Runtime Wasm fetch failed: ${response.status}`);
		if (!cached && options.validateResponse) options.validateResponse(response, assetUrl);
		else if (response.url && new URL(response.url).href !== assetUrl.href)
			throw new Error('Runtime Wasm response URL mismatch');
		reader = response.body.getReader();
		const prefix: Uint8Array[] = [];
		let prefixLength = 0;
		let done = false;
		while (prefixLength < 2 && !done) {
			const next = await abortable(reader.read(), signal);
			done = next.done;
			if (next.value?.byteLength) {
				if (
					next.value.byteLength >
					Math.max(receipt.bytes, receipt.uncompressedBytes) - prefixLength
				) {
					throw new Error('Runtime Wasm exceeds receipt byte limit');
				}
				prefix.push(Uint8Array.from(next.value));
				prefixLength += next.value.byteLength;
			}
		}
		const first = prefix[0];
		const second = (first?.length ?? 0) > 1 ? first![1] : prefix[1]?.[0];
		const gzip = first?.[0] === 0x1f && second === 0x8b;
		const input = reader;
		const source = new ReadableStream<Uint8Array>({
			async pull(output) {
				try {
					signal.throwIfAborted();
					if (prefix.length) {
						output.enqueue(prefix.shift()!);
						return;
					}
					if (done) {
						input.releaseLock();
						output.close();
						return;
					}
					const next = await abortable(input.read(), signal);
					if (next.done) {
						done = true;
						input.releaseLock();
						output.close();
					} else output.enqueue(next.value);
				} catch (error) {
					output.error(error);
					void input.cancel(error).catch(() => {});
				}
			},
			cancel(error) {
				return input.cancel(error).catch(() => {});
			}
		});
		let logical = source;
		const gates: Promise<void>[] = [];
		let storageSnapshot: Uint8Array | undefined;
		if (gzip) {
			if (typeof DecompressionStream !== 'function')
				throw new Error('Runtime gzip needs native decompression');
			const storage = verifiedStream(source, receipt.bytes, receipt.sha256, signal);
			storageSnapshot = storage.snapshot;
			gates.push(storage.verified);
			logical = storage.body.pipeThrough(new DecompressionStream('gzip'));
		}
		// Transparently HTTP-decoded responses are checked against the logical receipt.
		const verified = verifiedStream(
			logical,
			receipt.uncompressedBytes,
			receipt.uncompressedSha256,
			signal,
			options.onProgress
		);
		gates.push(verified.verified);
		const wasmResponse = new Response(verified.body, {
			headers: { 'Content-Type': 'application/wasm' }
		});
		const compiling =
			typeof WebAssembly.compileStreaming === 'function'
				? WebAssembly.compileStreaming(wasmResponse)
				: wasmResponse.arrayBuffer().then((bytes) => WebAssembly.compile(bytes));
		const [module] = await abortable(Promise.all([compiling, ...gates]), signal);
		signal.throwIfAborted();
		if (!cached && storageSnapshot) {
			await writePersistentRuntimeAsset({
				identity,
				cache: options.persistentCache,
				signal,
				bytes: storageSnapshot
			});
		}
		return module;
	} catch (error) {
		controller.abort(error);
		if (reader) void reader.cancel(error).catch(() => {});
		else void response?.body?.cancel(error).catch(() => {});
		throw error;
	} finally {
		parent?.removeEventListener('abort', abort);
	}
}
