import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';

declare var self: any;

self.document = {
	querySelectorAll() {
		return [];
	}
};

let stdinBufferGo: Int32Array | null = null;
let compilerUrl = '';
let loadedCompilerUrl = '';
let compilerPromise: Promise<{
	compiler: any;
	executeBrowserGoArtifact: (
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

async function loadCompiler(url: string) {
	if (!url) {
		throw new Error(
			'Go runtime is not configured. Set PUBLIC_WASM_GO_COMPILER_URL or runtimeAssets.go.compilerUrl.'
		);
	}
	if (loadedCompilerUrl === url && compilerPromise) {
		return await compilerPromise;
	}
	loadedCompilerUrl = url;
	compiledArtifact = null;
	compiledCacheKey = '';
	compilerPromise = (async () => {
		const module = await import(/* @vite-ignore */ url);
		const factory =
			typeof module.createGoCompiler === 'function'
				? module.createGoCompiler
				: typeof module.default === 'function'
					? module.default
					: null;
		if (!factory) {
			throw new Error('wasm-go module must export createGoCompiler or a default factory');
		}
		if (typeof module.executeBrowserGoArtifact !== 'function') {
			throw new Error('wasm-go module must export executeBrowserGoArtifact');
		}
		return {
			compiler: await factory(),
			executeBrowserGoArtifact: module.executeBrowserGoArtifact
		};
	})();
	return await compilerPromise;
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
	const { load, compilerUrl: nextCompilerUrl, buffer, code, prepare, args = [], log } = event.data;
	try {
		if (load) {
			compilerUrl = nextCompilerUrl;
			if (log) {
				console.log(`[wasm-idle:go-worker] load compilerUrl=${compilerUrl}`);
			}
			await loadCompiler(compilerUrl);
			postMessage({ load: true });
			return;
		}

		stdinBufferGo = new Int32Array(buffer);
		const runtime = await loadCompiler(compilerUrl);
		const compileCacheKey = code;
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:go-worker] compile start prepare=${String(prepare)} bytes=${code.length}`
				);
			}
			const result = await runtime.compiler.compile({
				code,
				target: 'wasip1/wasm',
				prepare,
				log,
				onProgress(progress: unknown) {
					postMessage({ progress });
				}
			});
			if (log) {
				console.log(
					`[wasm-idle:go-worker] compile settled success=${String(result.success)} hasWasm=${String(Boolean(result.artifact?.wasm))} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
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
						'Go compilation failed'
				);
			}
			if (result.stderr) postMessage({ output: result.stderr });
			if (!result.artifact?.wasm) {
				throw new Error('wasm-go did not return a wasm artifact');
			}
			compiledArtifact = result.artifact;
			compiledCacheKey = compileCacheKey;
			if (log) {
				console.log(
					`[wasm-idle:go-worker] cached artifact target=${compiledArtifact.target} format=${compiledArtifact.format}`
				);
			}
		}

		if (prepare) {
			if (log) {
				console.log('[wasm-idle:go-worker] prepare complete');
			}
			postMessage({ results: true });
			return;
		}

		if (log) {
			console.log(
				`[wasm-idle:go-worker] runtime start target=${compiledArtifact.target} format=${compiledArtifact.format}`
			);
		}
		const execution = await runtime.executeBrowserGoArtifact(compiledArtifact, {
			args,
			env: {
				USER: 'jungol'
			},
			stdin: () => {
				const chunk = waitForBufferedStdin(stdinBufferGo!, () => postMessage({ buffer: true }));
				if (chunk == null) {
					if (log) {
						console.log('[wasm-idle:go-stdin] fd_read(bytes=0, eof=true)');
					}
					return null;
				}
				if (log) {
					console.log(
						`[wasm-idle:go-stdin] fd_fill(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
					);
				}
				return chunk;
			},
			stdout: (output) => {
				if (output) {
					postMessage({ output });
				}
			},
			stderr: (output) => {
				if (output) {
					postMessage({ output });
				}
			}
		});
		if (log) {
			console.log(
				`[wasm-idle:go-worker] wasi run complete exitCode=${String(execution.exitCode)}`
			);
		}
		if (execution.exitCode !== 0) {
			throw new Error(
				execution.stderr
					? `Go program exited with code ${execution.exitCode}\n${execution.stderr}`
					: `Go program exited with code ${execution.exitCode}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:go-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
