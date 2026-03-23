import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';

declare var self: any;

self.document = {
	querySelectorAll() {
		return [];
	}
};

let stdinBufferRust: Int32Array | null = null;
let compilerUrl = '';
let runtimeBaseUrl = '';
let loadedCompilerUrl = '';
let compilerPromise: Promise<{
	compiler: any;
	executeBrowserRustArtifact: (
		artifact: any,
		runtimeBaseUrl: string,
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
			'Rust runtime is not configured. Set PUBLIC_WASM_RUST_COMPILER_URL or runtimeAssets.rust.compilerUrl.'
		);
	}
	if (loadedCompilerUrl === url && compilerPromise) {
		return await compilerPromise;
	}
	loadedCompilerUrl = url;
	try {
		runtimeBaseUrl = new URL('./runtime/', url).toString();
	} catch {
		runtimeBaseUrl = url;
	}
	compiledArtifact = null;
	compiledCacheKey = '';
	compilerPromise = (async () => {
		const module = await import(/* @vite-ignore */ url);
		const factory =
			typeof module.createRustCompiler === 'function'
				? module.createRustCompiler
				: typeof module.default === 'function'
					? module.default
					: null;
		if (!factory) {
			throw new Error(
				'wasm-rust module must export createRustCompiler or a default factory'
			);
		}
		if (typeof module.executeBrowserRustArtifact !== 'function') {
			throw new Error('wasm-rust module must export executeBrowserRustArtifact');
		}
		return {
			compiler: await factory(),
			executeBrowserRustArtifact: module.executeBrowserRustArtifact
		};
	})();
	return await compilerPromise;
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		compilerUrl: nextCompilerUrl,
		buffer,
		code,
		prepare,
		args = [],
		targetTriple = 'wasm32-wasip1',
		log
	} = event.data;
	try {
		if (load) {
			compilerUrl = nextCompilerUrl;
			if (log) {
				console.log(`[wasm-idle:rust-worker] load compilerUrl=${compilerUrl}`);
			}
			await loadCompiler(compilerUrl);
			postMessage({ load: true });
			return;
		}

		stdinBufferRust = new Int32Array(buffer);
		const runtime = await loadCompiler(compilerUrl);
		const compileCacheKey = `${targetTriple}\n${code}`;
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:rust-worker] compile start prepare=${String(prepare)} target=${targetTriple} bytes=${code.length}`
				);
			}
			const result = await runtime.compiler.compile({
				code,
				edition: '2024',
				crateType: 'bin',
				targetTriple,
				prepare,
				log,
				onProgress(progress: unknown) {
					postMessage({ progress });
				}
			});
			if (log) {
				console.log(
					`[wasm-idle:rust-worker] compile settled success=${String(result.success)} hasWasm=${String(Boolean(result.artifact?.wasm))} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
				);
			}
			for (const diagnostic of result.diagnostics || []) {
				postMessage({ diagnostic });
			}
			if (result.stdout) postMessage({ output: result.stdout });
			if (!result.success) {
				throw new Error(
					result.stderr ||
						result.diagnostics?.map((diagnostic: any) => diagnostic.message).join('\n') ||
						'Rust compilation failed'
				);
			}
			if (result.stderr) postMessage({ output: result.stderr });
			if (!result.artifact?.wasm) {
				throw new Error('wasm-rust did not return a wasm artifact');
			}
			compiledArtifact = result.artifact;
			compiledCacheKey = compileCacheKey;
			if (log) {
				console.log(
					`[wasm-idle:rust-worker] cached artifact target=${compiledArtifact.targetTriple} format=${compiledArtifact.format}`
				);
			}
		}

		if (prepare) {
			if (log) {
				console.log('[wasm-idle:rust-worker] prepare complete');
			}
			postMessage({ results: true });
			return;
		}

		if (log) {
			console.log(
				`[wasm-idle:rust-worker] runtime start target=${compiledArtifact.targetTriple} format=${compiledArtifact.format}`
			);
		}
		const execution = await runtime.executeBrowserRustArtifact(compiledArtifact, runtimeBaseUrl, {
			args,
			env: {
				USER: 'jungol'
			},
			stdin: () => {
				const chunk = waitForBufferedStdin(stdinBufferRust!, () => postMessage({ buffer: true }));
				if (chunk == null) {
					if (log) {
						console.log('[wasm-idle:rust-stdin] fd_read(bytes=0, eof=true)');
					}
					return null;
				}
				if (log) {
					console.log(
						`[wasm-idle:rust-stdin] fd_fill(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
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
				`[wasm-idle:rust-worker] wasi run complete exitCode=${String(execution.exitCode)}`
			);
		}
		if (execution.exitCode !== 0) {
			throw new Error(
				execution.stderr
					? `Rust program exited with code ${execution.exitCode}\n${execution.stderr}`
					: `Rust program exited with code ${execution.exitCode}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:rust-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
