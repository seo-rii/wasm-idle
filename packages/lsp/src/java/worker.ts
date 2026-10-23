import { fetchBoundedExternalAsset } from '../external-asset.js';
import {
	configureWorkerLanguageToolPersistentAssets,
	type LanguageToolPersistentOptions
} from '../persistent-assets.js';
import { runWithSignalAndTimeout } from '../lifecycle.js';
import { snapshotJavaLanguageServerAssets, type JavaLanguageServerAsset } from './assets.js';
import { formatJavaDocHtml } from './markdown.js';

interface JavaSession {
	dispatch(json: string): void;
	dispose(): void;
}

interface TeaVmModule {
	load(
		wasm: Uint8Array<ArrayBuffer>,
		options?: Record<string, unknown>
	): Promise<{
		exports: {
			createSession(
				rootUri: string,
				filesJson: string,
				sdk: Int8Array<ArrayBuffer>,
				output: (json: string) => void,
				formatHtml: (html: string) => string
			): JavaSession;
		};
	}>;
}

interface JavaWorkerOptions {
	baseUrl: string;
	assets: readonly JavaLanguageServerAsset[];
	files: Record<string, string>;
	canonicalUris: Record<string, string>;
	maxAssetBytes?: number;
	assetTimeoutMs?: number;
}

const scope = globalThis as unknown as {
	addEventListener(type: 'message', handler: (event: MessageEvent) => void): void;
	postMessage(message: unknown): void;
};
let initialized = false;
let session: JavaSession | undefined;
let canonicalUris: Record<string, string> = Object.create(null);

function canonicalize(value: unknown, key = ''): unknown {
	if (
		typeof value === 'string' &&
		['uri', 'rootUri', 'targetUri', 'oldUri', 'newUri'].includes(key)
	) {
		const uri = value.startsWith('file:') ? new URL(value).href : value;
		return canonicalUris[uri.toLowerCase()] || uri;
	}
	if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([name, entry]) => [name, canonicalize(entry, name)])
		);
	}
	return value;
}

async function initialize(
	options: JavaWorkerOptions,
	persistentAssets: LanguageToolPersistentOptions
) {
	configureWorkerLanguageToolPersistentAssets(persistentAssets);
	canonicalUris = options.canonicalUris;
	const assets = snapshotJavaLanguageServerAssets(options.assets);
	const bytes = new Map<string, Uint8Array<ArrayBuffer>>();
	await runWithSignalAndTimeout(
		async (signal) => {
			await Promise.all(
				assets.map(async (asset) => {
					const url = new URL(asset.path, options.baseUrl);
					url.searchParams.set('v', asset.sha256);
					bytes.set(
						asset.path,
						await fetchBoundedExternalAsset({
							url,
							label: `Java LSP ${asset.path}`,
							integrity: asset,
							maxBytes: options.maxAssetBytes,
							signal,
							runtimeId: 'java-lsp',
							profileId: 'javacs-teavm',
							reportProgress: (loaded, total) =>
								scope.postMessage({
									type: 'progress',
									stage: asset.path,
									loaded,
									total
								})
						})
					);
				})
			);
		},
		{
			timeoutMs: options.assetTimeoutMs ?? 120_000,
			operationName: 'Java LSP asset loading',
			timeoutError: () => new Error('Java LSP asset loading timed out')
		}
	);
	const moduleUrl = URL.createObjectURL(
		new Blob([bytes.get('javacs-runtime.mjs')!], { type: 'text/javascript' })
	);
	try {
		scope.postMessage({ type: 'progress', stage: 'instantiate-javacs' });
		const runtime = (await import(/* @vite-ignore */ moduleUrl)) as TeaVmModule;
		const instance = await runtime.load(bytes.get('javacs.wasm')!, {
			stackDeobfuscator: { enabled: false },
			noAutoImports: true
		});
		session = instance.exports.createSession(
			'file:///workspace',
			JSON.stringify(options.files),
			new Int8Array(bytes.get('jdk-platform.zip')!.buffer),
			(json) => {
				const message: unknown = JSON.parse(json);
				if (
					!message ||
					typeof message !== 'object' ||
					(message as { jsonrpc?: unknown }).jsonrpc !== '2.0'
				)
					throw new Error('Invalid upstream javacs JSON-RPC message');
				scope.postMessage(message);
			},
			formatJavaDocHtml
		);
	} finally {
		URL.revokeObjectURL(moduleUrl);
	}
	scope.postMessage({ type: 'ready' });
}

scope.addEventListener('message', (event) => {
	const message = event.data;
	if (message?.type === 'init') {
		if (initialized) return;
		initialized = true;
		void initialize(message.options, message.persistentAssets || {}).catch((error) => {
			scope.postMessage({
				type: 'error',
				message: error instanceof Error ? error.message : String(error)
			});
		});
		return;
	}
	if (message?.jsonrpc !== '2.0' || !session) return;
	try {
		if (message.method === 'initialize' && message.params?.rootUri == null) {
			message.params = {
				...message.params,
				rootUri: 'file:///workspace',
				workspaceFolders: message.params?.workspaceFolders ?? [
					{ uri: 'file:///workspace', name: 'workspace' }
				]
			};
		}
		if (message.method === 'textDocument/didOpen') {
			const uri = new URL(message.params.textDocument.uri).href;
			canonicalUris[uri.toLowerCase()] ??= uri;
		}
		session.dispatch(JSON.stringify(canonicalize(message)));
	} catch (error) {
		if (message.id !== undefined)
			scope.postMessage({
				jsonrpc: '2.0',
				id: message.id,
				error: {
					code: -32603,
					message: error instanceof Error ? error.message : String(error)
				}
			});
	}
});
