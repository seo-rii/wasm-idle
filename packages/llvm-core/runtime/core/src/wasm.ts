import { Unzip, UnzipInflate } from 'fflate';

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
			let extracted: Uint8Array | undefined;
			let archiveError: unknown;
			let selected = false;
			const unzip = new Unzip((file) => {
				if (selected || file.name.endsWith('/')) return;
				selected = true;
				const chunks: Uint8Array[] = [];
				let extractedLength = 0;
				file.ondata = (error, data, final) => {
					if (error) {
						archiveError = error;
						return;
					}
					if (data.byteLength > 0) {
						chunks.push(data);
						extractedLength += data.byteLength;
					}
					if (!final) return;
					extracted = new Uint8Array(extractedLength);
					let offset = 0;
					for (const chunk of chunks) {
						extracted.set(chunk, offset);
						offset += chunk.byteLength;
					}
				};
				file.start();
			});
			unzip.register(UnzipInflate);
			let receivedLength = 0;
			if (response.body) {
				const reader = response.body.getReader();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					if (!value) continue;
					receivedLength += value.byteLength;
					unzip.push(value);
					if (archiveError) throw archiveError;
					if (contentLength > 0) progress?.set?.(receivedLength / contentLength);
				}
				unzip.push(new Uint8Array(0), true);
			} else {
				const source = new Uint8Array(await response.arrayBuffer());
				receivedLength = source.byteLength;
				unzip.push(source, true);
			}
			if (archiveError) throw archiveError;
			if (extracted) return extracted;
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
