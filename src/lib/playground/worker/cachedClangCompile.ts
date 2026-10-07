import {
	BrowserClangRuntime,
	loadRuntimeManifest,
	resolveRuntimeManifestUrl,
	type ProgressSink
} from '@wasm-idle/llvm-core/clang';
import { configureWorkerRuntimeAssets, handleWorkerAssetMessage } from './assets';
import { compileWorkerRuntimeAsset } from './runtimeModule';
import {
	BUNDLED_CLANG_ASSET_INTEGRITY,
	BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES
} from '../clangAssetIntegrity';
import type { ClangCompileWorkerRequest, ClangCompileWorkerResponse } from '../clangWorkerProtocol';

const worker = globalThis as unknown as {
	onmessage: ((event: MessageEvent<ClangCompileWorkerRequest>) => void) | null;
	postMessage(message: ClangCompileWorkerResponse, transfer?: Transferable[]): void;
};
let started = false;

worker.onmessage = async ({ data }) => {
	if (handleWorkerAssetMessage(data)) return;
	if (started) return;
	started = true;
	const output: string[] = [];
	let runtime: BrowserClangRuntime | undefined;
	try {
		if (data.request.debug || (data.request.debugMode && data.request.debugMode !== 'none')) {
			throw new Error('Cached C/C++ execution does not support debug artifacts.');
		}
		configureWorkerRuntimeAssets(data.assets);
		const manifest = await loadRuntimeManifest(
			resolveRuntimeManifestUrl(data.runtimeBaseUrl),
			fetch,
			undefined,
			data.maxAssetBytes
		);
		if (data.languageSysroots)
			manifest.compiler.sysroot.profiles = BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES;
		const moduleAssets = new Map(
			[
				[
					manifest.compiler.clang.asset,
					new URL(manifest.compiler.clang.asset, data.runtimeBaseUrl).href
				],
				[
					manifest.compiler.lld.asset,
					new URL(manifest.compiler.lld.asset, data.runtimeBaseUrl).href
				]
			].map(([asset, url]) => [url, asset])
		);
		class CachedRuntime extends BrowserClangRuntime {
			async getCompilerFingerprint() {
				// This worker is selected only for the bundled, integrity-checked host profile.
				return BUNDLED_CLANG_ASSET_INTEGRITY['bin/clang.wasm.gz'].sha256;
			}
			async getModule(url: string, progress?: ProgressSink, signal?: AbortSignal) {
				const asset = moduleAssets.get(url);
				if (!asset) return super.getModule(url, progress, signal);
				signal?.throwIfAborted();
				const module = await compileWorkerRuntimeAsset(asset);
				signal?.throwIfAborted();
				progress?.set?.(1);
				return module;
			}
		}
		// Every source cache miss gets fresh compiler memory and files. The host
		// session keeps the immutable tool Modules and verified asset bytes alive.
		runtime = new CachedRuntime({
			runtimeBaseUrl: data.runtimeBaseUrl,
			maxAssetBytes: data.maxAssetBytes,
			manifest,
			persistentCache: data.persistentCache,
			log: data.log ?? false,
			stdout: (chunk) => output.push(chunk),
			progress: (value) =>
				worker.postMessage({
					type: 'progress',
					progress: {
						stage: 'bootstrap',
						completed: Math.round(value * 100),
						total: 100,
						percent: value * 100,
						message: 'Loading compiler runtime'
					}
				})
		});
		await runtime.ready;
		worker.postMessage({
			type: 'progress',
			progress: {
				stage: 'compile',
				completed: 0,
				total: 100,
				percent: 0,
				message: 'Compiling source'
			}
		});
		const artifact = await runtime.compileArtifact(data.request.code, {
			...data.request,
			persistentCache: data.persistentCache,
			precompiledHeader: data.precompiledHeader
		});
		if (runtime.usedPrecompiledHeader)
			worker.postMessage({
				type: 'progress',
				progress: {
					stage: 'compile',
					completed: 100,
					total: 100,
					percent: 100,
					message: 'Compiled with precompiled <bits/stdc++.h>'
				}
			});
		worker.postMessage({
			type: 'compiled',
			artifact,
			stdout: output.join(''),
			stderr: '',
			...buildingPrecompiledHeader(runtime)
		});
	} catch (error) {
		worker.postMessage({
			type: 'error',
			error: error instanceof Error ? error.message : String(error),
			stdout: output.join(''),
			stderr: '',
			...buildingPrecompiledHeader(runtime)
		});
	}
	// The program runs in another worker while this one, already holding the compiler and
	// headers, prepares <bits/stdc++.h> for the next compile.
	if (runtime && buildingPrecompiledHeader(runtime).precompiledHeader) {
		const header = await runtime.buildPrecompiledHeader().catch(() => undefined);
		worker.postMessage(
			{ type: 'precompiled-header', header },
			header ? [header.bytes.buffer] : []
		);
	}
};

function buildingPrecompiledHeader(runtime: BrowserClangRuntime | undefined) {
	return runtime?.precompiledHeaderPlan && !runtime.usedPrecompiledHeader
		? { precompiledHeader: 'building' as const }
		: {};
}
