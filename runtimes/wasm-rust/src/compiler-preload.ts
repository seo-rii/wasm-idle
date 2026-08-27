import { resolveVersionedAssetUrl } from './asset-url.js';
import { fetchRuntimeAssetBytes, hasRegisteredRuntimeAssetReceipt } from './runtime-asset.js';
import { PREVIEW2_COMPONENT_RUNTIME_ASSETS } from './browser-component-tools.js';
import { loadBundledRuntimeContext } from './compiler-runtime.js';
import {
	hasVerifiedRuntimeExecutableModuleUrls,
	isIntegratedCompilerOutput,
	loadRuntimeManifest,
	resolveRuntimeAssetUrl
} from './runtime-manifest.js';
import type { WasmRustRuntimeProfile } from './runtime-manifest.js';
import type { SupportedTargetTriple } from './types.js';

export interface PreloadBrowserRustRuntimeDependencies {
	loadManifest?: typeof loadRuntimeManifest;
	fetchImpl?: typeof fetch;
	importRuntimeModule?: <T>(assetUrl: string) => Promise<T>;
	runtimeProfile?: WasmRustRuntimeProfile;
}

export interface PreloadBrowserRustRuntimeOptions {
	targetTriple?: SupportedTargetTriple;
	dependencies?: PreloadBrowserRustRuntimeDependencies;
}

const rustRuntimePreloadCache = new Map<string, Promise<void>>();

export async function preloadBrowserRustRuntime(options: PreloadBrowserRustRuntimeOptions = {}) {
	const defaultImportRuntimeModule = <T>(assetUrl: string) =>
		import(/* @vite-ignore */ assetUrl) as Promise<T>;
	const runPreload = async () => {
		const fetchImpl = options.dependencies?.fetchImpl || fetch;
		const importRuntimeModule =
			options.dependencies?.importRuntimeModule || defaultImportRuntimeModule;
		const preloadAsset = async (assetUrl: string, assetLabel: string) => {
			if (hasRegisteredRuntimeAssetReceipt(assetUrl)) {
				await fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl, false);
				return;
			}
			const response = await fetchImpl(assetUrl);
			if (!response.ok) {
				throw new Error(
					`failed to preload ${assetLabel} from ${assetUrl} (status ${response.status})`
				);
			}
			await response.arrayBuffer();
		};
		const { manifest, targetConfig, versionedModuleBaseUrl, versionedRuntimeBaseUrl } =
			await loadBundledRuntimeContext(
				options.dependencies?.loadManifest,
				options.targetTriple,
				options.dependencies?.runtimeProfile
			);
		const assetPreloads = [
			preloadAsset(
				resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, manifest.compiler.rustcWasm),
				`wasm-rust runtime asset ${manifest.compiler.rustcWasm}`
			)
		];
		if (!hasVerifiedRuntimeExecutableModuleUrls()) {
			assetPreloads.push(
				preloadAsset(
					resolveVersionedAssetUrl(
						versionedModuleBaseUrl,
						'./compiler-worker.js'
					).toString(),
					'wasm-rust compiler worker'
				),
				preloadAsset(
					resolveVersionedAssetUrl(
						versionedModuleBaseUrl,
						'./rustc-thread-worker.js'
					).toString(),
					'wasm-rust rustc thread worker'
				)
			);
		}
		if (!isIntegratedCompilerOutput(targetConfig.compile)) {
			assetPreloads.push(
				preloadAsset(
					resolveRuntimeAssetUrl(
						versionedRuntimeBaseUrl,
						targetConfig.compile.llvm.llcWasm || 'llvm/llc.wasm'
					),
					`wasm-rust runtime asset ${targetConfig.compile.llvm.llcWasm || 'llvm/llc.wasm'}`
				),
				preloadAsset(
					resolveRuntimeAssetUrl(
						versionedRuntimeBaseUrl,
						targetConfig.compile.llvm.lldWasm || 'llvm/lld.wasm'
					),
					`wasm-rust runtime asset ${targetConfig.compile.llvm.lldWasm || 'llvm/lld.wasm'}`
				),
				preloadAsset(
					resolveRuntimeAssetUrl(
						versionedRuntimeBaseUrl,
						targetConfig.compile.llvm.lldData || 'llvm/lld.data'
					),
					`wasm-rust runtime asset ${targetConfig.compile.llvm.lldData || 'llvm/lld.data'}`
				)
			);
		}
		if (targetConfig.sysrootPack) {
			assetPreloads.push(
				preloadAsset(
					resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.sysrootPack.index),
					`wasm-rust runtime asset ${targetConfig.sysrootPack.index}`
				),
				preloadAsset(
					resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.sysrootPack.asset),
					`wasm-rust runtime asset ${targetConfig.sysrootPack.asset}`
				)
			);
		} else if (targetConfig.sysrootFiles) {
			for (const entry of targetConfig.sysrootFiles) {
				assetPreloads.push(
					preloadAsset(
						resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, entry.asset),
						`wasm-rust runtime asset ${entry.asset}`
					)
				);
			}
		}
		const modulePreloads: Array<Promise<unknown>> = [];
		if (!isIntegratedCompilerOutput(targetConfig.compile)) {
			if (targetConfig.compile.link.pack) {
				assetPreloads.push(
					preloadAsset(
						resolveRuntimeAssetUrl(
							versionedRuntimeBaseUrl,
							targetConfig.compile.link.pack.index
						),
						`wasm-rust runtime asset ${targetConfig.compile.link.pack.index}`
					),
					preloadAsset(
						resolveRuntimeAssetUrl(
							versionedRuntimeBaseUrl,
							targetConfig.compile.link.pack.asset
						),
						`wasm-rust runtime asset ${targetConfig.compile.link.pack.asset}`
					)
				);
			} else {
				if (targetConfig.compile.link.allocatorObjectAsset) {
					assetPreloads.push(
						preloadAsset(
							resolveRuntimeAssetUrl(
								versionedRuntimeBaseUrl,
								targetConfig.compile.link.allocatorObjectAsset
							),
							`wasm-rust runtime asset ${targetConfig.compile.link.allocatorObjectAsset}`
						)
					);
				}
				for (const entry of targetConfig.compile.link.files || []) {
					assetPreloads.push(
						preloadAsset(
							resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, entry.asset),
							`wasm-rust runtime asset ${entry.asset}`
						)
					);
				}
			}
			modulePreloads.push(
				importRuntimeModule(
					resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.compile.llvm.llc)
				),
				importRuntimeModule(
					resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, targetConfig.compile.llvm.lld)
				)
			);
		}
		if (
			targetConfig.compile.kind === 'llvm-wasm+component-encoder' ||
			targetConfig.compile.kind === 'integrated-rustc+component-encoder' ||
			targetConfig.execution.kind === 'preview2-component'
		) {
			for (const assetPath of PREVIEW2_COMPONENT_RUNTIME_ASSETS) {
				if (assetPath.endsWith('.js')) {
					modulePreloads.push(
						importRuntimeModule(
							resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, assetPath)
						)
					);
					continue;
				}
				assetPreloads.push(
					preloadAsset(
						resolveRuntimeAssetUrl(versionedRuntimeBaseUrl, assetPath),
						`wasm-rust runtime asset ${assetPath}`
					)
				);
			}
		}
		await Promise.all([...assetPreloads, ...modulePreloads]);
	};
	if (
		options.dependencies?.loadManifest ||
		options.dependencies?.fetchImpl ||
		options.dependencies?.importRuntimeModule
	) {
		await runPreload();
		return;
	}
	const profile = options.dependencies?.runtimeProfile;
	const cacheKey = [
		options.targetTriple || '__default__',
		profile?.protocolVersion ?? 'legacy',
		profile?.profileId ?? 'legacy',
		profile?.manifestFingerprint ?? 'legacy',
		profile?.manifestReceipt.bytes ?? 'legacy',
		profile?.manifestReceipt.sha256 ?? 'legacy',
		profile?.moduleUrl ?? 'legacy'
	].join('\0');
	let cachedPreload = rustRuntimePreloadCache.get(cacheKey);
	if (!cachedPreload) {
		cachedPreload = runPreload();
		rustRuntimePreloadCache.set(cacheKey, cachedPreload);
		cachedPreload.catch(() => {
			if (rustRuntimePreloadCache.get(cacheKey) === cachedPreload) {
				rustRuntimePreloadCache.delete(cacheKey);
			}
		});
	}
	await cachedPreload;
}
