import type { BrowserClangArtifact, BrowserClangCompileRequest } from '@wasm-idle/llvm-core/clang';

/** Only immutable compiler output lives here, never a worker, instance, or filesystem. */
export class CompiledArtifactCache {
	private entries = new Map<string, { artifact: BrowserClangArtifact; size: number }>();
	private bytes = 0;
	private hits = 0;
	private misses = 0;
	private maxEntries: number;
	private maxBytes: number;

	constructor(maxEntries = 8, maxBytes = 32 * 1024 * 1024) {
		this.maxEntries = maxEntries;
		this.maxBytes = maxBytes;
	}

	get(key: string) {
		const entry = this.entries.get(key);
		if (!entry) {
			this.misses++;
			return undefined;
		}
		this.hits++;
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.artifact;
	}

	set(key: string, artifact: BrowserClangArtifact) {
		const size = artifact.bytes.byteLength + key.length * 2;
		if (size > this.maxBytes) return;
		const old = this.entries.get(key);
		if (old) this.bytes -= old.size;
		this.entries.delete(key);
		this.entries.set(key, { artifact, size });
		this.bytes += size;
		while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
			const oldest = this.entries.keys().next().value!;
			this.bytes -= this.entries.get(oldest)!.size;
			this.entries.delete(oldest);
		}
	}

	clear() {
		this.entries.clear();
		this.bytes = 0;
	}

	stats() {
		return {
			hits: this.hits,
			misses: this.misses,
			entries: this.entries.size,
			bytes: this.bytes
		};
	}
}

export function clangCompileKey(
	runtimeBaseUrl: string,
	maxAssetBytes: number,
	request: BrowserClangCompileRequest,
	languageSysroots = false
) {
	return JSON.stringify([
		'wasm-idle/clang-cache-v2',
		runtimeBaseUrl,
		maxAssetBytes,
		languageSysroots,
		request.language,
		request.code,
		request.activePath,
		request.compileArgs,
		request.cVersion,
		request.cppVersion,
		[...(request.workspaceFiles || [])].sort((a, b) => a.path.localeCompare(b.path))
	]);
}
