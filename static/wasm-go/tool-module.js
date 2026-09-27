import { capGoWasmMemory } from './wasm-memory.js';
// Modules are immutable; instances, WASI state and guest files must never be cached.
const MAX_CACHED_MODULES = 4;
const modules = new Map();
function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw signal.reason ?? new DOMException('wasm-go tool compilation aborted', 'AbortError');
    }
}
function waitForModule(operation, signal) {
    if (!signal)
        return operation;
    return new Promise((resolve, reject) => {
        const abort = () => {
            signal.removeEventListener('abort', abort);
            reject(signal.reason ?? new DOMException('wasm-go tool compilation aborted', 'AbortError'));
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted)
            abort();
        operation.then((module) => {
            signal.removeEventListener('abort', abort);
            resolve(module);
        }, (error) => {
            signal.removeEventListener('abort', abort);
            reject(error);
        });
    });
}
export function clearGoToolModuleCache() {
    modules.clear();
}
/** Cache only after the caller's bounded, verified asset load has completed. */
export async function compileGoToolModule(bytes, maxWasmMemoryBytes, label, signal) {
    throwIfAborted(signal);
    // Snapshot the exact view before asynchronous hashing; caller mutation/transfer
    // must not change the bytes between the cache key and native compilation.
    const cappedBytes = capGoWasmMemory(Uint8Array.from(bytes), maxWasmMemoryBytes, label);
    const subtle = globalThis.crypto?.subtle;
    let key;
    if (subtle) {
        const digest = await subtle.digest('SHA-256', cappedBytes);
        key =
            `memory-cap-v1:${maxWasmMemoryBytes}:` +
                Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    throwIfAborted(signal);
    let operation = key ? modules.get(key) : undefined;
    if (operation && key) {
        // Refresh LRU order, including in-flight requests.
        modules.delete(key);
        modules.set(key, operation);
    }
    else {
        operation = WebAssembly.compile(cappedBytes);
        if (key) {
            const cacheKey = key;
            const cachedOperation = operation;
            modules.set(cacheKey, cachedOperation);
            void cachedOperation.catch(() => {
                if (modules.get(cacheKey) === cachedOperation)
                    modules.delete(cacheKey);
            });
            while (modules.size > MAX_CACHED_MODULES)
                modules.delete(modules.keys().next().value);
        }
    }
    const module = await waitForModule(operation, signal);
    throwIfAborted(signal);
    return module;
}
//# sourceMappingURL=tool-module.js.map