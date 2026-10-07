import { BrowserClangRuntime, executeBrowserClangArtifact } from '@wasm-idle/llvm-core/clang';
import { compileVerifiedWasmAsset } from '@wasm-idle/llvm-core/core/verified-wasm';
import {
	readPersistentRuntimeAsset,
	writePersistentRuntimeAsset,
	verifyRuntimeAssetIntegrity
} from '@wasm-idle/core';

const nativeFetch = globalThis.fetch.bind(globalThis);
let runtime: BrowserClangRuntime | undefined;
let stages: { stage: string; ms: number }[] = [];
let epoch = 0;

self.onmessage = async ({ data: { spec, warm } }) => {
	const start = performance.now();
	try {
		if (!warm || !runtime) {
			epoch = start;
			stages = [];
			const cache = { namespace: spec.namespace };
			// The ordinary host bridge verifies and persists MemFS/sysroot bytes too.
			// This controlled runtime adapter uses that same backend and receipt policy.
			globalThis.fetch = async (input, init) => {
				const url = String(input);
				const receipt = spec.receipts[url];
				if (!receipt) return nativeFetch(input, init);
				const identity = {
					url,
					sha256: receipt.sha256,
					bytes: receipt.bytes,
					validationKey: 'compiler-perf-v1'
				};
				const cached = await readPersistentRuntimeAsset({ identity, cache });
				if (cached) return new Response(Uint8Array.from(cached));
				const response = await nativeFetch(input, init);
				if (!response.ok) throw new Error(`Asset fetch failed ${response.status}`);
				const bytes = new Uint8Array(await response.arrayBuffer());
				await verifyRuntimeAssetIntegrity({
					asset: url,
					bytes,
					expected: receipt,
					stage: 'compressed'
				});
				await writePersistentRuntimeAsset({ identity, cache, bytes });
				return new Response(bytes);
			};
			const loads = new Map<string, Promise<WebAssembly.Module>>();
			class VerifiedRuntime extends BrowserClangRuntime {
				async getCompilerFingerprint() {
					return spec.receipts[this.assetUrls.clang].uncompressedSha256;
				}
				async getModule(
					url: string,
					progress?: { set?: (value: number) => void },
					signal?: AbortSignal
				) {
					if (!/\/(clang|lld)\.wasm\.gz$/.test(url))
						return super.getModule(url, progress, signal);
					if (loads.has(url)) return loads.get(url)!;
					const name = url.includes('/clang.wasm') ? 'clang' : 'lld';
					stages.push({ stage: `${name}-prepare-start`, ms: performance.now() - epoch });
					const loading = compileVerifiedWasmAsset(url, spec.receipts[url], {
						fetch: nativeFetch,
						maxAssetBytes: 128 * 1024 * 1024,
						persistentCache: cache,
						signal,
						onProgress: (loaded, total) => progress?.set?.(loaded / total)
					}).then((module) => {
						stages.push({
							stage: `${name}-prepare-finished`,
							ms: performance.now() - epoch
						});
						return module;
					});
					loads.set(url, loading);
					return loading;
				}
			}
			runtime = new VerifiedRuntime({
				runtimeBaseUrl: spec.baseUrl,
				manifest: spec.manifest,
				persistentCache: cache,
				stdout: () => {},
				log: false
			});
			await runtime.ready;
			stages.push({ stage: 'runtime-ready', ms: performance.now() - epoch });
		}
		const preparationMs = performance.now() - start;
		const results = [];
		for (const workload of spec.workloads) {
			const began = performance.now();
			const artifact = await runtime.compileArtifact(workload.source, {
				language: workload.language,
				compileArgs: workload.args,
				cppVersion: workload.standard,
				cVersion: workload.standard
			});
			const compiled = performance.now();
			let firstOutputMs: number | undefined;
			const output = await executeBrowserClangArtifact(artifact, {
				stdout: () => {
					firstOutputMs ??= performance.now() - start;
				}
			});
			if (output.exitCode !== 0 || output.stdout !== workload.expected)
				throw new Error(`${workload.name} output ${JSON.stringify(output)}`);
			results.push({
				name: workload.name,
				compileLinkMs: compiled - began,
				executeMs: performance.now() - compiled,
				firstOutputMs,
				elapsedMs: performance.now() - start,
				stdout: output.stdout,
				emittedBytes: artifact.bytes.byteLength
			});
		}
		self.postMessage({ preparationMs, totalMs: performance.now() - start, stages, results });
	} catch (error) {
		self.postMessage({
			error: error instanceof Error ? error.stack || error.message : String(error)
		});
	}
};
