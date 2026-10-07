import {
	BrowserMessageReader,
	BrowserMessageWriter,
	type BrowserMessageWriter as BrowserMessageWriterInstance
} from '../jsonrpc.js';
import { verifyRuntimeAssetIntegrity } from '@wasm-idle/core';
import { decompressGzip } from '@wasm-idle/llvm-core';
import { writeGccCompatibilityHeaders } from '@wasm-idle/llvm-core/core/gcc-compat';
import {
	CLANG_RESOURCE_HEADER_DIRECTORY,
	CLANG_RESOURCE_HEADER_PROVENANCE,
	installClangResourceHeaders
} from '@wasm-idle/llvm-core/core/clang-resource-headers';
import {
	CLANGD_CPP_FILE_PATH,
	CLANGD_WORKSPACE_PATH,
	createClangdConfiguration,
	normalizeClangdBaseUrl
} from './config.js';
import { ClangdStdinQueue } from './stdin-queue.js';
import { JsonStream } from '@wasm-idle/llvm-core/core/json-stream';
import type { ClangdWorkerInboundMessage } from './protocol.js';
import { ClangdWorkspaceFileRegistry, normalizeClangdWorkspaceFilePath } from './workspace.js';
import { mountClangdHeaders } from './headers.js';

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

const stdinQueue = new ClangdStdinQueue();
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

const stdin = () => stdinQueue.read();
const stdinReady = () => stdinQueue.ready();

let writer: BrowserMessageWriterInstance | null = null;
let clangdRuntime: any = null;
const workspaceFiles = new ClangdWorkspaceFileRegistry();

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
	const normalizedPath = normalizeClangdWorkspaceFilePath(filePath);
	if (!clangdRuntime) return;
	const registered = workspaceFiles.register(normalizedPath);
	const lastSlash = registered.path.lastIndexOf('/');
	const directoryPath =
		lastSlash > 0 ? registered.path.slice(0, lastSlash) : CLANGD_WORKSPACE_PATH;
	try {
		clangdRuntime.FS.mkdirTree(directoryPath);
		clangdRuntime.FS.writeFile(registered.path, '');
	} catch (error) {
		if (registered.added) workspaceFiles.unregister(registered.path);
		throw error;
	}
};

self.addEventListener('message', async (event: MessageEvent<ClangdWorkerInboundMessage>) => {
	if (event.data?.type === 'sync-file') {
		try {
			if (typeof event.data.name !== 'string') {
				throw new TypeError('clangd sync-file name must be a string');
			}
			syncWorkspaceFile(event.data.name);
		} catch (error) {
			self.postMessage({
				type: 'error',
				message: `Failed to sync clangd workspace file: ${error instanceof Error ? error.message : String(error)}`
			});
		}
		return;
	}
	if (event.data?.type !== 'init') return;

	debugEnabled = !!event.data.debug;
	try {
		if (typeof event.data.baseUrl !== 'string' || !event.data.baseUrl.trim()) {
			throw new Error('clangd init requires an explicit baseUrl');
		}
		const baseUrl = normalizeClangdBaseUrl(event.data.baseUrl.trim()) + '/';
		debugLog('init', baseUrl);
		if (!event.data.assets) throw new Error('clangd init requires preloaded runtime assets');
		const jsBytes = new Uint8Array(event.data.assets.clangdJs);
		self.postMessage({ type: 'progress', stage: 'module-loading', value: 1, max: 3 });
		const jsSource = textDecoder.decode(jsBytes);
		const jsDataUrl = URL.createObjectURL(
			new Blob([jsSource], { type: 'text/javascript;charset=utf-8' })
		);

		const preparedModule = event.data.assets.clangdModule;
		let wasmBytes: Uint8Array | undefined;
		if (!preparedModule) {
			if (!event.data.assets.clangdWasmGz)
				throw new Error('clangd init requires Wasm bytes or a verified Module');
			const compressedWasmBytes = new Uint8Array(event.data.assets.clangdWasmGz);
			self.postMessage({ type: 'progress', stage: 'decompression', value: 2, max: 3 });
			wasmBytes = await decompressGzip(compressedWasmBytes, 'clangd.wasm.gz');
		}
		if (wasmBytes && event.data.assets.clangdWasmIntegrity) {
			await verifyRuntimeAssetIntegrity({
				asset: 'clangd.wasm.gz',
				bytes: wasmBytes,
				expected: event.data.assets.clangdWasmIntegrity,
				stage: 'uncompressed',
				mimeType: 'application/wasm',
				runtimeId: 'clangd'
			});
		}
		self.postMessage({ type: 'progress', stage: 'wasm-initialization', value: 3, max: 3 });
		let wasmDataUrl: string | undefined;
		if (wasmBytes) {
			const wasmBlob = new Blob([Uint8Array.from(wasmBytes).buffer], {
				type: 'application/wasm'
			});
			wasmDataUrl = URL.createObjectURL(wasmBlob);
		} else if (
			!(preparedModule instanceof WebAssembly.Module) ||
			!Number.isSafeInteger(event.data.assets.clangdWasmBytes) ||
			event.data.assets.clangdWasmBytes! <= 0 ||
			event.data.assets.clangdWasmBytes! > 128 * 1024 * 1024 ||
			!/^[a-f0-9]{64}$/.test(event.data.assets.clangdWasmSha256 || '')
		) {
			throw new Error('Invalid prepared clangd Module metadata');
		}

		const jsModule = import(/* @vite-ignore */ jsDataUrl);
		const { default: Clangd } = await jsModule;
		clangdRuntime = await Clangd({
			thisProgram: '/usr/bin/clangd',
			mainScriptUrlOrBlob: jsDataUrl,
			locateFile: (path: string, prefix: string) =>
				path.endsWith('.wasm') && wasmDataUrl ? wasmDataUrl : `${prefix}${path}`,
			...(preparedModule
				? {
						instantiateWasm: (
							imports: WebAssembly.Imports,
							receiveInstance: (
								instance: WebAssembly.Instance,
								module: WebAssembly.Module
							) => void
						) => {
							const instance = new WebAssembly.Instance(preparedModule, imports);
							// Supplying the Module is essential: Emscripten sends it to pthread workers.
							receiveInstance(instance, preparedModule);
							return instance.exports;
						}
					}
				: {}),
			stdinReady,
			stdin,
			stdout,
			stderr,
			onExit: onAbort,
			onAbort
		});

		clangdRuntime.FS.mkdirTree(CLANGD_WORKSPACE_PATH);
		writeGccCompatibilityHeaders(clangdRuntime.FS, '/usr');
		// Explicit asset roots can omit integrity metadata. Identify those builds
		// from the actual Wasm bytes before selecting the matching resource headers.
		const wasmDigest =
			event.data.assets.clangdWasmSha256 ||
			event.data.assets.clangdWasmIntegrity?.uncompressedSha256 ||
			Array.from(
				new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(wasmBytes!))),
				(byte) => byte.toString(16).padStart(2, '0')
			).join('');
		// These builds use the same pinned LLVM 22 sources. Other clangd builds
		// keep their own resource headers instead of receiving this overlay.
		const resourceDir = event.data.assets.clangdHeaders
			? mountClangdHeaders(clangdRuntime.FS, event.data.assets.clangdHeaders)
			: [
						'0d71e7a7f8e6dd369cb2a0b22cc4016d649f370e5b905adb6092536deb0ee019',
						'f2bef5c4b4aa8691f0b996286231c5778a17119c41537ae4108c7ff2795f7fc3'
				  ].includes(wasmDigest)
				? CLANG_RESOURCE_HEADER_DIRECTORY
				: undefined;
		if (resourceDir && !event.data.assets.clangdHeaders) {
			installClangResourceHeaders(
				{
					readFile: (path) =>
						clangdRuntime.FS.analyzePath(path).exists
							? clangdRuntime.FS.readFile(path)
							: null,
					mkdirTree: (path) => clangdRuntime.FS.mkdirTree(path),
					writeFile: (path, contents) => clangdRuntime.FS.writeFile(path, contents)
				},
				CLANG_RESOURCE_HEADER_PROVENANCE,
				resourceDir
			);
		}
		syncWorkspaceFile(CLANGD_CPP_FILE_PATH);
		clangdRuntime.FS.writeFile(
			`${CLANGD_WORKSPACE_PATH}/.clangd`,
			createClangdConfiguration({ ...event.data.compileProfile, resourceDir })
		);
		for (const [path, source] of Object.entries(event.data.assets.objectiveCHeaders || {})) {
			if (
				!path ||
				path.startsWith('/') ||
				path.split('/').some((part) => !part || part === '..' || part === '.') ||
				/[\\\x00-\x1f]/u.test(path) ||
				typeof source !== 'string'
			)
				throw new Error('Invalid Objective-C header path or contents');
			const target = `/objc/${path}`;
			clangdRuntime.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
			clangdRuntime.FS.writeFile(target, source);
		}
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
			stdinQueue.push(textEncoder.encode(`Content-Length: ${bodyByteLength}\r\n\r\n${body}`));
			debugLog('stdin queued bytes', bodyByteLength);
		});
		self.postMessage({
			type: 'ready',
			value: wasmBytes?.byteLength ?? event.data.assets.clangdWasmBytes!
		});
	} catch (error) {
		self.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		});
	}
});
