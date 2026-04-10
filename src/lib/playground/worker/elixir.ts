import atomVmWasmUrl from '../../../../node_modules/@swmansion/popcorn/dist/AtomVM.wasm?url';
import initAtomVm from '../../../../node_modules/@swmansion/popcorn/dist/AtomVM.mjs';

declare var self: any;

const workerDocument = {
	querySelectorAll() {
		return [];
	}
};
const workerHost = {
	document: workerDocument,
	postMessage(message: unknown) {
		postMessage(message);
	}
};
const popcornBrowserGlobal = ['globalThis', 'window'].join('.');
const popcornParentGlobal = [popcornBrowserGlobal, 'parent'].join('.');
const workerHostGlobal = 'globalThis.__wasmIdleElixirWorkerHost';

self.document = workerDocument;
(globalThis as any).__wasmIdleElixirWorkerHost = workerHost;

class TrackedValue {
	key: number;
	value: unknown;

	constructor({ key, value }: { key: number; value: unknown }) {
		if (typeof key !== 'number') {
			throw new Error('key property in TrackedValue must be a number');
		}
		this.key = key;
		this.value = value;
	}
}

(globalThis as any).TrackedValue = TrackedValue;

type AtomVmModule = {
	FS: {
		mkdir(path: string): void;
		writeFile(path: string, data: Int8Array): void;
	};
	call(process: string, args: unknown): Promise<string>;
	cast(process: string, args: unknown): void;
	serialize: (value: unknown) => string;
	deserialize: (value: string) => unknown;
	cleanupFunctions: Map<number, (() => void) | undefined>;
	onAbort?: () => void;
	onElixirReady?: ((process: string | null) => void) | null;
	onGetTrackedObjects?: (keys: number[]) => string[];
	onRunTrackedJs?: (scriptString: string, isDebug: boolean) => number[] | null;
	onTrackedObjectDelete?: (key: number) => void;
	sendEvent?: (eventName: string, payload: unknown) => void;
	trackedObjectsMap: Map<number, unknown>;
	nextTrackedObjectKey: () => number;
};

let bundleUrl = '';
let loadedBundleUrl = '';
let runtimePromise: Promise<{ module: AtomVmModule; process: string | null }> | null = null;

function deserialize(module: AtomVmModule, message: string) {
	return JSON.parse(message, (_key, value) => {
		const isRef =
			typeof value === 'object' &&
			value !== null &&
			Object.hasOwn(value, 'popcorn_ref') &&
			Object.getOwnPropertyNames(value).length === 1;
		if (!isRef) {
			return value;
		}
		return module.trackedObjectsMap.get((value as { popcorn_ref: number }).popcorn_ref);
	});
}

function ensureFunctionEval(maybeFunction: unknown) {
	if (typeof maybeFunction !== 'function') {
		throw new Error('Script passed to onRunTrackedJs() is not wrapped in a function');
	}
}

function ensureResultKeyList(result: unknown) {
	if (!Array.isArray(result) && result !== undefined) {
		throw new Error(
			'Script passed to onRunTrackedJs() returned invalid value, accepted values are arrays and undefined'
		);
	}
}

function configureTrackedObjectBridge(
	module: AtomVmModule,
	resolveReadyProcess: (process: string | null) => void
) {
	let appReadyProcess: string | null | undefined;
	let elixirReady = false;
	module.serialize = JSON.stringify;
	module.deserialize = (message: string) => deserialize(module, message);
	module.cleanupFunctions = new Map();
	module.sendEvent = (eventName, payload) => {
		if (eventName === 'popcorn_app_ready') {
			const readyPayload =
				typeof payload === 'object' && payload !== null && Object.hasOwn(payload, 'name')
					? (payload as { name: unknown }).name
					: payload;
			appReadyProcess =
				readyPayload === null || readyPayload === undefined ? null : String(readyPayload);
			if (elixirReady) {
				resolveReadyProcess(appReadyProcess);
			}
			return;
		}
		if (eventName === 'popcorn_elixir_ready') {
			elixirReady = true;
			if (appReadyProcess !== undefined) {
				resolveReadyProcess(appReadyProcess);
			}
		}
	};
	module.onElixirReady = (process) => {
		module.onElixirReady = null;
		resolveReadyProcess(process);
	};
	module.onTrackedObjectDelete = (key) => {
		const cleanup = module.cleanupFunctions.get(key);
		module.cleanupFunctions.delete(key);
		try {
			cleanup?.();
		} catch (error) {
			console.error(error);
		} finally {
			module.trackedObjectsMap.delete(key);
		}
	};
	module.onRunTrackedJs = (scriptString, isDebug) => {
		const trackValue = (tracked: unknown) => {
			if (tracked instanceof TrackedValue) {
				module.trackedObjectsMap.set(tracked.key, tracked.value);
				return tracked.key;
			}
			const key = module.nextTrackedObjectKey();
			module.trackedObjectsMap.set(key, tracked);
			return key;
		};
		let fn;
		try {
			const indirectEval = globalThis.eval;
			const workerScript = scriptString
				.replaceAll(`${popcornParentGlobal}.document`, `${workerHostGlobal}.document`)
				.replaceAll(popcornParentGlobal, workerHostGlobal)
				.replaceAll(popcornBrowserGlobal, workerHostGlobal);
			fn = indirectEval(workerScript);
		} catch (error) {
			console.error(error);
			return null;
		}
		if (isDebug) {
			ensureFunctionEval(fn);
		}
		let result;
		try {
			result = fn?.(module);
		} catch (error) {
			console.error(error);
			return null;
		}
		if (isDebug) {
			ensureResultKeyList(result);
		}
		return result?.map(trackValue) ?? [];
	};
	module.onGetTrackedObjects = (keys) =>
		keys.map((key) => module.serialize(module.trackedObjectsMap.get(key)));
}

function configureMessagingBridge(module: AtomVmModule) {
	const originalCast = module.cast.bind(module);
	const originalCall = module.call.bind(module);
	module.cast = (process, args) => {
		originalCast(process, module.serialize(args));
	};
	module.call = (process, args) => originalCall(process, module.serialize(args));
}

async function startVm(avmBundle: Int8Array, log: boolean) {
	let resolveProcess: ((process: string | null) => void) | null = null;
	const processPromise = new Promise<string | null>((resolve, reject) => {
		const timeout = setTimeout(() => {
			resolveProcess = null;
			reject(new Error('Elixir runtime did not become ready'));
		}, 30_000);
		resolveProcess = (process) => {
			clearTimeout(timeout);
			resolveProcess = null;
			resolve(process);
		};
	});
	const module = (await initAtomVm({
		locateFile(path: string) {
			if (path === 'AtomVM.wasm') {
				return atomVmWasmUrl;
			}
			return path;
		},
		preRun: [
			({ FS }: AtomVmModule) => {
				FS.mkdir('/data');
				FS.writeFile('/data/bundle.avm', avmBundle);
			}
		],
		arguments: ['/data/bundle.avm'],
		print(text: string) {
			postMessage({ output: text });
		},
		printErr(text: string) {
			postMessage({ output: text });
		},
		onAbort() {
			if (log) {
				console.error('[wasm-idle:elixir-worker] AtomVM aborted');
			}
			setTimeout(() => postMessage({ error: 'Elixir runtime aborted' }), 100);
		}
	})) as AtomVmModule;
	configureTrackedObjectBridge(module, (process) => resolveProcess?.(process));
	configureMessagingBridge(module);
	return {
		module,
		process: await processPromise
	};
}

async function loadRuntime(nextBundleUrl: string, log: boolean) {
	if (!nextBundleUrl) {
		throw new Error(
			'Elixir runtime is not configured. Set PUBLIC_WASM_ELIXIR_BUNDLE_URL or runtimeAssets.elixir.bundleUrl.'
		);
	}
	if (loadedBundleUrl === nextBundleUrl && runtimePromise) {
		return await runtimePromise;
	}
	loadedBundleUrl = nextBundleUrl;
	runtimePromise = (async () => {
		if (log) {
			console.log(`[wasm-idle:elixir-worker] load bundleUrl=${nextBundleUrl}`);
		}
		const bundleBuffer = await fetch(nextBundleUrl).then((response) => {
			if (!response.ok) {
				throw new Error(`Failed to fetch Elixir bundle: ${response.status} ${response.statusText}`);
			}
			return response.arrayBuffer();
		});
		return await startVm(new Int8Array(bundleBuffer), log);
	})();
	return await runtimePromise;
}

function normalizeCallError(module: AtomVmModule, error: unknown) {
	if (error === 'noproc') {
		runtimePromise = null;
		loadedBundleUrl = '';
		return 'Elixir runtime process is unavailable';
	}
	if (typeof error === 'string') {
		try {
			const value = module.deserialize(error);
			return typeof value === 'string' ? value : JSON.stringify(value);
		} catch {
			return error;
		}
	}
	if (error instanceof Error) {
		return error.message;
	}
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

self.onmessage = async (event: { data: any }) => {
	const { load, bundleUrl: nextBundleUrl, code, prepare, log = true } = event.data;
	try {
		if (load) {
			bundleUrl = nextBundleUrl;
			await loadRuntime(bundleUrl, log);
			postMessage({ load: true });
			return;
		}

		if (!bundleUrl) {
			throw new Error('Elixir runtime not loaded');
		}
		if (prepare) {
			postMessage({ results: true });
			return;
		}

		const runtime = await loadRuntime(bundleUrl, log);
		if (!runtime.process) {
			throw new Error('Elixir runtime did not expose a default process');
		}
		if (log) {
			console.log(`[wasm-idle:elixir-worker] eval bytes=${code.length}`);
		}
		const response = await runtime.module.call(runtime.process, ['eval_elixir', code]);
		const rendered = runtime.module.deserialize(response);
		if (typeof rendered === 'string') {
			postMessage({ results: rendered });
			return;
		}
		if (rendered === undefined) {
			postMessage({ results: true });
			return;
		}
		postMessage({ results: JSON.stringify(rendered) });
	} catch (error) {
		if (log) {
			console.error('[wasm-idle:elixir-worker] failed', error);
		}
		if (runtimePromise) {
			try {
				const runtime = await runtimePromise;
				postMessage({ error: normalizeCallError(runtime.module, error) });
				return;
			} catch {
				// Ignore secondary runtime load errors and surface the original failure instead.
			}
		}
		postMessage({
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
