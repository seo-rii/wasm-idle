// Keep only the immutable LLDB/WAMR pair. Workers, instances, memories, queues and
// filesystem state are created afresh for every debug session.
const modules = new Map<string, Promise<WebAssembly.Module>>();

/** Caller must finish manifest/hash validation before consulting this cache. */
export function compileVerifiedDebugModule(sha256: string, bytes: ArrayBuffer) {
	const cached = modules.get(sha256);
	if (cached) {
		modules.delete(sha256);
		modules.set(sha256, cached);
		return cached;
	}
	const pending = WebAssembly.compile(bytes);
	modules.set(sha256, pending);
	while (modules.size > 2) modules.delete(modules.keys().next().value!);
	void pending.catch(() => {
		if (modules.get(sha256) === pending) modules.delete(sha256);
	});
	return pending;
}
