import * as zip from '@zip.js/zip.js';

export interface ProgressSink {
	set?: (value: number) => void;
}

const store: Partial<Record<string, Promise<WebAssembly.Module>>> = {};
const bufferStore: Partial<Record<string, Promise<Uint8Array>>> = {};

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

export const readBuffer = async (name: string, progress?: ProgressSink) => {
	if (!bufferStore[name]) {
		bufferStore[name] = (async () => {
			const resolvedUrl = resolveRuntimeAssetUrl(name);
			const response = await fetch(resolvedUrl);
			if (!response.ok) {
				throw new Error(`Failed to load runtime asset ${resolvedUrl}: ${response.status}`);
			}
			const contentLength = +(response.headers.get('Content-Length') || 0);
			if (!response.body) {
				return new Uint8Array(await response.arrayBuffer());
			}
			const r = response.body.getReader();

			let receivedLength = 0;
			const chunks: Uint8Array[] = [];
			while (true) {
				const { done, value } = await r.read();
				if (done) break;
				if (!value) continue;
				chunks.push(Uint8Array.from(value));
				receivedLength += value.length;
				if (contentLength > 0) progress?.set?.(receivedLength / contentLength);
			}
			const chunksAll = new Uint8Array(receivedLength);
			let position = 0;
			for (const chunk of chunks) {
				chunksAll.set(chunk, position);
				position += chunk.length;
			}

			const reader = new zip.ZipReader(new zip.Uint8ArrayReader(chunksAll));
			const entries = await reader.getEntries();
			for (const entry of entries) {
				if (!('getData' in entry)) continue;
				return await entry.getData(new zip.Uint8ArrayWriter());
			}
			throw new Error('No entry found');
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
