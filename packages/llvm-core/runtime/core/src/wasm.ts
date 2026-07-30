export interface ProgressSink {
	set?: (value: number) => void;
}

const store = new Map<string, Promise<WebAssembly.Module>>();
const bufferStore = new Map<string, Promise<Uint8Array>>();

const isGzip = (bytes: Uint8Array) =>
	bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

export const DEFAULT_MAX_DECOMPRESSED_ASSET_BYTES = 128 * 1024 * 1024;
export const DEFAULT_MAX_RUNTIME_JSON_BYTES = 4 * 1024 * 1024;
const DEFAULT_DECOMPRESSION_BUFFER_BYTES = 64 * 1024;

export interface RuntimeJsonFetchOptions {
	fetchImpl?: typeof fetch;
	label?: string;
	maxBytes?: number;
	signal?: AbortSignal;
}

async function readBoundedDecompressionStream(
	stream: ReadableStream<Uint8Array>,
	assetUrl: string | URL,
	maxOutputBytes: number,
	signal?: AbortSignal
) {
	const reader = stream.getReader();
	const cancelOnAbort = () => {
		void reader.cancel(runtimeAbortReason(signal!)).catch(() => {});
	};
	signal?.addEventListener('abort', cancelOnAbort, { once: true });
	let bytes = new Uint8Array(Math.min(DEFAULT_DECOMPRESSION_BUFFER_BYTES, maxOutputBytes));
	let receivedLength = 0;
	try {
		throwIfRuntimeAssetAborted(signal);
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxOutputBytes) {
				await reader.cancel().catch(() => {});
				throw new Error(
					`Runtime asset ${assetUrl} decompressed size exceeds the ${maxOutputBytes} byte limit`
				);
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					maxOutputBytes,
					Math.max(nextLength, Math.max(bytes.byteLength * 2, 1))
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, receivedLength));
				bytes = grown;
			}
			bytes.set(value, receivedLength);
			receivedLength = nextLength;
		}
		throwIfRuntimeAssetAborted(signal);
		return bytes.subarray(0, receivedLength);
	} catch (error) {
		if (signal?.aborted) throw runtimeAbortReason(signal);
		throw error;
	} finally {
		signal?.removeEventListener('abort', cancelOnAbort);
		reader.releaseLock();
	}
}

function resolveRuntimeAssetUrl(name: string) {
	let resolvedUrl: URL;
	try {
		resolvedUrl = new URL(name, typeof location !== 'undefined' ? location.href : undefined);
	} catch {
		throw new Error('Runtime asset URL must be absolute outside a browser document');
	}
	if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') {
		throw new Error('Runtime assets must use HTTP(S)');
	}
	if (resolvedUrl.username || resolvedUrl.password) {
		throw new Error('Runtime asset URLs must not include credentials');
	}
	if (resolvedUrl.hash) throw new Error('Runtime asset URLs must not include fragments');
	return resolvedUrl;
}

function readContentLength(response: Response) {
	const value = response.headers.get('Content-Length');
	if (value === null) return 0;
	const contentLength = Number(value);
	if (!/^\d+$/u.test(value) || !Number.isSafeInteger(contentLength)) {
		throw new Error('Runtime asset has an invalid Content-Length');
	}
	return contentLength;
}

function runtimeAbortReason(signal: AbortSignal) {
	return signal.reason ?? new DOMException('Runtime asset load aborted', 'AbortError');
}

function waitForRuntimeAssetOperation<T>(
	operation: Promise<T>,
	signal?: AbortSignal,
	onLateValue?: (value: T, reason: unknown) => void | Promise<void>
): Promise<T> {
	if (!signal) return operation;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const cancelOnAbort = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', cancelOnAbort);
			reject(runtimeAbortReason(signal));
		};
		signal.addEventListener('abort', cancelOnAbort, { once: true });
		operation.then(
			(value) => {
				if (settled) {
					if (onLateValue) {
						void Promise.resolve()
							.then(() => onLateValue(value, signal.reason))
							.catch(() => {});
					}
					return;
				}
				settled = true;
				signal.removeEventListener('abort', cancelOnAbort);
				resolve(value);
			},
			(error) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', cancelOnAbort);
				reject(error);
			}
		);
		if (signal.aborted) cancelOnAbort();
	});
}

function throwIfRuntimeAssetAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw runtimeAbortReason(signal);
}

async function readResponseBytes(
	response: Response,
	assetUrl: string | URL,
	maxOutputBytes: number,
	progress?: ProgressSink,
	signal?: AbortSignal
) {
	if (signal?.aborted) {
		const reason = runtimeAbortReason(signal);
		await response.body?.cancel(reason).catch(() => {});
		throw reason;
	}
	let contentLength: number;
	try {
		contentLength = readContentLength(response);
	} catch (error) {
		await response.body?.cancel(error).catch(() => {});
		throw error;
	}
	if (contentLength > maxOutputBytes) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`Runtime asset ${assetUrl} size exceeds the ${maxOutputBytes} byte limit`);
	}
	if (!response.body) {
		const bytes = new Uint8Array(
			await waitForRuntimeAssetOperation(response.arrayBuffer(), signal)
		);
		if (signal?.aborted) throw runtimeAbortReason(signal);
		if (bytes.byteLength > maxOutputBytes) {
			throw new Error(
				`Runtime asset ${assetUrl} size exceeds the ${maxOutputBytes} byte limit`
			);
		}
		progress?.set?.(1);
		return bytes;
	}

	const reader = response.body.getReader();
	const cancelOnAbort = () => {
		void reader.cancel(runtimeAbortReason(signal!)).catch(() => {});
	};
	signal?.addEventListener('abort', cancelOnAbort, { once: true });
	let bytes = new Uint8Array(
		Math.min(maxOutputBytes, contentLength || DEFAULT_DECOMPRESSION_BUFFER_BYTES)
	);
	let receivedLength = 0;
	try {
		if (signal?.aborted) throw runtimeAbortReason(signal);
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxOutputBytes) {
				throw new Error(
					`Runtime asset ${assetUrl} size exceeds the ${maxOutputBytes} byte limit`
				);
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					maxOutputBytes,
					Math.max(nextLength, Math.max(bytes.byteLength * 2, 1))
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, receivedLength));
				bytes = grown;
			}
			bytes.set(value, receivedLength);
			receivedLength = nextLength;
			if (contentLength > 0) progress?.set?.(receivedLength / contentLength);
		}
		if (signal?.aborted) throw runtimeAbortReason(signal);
		return bytes.subarray(0, receivedLength);
	} catch (error) {
		await reader.cancel(error).catch(() => {});
		if (signal?.aborted) throw runtimeAbortReason(signal);
		throw error;
	} finally {
		signal?.removeEventListener('abort', cancelOnAbort);
		reader.releaseLock();
	}
}

export async function fetchRuntimeJson(
	url: string | URL,
	options: RuntimeJsonFetchOptions = {}
): Promise<unknown> {
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_RUNTIME_JSON_BYTES;
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
		throw new Error('Runtime JSON byte limit must be a positive safe integer');
	}
	const resolvedUrl = resolveRuntimeAssetUrl(url.toString());
	const label = options.label?.trim() || 'runtime JSON';
	const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
	if (!fetchImpl) throw new Error(`Fetch is unavailable while loading ${label}`);
	if (options.signal?.aborted) throw runtimeAbortReason(options.signal);
	const requestInit: RequestInit = {
		cache: 'no-store',
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer'
	};
	if (options.signal) requestInit.signal = options.signal;
	const pendingResponse = Promise.resolve(fetchImpl(resolvedUrl.toString(), requestInit));
	const response = await waitForRuntimeAssetOperation(
		pendingResponse,
		options.signal,
		async (lateResponse, reason) => {
			await lateResponse.body?.cancel(reason).catch(() => {});
		}
	);
	if (options.signal?.aborted) {
		const reason = runtimeAbortReason(options.signal);
		await response.body?.cancel(reason).catch(() => {});
		throw reason;
	}
	if (response.url) {
		let finalUrl: URL;
		try {
			finalUrl = new URL(response.url);
		} catch {
			await response.body?.cancel().catch(() => {});
			throw new Error(`${label} returned an invalid final URL`);
		}
		if (finalUrl.href !== resolvedUrl.href) {
			await response.body?.cancel().catch(() => {});
			throw new Error(`${label} returned an unexpected final URL`);
		}
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`Failed to load ${label} from ${resolvedUrl}: ${response.status}`);
	}
	const bytes = await readResponseBytes(
		response,
		resolvedUrl,
		maxBytes,
		undefined,
		options.signal
	);
	let source: string;
	try {
		source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8`, { cause: error });
	}
	try {
		return JSON.parse(source) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid JSON`, { cause: error });
	}
}

export async function decompressGzip(
	bytes: Uint8Array,
	assetUrl: string | URL = 'runtime asset',
	maxOutputBytes = DEFAULT_MAX_DECOMPRESSED_ASSET_BYTES
) {
	if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
		throw new Error('Runtime asset decompression limit must be a non-negative safe integer');
	}
	// Browsers expose an already-decoded body when the server sets Content-Encoding: gzip.
	if (!isGzip(bytes)) {
		if (bytes.byteLength > maxOutputBytes) {
			throw new Error(
				`Runtime asset ${assetUrl} decompressed size exceeds the ${maxOutputBytes} byte limit`
			);
		}
		return bytes;
	}
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			`Failed to decompress runtime asset ${assetUrl}: DecompressionStream('gzip') is unavailable`
		);
	}
	try {
		const compressed = Uint8Array.from(bytes);
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(compressed);
				controller.close();
			}
		});
		const decompressor = new DecompressionStream('gzip');
		const stream = source.pipeThrough({
			readable: decompressor.readable as ReadableStream<Uint8Array>,
			writable: decompressor.writable as WritableStream<Uint8Array>
		});
		return await readBoundedDecompressionStream(stream, assetUrl, maxOutputBytes);
	} catch (error) {
		throw new Error(
			`Failed to decompress runtime asset ${assetUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

async function readGzipResponse(
	response: Response,
	assetUrl: URL,
	maxOutputBytes: number,
	progress?: ProgressSink,
	signal?: AbortSignal
) {
	if (signal?.aborted) {
		const reason = runtimeAbortReason(signal);
		await response.body?.cancel(reason).catch(() => {});
		throw reason;
	}
	let contentLength: number;
	try {
		contentLength = readContentLength(response);
	} catch (error) {
		await response.body?.cancel(error).catch(() => {});
		throw error;
	}
	if (contentLength > maxOutputBytes) {
		await response.body?.cancel().catch(() => {});
		throw new Error(
			`Runtime asset ${assetUrl} download size exceeds the ${maxOutputBytes} byte limit`
		);
	}
	if (!response.body) {
		const source = new Uint8Array(
			await waitForRuntimeAssetOperation(response.arrayBuffer(), signal)
		);
		throwIfRuntimeAssetAborted(signal);
		if (source.byteLength > maxOutputBytes) {
			throw new Error(
				`Runtime asset ${assetUrl} download size exceeds the ${maxOutputBytes} byte limit`
			);
		}
		const result = await decompressGzip(source, assetUrl, maxOutputBytes);
		throwIfRuntimeAssetAborted(signal);
		progress?.set?.(1);
		return result;
	}

	const reader = response.body.getReader();
	const leadingChunks: Uint8Array[] = [];
	let leadingLength = 0;
	let receivedLength = 0;
	let readerDone = false;
	let readerReleased = false;
	const releaseReader = () => {
		if (readerReleased) return;
		readerReleased = true;
		reader.releaseLock();
	};
	const cancelReader = async (reason?: unknown) => {
		if (readerReleased) return;
		try {
			await reader.cancel(reason);
		} finally {
			releaseReader();
		}
	};
	const cancelOnAbort = () => {
		void cancelReader(runtimeAbortReason(signal!)).catch(() => {});
	};
	signal?.addEventListener('abort', cancelOnAbort, { once: true });
	try {
		throwIfRuntimeAssetAborted(signal);
		while (leadingLength < 2) {
			const { done, value } = await reader.read();
			if (done) {
				readerDone = true;
				releaseReader();
				break;
			}
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxOutputBytes) {
				const error = new Error(
					`Runtime asset ${assetUrl} download size exceeds the ${maxOutputBytes} byte limit`
				);
				await cancelReader(error);
				throw error;
			}
			leadingChunks.push(value);
			leadingLength += value.byteLength;
			receivedLength = nextLength;
			if (contentLength > 0) {
				progress?.set?.(Math.min(receivedLength / contentLength, 1));
			}
		}
		throwIfRuntimeAssetAborted(signal);
	} catch (error) {
		await cancelReader(error).catch(() => {});
		if (signal?.aborted) throw runtimeAbortReason(signal);
		throw error;
	} finally {
		signal?.removeEventListener('abort', cancelOnAbort);
	}

	let firstByte: number | undefined;
	let secondByte: number | undefined;
	for (const chunk of leadingChunks) {
		for (const byte of chunk) {
			if (firstByte === undefined) firstByte = byte;
			else if (secondByte === undefined) secondByte = byte;
			if (secondByte !== undefined) break;
		}
		if (secondByte !== undefined) break;
	}

	let leadingIndex = 0;
	const source = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (leadingIndex < leadingChunks.length) {
				controller.enqueue(leadingChunks[leadingIndex++]);
				return;
			}
			if (readerDone) {
				controller.close();
				return;
			}
			try {
				const { done, value } = await reader.read();
				if (done) {
					readerDone = true;
					releaseReader();
					controller.close();
					return;
				}
				if (!value) return;
				const nextLength = receivedLength + value.byteLength;
				if (nextLength > maxOutputBytes) {
					const error = new Error(
						`Runtime asset ${assetUrl} download size exceeds the ${maxOutputBytes} byte limit`
					);
					await cancelReader(error);
					controller.error(error);
					return;
				}
				receivedLength = nextLength;
				if (contentLength > 0) {
					progress?.set?.(Math.min(receivedLength / contentLength, 1));
				}
				controller.enqueue(value);
			} catch (error) {
				await cancelReader(error).catch(() => {});
				controller.error(error);
			}
		},
		cancel(reason) {
			return cancelReader(reason);
		}
	});

	let output = source;
	if (firstByte === 0x1f && secondByte === 0x8b) {
		if (typeof DecompressionStream !== 'function') {
			await cancelReader();
			throw new Error(
				`Failed to decompress runtime asset ${assetUrl}: DecompressionStream('gzip') is unavailable`
			);
		}
		const decompressor = new DecompressionStream('gzip');
		output = source.pipeThrough({
			readable: decompressor.readable as ReadableStream<Uint8Array>,
			writable: decompressor.writable as WritableStream<Uint8Array>
		});
	}

	try {
		const result = await readBoundedDecompressionStream(
			output,
			assetUrl,
			maxOutputBytes,
			signal
		);
		progress?.set?.(1);
		return result;
	} catch (error) {
		await cancelReader(error).catch(() => {});
		if (signal?.aborted) throw runtimeAbortReason(signal);
		throw new Error(
			`Failed to decompress runtime asset ${assetUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

async function unzipFirstFile(
	bytes: Uint8Array,
	assetUrl: string | URL,
	maxOutputBytes: number,
	signal?: AbortSignal
) {
	throwIfRuntimeAssetAborted(signal);
	const { unzipSync } = await import('fflate');
	throwIfRuntimeAssetAborted(signal);
	let selectedFile: string | undefined;
	const entries = unzipSync(bytes, {
		filter(file) {
			if (file.name.endsWith('/') || selectedFile !== undefined) return false;
			if (file.originalSize > maxOutputBytes) {
				throw new Error(
					`Runtime asset ${assetUrl} extracted size exceeds the ${maxOutputBytes} byte limit`
				);
			}
			selectedFile = file.name;
			return true;
		}
	});
	throwIfRuntimeAssetAborted(signal);
	for (const [entryName, entryBytes] of Object.entries(entries)) {
		if (!entryName.endsWith('/')) return entryBytes;
	}
	throw new Error('No entry found');
}

export const readBuffer = async (
	name: string,
	progress?: ProgressSink,
	maxOutputBytes = DEFAULT_MAX_DECOMPRESSED_ASSET_BYTES,
	signal?: AbortSignal
) => {
	if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
		throw new Error('Runtime asset byte limit must be a non-negative safe integer');
	}
	throwIfRuntimeAssetAborted(signal);
	const cacheKey = `${name}\0${maxOutputBytes}`;
	let pending = signal ? undefined : bufferStore.get(cacheKey);
	if (!pending) {
		pending = (async () => {
			const resolvedUrl = resolveRuntimeAssetUrl(name);
			const requestInit: RequestInit = {
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			};
			if (signal) requestInit.signal = signal;
			let response: Response;
			try {
				const pendingResponse = Promise.resolve(fetch(resolvedUrl, requestInit));
				response = await waitForRuntimeAssetOperation(
					pendingResponse,
					signal,
					async (lateResponse, reason) => {
						await lateResponse.body?.cancel(reason).catch(() => {});
					}
				);
			} catch (error) {
				if (signal?.aborted) throw runtimeAbortReason(signal);
				throw error;
			}
			if (signal?.aborted) {
				const reason = runtimeAbortReason(signal);
				await response.body?.cancel(reason).catch(() => {});
				throw reason;
			}
			if (response.url) {
				let finalUrl: URL;
				try {
					finalUrl = new URL(response.url);
				} catch {
					await response.body?.cancel().catch(() => {});
					throw new Error('Runtime asset returned an invalid final URL');
				}
				if (finalUrl.href !== resolvedUrl.href) {
					await response.body?.cancel().catch(() => {});
					throw new Error('Runtime asset returned an unexpected final URL');
				}
			}
			if (!response.ok) {
				await response.body?.cancel().catch(() => {});
				throw new Error(`Failed to load runtime asset ${resolvedUrl}: ${response.status}`);
			}
			if (resolvedUrl.pathname.endsWith('.gz')) {
				return await readGzipResponse(
					response,
					resolvedUrl,
					maxOutputBytes,
					progress,
					signal
				);
			}
			const source = await readResponseBytes(
				response,
				resolvedUrl,
				maxOutputBytes,
				progress,
				signal
			);
			if (resolvedUrl.pathname.endsWith('.zip')) {
				return await unzipFirstFile(source, resolvedUrl, maxOutputBytes, signal);
			}
			return source;
		})();
		if (!signal) {
			pending = pending.catch((error) => {
				if (bufferStore.get(cacheKey) === pending) bufferStore.delete(cacheKey);
				throw error;
			});
			bufferStore.set(cacheKey, pending);
		}
	}

	const data = await pending;
	throwIfRuntimeAssetAborted(signal);
	progress?.set?.(1);
	return Uint8Array.from(data);
};

export async function compile(filename: string, progress?: ProgressSink, signal?: AbortSignal) {
	// TODO: make compileStreaming work. It needs the server to use the
	// application/wasm mimetype.
	throwIfRuntimeAssetAborted(signal);
	const cached = signal ? undefined : store.get(filename);
	if (cached) return cached;
	let pending = (async () => {
		const bytes = await readBuffer(
			filename,
			progress,
			DEFAULT_MAX_DECOMPRESSED_ASSET_BYTES,
			signal
		);
		throwIfRuntimeAssetAborted(signal);
		const module = await waitForRuntimeAssetOperation(WebAssembly.compile(bytes), signal);
		throwIfRuntimeAssetAborted(signal);
		return module;
	})();
	if (!signal) {
		pending = pending.catch((error) => {
			if (store.get(filename) === pending) store.delete(filename);
			throw error;
		});
		store.set(filename, pending);
	}
	return pending;
}

export function getInstance(module: WebAssembly.Module, imports: WebAssembly.Imports) {
	return WebAssembly.instantiate(module, imports) as Promise<WebAssembly.Instance>;
}
