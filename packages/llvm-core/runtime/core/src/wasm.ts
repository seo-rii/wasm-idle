import { unzipSync } from 'fflate';

export interface ProgressSink {
	set?: (value: number) => void;
}

const store: Partial<Record<string, Promise<WebAssembly.Module>>> = {};
const bufferStore: Partial<Record<string, Promise<Uint8Array>>> = {};

const isGzip = (bytes: Uint8Array) =>
	bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

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

async function readResponseBytes(response: Response, progress?: ProgressSink) {
	const contentLength = +(response.headers.get('Content-Length') || 0);
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		progress?.set?.(1);
		return bytes;
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let receivedLength = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		const chunk = Uint8Array.from(value);
		chunks.push(chunk);
		receivedLength += chunk.byteLength;
		if (contentLength > 0) progress?.set?.(receivedLength / contentLength);
	}

	const bytes = new Uint8Array(receivedLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function gunzip(bytes: Uint8Array, assetUrl: URL) {
	// Browsers expose an already-decoded body when the server sets Content-Encoding: gzip.
	if (!isGzip(bytes)) return bytes;
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			`Failed to decompress runtime asset ${assetUrl}: DecompressionStream('gzip') is unavailable`
		);
	}
	try {
		const compressed = Uint8Array.from(bytes);
		const stream = new Blob([compressed.buffer])
			.stream()
			.pipeThrough(new DecompressionStream('gzip'));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	} catch (error) {
		throw new Error(
			`Failed to decompress runtime asset ${assetUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

function unzipFirstFile(bytes: Uint8Array) {
	const entries = unzipSync(bytes);
	for (const [entryName, entryBytes] of Object.entries(entries)) {
		if (!entryName.endsWith('/')) return entryBytes;
	}
	throw new Error('No entry found');
}

export const readBuffer = async (name: string, progress?: ProgressSink) => {
	if (!bufferStore[name]) {
		bufferStore[name] = (async () => {
			const resolvedUrl = resolveRuntimeAssetUrl(name);
			const response = await fetch(resolvedUrl);
			if (!response.ok) {
				throw new Error(`Failed to load runtime asset ${resolvedUrl}: ${response.status}`);
			}
			const source = await readResponseBytes(response, progress);
			if (resolvedUrl.pathname.endsWith('.gz')) return await gunzip(source, resolvedUrl);
			if (resolvedUrl.pathname.endsWith('.zip')) return unzipFirstFile(source);
			return source;
		})().catch((error) => {
			delete bufferStore[name];
			throw error;
		});
	}

	const data = await bufferStore[name];
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
