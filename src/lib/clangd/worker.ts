/// <reference lib="WebWorker" />

import {
	CLANGD_CPP_FILE_PATH,
	CLANGD_WORKSPACE_PATH,
	createClangdCompileFlags,
	normalizeClangdBaseUrl
} from '$lib/clangd/config';
import { JsonStream } from '$lib/clangd/jsonStream';
import {
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage,
	loadWorkerRuntimeAsset,
	type WorkerRuntimeAssetConfig
} from '$lib/playground/worker/assets';
import {
	BrowserMessageReader,
	BrowserMessageWriter,
	type BrowserMessageWriter as BrowserMessageWriterInstance
} from '$lib/utils/vscodeJsonrpcBrowser';

declare const self: DedicatedWorkerGlobalScope & { reportError?: (message: string) => void };

const textEncoder = new TextEncoder();
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

self.addEventListener('message', async (event) => {
	if (handleWorkerAssetMessage(event.data)) return;
	if (event.data?.type === 'sync-file' && typeof event.data?.name === 'string') {
		syncWorkspaceFile(event.data.name);
		return;
	}
	if (event.data?.type !== 'init') return;
	const runtimeAssets = event.data.assets as WorkerRuntimeAssetConfig | undefined;
	const normalizedBaseUrl = normalizeClangdBaseUrl(event.data.baseUrl || '');
	const baseUrl =
		runtimeAssets?.baseUrl || (normalizedBaseUrl ? `${normalizedBaseUrl}/` : '/clangd/');
	configureWorkerRuntimeAssets({
		baseUrl,
		useAssetBridge: !!runtimeAssets?.useAssetBridge
	});
	try {
		const jsSource = new TextDecoder().decode(
			(await loadWorkerRuntimeAsset('clangd.js')).bytes
		);
		self.postMessage({ type: 'progress', value: 1, max: 3 });
		const jsDataUrl = URL.createObjectURL(
			new Blob([jsSource], { type: 'text/javascript;charset=utf-8' })
		);
		const jsModule = import(/* @vite-ignore */ jsDataUrl);
		const compressedWasmBytes = (await loadWorkerRuntimeAsset('clangd.wasm.gz')).bytes;
		self.postMessage({ type: 'progress', value: 2, max: 3 });
		let wasmBytes = compressedWasmBytes;
		if (compressedWasmBytes[0] === 0x1f && compressedWasmBytes[1] === 0x8b) {
			if (typeof DecompressionStream === 'undefined') {
				throw new Error(
					'Failed to decompress clangd.wasm.gz: DecompressionStream is unavailable'
				);
			}
			const compressedWasmCopy = new Uint8Array(compressedWasmBytes.byteLength);
			compressedWasmCopy.set(compressedWasmBytes);
			const stream = new Blob([compressedWasmCopy.buffer])
				.stream()
				.pipeThrough(new DecompressionStream('gzip'));
			wasmBytes = new Uint8Array(await new Response(stream).arrayBuffer());
		}
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
		reader.listen((data) => {
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
