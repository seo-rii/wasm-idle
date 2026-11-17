import { capGoWasmMemory } from './wasm-memory.js';

// Modules are immutable; instances, WASI state and guest files must never be cached.
const MAX_CACHED_MODULES = 4;
const modules = new Map<string, Promise<WebAssembly.Module>>();
// A versioned runtime URL names fixed bytes: its query is the distribution's content
// fingerprint. Remember the module prepared from it so later compiles skip downloading,
// inflating, copying and hashing the tool (about 60 MB for compile and link together).
const versionedModules = new Map<string, WebAssembly.Module>();

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) {
		throw signal.reason ?? new DOMException('wasm-go tool compilation aborted', 'AbortError');
	}
}

function waitForModule(operation: Promise<WebAssembly.Module>, signal?: AbortSignal) {
	if (!signal) return operation;
	return new Promise<WebAssembly.Module>((resolve, reject) => {
		const abort = () => {
			signal.removeEventListener('abort', abort);
			reject(
				signal.reason ?? new DOMException('wasm-go tool compilation aborted', 'AbortError')
			);
		};
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		operation.then(
			(module) => {
				signal.removeEventListener('abort', abort);
				resolve(module);
			},
			(error) => {
				signal.removeEventListener('abort', abort);
				reject(error);
			}
		);
	});
}

export function clearGoToolModuleCache() {
	modules.clear();
	versionedModules.clear();
}

/** Look up a module by its versioned asset URL before loading and compiling its bytes. */
export async function prepareVersionedGoToolModule(
	url: URL,
	maxWasmMemoryBytes: number,
	load: () => Promise<WebAssembly.Module>,
	signal?: AbortSignal,
	onCacheHit?: () => void
): Promise<WebAssembly.Module> {
	throwIfAborted(signal);
	// Unversioned URLs may change in place; they keep using the content-addressed path only.
	const key = url.search ? `memory-cap-v1:${maxWasmMemoryBytes}:${url.href}` : undefined;
	const cached = key ? versionedModules.get(key) : undefined;
	if (key && cached) {
		versionedModules.delete(key);
		versionedModules.set(key, cached);
		onCacheHit?.();
		return cached;
	}
	// Publish only completed modules, so one caller's cancellation never rejects another's.
	const module = await load();
	throwIfAborted(signal);
	if (key) {
		versionedModules.set(key, module);
		while (versionedModules.size > MAX_CACHED_MODULES)
			versionedModules.delete(versionedModules.keys().next().value!);
	}
	return module;
}

/** Cache only after the caller's bounded, verified asset load has completed. */
export async function compileGoToolModule(
	bytes: Uint8Array,
	maxWasmMemoryBytes: number,
	label: string,
	signal?: AbortSignal
): Promise<WebAssembly.Module> {
	throwIfAborted(signal);
	// Snapshot the exact view before asynchronous hashing; caller mutation/transfer
	// must not change the bytes between the cache key and native compilation.
	const cappedBytes = capGoWasmMemory(Uint8Array.from(bytes), maxWasmMemoryBytes, label);
	const subtle = globalThis.crypto?.subtle;
	let key: string | undefined;
	if (subtle) {
		const digest = await subtle.digest('SHA-256', cappedBytes as Uint8Array<ArrayBuffer>);
		key =
			`memory-cap-v1:${maxWasmMemoryBytes}:` +
			Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
				''
			);
	}
	throwIfAborted(signal);
	let operation = key ? modules.get(key) : undefined;
	if (operation && key) {
		// Refresh LRU order, including in-flight requests.
		modules.delete(key);
		modules.set(key, operation);
	} else {
		operation = WebAssembly.compile(cappedBytes as Uint8Array<ArrayBuffer>);
		if (key) {
			const cacheKey = key;
			const cachedOperation = operation;
			modules.set(cacheKey, cachedOperation);
			void cachedOperation.catch(() => {
				if (modules.get(cacheKey) === cachedOperation) modules.delete(cacheKey);
			});
			while (modules.size > MAX_CACHED_MODULES) modules.delete(modules.keys().next().value!);
		}
	}
	const module = await waitForModule(operation, signal);
	throwIfAborted(signal);
	return module;
}
