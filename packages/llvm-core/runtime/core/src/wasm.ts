export interface ProgressSink {
	set?: (value: number) => void;
}

const store: Partial<Record<string, Promise<WebAssembly.Module>>> = {};
const bufferStore: Partial<Record<string, Promise<Uint8Array>>> = {};

const isGzip = (bytes: Uint8Array) =>
	bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

export const DEFAULT_MAX_DECOMPRESSED_ASSET_BYTES = 128 * 1024 * 1024;
const DEFAULT_DECOMPRESSION_BUFFER_BYTES = 64 * 1024;

async function readBoundedDecompressionStream(
	stream: ReadableStream<Uint8Array>,
	assetUrl: string | URL,
	maxOutputBytes: number
) {
	const reader = stream.getReader();
	let bytes = new Uint8Array(Math.min(DEFAULT_DECOMPRESSION_BUFFER_BYTES, maxOutputBytes));
	let receivedLength = 0;
	try {
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
		return bytes.subarray(0, receivedLength);
	} finally {
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
	return resolvedUrl;
}

function readContentLength(response: Response) {
	const value = response.headers.get('Content-Length');
	if (!value || !/^\d+$/u.test(value)) return 0;
	const contentLength = Number(value);
	return Number.isSafeInteger(contentLength) ? contentLength : 0;
}

async function readResponseBytes(
	response: Response,
	assetUrl: string | URL,
	maxOutputBytes: number,
	progress?: ProgressSink
) {
	const contentLength = readContentLength(response);
	if (contentLength > maxOutputBytes) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`Runtime asset ${assetUrl} size exceeds the ${maxOutputBytes} byte limit`);
	}
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxOutputBytes) {
			throw new Error(
				`Runtime asset ${assetUrl} size exceeds the ${maxOutputBytes} byte limit`
			);
		}
		progress?.set?.(1);
		return bytes;
	}

	const reader = response.body.getReader();
	let bytes = new Uint8Array(
		Math.min(maxOutputBytes, contentLength || DEFAULT_DECOMPRESSION_BUFFER_BYTES)
	);
	let receivedLength = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxOutputBytes) {
				await reader.cancel().catch(() => {});
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
		return bytes.subarray(0, receivedLength);
	} finally {
		reader.releaseLock();
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
	progress?: ProgressSink
) {
	const contentLength = readContentLength(response);
	if (contentLength > maxOutputBytes) {
		await response.body?.cancel().catch(() => {});
		throw new Error(
			`Runtime asset ${assetUrl} download size exceeds the ${maxOutputBytes} byte limit`
		);
	}
	if (!response.body) {
		const source = new Uint8Array(await response.arrayBuffer());
		if (source.byteLength > maxOutputBytes) {
			throw new Error(
				`Runtime asset ${assetUrl} download size exceeds the ${maxOutputBytes} byte limit`
			);
		}
		const result = await decompressGzip(source, assetUrl, maxOutputBytes);
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
	try {
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
	} catch (error) {
		await cancelReader(error).catch(() => {});
		throw error;
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
		const result = await readBoundedDecompressionStream(output, assetUrl, maxOutputBytes);
		progress?.set?.(1);
		return result;
	} catch (error) {
		await cancelReader(error).catch(() => {});
		throw new Error(
			`Failed to decompress runtime asset ${assetUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

async function unzipFirstFile(bytes: Uint8Array, assetUrl: string | URL, maxOutputBytes: number) {
	const { unzipSync } = await import('fflate');
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
	for (const [entryName, entryBytes] of Object.entries(entries)) {
		if (!entryName.endsWith('/')) return entryBytes;
	}
	throw new Error('No entry found');
}

export const readBuffer = async (
	name: string,
	progress?: ProgressSink,
	maxOutputBytes = DEFAULT_MAX_DECOMPRESSED_ASSET_BYTES
) => {
	if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
		throw new Error('Runtime asset byte limit must be a non-negative safe integer');
	}
	const cacheKey = `${name}\0${maxOutputBytes}`;
	if (!bufferStore[cacheKey]) {
		bufferStore[cacheKey] = (async () => {
			const resolvedUrl = resolveRuntimeAssetUrl(name);
			const response = await fetch(resolvedUrl, {
				credentials: 'omit',
				referrerPolicy: 'no-referrer'
			});
			if (!response.ok) {
				throw new Error(`Failed to load runtime asset ${resolvedUrl}: ${response.status}`);
			}
			if (resolvedUrl.pathname.endsWith('.gz')) {
				return await readGzipResponse(response, resolvedUrl, maxOutputBytes, progress);
			}
			const source = await readResponseBytes(response, resolvedUrl, maxOutputBytes, progress);
			if (resolvedUrl.pathname.endsWith('.zip')) {
				return await unzipFirstFile(source, resolvedUrl, maxOutputBytes);
			}
			return source;
		})().catch((error) => {
			delete bufferStore[cacheKey];
			throw error;
		});
	}

	const data = await bufferStore[cacheKey];
	progress?.set?.(1);
	return Uint8Array.from(data);
};

export async function compile(filename: string, progress?: ProgressSink) {
	// TODO: make compileStreaming work. It needs the server to use the
	// application/wasm mimetype.
	if (store[filename]) return store[filename];
	return (store[filename] = WebAssembly.compile(await readBuffer(filename, progress)));
}

export function getInstance(module: WebAssembly.Module, imports: WebAssembly.Imports) {
	return WebAssembly.instantiate(module, imports) as Promise<WebAssembly.Instance>;
}
