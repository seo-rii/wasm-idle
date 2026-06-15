import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';

declare var self: any;

let stdinBufferD: Int32Array | null = null;
let moduleUrl = '';
let loadedModuleUrl = '';
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

async function loadRuntime(url: string) {
	if (!url) {
		throw new Error(
			'D runtime is not configured. Set PUBLIC_WASM_D_MODULE_URL or runtimeAssets.d.moduleUrl.'
		);
	}
	if (loadedModuleUrl === url && runtimePromise) {
		return await runtimePromise;
	}
	loadedModuleUrl = url;
	compiledArtifact = null;
	compiledCacheKey = '';
	runtimePromise = (async () => {
		const module = await import(/* @vite-ignore */ url);
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
		const runtimeBaseUrl = new URL('runtime/', url).href;
		return {
			compiler: await factory({ runtimeBaseUrl }),
			executeBrowserDArtifact: module.executeBrowserDArtifact
		};
	})();
	return await runtimePromise;
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
			moduleUrl = nextModuleUrl;
			if (log) console.log(`[wasm-idle:d-worker] load moduleUrl=${moduleUrl}`);
			await loadRuntime(moduleUrl);
			postMessage({ load: true });
			return;
		}

		stdinBufferD = new Int32Array(buffer);
		const runtime = await loadRuntime(moduleUrl);
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
						result.diagnostics?.map((diagnostic: any) => diagnostic.message).join('\n') ||
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
				const chunk = waitForBufferedStdin(stdinBufferD!, () => postMessage({ buffer: true }));
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
			stdout: (output) => {
				if (output) postMessage({ output });
			},
			stderr: (output) => {
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
