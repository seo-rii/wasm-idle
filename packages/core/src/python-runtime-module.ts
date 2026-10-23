// Share immutable engine code across Python execution and language-server workers.
// Byte identity is computed here, so a caller cannot poison another consumer's cache.
const modules = new Map<string, { promise: Promise<WebAssembly.Module>; bytes: number }>();
const maxBytes = 32 * 1024 * 1024;
let retainedBytes = 0;

export async function compilePythonRuntimeModule(bytes: Uint8Array): Promise<WebAssembly.Module> {
	const snapshot = Uint8Array.from(bytes);
	if (!globalThis.crypto?.subtle || snapshot.length > maxBytes)
		return WebAssembly.compile(snapshot);
	const digest = await crypto.subtle.digest('SHA-256', snapshot);
	// This API intentionally accepts no compile options: all callers use the
	// default Pyodide compilation ABI. Other option sets must use a separate key.
	const key =
		'python-default-v1:' +
		Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
	const previous = modules.get(key);
	if (previous) {
		modules.delete(key);
		modules.set(key, previous);
		return previous.promise;
	}
	while (modules.size >= 2 || retainedBytes + snapshot.length > maxBytes) {
		const oldest = modules.keys().next().value!;
		retainedBytes -= modules.get(oldest)!.bytes;
		modules.delete(oldest);
	}
	const entry = { promise: WebAssembly.compile(snapshot), bytes: snapshot.length };
	modules.set(key, entry);
	retainedBytes += entry.bytes;
	void entry.promise.catch(() => {
		if (modules.get(key) === entry) {
			modules.delete(key);
			retainedBytes -= entry.bytes;
		}
	});
	return entry.promise;
}
