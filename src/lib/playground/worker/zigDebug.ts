import { verifyRuntimeAssetIntegrity, type RuntimeAssetIntegrityEntry } from '@wasm-idle/core';
import { decompressGzip } from '@wasm-idle/llvm-core';
import { fetchRuntimeAssetBytes, resolveRuntimeAssetUrl } from './runtimeAssetFetch';
import type { ZigExecutionAssetReceipts } from '../zigAssets';

export interface ZigDebugBackend {
	path: string;
	integrity: Readonly<Record<string, RuntimeAssetIntegrityEntry>>;
	maxAssetBytes: number;
	maxWasmMemoryBytes?: number;
}

export interface ZigLldbArtifact {
	bytes: Uint8Array;
	descriptor: {
		kind: 'dwarf';
		sourceRoot: '/workspace';
		moduleSha256: string;
		files: { path: string; contentSha256: string }[];
		compiler: Record<string, unknown>;
	};
	sources: { path: string; content: string; contentSha256: string }[];
}

export function snapshotZigDebugBackend(
	path: unknown,
	integrity: unknown,
	maxAssetBytes: number,
	maxWasmMemoryBytes?: number
): ZigDebugBackend {
	if (typeof path !== 'string' || !path) {
		throw new Error('Zig LLDB debugging requires a Clang runtime asset URL');
	}
	const base = resolveRuntimeAssetUrl(path, 'Zig debug Clang runtime');
	if (base.search) throw new Error('Zig debug Clang runtime URL must not include a query');
	if (!base.pathname.endsWith('/')) base.pathname += '/';
	if (!integrity || typeof integrity !== 'object' || Array.isArray(integrity)) {
		throw new Error('Zig LLDB debugging requires verified Clang runtime asset receipts');
	}
	const receipts: Record<string, RuntimeAssetIntegrityEntry> = Object.create(null);
	for (const [name, entry] of Object.entries(integrity)) {
		const receipt = entry as RuntimeAssetIntegrityEntry | null;
		if (
			!receipt ||
			!Number.isSafeInteger(receipt.bytes) ||
			(receipt.bytes as number) <= 0 ||
			typeof receipt.sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(receipt.sha256) ||
			!Number.isSafeInteger(receipt.uncompressedBytes) ||
			(receipt.uncompressedBytes as number) <= 0 ||
			typeof receipt.uncompressedSha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(receipt.uncompressedSha256)
		)
			throw new Error(`Invalid Zig debug Clang runtime asset receipt: ${name}`);
		if (
			new URL(name, base).href !== `${base.href}${name}` ||
			name.includes('..') ||
			/[?#\\]/u.test(name)
		) {
			throw new Error(`Invalid Zig debug Clang runtime asset name: ${name}`);
		}
		receipts[name] = Object.freeze({
			bytes: receipt.bytes,
			sha256: receipt.sha256,
			uncompressedBytes: receipt.uncompressedBytes,
			uncompressedSha256: receipt.uncompressedSha256
		});
	}
	if (!receipts['runtime-manifest.v1.json']) {
		throw new Error('Zig LLDB debugging requires a verified Clang runtime manifest');
	}
	return Object.freeze({
		path: base.href,
		integrity: Object.freeze(receipts),
		maxAssetBytes,
		maxWasmMemoryBytes
	});
}

async function sha256(bytes: Uint8Array) {
	return Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))),
		(byte) => byte.toString(16).padStart(2, '0')
	).join('');
}

/** Every backend payload is verified before the existing Clang loader sees it. */
export function createZigDebugBackendFetch(backend: ZigDebugBackend): typeof fetch {
	return async (input, init) => {
		const url = new URL(
			typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
		);
		const name = url.href.startsWith(backend.path) ? url.href.slice(backend.path.length) : '';
		const receipt = Object.hasOwn(backend.integrity, name)
			? backend.integrity[name]
			: undefined;
		if (!receipt) throw new Error(`Unpinned Zig debug Clang runtime asset: ${url.href}`);
		const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
		const delivered = await fetchRuntimeAssetBytes({
			url: url.href,
			label: `Zig debug ${name}`,
			expected: receipt,
			maxAssetBytes: backend.maxAssetBytes,
			signal: signal || undefined,
			integrityContext: { asset: name, runtimeId: 'ZIG' }
		});
		const bytes =
			delivered[0] === 0x1f && delivered[1] === 0x8b
				? await decompressGzip(delivered, url.href, backend.maxAssetBytes)
				: delivered;
		await verifyRuntimeAssetIntegrity({
			asset: name,
			runtimeId: 'ZIG',
			bytes,
			expected: receipt,
			stage: 'uncompressed'
		});
		return new Response(Uint8Array.from(bytes), {
			headers: {
				'Content-Type': name.endsWith('.json')
					? 'application/json'
					: 'application/octet-stream',
				'Content-Length': String(bytes.byteLength)
			}
		});
	};
}

export async function compileZigDebugArtifact({
	bitcode,
	sources,
	zigReceipts,
	backend,
	log
}: {
	bitcode: readonly Uint8Array[];
	sources: { path: string; content: string }[];
	zigReceipts: ZigExecutionAssetReceipts;
	backend: ZigDebugBackend;
	log: boolean;
}): Promise<ZigLldbArtifact> {
	const { BrowserClangRuntime, loadRuntimeManifest, resolveRuntimeManifestUrl } =
		await import('@wasm-idle/llvm-core/clang');
	const fetchImpl = createZigDebugBackendFetch(backend);
	const manifest = await loadRuntimeManifest(
		resolveRuntimeManifestUrl(backend.path),
		fetchImpl,
		undefined,
		backend.maxAssetBytes
	);
	if (!manifest.compiler.provenance)
		throw new Error('Zig debug backend manifest requires Clang compiler provenance');
	if (backend.integrity['bin/c-sysroot.tar.gz']) {
		manifest.compiler.sysroot.profiles = {
			c: { asset: 'bin/c-sysroot.tar.gz' },
			cppAddon: { asset: 'bin/cpp-addon.tar.gz' }
		};
	}
	const runtime = new BrowserClangRuntime({
		runtimeBaseUrl: backend.path,
		manifest,
		fetchImpl,
		maxAssetBytes: backend.maxAssetBytes,
		log,
		persistentCache: false,
		stdout: (output) => {
			if (output) postMessage({ output });
		},
		stdin: () => '',
		progress: (percent) =>
			postMessage({ progress: { percent: percent * 100, stage: 'zig-debug-backend' } })
	});
	const bytes = await runtime.compileBitcodeArtifact(bitcode, {
		// Match Zig's WASI linker default; its freestanding target uses a smaller stack.
		stackSizeBytes: 16 * 1024 * 1024,
		maxWasmMemoryBytes: backend.maxWasmMemoryBytes
	});
	const module = await WebAssembly.compile(Uint8Array.from(bytes));
	if (
		!['.debug_info', '.debug_line'].every((name) =>
			WebAssembly.Module.customSections(module, name).some((section) => section.byteLength)
		)
	) {
		throw new Error('Zig debug backend did not preserve DWARF source information');
	}
	if (
		WebAssembly.Module.imports(module).some(
			(entry) => entry.module !== 'wasi_snapshot_preview1'
		)
	) {
		throw new Error('Zig debug backend left an unresolved non-WASI runtime import');
	}
	const sourceFiles = await Promise.all(
		sources.map(async (file) => ({
			...file,
			contentSha256: await sha256(new TextEncoder().encode(file.content))
		}))
	);
	const compiler = {
		name: 'zig',
		compilerSha256: zigReceipts['zig_small.wasm'].sha256,
		stdlibSha256: zigReceipts['std.tar.gz'].sha256,
		backend: {
			...manifest.compiler.provenance,
			manifestSha256: backend.integrity['runtime-manifest.v1.json'].sha256,
			assets: backend.integrity
		}
	};
	return {
		bytes,
		descriptor: {
			kind: 'dwarf',
			sourceRoot: '/workspace',
			moduleSha256: await sha256(bytes),
			files: sourceFiles.map(({ path, contentSha256 }) => ({ path, contentSha256 })),
			compiler
		},
		sources: sourceFiles
	};
}
