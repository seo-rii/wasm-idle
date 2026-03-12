/// <reference lib="WebWorker" />

import {
	CLANGD_CPP_FILE_PATH,
	CLANGD_WORKSPACE_PATH,
	createClangdCompileFlags,
	normalizeClangdBaseUrl
} from '$lib/clangd/config';
import { JsonStream } from '$lib/clangd/jsonStream';
import { BrowserMessageReader, BrowserMessageWriter } from 'vscode-jsonrpc/browser';

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

let writer: BrowserMessageWriter | null = null;

const stdout = (charCode: number) => {
	const json = jsonStream.insert(charCode);
	if (json && writer) writer.write(JSON.parse(json));
};

const stderr = () => {};

const onAbort = () => {
	writer?.end();
	self.reportError?.('clangd aborted');
};

self.addEventListener('message', async (event) => {
	if (event.data?.type !== 'init') return;
	const baseUrl = normalizeClangdBaseUrl(event.data.baseUrl);
	try {
		const jsResponse = await fetch(`${baseUrl}/clangd.js`);
		if (!jsResponse.ok) {
			throw new Error(`Failed to load clangd.js: ${jsResponse.status}`);
		}
		const jsSource = await jsResponse.text();
		const jsDataUrl = URL.createObjectURL(
			new Blob([jsSource], { type: 'text/javascript;charset=utf-8' })
		);
		const jsModule = import(/* @vite-ignore */ jsDataUrl);
		const wasmResponse = await fetch(`${baseUrl}/clangd.wasm.gz`);
		if (!wasmResponse.ok) {
			throw new Error(`Failed to load clangd.wasm.gz: ${wasmResponse.status}`);
		}
		const wasmSize = +(wasmResponse.headers.get('Content-Length') || 0);
		const wasmReader = wasmResponse.body?.getReader();
		const chunks: Uint8Array[] = [];
		let receivedLength = 0;
		if (wasmReader) {
			while (true) {
				const { done, value } = await wasmReader.read();
				if (done) break;
				if (!value) continue;
				chunks.push(Uint8Array.from(value));
				receivedLength += value.length;
				self.postMessage({
					type: 'progress',
					value: receivedLength,
					...(wasmSize > 0 ? { max: wasmSize } : {})
				});
			}
		} else {
			const wasmBytes = new Uint8Array(await wasmResponse.arrayBuffer());
			chunks.push(wasmBytes);
			receivedLength = wasmBytes.byteLength;
			self.postMessage({
				type: 'progress',
				value: receivedLength,
				...(wasmSize > 0 ? { max: wasmSize } : {})
			});
		}
		if (typeof DecompressionStream === 'undefined') {
			throw new Error('This browser does not support gzip decompression streams');
		}
		const compressedWasmBytes = new Uint8Array(receivedLength);
		let offset = 0;
		for (const chunk of chunks) {
			compressedWasmBytes.set(chunk, offset);
			offset += chunk.length;
		}
		const wasmBytes = await new Response(
			new Blob([compressedWasmBytes.buffer], { type: 'application/gzip' })
				.stream()
				.pipeThrough(new DecompressionStream('gzip'))
		).arrayBuffer();
		const wasmBlob = new Blob([wasmBytes], { type: 'application/wasm' });
		const wasmDataUrl = URL.createObjectURL(wasmBlob);
		const { default: Clangd } = await jsModule;
		const clangd = await Clangd({
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

		clangd.FS.mkdirTree(CLANGD_WORKSPACE_PATH);
		clangd.FS.writeFile(CLANGD_CPP_FILE_PATH, '');
		clangd.FS.writeFile(
			`${CLANGD_WORKSPACE_PATH}/.clangd`,
			JSON.stringify({
				CompileFlags: {
					Add: createClangdCompileFlags()
				}
			})
		);
		clangd.callMain([]);

		writer = new BrowserMessageWriter(self);
		const reader = new BrowserMessageReader(self);
		reader.listen((data) => {
			const body = JSON.stringify(data).replace(/[\u007F-\uFFFF]/g, (character) => {
				return '\\u' + character.codePointAt(0)?.toString(16).padStart(4, '0');
			});
			stdinChunks.push(`Content-Length: ${body.length}\r\n`, '\r\n', body);
			resolveStdinReady();
		});
		self.postMessage({ type: 'ready', value: receivedLength });
	} catch (error) {
		self.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		});
	}
});
