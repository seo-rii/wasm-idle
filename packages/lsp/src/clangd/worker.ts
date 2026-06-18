import {
	BrowserMessageReader,
	BrowserMessageWriter,
	type BrowserMessageWriter as BrowserMessageWriterInstance
} from '../jsonrpc.js';
import { writeGccCompatibilityHeaders } from './gcc-compat.js';
import {
	CLANGD_CPP_FILE_PATH,
	CLANGD_WORKSPACE_PATH,
	createClangdCompileFlags,
	normalizeClangdBaseUrl
} from './config.js';
import { JsonStream } from './json-stream.js';
import type { ClangdWorkerInboundMessage } from './protocol.js';

interface ClangdWorkerScope {
	addEventListener(
		type: 'message',
		listener: (event: MessageEvent<ClangdWorkerInboundMessage>) => void
	): void;
	postMessage(message: unknown, transfer?: Transferable[]): void;
	reportError?: (message: string) => void;
}

declare const self: ClangdWorkerScope;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const jsonStream = new JsonStream();

let resolveStdinReady = () => {};
const stdinChunks: string[] = [];
const currentStdinChunk: (number | null)[] = [];

const stdin = (): number | null => {
	if (currentStdinChunk.length === 0) {
		if (stdinChunks.length === 0) return null;
		const nextChunk = stdinChunks.shift();
		if (!nextChunk) return null;
		currentStdinChunk.push(...textEncoder.encode(nextChunk), null);
	}
	return currentStdinChunk.shift() ?? null;
};

const stdinReady = async () => {
	if (stdinChunks.length === 0) {
		return new Promise<void>((resolve) => {
			resolveStdinReady = resolve;
		});
	}
};

let writer: BrowserMessageWriterInstance | null = null;
let clangdRuntime: any = null;

const stdout = (charCode: number) => {
	const json = jsonStream.insert(charCode);
	if (json && writer) writer.write(JSON.parse(json));
};

const stderr = () => {};

const onAbort = () => {
	writer?.end();
	self.reportError?.('clangd aborted');
};

const syncWorkspaceFile = (filePath: string) => {
	if (!clangdRuntime) return;
	const normalizedFilePath = filePath.startsWith(CLANGD_WORKSPACE_PATH)
		? filePath
		: `${CLANGD_WORKSPACE_PATH}/${filePath.replace(/^\/+/, '')}`;
	const lastSlash = normalizedFilePath.lastIndexOf('/');
	const directoryPath =
		lastSlash > 0 ? normalizedFilePath.slice(0, lastSlash) : CLANGD_WORKSPACE_PATH;
	clangdRuntime.FS.mkdirTree(directoryPath);
	clangdRuntime.FS.writeFile(normalizedFilePath, '');
};

async function fetchAssetBytes(baseUrl: string, asset: string) {
	const response = await fetch(new URL(asset, baseUrl).href);
	if (!response.ok) throw new Error(`Failed to load ${asset}: ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

async function decompressGzip(bytes: Uint8Array) {
	if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
	if (typeof DecompressionStream === 'undefined') {
		throw new Error('Failed to decompress clangd.wasm.gz: DecompressionStream is unavailable');
	}
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	const stream = new Blob([copy.buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

self.addEventListener('message', async (event: MessageEvent<ClangdWorkerInboundMessage>) => {
	if (event.data?.type === 'sync-file' && typeof event.data?.name === 'string') {
		syncWorkspaceFile(event.data.name);
		return;
	}
	if (event.data?.type !== 'init') return;

	const baseUrl = normalizeClangdBaseUrl(event.data.baseUrl || '/clangd') + '/';
	try {
		const jsBytes = event.data.assets?.clangdJs
			? new Uint8Array(event.data.assets.clangdJs)
			: await fetchAssetBytes(baseUrl, 'clangd.js');
		self.postMessage({ type: 'progress', value: 1, max: 3 });
		const jsSource = textDecoder.decode(jsBytes);
		const jsDataUrl = URL.createObjectURL(
			new Blob([jsSource], { type: 'text/javascript;charset=utf-8' })
		);
		const jsModule = import(/* @vite-ignore */ jsDataUrl);

		const compressedWasmBytes = event.data.assets?.clangdWasmGz
			? new Uint8Array(event.data.assets.clangdWasmGz)
			: await fetchAssetBytes(baseUrl, 'clangd.wasm.gz');
		self.postMessage({ type: 'progress', value: 2, max: 3 });
		const wasmBytes = await decompressGzip(compressedWasmBytes);
		self.postMessage({ type: 'progress', value: 3, max: 3 });
		const wasmBlobBytes = new Uint8Array(wasmBytes.byteLength);
		wasmBlobBytes.set(wasmBytes);
		const wasmBlob = new Blob([wasmBlobBytes.buffer], { type: 'application/wasm' });
		const wasmDataUrl = URL.createObjectURL(wasmBlob);

		const { default: Clangd } = await jsModule;
		clangdRuntime = await Clangd({
			thisProgram: '/usr/bin/clangd',
			mainScriptUrlOrBlob: jsDataUrl,
			locateFile: (path: string, prefix: string) =>
				path.endsWith('.wasm') ? wasmDataUrl : `${prefix}${path}`,
			stdinReady,
			stdin,
			stdout,
			stderr,
			onExit: onAbort,
			onAbort
		});

		clangdRuntime.FS.mkdirTree(CLANGD_WORKSPACE_PATH);
		writeGccCompatibilityHeaders(clangdRuntime.FS, '/usr');
		syncWorkspaceFile(CLANGD_CPP_FILE_PATH);
		clangdRuntime.FS.writeFile(
			`${CLANGD_WORKSPACE_PATH}/.clangd`,
			JSON.stringify({
				CompileFlags: {
					Add: createClangdCompileFlags()
				}
			})
		);
		clangdRuntime.callMain([]);

		writer = new BrowserMessageWriter(self);
		const reader = new BrowserMessageReader(self);
		reader.listen((data: unknown) => {
			const body = JSON.stringify(data).replace(/[\u007F-\uFFFF]/g, (character) => {
				return '\\u' + character.codePointAt(0)?.toString(16).padStart(4, '0');
			});
			stdinChunks.push(`Content-Length: ${body.length}\r\n`, '\r\n', body);
			resolveStdinReady();
		});
		self.postMessage({ type: 'ready', value: wasmBytes.byteLength });
	} catch (error) {
		self.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		});
	}
});
