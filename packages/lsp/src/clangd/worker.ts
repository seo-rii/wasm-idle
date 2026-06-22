import {
	BrowserMessageReader,
	BrowserMessageWriter,
	type BrowserMessageWriter as BrowserMessageWriterInstance
} from '../jsonrpc.js';
import { writeGccCompatibilityHeaders } from '@wasm-idle/clang-common/gcc-compat';
import {
	CLANGD_CPP_FILE_PATH,
	CLANGD_WORKSPACE_PATH,
	createClangdCompileFlags,
	normalizeClangdBaseUrl
} from './config.js';
import { JsonStream } from '@wasm-idle/clang-common/json-stream';
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
let debugEnabled = false;
let stderrBuffer = '';

const describeMessage = (data: unknown) => {
	const record = data as { id?: unknown; method?: unknown } | null;
	if (!record || typeof record !== 'object') return typeof data;
	if (typeof record.method === 'string') return record.method;
	if (record.id !== undefined) return `response:${String(record.id)}`;
	return 'unknown';
};

const isJsonRpcMessage = (data: unknown) => {
	const record = data as { jsonrpc?: unknown } | null;
	return !!record && typeof record === 'object' && record.jsonrpc === '2.0';
};

const debugLog = (...args: unknown[]) => {
	if (debugEnabled) console.debug('[wasm-idle:clangd-worker]', ...args);
};

const stdin = (): number | null => {
	if (currentStdinChunk.length === 0) {
		if (stdinChunks.length === 0) return null;
		const nextChunk = stdinChunks.shift();
		if (!nextChunk) return null;
		currentStdinChunk.push(...textEncoder.encode(nextChunk));
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
	if (!json || !writer) return;
	const message = JSON.parse(json);
	debugLog('stdout', describeMessage(message));
	writer.write(message);
};

const stderr = (charCode: number) => {
	if (!debugEnabled) return;
	if (charCode === 10 || charCode === 13) {
		if (stderrBuffer) debugLog('stderr', stderrBuffer);
		stderrBuffer = '';
		return;
	}
	stderrBuffer += String.fromCharCode(charCode);
};

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
	debugEnabled = !!event.data.debug;
	debugLog('init', baseUrl);
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
		debugLog('callMain start');
		const callMainResult = clangdRuntime.callMain([]);
		debugLog('callMain returned', callMainResult);

		writer = new BrowserMessageWriter(self);
		const reader = new BrowserMessageReader(self);
		reader.listen((data: unknown) => {
			if (!isJsonRpcMessage(data)) {
				debugLog('ignored control message', describeMessage(data));
				return;
			}
			debugLog('stdin message', describeMessage(data));
			const body = JSON.stringify(data).replace(/[\u007F-\uFFFF]/g, (character) => {
				return '\\u' + character.codePointAt(0)?.toString(16).padStart(4, '0');
			});
			const bodyByteLength = textEncoder.encode(body).byteLength;
			stdinChunks.push(`Content-Length: ${bodyByteLength}\r\n\r\n${body}`);
			debugLog('stdin queued bytes', bodyByteLength);
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
