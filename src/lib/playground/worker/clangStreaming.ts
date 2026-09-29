import { compileVerifiedWasmAsset } from '@wasm-idle/llvm-core/core/verified-wasm';
import type { BrowserClangRuntime, ProgressSink } from '@wasm-idle/llvm-core/clang';
import { BUNDLED_CLANG_ASSET_INTEGRITY } from '../clangAssetIntegrity';
import { hasWorkerRuntimeModuleBridge } from './assets';
import { compileWorkerRuntimeAsset } from './runtimeModule';

// Capture before configureWorkerRuntimeAssets installs its whole-buffer fetch shim.
const nativeFetch = globalThis.fetch?.bind(globalThis);
const toolNames = ['bin/clang.wasm.gz', 'bin/lld.wasm.gz'] as const;

/** Application-only adapter. The host opts in only for the built-in trust profile. */
export function withVerifiedStreaming(
	Runtime: typeof BrowserClangRuntime,
	baseUrl: string,
	maxAssetBytes = 128 * 1024 * 1024,
	verifiedStreaming = true
): typeof BrowserClangRuntime {
	const bridgeModules = hasWorkerRuntimeModuleBridge();
	if (
		!bridgeModules &&
		(!verifiedStreaming ||
			!nativeFetch ||
			!globalThis.crypto?.subtle ||
			typeof DecompressionStream !== 'function')
	)
		return Runtime;
	const urls = new Map(toolNames.map((name) => [new URL(name, baseUrl).href, name]));
	// Scope the two immutable tool modules to this one runtime construction, not globals.
	const loads = new Map<string, Promise<WebAssembly.Module>>();
	return class extends Runtime {
		async getModule(url: string, progress?: ProgressSink, signal?: AbortSignal) {
			if (bridgeModules) {
				const root = new URL(baseUrl);
				const target = new URL(url, root);
				if (target.origin === root.origin && target.pathname.startsWith(root.pathname)) {
					signal?.throwIfAborted();
					const module = await compileWorkerRuntimeAsset(
						`${target.pathname.slice(root.pathname.length)}${target.search}`
					);
					signal?.throwIfAborted();
					progress?.set?.(1);
					return module;
				}
			}
			const name = urls.get(url);
			if (!name) return super.getModule(url, progress, signal);
			signal?.throwIfAborted();
			const cached = signal ? undefined : loads.get(url);
			if (cached) return cached;
			const operation = compileVerifiedWasmAsset(url, BUNDLED_CLANG_ASSET_INTEGRITY[name], {
				fetch: nativeFetch!,
				maxAssetBytes,
				signal,
				onProgress(loaded, total) {
					progress?.set?.(loaded / total);
					globalThis.postMessage?.({ assetProgress: { asset: name, loaded, total } });
				}
			});
			if (!signal) {
				loads.set(url, operation);
				void operation.catch(() => {
					if (loads.get(url) === operation) loads.delete(url);
				});
			}
			return operation;
		}
	};
}
