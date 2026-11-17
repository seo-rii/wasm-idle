import type { RuntimeGeneratedAssetCacheBackend } from '@wasm-idle/core';

/**
 * Pyodide memory snapshots let a later worker skip interpreter initialization, which dominates
 * Python startup (about 2.5 s of a 2.9 s cold boot in Chromium, against about 0.4 s restored).
 *
 * A snapshot is generated locally from the exact runtime this worker loaded and is stored in the
 * persistent generated-asset cache, so it shares that cache's namespace, LRU, quota and opt-out.
 * Its key covers every byte that shapes the initialized interpreter heap: the Pyodide entry and
 * Emscripten scripts (which also pin the Wasm build id that Pyodide checks on restore) and the
 * standard library archive whose zip directory the heap caches.
 */
export const PYTHON_SNAPSHOT_FORMAT = 'wasm-idle-pyodide-memory-snapshot-v1';
/** Restored heaps are about 31 MiB for Pyodide 314; refuse anything implausibly large. */
export const MAX_PYTHON_SNAPSHOT_BYTES = 256 * 1024 * 1024;

/**
 * A restored heap repeats the snapshot's interpreter state. Re-seed the global `random` generator
 * (imported during Pyodide initialization) and re-read the time zone so restored workers do not
 * replay one sequence. String hash randomization is fixed per snapshot, like a PYTHONHASHSEED.
 */
export const PYTHON_SNAPSHOT_RESTORE_SOURCE = `def __wasm_idle_snapshot_restored():
    globals().pop("__wasm_idle_snapshot_restored", None)
    import sys
    random = sys.modules.get("random")
    if random is not None:
        random.seed()
    time = sys.modules.get("time")
    if time is not None and hasattr(time, "tzset"):
        time.tzset()
    return 1 + 1
__wasm_idle_snapshot_restored()
`;

const hex = (digest: ArrayBuffer) =>
	Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');

export async function pythonSnapshotKey(
	version: string,
	inputs: { entry: Uint8Array; emscripten: Uint8Array; standardLibrary: Uint8Array }
) {
	const digest = async (bytes: Uint8Array) =>
		hex(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
	return JSON.stringify([
		PYTHON_SNAPSHOT_FORMAT,
		version,
		await digest(inputs.entry),
		await digest(inputs.emscripten),
		await digest(inputs.standardLibrary)
	]);
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number) {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > limit) throw new Error('Python snapshot exceeds its size limit');
			chunks.push(value);
		}
	} catch (error) {
		void reader.cancel(error).catch(() => undefined);
		throw error;
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export async function readPythonSnapshot(
	cache: RuntimeGeneratedAssetCacheBackend,
	key: string
): Promise<Uint8Array | undefined> {
	if (typeof DecompressionStream !== 'function') return undefined;
	const compressed = await cache.read(key).catch(() => undefined);
	if (!compressed?.byteLength) return undefined;
	try {
		const snapshot = await readBounded(
			new Response(compressed as Uint8Array<ArrayBuffer>).body!.pipeThrough(
				new DecompressionStream('gzip')
			),
			MAX_PYTHON_SNAPSHOT_BYTES
		);
		return snapshot.byteLength ? snapshot : undefined;
	} catch {
		await cache.remove(key).catch(() => undefined);
		return undefined;
	}
}

export async function writePythonSnapshot(
	cache: RuntimeGeneratedAssetCacheBackend,
	key: string,
	snapshot: Uint8Array
) {
	if (
		typeof CompressionStream !== 'function' ||
		!snapshot.byteLength ||
		snapshot.byteLength > MAX_PYTHON_SNAPSHOT_BYTES
	)
		return false;
	const compressed = await readBounded(
		new Response(snapshot as Uint8Array<ArrayBuffer>).body!.pipeThrough(
			new CompressionStream('gzip')
		),
		MAX_PYTHON_SNAPSHOT_BYTES
	);
	return await cache.write(key, compressed).catch(() => false);
}
