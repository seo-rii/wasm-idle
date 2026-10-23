import {
	Emitter,
	type Message,
	type MessageReader,
	type MessageWriter,
	type PartialMessageInfo
} from 'vscode-jsonrpc';
import { fetchBoundedExternalAsset } from '../external-asset.js';
import { waitForLanguageServerStartup } from '../lifecycle.js';
import type {
	EditorLanguageServerHandle,
	EditorLanguageServerOptions,
	EditorLanguageServerRuntimeOptions
} from '../types.js';
import {
	createLanguageServerProgressReporter,
	type LanguageServerStatus
} from '../worker-client.js';
import {
	JAVA_LANGUAGE_SERVER_ASSETS,
	JAVA_LANGUAGE_SERVER_PROFILE,
	type JavaLanguageServerAsset
} from './assets.js';

export interface JavaLanguageServerOptions extends EditorLanguageServerRuntimeOptions {
	java?: {
		/** Prepared static host.html and JARs; defaults to rootUrl/java-lsp/. */
		baseUrl?: string;
		hostUrl?: string;
		/** Exact file URI → source snapshot, mirrored before server initialize. */
		initialFiles?: Readonly<Record<string, string>>;
		assets?: readonly JavaLanguageServerAsset[];
		/** CheerpJ commercial deployments can supply their runtime license key. */
		licenseKey?: string;
	};
	onStatus?: (status: LanguageServerStatus) => void;
}

export async function getJavaLanguageServer(
	options?: EditorLanguageServerOptions | JavaLanguageServerOptions
): Promise<EditorLanguageServerHandle> {
	const initialSignal = typeof options === 'object' ? options.signal : undefined;
	if (initialSignal?.aborted) throw initialSignal.reason;
	if (typeof document === 'undefined' || typeof MessageChannel === 'undefined')
		throw new Error('Java LSP requires a browser document and MessageChannel');
	if (!('credentialless' in HTMLIFrameElement.prototype))
		throw new Error('Java LSP requires credentialless iframe support (Chromium)');
	const settings = typeof options === 'object' ? (options as JavaLanguageServerOptions) : {};
	const currentUrl = settings.currentUrl || globalThis.location.href;
	const root = new URL(
		typeof options === 'string' ? options : settings.rootUrl || './',
		currentUrl
	);
	const base = new URL(settings.java?.baseUrl || 'java-lsp/', root);
	const hostUrl = new URL(settings.java?.hostUrl || 'host.html', base);
	for (const url of [base, hostUrl])
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
			throw new Error(
				'Java LSP asset/host URLs must be HTTP(S) without credentials or fragments'
			);
	if (!base.pathname.endsWith('/')) throw new Error('Java LSP baseUrl must end with /');
	const initialFiles = { ...(settings.java?.initialFiles || {}) };
	const canonicalUris = new Map<string, string>();
	let initialBytes = 0;
	for (const [value, text] of Object.entries(initialFiles)) {
		const uri = new URL(value);
		if (
			uri.protocol !== 'file:' ||
			uri.hostname ||
			uri.search ||
			uri.hash ||
			typeof text !== 'string'
		)
			throw new Error('Java initial files require local file URIs and text');
		const previous = canonicalUris.get(uri.href.toLowerCase());
		if (previous && previous !== uri.href)
			throw new Error('Ambiguous case in Java initial file URIs');
		canonicalUris.set(uri.href.toLowerCase(), uri.href);
		initialBytes += new TextEncoder().encode(text).byteLength;
	}
	if (initialBytes > 16 * 1024 * 1024) throw new Error('Java initial workspace exceeds 16 MiB');
	const assets = (settings.java?.assets || JAVA_LANGUAGE_SERVER_ASSETS).map((asset) => ({
		...asset
	}));
	if (assets.length !== 5 || new Set(assets.map((asset) => asset.path)).size !== assets.length)
		throw new Error('Java LSP requires the five pinned original JAR assets');
	const expected = new Set(JAVA_LANGUAGE_SERVER_ASSETS.map((asset) => asset.path));
	for (const asset of assets)
		if (
			!expected.has(asset.path) ||
			!/^[a-f0-9]{64}$/.test(asset.sha256) ||
			!Number.isSafeInteger(asset.bytes) ||
			asset.bytes <= 0
		)
			throw new Error('Invalid Java LSP asset receipt');
	const maxBytes = settings.maxAssetBytes ?? 32 * 1024 * 1024;
	if (assets.reduce((sum, asset) => sum + asset.bytes, 0) > maxBytes)
		throw new Error('Java LSP assets exceed maxAssetBytes');
	const status = createLanguageServerProgressReporter(settings.onStatus);
	status.loading('java-assets');
	const cancellation = new AbortController();
	const channel = new MessageChannel();
	const frame = document.createElement('iframe');
	frame.hidden = true;
	frame.title = 'Java language server';
	frame.setAttribute('aria-hidden', 'true');
	frame.dataset.wasmIdleJavaLspHost = 'true';
	const readErrors = new Emitter<Error>();
	const writeErrors = new Emitter<[Error, Message | undefined, number | undefined]>();
	const closed = new Emitter<void>();
	const partial = new Emitter<PartialMessageInfo>();
	let stopped = false;
	let listener: ((message: Message) => void) | undefined;
	const buffered: Message[] = [];
	let failStartup = (_error: Error) => {};
	let readyStartup = () => {};
	const stop = () => {
		if (stopped) return;
		stopped = true;
		cancellation.abort(new Error('Java language server disposed'));
		failStartup(new Error('Java language server disposed'));
		settings.signal?.removeEventListener('abort', abort);
		channel.port1.close();
		channel.port2.close();
		frame.remove();
		listener = undefined;
		buffered.length = 0;
		closed.fire();
	};
	const abort = () => stop();
	settings.signal?.addEventListener('abort', abort, { once: true });
	channel.port1.onmessage = (event: MessageEvent) => {
		if (stopped) return;
		const data = event.data;
		if (data?.jsonrpc === '2.0') {
			if (listener) listener(data);
			else if (buffered.length < 256) buffered.push(data);
			else {
				const error = new Error('Java LSP startup message queue exceeded its limit');
				readErrors.fire(error);
				failStartup(error);
				stop();
			}
		} else if (data?.type === 'ready') readyStartup();
		else if (data?.type === 'progress')
			status.progress({ stage: String(data.stage || 'java') });
		else if (data?.type === 'error') {
			const error = new Error(String(data.message || 'Java JVM host failed'));
			status.error(error.message);
			readErrors.fire(error);
			failStartup(error);
			stop();
		}
	};
	channel.port1.start();
	try {
		await waitForLanguageServerStartup(
			async () => {
				const payload: Array<{ path: string; bytes: Uint8Array<ArrayBuffer> }> = [];
				for (const asset of assets) {
					const url = new URL(asset.path, base);
					url.searchParams.set('v', asset.sha256);
					const bytes = await fetchBoundedExternalAsset({
						url,
						label: `Java LSP ${asset.path}`,
						integrity: asset,
						maxBytes: asset.bytes,
						signal: cancellation.signal,
						persistentCache: settings.persistentCache,
						runtimeId: 'java-lsp',
						profileId: JAVA_LANGUAGE_SERVER_PROFILE,
						reportProgress: (loaded, total) =>
							status.progress({ stage: asset.path, loaded, total })
					});
					payload.push({ path: asset.path, bytes });
				}
				await new Promise<void>((resolve, reject) => {
					readyStartup = resolve;
					failStartup = reject;
					if (stopped || settings.signal?.aborted) {
						reject(new Error('Java LSP startup aborted'));
						return;
					}
					frame.onload = () => {
						frame.contentWindow?.postMessage(
							{ type: 'wasm-idle-java-lsp-connect' },
							hostUrl.origin,
							[channel.port2]
						);
						channel.port1.postMessage(
							{
								type: 'start',
								assets: payload,
								initialFiles,
								licenseKey: settings.java?.licenseKey
							},
							payload.map((asset) => asset.bytes.buffer)
						);
					};
					frame.onerror = () => reject(new Error('Cannot load the Java JVM host'));
					frame.src = hostUrl.href;
					document.body.append(frame);
				});
			},
			{ signal: settings.signal, timeoutMs: settings.startupTimeoutMs ?? 180000 }
		);
		status.ready();
	} catch (error) {
		stop();
		status.error(error instanceof Error ? error.message : String(error));
		throw error;
	}
	const reader: MessageReader = {
		onError: readErrors.event,
		onClose: closed.event,
		onPartialMessage: partial.event,
		listen(callback) {
			listener = callback;
			for (const message of buffered.splice(0)) callback(message);
			return {
				dispose() {
					if (listener === callback) listener = undefined;
				}
			};
		},
		dispose: stop
	};
	const writer: MessageWriter = {
		onError: writeErrors.event,
		onClose: closed.event,
		async write(message) {
			if (stopped) throw new Error('Java LSP transport is closed');
			try {
				channel.port1.postMessage(message);
			} catch (cause) {
				const error = cause instanceof Error ? cause : new Error(String(cause));
				writeErrors.fire([error, message, undefined]);
				throw error;
			}
		},
		end: stop,
		dispose: stop
	};
	return { transport: { reader, writer }, dispose: stop };
}
