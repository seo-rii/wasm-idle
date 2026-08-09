import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import {
	loadVerifiedDOuterAssets,
	snapshotDOuterAssetConfig,
	type DOuterAssetConfig
} from '$lib/playground/dOuterAssets';
import { createRuntimeAssetsKey, verifyRuntimeAssetIntegrity } from '@wasm-idle/core';

declare var self: any;

let stdinBufferD: Int32Array | null = null;
let runtimeConfig: DOuterAssetConfig | null = null;
let loadedRuntimeKey = '';
let runtimePromise: Promise<{
	compiler: any;
	executeBrowserDArtifact: (
		artifact: any,
		options?: {
			args?: string[];
			env?: Record<string, string>;
			stdin?: () => string | null;
			stdout?: (chunk: string) => void;
			stderr?: (chunk: string) => void;
		}
	) => Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
	}>;
}> | null = null;
let compiledArtifact: any = null;
let compiledCacheKey = '';

async function loadRuntime(config: DOuterAssetConfig) {
	const snapshot = snapshotDOuterAssetConfig(config);
	const runtimeKey = createRuntimeAssetsKey({ d: snapshot });
	if (!runtimeKey) throw new TypeError('D runtime asset key could not be created');
	if (loadedRuntimeKey === runtimeKey && runtimePromise) {
		return await runtimePromise;
	}
	loadedRuntimeKey = runtimeKey;
	compiledArtifact = null;
	compiledCacheKey = '';
	const pendingRuntime = (async () => {
		const { moduleBytes, manifestBytes } = await loadVerifiedDOuterAssets(snapshot);
		const moduleObjectUrl = URL.createObjectURL(
			new Blob([moduleBytes.slice().buffer], { type: 'text/javascript' })
		);
		let module: any;
		try {
			module = await import(/* @vite-ignore */ moduleObjectUrl);
		} finally {
			try {
				URL.revokeObjectURL(moduleObjectUrl);
			} catch {
				// Cleanup must not replace module import success or failure.
			}
		}
		const factory =
			typeof module.createDCompiler === 'function'
				? module.createDCompiler
				: typeof module.default === 'function'
					? module.default
					: null;
		if (!factory) {
			throw new Error('wasm-d module must export createDCompiler or a default factory');
		}
		if (typeof module.executeBrowserDArtifact !== 'function') {
			throw new Error('wasm-d module must export executeBrowserDArtifact');
		}
		if (typeof module.parseRuntimeManifest !== 'function') {
			throw new Error('wasm-d module must export parseRuntimeManifest');
		}
		const manifestSource = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
		const manifest = module.parseRuntimeManifest(JSON.parse(manifestSource));
		const manifestUrl = new URL(snapshot.manifestUrl);
		const runtimeBaseUrl = new URL('./', manifestUrl);
		runtimeBaseUrl.search = manifestUrl.search;
		return {
			compiler: await factory({
				runtimeBaseUrl: runtimeBaseUrl.href,
				manifest,
				verifyRuntimeAssetIntegrity
			}),
			executeBrowserDArtifact: module.executeBrowserDArtifact
		};
	})();
	runtimePromise = pendingRuntime;
	try {
		return await pendingRuntime;
	} catch (error) {
		if (runtimePromise === pendingRuntime && loadedRuntimeKey === runtimeKey) {
			runtimePromise = null;
			loadedRuntimeKey = '';
		}
		throw error;
	}
}

function normalizeDiagnostic(diagnostic: any) {
	return {
		fileName: diagnostic?.fileName ?? null,
		lineNumber: Math.max(1, Number(diagnostic?.lineNumber || 1)),
		columnNumber:
			typeof diagnostic?.columnNumber === 'number'
				? Math.max(1, diagnostic.columnNumber)
				: undefined,
		severity:
			diagnostic?.severity === 'warning' || diagnostic?.severity === 'other'
				? diagnostic.severity
				: 'error',
		message: String(diagnostic?.message || '')
	};
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		manifestUrl: nextManifestUrl,
		outerIntegrity,
		buffer,
		code,
		prepare,
		args = [],
		stdin,
		fileName = 'main.d',
		log
	} = event.data;
	try {
		if (load) {
			runtimeConfig = snapshotDOuterAssetConfig({
				moduleUrl: nextModuleUrl,
				manifestUrl: nextManifestUrl,
				integrity: outerIntegrity
			});
			if (log) console.log(`[wasm-idle:d-worker] load moduleUrl=${runtimeConfig.moduleUrl}`);
			await loadRuntime(runtimeConfig);
			postMessage({ load: true });
			return;
		}

		stdinBufferD = new Int32Array(buffer);
		if (!runtimeConfig) throw new Error('D runtime has not been loaded');
		const runtime = await loadRuntime(runtimeConfig);
		const compileCacheKey = `${fileName}\n${code}`;
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:d-worker] compile start prepare=${String(prepare)} file=${fileName} bytes=${code.length}`
				);
			}
			const result = await runtime.compiler.compile({
				code,
				fileName,
				target: 'wasm32-wasi',
				log,
				onProgress(progress: unknown) {
					postMessage({ progress });
				}
			});
			if (log) {
				console.log(
					`[wasm-idle:d-worker] compile settled success=${String(result.success)} hasWasm=${String(Boolean(result.artifact?.wasm))} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
				);
			}
			for (const diagnostic of result.diagnostics || []) {
				postMessage({ diagnostic: normalizeDiagnostic(diagnostic) });
			}
			if (result.stdout) postMessage({ output: result.stdout });
			if (!result.success) {
				throw new Error(
					result.stderr ||
						result.diagnostics
							?.map((diagnostic: any) => diagnostic.message)
							.join('\n') ||
						'D compilation failed'
				);
			}
			if (result.stderr) postMessage({ output: result.stderr });
			if (!result.artifact?.wasm && !result.artifact?.bytes) {
				throw new Error('wasm-d did not return a wasm artifact');
			}
			compiledArtifact = result.artifact;
			compiledCacheKey = compileCacheKey;
		}

		if (prepare) {
			postMessage({ results: true });
			return;
		}

		const hasInitialStdin = typeof stdin === 'string';
		let initialStdin: string | null = hasInitialStdin ? stdin : null;
		const execution = await runtime.executeBrowserDArtifact(compiledArtifact, {
			args,
			env: {
				USER: 'jungol'
			},
			stdin: () => {
				if (hasInitialStdin) {
					const chunk = initialStdin;
					initialStdin = null;
					if (log) {
						console.log(
							chunk == null
								? '[wasm-idle:d-stdin] read(bytes=0, eof=true)'
								: `[wasm-idle:d-stdin] read(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
						);
					}
					return chunk;
				}
				const chunk = waitForBufferedStdin(stdinBufferD!, () =>
					postMessage({ buffer: true })
				);
				if (chunk == null) {
					if (log) console.log('[wasm-idle:d-stdin] read(bytes=0, eof=true)');
					return null;
				}
				if (log) {
					console.log(
						`[wasm-idle:d-stdin] read(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
					);
				}
				return chunk;
			},
			stdout: (output: string) => {
				if (output) postMessage({ output });
			},
			stderr: (output: string) => {
				if (output) postMessage({ output });
			}
		});
		if (execution.exitCode !== 0) {
			throw new Error(
				execution.stderr
					? `D program exited with code ${execution.exitCode}\n${execution.stderr}`
					: `D program exited with code ${execution.exitCode}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) console.error('[wasm-idle:d-worker] failed', error);
		postMessage({ error: error?.message || String(error) });
	}
};
