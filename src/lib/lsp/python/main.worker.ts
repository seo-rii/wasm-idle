/// <reference lib="WebWorker" />

import type { PyodideInterface } from 'pyodide';
import { loadPyodide } from 'pyodide';
import packageInitSource from './package/arcturus_python_lsp/__init__.py?raw';
import packageServerSource from './package/arcturus_python_lsp/server.py?raw';

declare const self: DedicatedWorkerGlobalScope;

type PythonBridge = (payload: string) => void;

let pyodide: PyodideInterface | null = null;
let bridge: PythonBridge | null = null;
let initPromise: Promise<void> | null = null;
let configuredPyodideBaseUrl = '/pyodide/';

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
	currentPyodide.FS.mkdirTree('/arcturus_lsp/arcturus_python_lsp');
	currentPyodide.FS.writeFile('/arcturus_lsp/arcturus_python_lsp/__init__.py', packageInitSource);
	currentPyodide.FS.writeFile('/arcturus_lsp/arcturus_python_lsp/server.py', packageServerSource);
}

async function bootstrapPythonBridge(pyodideBaseUrl: string) {
	if (bridge) return;
	if (initPromise) return initPromise;

	initPromise = (async () => {
		self.postMessage({ type: 'progress', stage: 'load-pyodide' });
		pyodide = await loadPyodide({ indexURL: normalizeBaseUrl(pyodideBaseUrl) });
		pyodide.registerJsModule('arcturus_lsp_bridge', {
			emit: emitTransportMessage
		});
		await pyodide.loadPackage('jedi');
		installPythonServerPackage(pyodide);

		await pyodide.runPythonAsync(`
import sys

if "/arcturus_lsp" not in sys.path:
    sys.path.insert(0, "/arcturus_lsp")

from arcturus_python_lsp import create_bridge

_arcturus_python_lsp_bridge = create_bridge()
`);

		const bridgeProxy = pyodide.globals.get('_arcturus_python_lsp_bridge');
		bridge = (payload: string) => {
			bridgeProxy(payload);
		};
		self.postMessage({ type: 'ready' });
	})().catch((error) => {
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
	if (payload.type === 'init') {
		configuredPyodideBaseUrl =
			typeof payload.pyodideBaseUrl === 'string' ? payload.pyodideBaseUrl : '/pyodide/';
		void bootstrapPythonBridge(configuredPyodideBaseUrl).catch((error) => {
			console.error('Failed to initialize Python LSP worker', error);
		});
		return;
	}
	if ('type' in payload) return;

	const serialized = JSON.stringify(payload);

	if (bridge) {
		bridge(serialized);
		return;
	}

	void bootstrapPythonBridge(configuredPyodideBaseUrl)
		.then(() => {
			bridge?.(serialized);
		})
		.catch((error) => {
			console.error('Failed to forward LSP message to Python bridge', error);
		});
});
