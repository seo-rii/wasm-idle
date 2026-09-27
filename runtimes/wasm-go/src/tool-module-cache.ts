// Cache compiled code only: every invocation retains its own WASI state,
// filesystem, memory and instance, and still validates its runtime asset bytes.
const MAX_CACHED_TOOL_MODULES = 2;
const modules = new Map<string, Promise<WebAssembly.Module>>();

function abortReason(signal: AbortSignal) {
	return signal.reason ?? new DOMException('wasm-go tool compilation aborted', 'AbortError');
}

function waitForModule<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return operation;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', abort);
			callback();
		};
		const abort = () => finish(() => reject(abortReason(signal)));
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		// Always observe the operation, including when cancellation already fired.
		operation.then(
			(value) => finish(() => resolve(value)),
			(error) => finish(() => reject(error))
		);
	});
}

/** Compile an owned snapshot after capGoWasmMemory enforces the invocation's limit. */
export async function compileCappedGoToolModule(
	bytes: Uint8Array,
	maxWasmMemoryBytes: number,
	signal?: AbortSignal
): Promise<WebAssembly.Module> {
	if (signal?.aborted) throw abortReason(signal);
	// This replaces the old compile-site slice and prevents mutation/detachment
	// between asynchronous hashing and compilation. Respect typed-array subviews.
	const snapshot = Uint8Array.from(bytes);
	const compile = () => WebAssembly.compile(snapshot.buffer);
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) return await waitForModule(Promise.resolve().then(compile), signal);

	let digest: ArrayBuffer;
	try {
		digest = await waitForModule(subtle.digest('SHA-256', snapshot), signal);
	} catch {
		if (signal?.aborted) throw abortReason(signal);
		// Hashing is only a cache-key optimization, not an integrity check.
		return await waitForModule(Promise.resolve().then(compile), signal);
	}
	if (signal?.aborted) throw abortReason(signal);
	const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	const key = `${maxWasmMemoryBytes}:${hash}`;
	let pending = modules.get(key);
	if (pending) {
		modules.delete(key);
		modules.set(key, pending);
	} else {
		pending = Promise.resolve().then(compile);
		modules.set(key, pending);
		while (modules.size > MAX_CACHED_TOOL_MODULES) {
			modules.delete(modules.keys().next().value!);
		}
		const inserted = pending;
		void pending.catch(() => {
			if (modules.get(key) === inserted) modules.delete(key);
		});
	}
	// Cancelling a waiter does not poison another invocation's shared module.
	return await waitForModule(pending, signal);
}
