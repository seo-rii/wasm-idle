import { SharedByteQueue, createSharedByteQueue } from '@wasm-idle/llvm-core/debug';
import { Emitter, ReadableStreamMessageReader, WriteableStreamMessageWriter } from '../jsonrpc.js';
import { waitForLanguageServerStartup } from '../lifecycle.js';
import {
	createLanguageServerProgressReporter,
	type LanguageServerStatus
} from '../worker-client.js';
import type {
	EditorLanguageServerHandle,
	EditorLanguageServerOptions,
	EditorLanguageServerRuntimeOptions
} from '../types.js';

export interface GrainLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

export async function getGrainLanguageServer(
	options?: EditorLanguageServerOptions | GrainLanguageServerOptions
): Promise<EditorLanguageServerHandle> {
	const config =
		typeof options === 'object' ? (options as GrainLanguageServerOptions) : undefined;
	const currentUrl = config?.currentUrl || globalThis.location?.href;
	const rootUrl = typeof options === 'string' ? options : config?.rootUrl;
	if (!config?.grain?.baseUrl && !rootUrl)
		throw new Error('Grain LSP requires grain.baseUrl or rootUrl');
	const root = new URL(config?.grain?.baseUrl || rootUrl!, currentUrl);
	if (!root.pathname.endsWith('/')) root.pathname += '/';
	const base = config?.grain?.baseUrl ? root : new URL('wasm-grain-lsp/', root);
	if (
		!['http:', 'https:'].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.hash ||
		base.search
	)
		throw new Error('Grain LSP requires a plain HTTP(S) asset root');
	if (typeof SharedArrayBuffer !== 'function')
		throw new Error('Grain LSP requires cross-origin isolation and SharedArrayBuffer');
	const suppliedFiles = config?.grain?.workspaceFiles || [];
	if (suppliedFiles.length > 1000) throw new Error('Grain LSP workspace exceeds 1000 files');
	let workspaceBytes = 0;
	const workspaceFiles = suppliedFiles.map((file) => {
		if (
			typeof file.path !== 'string' ||
			file.path.startsWith('/') ||
			file.path.includes('\\') ||
			file.path.includes('\0') ||
			file.path.split('/').some((part) => !part || part === '.' || part === '..') ||
			typeof file.content !== 'string'
		)
			throw new Error('Invalid Grain LSP workspace file');
		workspaceBytes += new TextEncoder().encode(file.content).byteLength;
		if (workspaceBytes > 16 * 1024 * 1024)
			throw new Error('Grain LSP workspace exceeds 16 MiB');
		return { path: file.path, content: file.content };
	});
	const descriptor = createSharedByteQueue(64 * 1024);
	const stdin = new SharedByteQueue(descriptor);
	const stdout = new Emitter<Uint8Array>();
	const errors = new Emitter<Error>();
	const close = new Emitter<void>();
	const controller = new AbortController();
	let reader: InstanceType<typeof ReadableStreamMessageReader> | undefined;
	let writer: InstanceType<typeof WriteableStreamMessageWriter> | undefined;
	const status = createLanguageServerProgressReporter(config?.onStatus);
	status.loading('grain-lsp-startup');
	let worker: Worker | undefined;
	let disposed = false;
	let terminalError: Error | undefined;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		controller.abort();
		stdin.close();
		worker?.terminate();
		close.fire();
		reader?.dispose();
		writer?.dispose();
		stdout.dispose();
		errors.dispose();
		close.dispose();
		status.disabled();
	};
	const fail = (error: Error) => {
		if (disposed) return;
		terminalError = error;
		errors.fire(error);
		dispose();
		status.error(error.message);
	};
	try {
		await waitForLanguageServerStartup(
			() =>
				new Promise<void>((resolve, reject) => {
					worker =
						config?.createWorker?.() ||
						new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
					worker.addEventListener('message', ({ data }: MessageEvent) => {
						if (disposed) return;
						if (data?.type === 'ready') resolve();
						else if (data?.type === 'stdout') stdout.fire(data.bytes);
						else if (data?.type === 'progress') status.progress(data);
						else if (data?.type === 'error') {
							const error = new Error(data.message);
							reject(error);
							fail(error);
						} else if (data?.type === 'exit') {
							if (reader) dispose();
							else {
								const error = new Error('Grain LSP exited before initialization');
								reject(error);
								fail(error);
							}
						}
					});
					worker.addEventListener('error', (event) => {
						if (disposed) return;
						const error =
							event.error instanceof Error ? event.error : new Error(event.message);
						reject(error);
						fail(error);
					});
					worker.postMessage({
						type: 'init',
						options: { baseUrl: base.href, stdin: descriptor, workspaceFiles },
						persistentAssets: {
							persistentCache: config?.persistentCache,
							assetRoot: rootUrl ? new URL(rootUrl, currentUrl).href : undefined
						}
					});
				}),
			{ signal: config?.signal, timeoutMs: config?.startupTimeoutMs }
		);
		if (disposed) throw terminalError || new Error('Grain LSP stopped during initialization');
		reader = new ReadableStreamMessageReader({
			onData: stdout.event,
			onError: errors.event,
			onEnd: close.event,
			onClose: close.event
		});
		writer = new WriteableStreamMessageWriter({
			onError: errors.event,
			onEnd: close.event,
			onClose: close.event,
			write: (data: string | Uint8Array) =>
				stdin.write(
					typeof data === 'string' ? new TextEncoder().encode(data) : data,
					controller.signal
				),
			end: () => stdin.close()
		});
		status.ready();
		return { transport: { reader, writer }, dispose };
	} catch (error) {
		if (!disposed) {
			dispose();
			status.error(error instanceof Error ? error.message : String(error));
		}
		throw error;
	}
}
