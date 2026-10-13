import {
	BrowserClangRuntime,
	loadRuntimeManifest,
	extractCompilerDiagnostics,
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
import { OutputLimitError, resolveExecutionLimits } from '@wasm-idle/core';

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
	const encoder = new TextEncoder();
	let outputBytes = 0;
	let outputLimitError: OutputLimitError | undefined;
	const controller = new AbortController();
	let runtime: BrowserClangRuntime | undefined;
	try {
		const maxOutputBytes = resolveExecutionLimits(
			data.maxOutputBytes === undefined ? {} : { maxOutputBytes: data.maxOutputBytes }
		).maxOutputBytes;
		const checkOutputBytes = (additionalBytes: number) => {
			if (outputLimitError) throw outputLimitError;
			const actual = outputBytes + additionalBytes;
			if (actual <= maxOutputBytes) return;
			outputLimitError = new OutputLimitError(
				`Compiler output exceeded ${maxOutputBytes} bytes`,
				{ limit: maxOutputBytes, actual, phase: 'compile' }
			);
			const stdout = output.join('');
			// Report before retaining a chunk, including temporarily buffered PCH diagnostics.
			worker.postMessage({
				type: 'error',
				error: outputLimitError.message,
				code: 'output-limit',
				limit: maxOutputBytes,
				actual,
				stdout,
				diagnostics: extractCompilerDiagnostics(stdout),
				stderr: ''
			});
			// A header builder can recover close-time stream errors; prevent its cache write too.
			controller.abort(outputLimitError);
			throw outputLimitError;
		};
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
			signal: controller.signal,
			log: data.log ?? false,
			stdout: (chunk) => {
				if (!chunk) return;
				const bytes = encoder.encode(chunk).byteLength;
				checkOutputBytes(bytes);
				outputBytes += bytes;
				output.push(chunk);
			},
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
			onBufferedOutput: checkOutputBytes,
			persistentCache: data.persistentCache,
			precompiledHeader: data.precompiledHeader
		});
		if (outputLimitError) return;
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
		const stdout = output.join('');
		worker.postMessage({
			type: 'compiled',
			artifact,
			stdout,
			diagnostics: extractCompilerDiagnostics(stdout),
			stderr: '',
			...buildingPrecompiledHeader(runtime)
		});
	} catch (error) {
		if (outputLimitError) return;
		const stdout = output.join('');
		worker.postMessage({
			type: 'error',
			error: error instanceof Error ? error.message : String(error),
			stdout,
			diagnostics: extractCompilerDiagnostics(stdout),
			stderr: '',
			...buildingPrecompiledHeader(runtime)
		});
	}
	// The program runs in another worker while this one, already holding the compiler and
	// headers, prepares <bits/stdc++.h> for the next compile.
	if (runtime && buildingPrecompiledHeader(runtime).precompiledHeader) {
		const header = await runtime.buildPrecompiledHeader().catch(() => undefined);
		if (outputLimitError) return;
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
