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

export interface CobolLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	onStatus?: (status: LanguageServerStatus) => void;
}

export async function getCobolLanguageServer(
	options?: EditorLanguageServerOptions | CobolLanguageServerOptions
): Promise<EditorLanguageServerHandle> {
	const config =
		typeof options === 'object' ? (options as CobolLanguageServerOptions) : undefined;
	const currentUrl = config?.currentUrl || globalThis.location?.href;
	const rootUrl = typeof options === 'string' ? options : config?.rootUrl;
	if (!config?.cobol?.baseUrl && !rootUrl)
		throw new Error('COBOL LSP requires cobol.baseUrl or rootUrl');
	const root = new URL(config?.cobol?.baseUrl || rootUrl!, currentUrl);
	if (!root.pathname.endsWith('/')) root.pathname += '/';
	const base = config?.cobol?.baseUrl ? root : new URL('wasm-cobol-lsp/', root);
	if (
		!['http:', 'https:'].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.hash ||
		base.search
	)
		throw new Error('COBOL LSP requires a plain HTTP(S) asset root');
	if (typeof SharedArrayBuffer !== 'function')
		throw new Error('COBOL LSP requires cross-origin isolation and SharedArrayBuffer');
	const supplied = config?.cobol?.workspaceFiles || [];
	if (supplied.length > 1000) throw new Error('COBOL LSP workspace exceeds 1000 files');
	let workspaceBytes = 0;
	const workspaceFiles = supplied.map((file) => {
		if (
			typeof file.path !== 'string' ||
			file.path.startsWith('/') ||
			file.path.includes('\\') ||
			file.path.includes('\0') ||
			file.path.split('/').some((part) => !part || part === '.' || part === '..') ||
			typeof file.content !== 'string'
		)
			throw new Error('Invalid COBOL LSP workspace file');
		workspaceBytes += new TextEncoder().encode(file.content).byteLength;
		if (workspaceBytes > 16 * 1024 * 1024)
			throw new Error('COBOL LSP workspace exceeds 16 MiB');
		return { path: file.path, content: file.content };
	});
	const descriptor = createSharedByteQueue(64 * 1024);
	const stdin = new SharedByteQueue(descriptor);
	const stdout = new Emitter<Uint8Array>();
	const errors = new Emitter<Error>();
	const closed = new Emitter<void>();
	let reader: ReadableStreamMessageReader | undefined;
	let writer: WriteableStreamMessageWriter | undefined;
	const controller = new AbortController();
	const status = createLanguageServerProgressReporter(config?.onStatus);
	status.loading('cobol-lsp-startup');
	let worker: Worker | undefined;
	let disposed = false;
	let ready = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		controller.abort();
		stdin.close();
		worker?.terminate();
		closed.fire();
		reader?.dispose();
		writer?.dispose();
		stdout.dispose();
		errors.dispose();
		closed.dispose();
		status.disabled();
	};
	try {
		await waitForLanguageServerStartup(
			() =>
				new Promise<void>((resolve, reject) => {
					worker =
						config?.createWorker?.() ||
						new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
					const failed = (error: Error) => {
						errors.fire(error);
						status.error(error.message);
						reject(error);
					};
					worker.addEventListener('message', ({ data }: MessageEvent) => {
						if (disposed) return;
						if (data?.type === 'ready') {
							ready = true;
							resolve();
						} else if (data?.type === 'stdout') stdout.fire(data.bytes);
						else if (data?.type === 'progress') status.progress(data);
						else if (data?.type === 'error')
							failed(
								Object.assign(
									new Error(data.message),
									data.stack ? { stack: data.stack } : {}
								)
							);
						else if (data?.type === 'exit') {
							if (!ready)
								failed(new Error(`COBOL LSP exited before startup (${data.code})`));
							closed.fire();
						}
					});
					worker.addEventListener('error', (event) =>
						failed(event.error || new Error(event.message))
					);
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
		reader = new ReadableStreamMessageReader({
			onData: stdout.event,
			onError: errors.event,
			onEnd: closed.event,
			onClose: closed.event
		});
		writer = new WriteableStreamMessageWriter({
			onError: errors.event,
			onEnd: closed.event,
			onClose: closed.event,
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
		dispose();
		status.error(error instanceof Error ? error.message : String(error));
		throw error;
	}
}
