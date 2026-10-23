import type { PyodideInterface } from 'pyodide';
import packageInitSource from './package/wasm_idle_python_lsp/__init__.py?raw';
import packageServerSource from './package/wasm_idle_python_lsp/server.py?raw';
import type { PythonLspWorkerInboundMessage } from './protocol.js';
import {
	configureWorkerLanguageToolPersistentAssets,
	type LanguageToolPersistentOptions
} from '../persistent-assets.js';
import { withPersistentPythonLspAssets } from './persistent-fetch.js';
import { createPythonRequestQueue } from './request-queue.js';
import { withPythonRuntimeModule } from './runtime-module.js';

interface PythonLspWorkerScope {
	addEventListener(
		type: 'message',
		listener: (event: MessageEvent<PythonLspWorkerInboundMessage>) => void
	): void;
	postMessage(message: unknown): void;
}

declare const self: PythonLspWorkerScope;

type PythonBridge = (payload: string) => void;

let pyodide: PyodideInterface | null = null;
let bridge: PythonBridge | null = null;
let initPromise: Promise<void> | null = null;
let configuredPyodideBaseUrl: string | null = null;
let persistentAssets: LanguageToolPersistentOptions = {};
let runtimeModule: Promise<WebAssembly.Module | undefined> = Promise.resolve(undefined);
let receiveRuntimeModule: ((module: WebAssembly.Module | undefined) => void) | undefined;
let rejectRuntimeModule: ((reason: Error) => void) | undefined;
const diagnosticTimers = new Map<string, ReturnType<typeof setTimeout>>();
const requests = createPythonRequestQueue(
	(message) => bridge?.(JSON.stringify(message)),
	(message) => self.postMessage(message)
);

function scheduleDiagnostics(uri: string, version: number | null, cancelled = false) {
	const previous = diagnosticTimers.get(uri);
	if (previous !== undefined) clearTimeout(previous);
	if (cancelled) {
		diagnosticTimers.delete(uri);
		return;
	}
	diagnosticTimers.set(
		uri,
		setTimeout(() => {
			diagnosticTimers.delete(uri);
			requests.push({
				jsonrpc: '2.0',
				method: 'wasmIdle/publishDiagnostics',
				params: { uri, version }
			});
		}, 120)
	);
}

function toErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function normalizeBaseUrl(baseUrl: string) {
	return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function emitTransportMessage(payload: string) {
	try {
		self.postMessage(JSON.parse(payload));
	} catch (error) {
		console.error('Failed to emit Python LSP payload', error, payload);
	}
}

function installPythonServerPackage(currentPyodide: PyodideInterface) {
	currentPyodide.FS.mkdirTree('/wasm_idle_lsp/wasm_idle_python_lsp');
	currentPyodide.FS.writeFile(
		'/wasm_idle_lsp/wasm_idle_python_lsp/__init__.py',
		packageInitSource
	);
	currentPyodide.FS.writeFile(
		'/wasm_idle_lsp/wasm_idle_python_lsp/server.py',
		packageServerSource
	);
}

async function bootstrapPythonBridge(pyodideBaseUrl: string) {
	if (bridge) return;
	if (initPromise) return initPromise;

	initPromise = withPersistentPythonLspAssets(persistentAssets, async () => {
		self.postMessage({ type: 'progress', stage: 'load-pyodide' });
		const { loadPyodide } = (await import(
			/* @vite-ignore */ `${normalizeBaseUrl(pyodideBaseUrl)}pyodide.mjs`
		)) as typeof import('pyodide');
		pyodide = await withPythonRuntimeModule(
			normalizeBaseUrl(pyodideBaseUrl),
			await runtimeModule,
			() => loadPyodide({ indexURL: normalizeBaseUrl(pyodideBaseUrl) })
		);
		pyodide.registerJsModule('wasm_idle_lsp_bridge', {
			emit: emitTransportMessage,
			schedule_diagnostics: scheduleDiagnostics
		});
		self.postMessage({ type: 'progress', stage: 'load-jedi' });
		try {
			await pyodide.loadPackage('jedi');
		} catch (error) {
			console.warn(
				'Python LSP semantic features disabled because jedi failed to load',
				error
			);
		}
		installPythonServerPackage(pyodide);

		await pyodide.runPythonAsync(`
import sys

if "/wasm_idle_lsp" not in sys.path:
    sys.path.insert(0, "/wasm_idle_lsp")

from wasm_idle_python_lsp import create_bridge

_wasm_idle_python_lsp_bridge = create_bridge()
`);

		const bridgeProxy = pyodide.globals.get('_wasm_idle_python_lsp_bridge');
		bridge = (payload: string) => {
			bridgeProxy(payload);
		};
		self.postMessage({ type: 'ready' });
	}).catch((error) => {
		const message = toErrorMessage(error);
		console.error('Python LSP bootstrap failed', error);
		self.postMessage({ type: 'error', error: message });
		initPromise = null;
		bridge = null;
		throw error;
	});

	return initPromise;
}

self.addEventListener('message', (event) => {
	const payload = event.data as Record<string, unknown> | null;
	if (!payload || typeof payload !== 'object') return;
	if (payload.type === 'runtime-module') {
		if (payload.module instanceof WebAssembly.Module) receiveRuntimeModule?.(payload.module);
		else
			rejectRuntimeModule?.(
				new Error(String(payload.error || 'Python runtime module unavailable'))
			);
		receiveRuntimeModule = undefined;
		rejectRuntimeModule = undefined;
		return;
	}
	if (payload.type === 'init') {
		if (typeof payload.pyodideBaseUrl !== 'string' || !payload.pyodideBaseUrl.trim()) {
			self.postMessage({
				type: 'error',
				error: 'Python LSP init requires an explicit pyodideBaseUrl'
			});
			return;
		}
		configuredPyodideBaseUrl = payload.pyodideBaseUrl.trim();
		if (payload.runtimeModuleBridge === true) {
			runtimeModule = new Promise((resolve, reject) => {
				receiveRuntimeModule = resolve;
				rejectRuntimeModule = reject;
			});
			// Observe rejection immediately while the JS loader is still importing.
			void runtimeModule.catch(() => {});
			self.postMessage({ type: 'runtime-module-request' });
		}
		if (payload.persistentAssets && typeof payload.persistentAssets === 'object') {
			persistentAssets = payload.persistentAssets as LanguageToolPersistentOptions;
			configureWorkerLanguageToolPersistentAssets(persistentAssets);
		}
		void bootstrapPythonBridge(configuredPyodideBaseUrl).catch((error) => {
			console.error('Failed to initialize Python LSP worker', error);
		});
		return;
	}
	if ('type' in payload) return;
	if (!configuredPyodideBaseUrl) {
		self.postMessage({
			type: 'error',
			error: 'Python LSP worker requires init before JSON-RPC messages'
		});
		return;
	}

	if (bridge) {
		requests.push(payload);
		return;
	}

	void bootstrapPythonBridge(configuredPyodideBaseUrl)
		.then(() => {
			requests.push(payload);
		})
		.catch((error) => {
			console.error('Failed to forward LSP message to Python bridge', error);
		});
});
