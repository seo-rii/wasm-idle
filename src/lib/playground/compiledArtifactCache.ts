import type { BrowserClangArtifact, BrowserClangCompileRequest } from '@wasm-idle/llvm-core/clang';
import type { CompilerDiagnostic } from '@wasm-idle/llvm-core/clang';

function snapshotArtifact(artifact: BrowserClangArtifact): BrowserClangArtifact {
	const { bytes, wasm, ...metadata } = artifact;
	return {
		...structuredClone(metadata),
		// Compiled modules are immutable. Byte views must not retain an oversized backing buffer.
		wasm,
		bytes: ArrayBuffer.isView(bytes) ? Uint8Array.from(bytes) : bytes.slice(0)
	};
}

/** Only immutable compiler output lives here, never a worker, instance, or filesystem. */
export class CompiledArtifactCache {
	private entries = new Map<
		string,
		{ artifact: BrowserClangArtifact; diagnostics: CompilerDiagnostic[]; size: number }
	>();
	private bytes = 0;
	private hits = 0;
	private misses = 0;
	private maxEntries: number;
	private maxBytes: number;

	constructor(maxEntries = 8, maxBytes = 32 * 1024 * 1024) {
		if (!Number.isSafeInteger(maxEntries) || maxEntries < 0)
			throw new TypeError('Invalid compiled artifact cache maxEntries');
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
			throw new TypeError('Invalid compiled artifact cache maxBytes');
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
		return snapshotArtifact(entry.artifact);
	}

	getDiagnostics(key: string): CompilerDiagnostic[] {
		return this.entries.get(key)?.diagnostics.map((diagnostic) => ({ ...diagnostic })) ?? [];
	}

	set(key: string, artifact: BrowserClangArtifact, diagnostics: CompilerDiagnostic[] = []) {
		// A zero budget disables retention without disabling compilation.
		if (this.maxEntries === 0 || this.maxBytes === 0) return;
		const size =
			artifact.bytes.byteLength +
			key.length * 2 +
			(diagnostics.length ? JSON.stringify(diagnostics).length * 2 : 0);
		if (size > this.maxBytes) return;
		const old = this.entries.get(key);
		if (old) this.bytes -= old.size;
		this.entries.delete(key);
		this.entries.set(key, {
			artifact: snapshotArtifact(artifact),
			diagnostics: diagnostics.map((diagnostic) => ({ ...diagnostic })),
			size
		});
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
		'wasm-idle/clang-cache-v3',
		runtimeBaseUrl,
		maxAssetBytes,
		languageSysroots,
		request.language,
		request.code,
		request.activePath,
		request.compileArgs,
		request.cVersion,
		request.cppVersion,
		request.maxWasmMemoryBytes,
		[...(request.workspaceFiles || [])].sort((a, b) => a.path.localeCompare(b.path))
	]);
}
