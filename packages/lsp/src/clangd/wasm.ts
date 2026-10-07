import { verifyRuntimeAssetIntegrity } from '@wasm-idle/core';
import { decompressGzip } from '@wasm-idle/llvm-core';
import {
	compileVerifiedWasmAsset,
	type VerifiedWasmReceipt
} from '@wasm-idle/llvm-core/core/verified-wasm';
import {
	loadLanguageToolAsset,
	requireAllowedAssetUrl,
	type ResolvedLanguageToolAssetConfig
} from '../assets.js';
import { runWithSignalAndTimeout } from '../lifecycle.js';
import { resolveLanguageToolPersistentOptions } from '../persistent-assets.js';

export interface PreparedClangdWasm {
	module: WebAssembly.Module;
	bytes: number;
	sha256: string;
}

// Modules are shared within the host realm, including across replaced LSP workers.
// The byte budget represents engine input bytes, not an estimate of engine memory.
const modules = new Map<string, PreparedClangdWasm>();
const loaderIds = new WeakMap<object, number>();
let nextLoaderId = 1;
const MAX_BYTES = 128 * 1024 * 1024;
const MODULE_BUDGET = 256 * 1024 * 1024;

function cacheKey(config: ResolvedLanguageToolAssetConfig, digest: string) {
	if (config.loader && !loaderIds.has(config.loader))
		loaderIds.set(config.loader, nextLoaderId++);
	return JSON.stringify([
		config.baseUrl,
		config.allowedBaseUrls,
		config.cache,
		config.redirect,
		config.requireExactResponseUrl,
		config.integrity?.['clangd.wasm.gz'],
		config.loader ? loaderIds.get(config.loader) : null,
		digest
	]);
}

function remember(key: string, value: PreparedClangdWasm) {
	modules.delete(key);
	modules.set(key, value);
	let bytes = [...modules.values()].reduce((total, entry) => total + entry.bytes, 0);
	while (modules.size > 2 || bytes > MODULE_BUDGET) {
		const first = modules.entries().next().value!;
		bytes -= first[1].bytes;
		modules.delete(first[0]);
	}
	return value;
}

export async function prepareClangdWasm(
	config: ResolvedLanguageToolAssetConfig,
	reportProgress: (loaded: number, total?: number) => void,
	lifecycle: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<PreparedClangdWasm> {
	return runWithSignalAndTimeout(
		async (signal) => {
			const expected = config.integrity?.['clangd.wasm.gz'];
			const receipt = typeof expected === 'object' ? expected : undefined;
			const fullReceipt =
				receipt &&
				[receipt.bytes, receipt.uncompressedBytes].every(
					(n) => Number.isSafeInteger(n) && n! > 0 && n! <= MAX_BYTES
				) &&
				[receipt.sha256, receipt.uncompressedSha256].every((hash) =>
					/^[a-f0-9]{64}$/.test(hash || '')
				);
			// Data loaders retain their ownership and validation behavior. Native streaming
			// requires both transport and logical receipts and native gzip support.
			if (
				!config.loader &&
				fullReceipt &&
				typeof DecompressionStream === 'function' &&
				!receipt.mediaType
			) {
				const key = cacheKey(config, receipt.uncompressedSha256!);
				const cached = modules.get(key);
				if (cached) {
					signal.throwIfAborted();
					reportProgress(cached.bytes, cached.bytes);
					return remember(key, cached);
				}
				const url = requireAllowedAssetUrl('clangd.wasm.gz', 'clangd.wasm.gz', config);
				const module = await compileVerifiedWasmAsset(
					url.href,
					receipt as VerifiedWasmReceipt,
					{
						maxAssetBytes: MAX_BYTES,
						persistentCache:
							resolveLanguageToolPersistentOptions(config).persistentCache,
						validationKey: key,
						signal,
						onProgress: reportProgress,
						fetch: (input, init) =>
							fetch(input, {
								...init,
								redirect: config.redirect ?? 'follow',
								...(config.cache ? { cache: config.cache } : {})
							}),
						validateResponse: (response, requested) => {
							if (
								config.requireExactResponseUrl &&
								(!response.url || new URL(response.url).href !== requested.href)
							)
								throw new Error(
									'Runtime asset clangd.wasm.gz returned an unexpected final URL'
								);
							requireAllowedAssetUrl(
								'clangd.wasm.gz',
								response.url || requested.href,
								config
							);
						}
					}
				);
				return remember(key, {
					module,
					bytes: receipt.uncompressedBytes!,
					sha256: receipt.uncompressedSha256!
				});
			}
			const loaded = await loadLanguageToolAsset(
				'clangd',
				'clangd.wasm.gz',
				config,
				reportProgress,
				{ signal, timeoutMs: lifecycle.timeoutMs }
			);
			const bytes = await decompressGzip(loaded.bytes, 'clangd.wasm.gz', MAX_BYTES, signal);
			if (bytes.byteLength > MAX_BYTES)
				throw new Error('clangd Wasm exceeds the runtime byte limit');
			if (
				receipt &&
				(receipt.uncompressedSha256 !== undefined ||
					receipt.uncompressedBytes !== undefined)
			)
				await verifyRuntimeAssetIntegrity({
					asset: 'clangd.wasm.gz',
					bytes,
					expected: receipt,
					stage: 'uncompressed',
					mimeType: 'application/wasm',
					runtimeId: 'clangd'
				});
			signal.throwIfAborted();
			const sha256 = Array.from(
				new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))),
				(b) => b.toString(16).padStart(2, '0')
			).join('');
			const key = cacheKey(config, sha256);
			const cached = modules.get(key);
			const module = cached?.module ?? (await WebAssembly.compile(Uint8Array.from(bytes)));
			signal.throwIfAborted();
			return remember(key, { module, bytes: bytes.byteLength, sha256 });
		},
		{
			signal: lifecycle.signal,
			timeoutMs: lifecycle.timeoutMs ?? 120_000,
			operationName: 'clangd Wasm preparation',
			timeoutError: () => new Error('Timed out preparing clangd Wasm')
		}
	);
}
