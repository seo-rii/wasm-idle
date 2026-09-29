import {
	BrowserClangRuntime,
	loadRuntimeManifest,
	resolveRuntimeManifestUrl,
	type ProgressSink
} from '@wasm-idle/llvm-core/clang';
import { configureWorkerRuntimeAssets, handleWorkerAssetMessage } from './assets';
import { compileWorkerRuntimeAsset } from './runtimeModule';
import { BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES } from '../clangAssetIntegrity';
import type { ClangCompileWorkerRequest, ClangCompileWorkerResponse } from '../clangWorkerProtocol';

const worker = globalThis as unknown as {
	onmessage: ((event: MessageEvent<ClangCompileWorkerRequest>) => void) | null;
	postMessage(message: ClangCompileWorkerResponse): void;
};
let started = false;

worker.onmessage = async ({ data }) => {
	if (handleWorkerAssetMessage(data)) return;
	if (started) return;
	started = true;
	const output: string[] = [];
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
		const runtime = new CachedRuntime({
			runtimeBaseUrl: data.runtimeBaseUrl,
			maxAssetBytes: data.maxAssetBytes,
			manifest,
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
		const artifact = await runtime.compileArtifact(data.request.code, data.request);
		worker.postMessage({ type: 'compiled', artifact, stdout: output.join(''), stderr: '' });
	} catch (error) {
		worker.postMessage({
			type: 'error',
			error: error instanceof Error ? error.message : String(error),
			stdout: output.join(''),
			stderr: ''
		});
	}
};
