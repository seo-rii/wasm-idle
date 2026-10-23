import type { Message } from 'vscode-jsonrpc';
import { resolveExecutionLimits } from '@wasm-idle/core';
import { WASM_LEAN4_PROFILE as profile } from '../bundledLean4Runtime.js';
import { preflightLean4RuntimeAssets } from './assets.js';
import { adaptLean4Glue } from './platform.js';
import { LeanStdin, LspFrameDecoder } from './stdio.js';

type Rpc = Message & {
	id?: string | number;
	method?: string;
	params?: any;
	result?: any;
	error?: unknown;
};
type Document = { uri: string; languageId: string; version: number; text: string };
type Process = { ready: Promise<void>; send: (m: Rpc) => void; dispose: () => void };

const scope = globalThis as unknown as {
	onmessage: (event: MessageEvent) => void;
	postMessage: (message: unknown) => void;
	crossOriginIsolated: boolean;
};
const send = (message: Rpc) => scope.postMessage(message);
type RemoteWorker = {
	onmessage?: (event: { data: any }) => void;
	onerror?: (event: { message: string; preventDefault: () => void }) => void;
	postMessage: (data: unknown) => void;
	terminate: () => void;
};
let nextWorkerId = 0;
const ownedWorkers = new Map<number, RemoteWorker>();
function createProcessWorker(url: string, pthread = false): RemoteWorker {
	const id = ++nextWorkerId;
	const process: RemoteWorker = {
		postMessage: (data) => scope.postMessage({ leanWorker: { type: 'post', id, data } }),
		terminate() {
			ownedWorkers.delete(id);
			scope.postMessage({ leanWorker: { type: 'terminate', id } });
		}
	};
	ownedWorkers.set(id, process);
	scope.postMessage({ leanWorker: { type: 'create', id, url, pthread } });
	return process;
}
const error = (id: string | number, code: number, message: string) =>
	send({ jsonrpc: '2.0', id, error: { code, message } });
const unsupported = new Set([
	'workspace/symbol',
	'textDocument/references',
	'textDocument/rename',
	'textDocument/prepareRename',
	'textDocument/prepareCallHierarchy',
	'callHierarchy/incomingCalls',
	'callHierarchy/outgoingCalls',
	'$/lean/prepareModuleHierarchy',
	'$/lean/moduleHierarchy/imports',
	'$/lean/moduleHierarchy/importedBy'
]);
const hex = (data: ArrayBuffer) =>
	[...new Uint8Array(data)].map((v) => v.toString(16).padStart(2, '0')).join('');

let library: Record<string, Uint8Array>;
let wasmModule: WebAssembly.Module;
let glueText = '';
let maxMemoryBytes = 1024 ** 3;
let processStartupTimeoutMs = 120000;
let initialized = false;
let bootstrap: Process | undefined;
let fileProcess: Process | undefined;
let initializeParams: any;
let initializeId: string | number | undefined;
let active: Document | undefined;
let generation = 0;
const pending = new Set<string | number>();
const early: Rpc[] = [];
const serverRequests = new Map<string, string | number>();
let nextServerId = 0;

function cancelPending(message: string) {
	if (!initialized && initializeId !== undefined) {
		error(initializeId, -32603, message);
		initializeId = undefined;
	}
	for (const id of pending) error(id, -32801, message);
	pending.clear();
}

function startProcess(
	args: string[],
	pool: number,
	output: (message: Rpc) => void,
	exit: (code: number) => void
): Process {
	const stdin = new LeanStdin();
	const frames = new LspFrameDecoder();
	const worker = createProcessWorker(new URL('./runtime-worker.js', import.meta.url).href);
	const glueUrl = URL.createObjectURL(
		new Blob([adaptLean4Glue(glueText, pool)], { type: 'text/javascript' })
	);
	let disposed = false;
	const pthreads = new Map<number, RemoteWorker>();
	let startupTimer: ReturnType<typeof setTimeout>;
	let resolve!: () => void;
	let reject!: (reason: Error) => void;
	const ready = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	const fail = (message: string) => {
		if (disposed) return;
		reject(new Error(message));
		cancelPending(message);
		scope.postMessage({ type: 'error', message });
		process.dispose();
	};
	worker.onmessage = ({ data }) => {
		if (disposed) return;
		try {
			if (data.thread) {
				const thread = data.thread;
				if (thread.type === 'create') {
					if (thread.url !== glueUrl || pthreads.size >= pool || pthreads.has(thread.id))
						throw new Error('Unexpected Lean pthread allocation.');
					const pthread = createProcessWorker(glueUrl, true);
					pthreads.set(thread.id, pthread);
					pthread.onmessage = ({ data }) =>
						worker.postMessage({ threadEvent: { id: thread.id, data } });
					// The process owner may be inside callMain, so its JS message loop cannot
					// report a crashed pthread. Fail through this idle supervisor instead.
					pthread.onerror = ({ message }) => fail(`Lean pthread failed: ${message}`);
				} else if (thread.type === 'post')
					pthreads.get(thread.id)?.postMessage(thread.data);
				else if (thread.type === 'terminate') {
					pthreads.get(thread.id)?.terminate();
					pthreads.delete(thread.id);
				}
			} else if (data.ready) {
				clearTimeout(startupTimer);
				resolve();
			} else if (data.stdout)
				for (const message of frames.push(data.stdout)) output(message as Rpc);
			else if (data.error) fail(data.error);
			else if (typeof data.exit === 'number') exit(data.exit);
			else if (data.stderr) console.warn('Lean 4:', String(data.stderr).slice(0, 4096));
		} catch (cause) {
			fail(String(cause));
		}
	};
	worker.onerror = (event) => {
		event.preventDefault();
		fail(event.message || 'Lean process worker failed.');
	};
	const process = {
		ready,
		send: (message: Rpc) => {
			if (!disposed) stdin.write(message);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			clearTimeout(startupTimer);
			reject(new DOMException('Lean process was disposed.', 'AbortError'));
			stdin.close();
			for (const pthread of pthreads.values()) pthread.terminate();
			pthreads.clear();
			worker.terminate();
			URL.revokeObjectURL(glueUrl);
		}
	};
	startupTimer = setTimeout(
		() => fail('Lean document process startup timed out.'),
		processStartupTimeoutMs
	);
	worker.postMessage({
		args,
		stdin: stdin.descriptor,
		library,
		wasmModule,
		glueUrl,
		maxMemoryBytes
	});
	return process;
}

function fileOutput(message: Rpc) {
	if (message.method && message.id !== undefined) {
		// Client and server request IDs are independent. Prefix server IDs across process restarts.
		const id = `lean-browser:${++nextServerId}`;
		serverRequests.set(id, message.id);
		send({ ...message, id });
	} else {
		if (!message.method && message.id !== undefined) pending.delete(message.id);
		send(message);
	}
}

async function openDocument(document: Document) {
	if (!initializeParams)
		throw new Error('Lean LSP must be initialized before opening a document.');
	const uri = new URL(document.uri);
	if (
		uri.protocol !== 'file:' ||
		uri.host ||
		!uri.pathname.endsWith('.lean') ||
		typeof document.text !== 'string' ||
		document.text.length > 8 * 1024 ** 2
	)
		throw new Error('Lean LSP requires a local .lean document of at most 8 MiB.');
	cancelPending('Lean document process was replaced.');
	fileProcess?.dispose();
	serverRequests.clear();
	active = { ...document };
	const token = ++generation;
	const process = startProcess(
		['-j4', '--worker', document.uri],
		64,
		(message) => {
			if (token === generation) fileOutput(message);
		},
		(code) => {
			if (token !== generation) return;
			process.dispose();
			fileProcess = undefined;
			if (code === 2 && active) {
				// The original FileWorker requests this restart when imports/header state changes.
				void openDocument(active).catch(fail);
			} else cancelPending(`Lean document process exited with code ${code}.`);
		}
	);
	fileProcess = process;
	try {
		await process.ready;
	} catch (cause) {
		// A newer didOpen may replace an import-triggered restart while it is still loading.
		// Its intentional disposal must not turn into a fatal error for the new document.
		if (token !== generation) return;
		throw cause;
	}
	if (token !== generation) return;
	process.send({
		jsonrpc: '2.0',
		id: 'lean-browser:init',
		method: 'initialize',
		params: initializeParams
	});
	process.send({
		jsonrpc: '2.0',
		method: 'textDocument/didOpen',
		params: { textDocument: active }
	});
	for (const message of early.splice(0)) forward(message);
}

function canonicalDocumentUri(message: Rpc): Rpc {
	// Monaco's URI identity service may lower-case a request URI while didOpen retains
	// the model's case. FileWorker must consistently receive the original open URI,
	// including requests queued before didOpen.
	const uri = message.params?.textDocument?.uri;
	return message.method !== 'textDocument/didOpen' &&
		active &&
		typeof uri === 'string' &&
		uri.toLowerCase() === active.uri.toLowerCase()
		? {
				...message,
				params: {
					...message.params,
					textDocument: { ...message.params.textDocument, uri: active.uri }
				}
			}
		: message;
}

function forward(message: Rpc) {
	message = canonicalDocumentUri(message);
	if (message.id !== undefined && !message.method) {
		const id = serverRequests.get(String(message.id));
		if (id !== undefined) {
			serverRequests.delete(String(message.id));
			fileProcess?.send({ ...message, id });
		}
		return;
	}
	if (message.id !== undefined && unsupported.has(message.method || '')) {
		error(message.id, -32601, 'This operation requires the native Lean project watchdog.');
		return;
	}
	if (!fileProcess) {
		if (early.length >= 128) throw new Error('Too many Lean requests before didOpen.');
		early.push(message);
		return;
	}
	if (message.params?.textDocument?.uri && message.params.textDocument.uri !== active?.uri) {
		if (message.id !== undefined)
			error(message.id, -32801, 'Lean LSP has a different active document.');
		return;
	}
	if (message.id !== undefined) pending.add(message.id);
	fileProcess.send(message);
}

async function handle(message: Rpc) {
	message = canonicalDocumentUri(message);
	switch (message.method) {
		case 'initialize':
			if (!bootstrap || initializeParams) throw new Error('Lean LSP is already initialized.');
			initializeParams = message.params;
			initializeId = message.id;
			bootstrap.send(message);
			return;
		case 'initialized':
			return;
		case 'textDocument/didOpen':
			await openDocument(message.params.textDocument);
			return;
		case 'textDocument/didClose':
			if (message.params?.textDocument?.uri === active?.uri) {
				generation++;
				fileProcess?.dispose();
				fileProcess = undefined;
				active = undefined;
				cancelPending('Lean document was closed.');
				serverRequests.clear();
			}
			return;
		case 'textDocument/didChange': {
			if (!active || message.params?.textDocument?.uri !== active.uri) return;
			// Keep the current buffer for original FileWorker-requested restarts. Incremental edits
			// remain untouched on the wire and are interpreted by the original Lean handler.
			for (const change of message.params.contentChanges) {
				if (!change.range) active.text = change.text;
				else {
					const offset = (position: { line: number; character: number }) => {
						let p = 0;
						for (let i = 0; i < position.line; i++) {
							const end = active!.text.indexOf('\n', p);
							p = end < 0 ? active!.text.length : end + 1;
						}
						return p + position.character;
					};
					active.text =
						active.text.slice(0, offset(change.range.start)) +
						change.text +
						active.text.slice(offset(change.range.end));
				}
			}
			active.version = message.params.textDocument.version;
			forward(message);
			return;
		}
		case 'shutdown':
			generation++;
			fileProcess?.dispose();
			bootstrap?.dispose();
			fileProcess = bootstrap = undefined;
			cancelPending('Lean LSP shut down.');
			if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: null });
			return;
		case 'exit':
			return;
		default:
			forward(message);
	}
}

function fail(cause: unknown) {
	const message = cause instanceof Error ? cause.message : String(cause);
	cancelPending(message);
	bootstrap?.dispose();
	fileProcess?.dispose();
	scope.postMessage({ type: 'error', message });
}

async function init(data: any) {
	if (!scope.crossOriginIsolated || typeof SharedArrayBuffer !== 'function')
		throw new Error('Lean LSP requires cross-origin isolation and SharedArrayBuffer.');
	maxMemoryBytes = data.options.maxMemoryBytes;
	processStartupTimeoutMs = data.options.processStartupTimeoutMs ?? 120000;
	const limits = resolveExecutionLimits({
		maxWasmMemoryBytes: maxMemoryBytes,
		assetTimeoutMs: data.options.assetTimeoutMs ?? 120000,
		maxAssetBytes: data.options.maxAssetBytes ?? 128 * 1024 ** 2
	});
	const payload = await preflightLean4RuntimeAssets(data.options.baseUrl, {
		limits,
		persistentCache: data.persistentAssets?.persistentCache,
		reportProgress: (loaded, stage) =>
			scope.postMessage({ type: 'progress', stage, loaded, total: 1 })
	});
	library = {};
	for (const [name, receipt] of Object.entries(profile.assets)) {
		const delivered = (payload as Record<string, unknown>)[name] as Uint8Array;
		let bytes = delivered;
		if ('encoding' in receipt && receipt.encoding === 'gzip') {
			const stream = new Blob([new Uint8Array(delivered)])
				.stream()
				.pipeThrough(new DecompressionStream('gzip'));
			const reader = stream.getReader();
			bytes = new Uint8Array(receipt.uncompressed.bytes);
			let offset = 0;
			while (true) {
				const part = await reader.read();
				if (part.done) break;
				if (offset + part.value.length > bytes.length) {
					await reader.cancel();
					throw new Error(`Lean ${name} inflated beyond its receipt.`);
				}
				bytes.set(part.value, offset);
				offset += part.value.length;
			}
			if (
				offset !== bytes.length ||
				hex(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))) !==
					receipt.uncompressed.sha256
			)
				throw new Error(`Lean ${name} decoded receipt mismatch.`);
		}
		const logicalName = 'logicalName' in receipt ? receipt.logicalName : name;
		if (logicalName === 'lean.wasm')
			wasmModule = await WebAssembly.compile(new Uint8Array(bytes));
		else if (name === 'lean.mjs') glueText = new TextDecoder().decode(bytes);
		else if (name === 'lean-init.index.json' || logicalName.endsWith('.pack')) {
			const shared = new Uint8Array(new SharedArrayBuffer(bytes.length));
			shared.set(bytes);
			library[logicalName] = shared;
		}
	}
	bootstrap = startProcess(
		['-j2', '--server'],
		8,
		(message) => {
			if (!message.method && message.id === initializeId && message.result) {
				// These capabilities belong to the native project watchdog, not the FileWorker.
				const capabilities = { ...message.result.capabilities };
				for (const key of [
					'referencesProvider',
					'renameProvider',
					'callHierarchyProvider',
					'workspaceSymbolProvider'
				])
					delete capabilities[key];
				delete capabilities.experimental;
				initialized = true;
				send({ ...message, result: { ...message.result, capabilities } });
				bootstrap?.dispose();
				bootstrap = undefined;
			} else send(message);
		},
		(code) => fail(`Lean initialization process exited with code ${code}.`)
	);
	await bootstrap.ready;
	scope.postMessage({ type: 'ready' });
}

// Preserve message ordering while a document process is being prepared.
let queued = Promise.resolve();
scope.onmessage = ({ data }) => {
	if (data?.type === 'lean-worker-event') {
		const worker = ownedWorkers.get(data.id);
		if (data.error) worker?.onerror?.({ message: data.error, preventDefault() {} });
		else worker?.onmessage?.({ data: data.data });
		return;
	}
	queued = queued
		.then(() => (data?.type === 'init' ? init(data) : handle(data as Rpc)))
		.catch((cause) => {
			if (data?.id !== undefined) error(data.id, -32603, String(cause));
			fail(cause);
		});
};
