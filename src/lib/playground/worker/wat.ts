import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';

declare var self: any;

const encoder = new TextEncoder();

let moduleUrl = '';
let loadedModuleUrl = '';
let runtimePromise: Promise<{
	compiler: any;
	executeBrowserWatArtifact: (
			artifact: any,
			options?: {
				stdout?: (chunk: string) => void;
				stderr?: (chunk: string) => void;
				files?: SandboxWorkspaceFile[];
				activePath?: string;
				imports?: WebAssembly.Imports;
			}
	) => Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
	}>;
}> | null = null;
let compiledArtifact: any = null;
let compiledCacheKey = '';

class WatStdin {
	private initialStdin: string | null;
	private readonly fixedInitialStdin: boolean;
	private currentBytes = new Uint8Array(0);
	private currentOffset = 0;

	constructor(
		initialStdin: string | undefined,
		private readonly buffer: Int32Array | null,
		private readonly log: boolean
	) {
		this.initialStdin = typeof initialStdin === 'string' ? initialStdin : null;
		this.fixedInitialStdin = typeof initialStdin === 'string';
	}

	readByte() {
		while (this.currentOffset >= this.currentBytes.length) {
			const chunk = this.readChunk();
			if (chunk == null) return -1;
			if (!chunk) continue;
			this.currentBytes = encoder.encode(chunk);
			this.currentOffset = 0;
		}
		return this.currentBytes[this.currentOffset++] ?? -1;
	}

	private readChunk() {
		if (this.initialStdin != null) {
			const chunk = this.initialStdin;
			this.initialStdin = null;
			return chunk;
		}
		if (this.fixedInitialStdin || !this.buffer) return null;
		const chunk = waitForBufferedStdin(this.buffer, () => postMessage({ buffer: true }));
		if (this.log) {
			console.log(
				chunk == null
					? '[wasm-idle:wat-stdin] read(bytes=0, eof=true)'
					: `[wasm-idle:wat-stdin] read(bytes=${encoder.encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
			);
		}
		return chunk;
	}
}

async function loadRuntime(url: string) {
	if (!url) {
		throw new Error(
			'WAT runtime is not configured. Set PUBLIC_WASM_WAT_MODULE_URL or runtimeAssets.wat.moduleUrl.'
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
			typeof module.createWatCompiler === 'function'
				? module.createWatCompiler
				: typeof module.default === 'function'
					? module.default
					: null;
		if (!factory) {
			throw new Error('wasm-wat module must export createWatCompiler or a default factory');
		}
		if (typeof module.executeBrowserWatArtifact !== 'function') {
			throw new Error('wasm-wat module must export executeBrowserWatArtifact');
		}
		return {
			compiler: await factory(),
			executeBrowserWatArtifact: module.executeBrowserWatArtifact
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
		endColumnNumber:
			typeof diagnostic?.endColumnNumber === 'number'
				? Math.max(1, diagnostic.endColumnNumber)
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
		code,
		prepare,
		buffer,
		stdin,
		activePath = 'main.wat',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			moduleUrl = nextModuleUrl;
			if (log) {
				console.log(`[wasm-idle:wat-worker] load moduleUrl=${moduleUrl}`);
			}
			await loadRuntime(moduleUrl);
			postMessage({ load: true });
			return;
		}

		const runtime = await loadRuntime(moduleUrl);
		const compileCacheKey = JSON.stringify({
			activePath,
			code,
			workspaceFiles
		});
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:wat-worker] compile start prepare=${String(prepare)} bytes=${code.length}`
				);
			}
			const result = await runtime.compiler.compile({
				code,
				fileName: activePath,
				log
			});
			if (log) {
				console.log(
					`[wasm-idle:wat-worker] compile settled success=${String(result.success)} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
				);
			}
			for (const diagnostic of result.diagnostics || []) {
				postMessage({ diagnostic: normalizeDiagnostic(diagnostic) });
			}
			if (result.stdout) postMessage({ output: result.stdout });
			if (!result.success || !result.artifact) {
				throw new Error(
					result.stderr ||
						result.diagnostics
							?.map((diagnostic: any) => diagnostic.message)
							.join('\n') ||
						'WAT compilation failed'
				);
			}
			if (result.stderr) postMessage({ output: result.stderr });
			compiledArtifact = result.artifact;
			compiledCacheKey = compileCacheKey;
		}

		if (prepare) {
			postMessage({ results: true });
			return;
		}

			const stdinReader = new WatStdin(
				stdin,
				buffer ? new Int32Array(buffer) : null,
				Boolean(log)
			);
			const execution = await runtime.executeBrowserWatArtifact(compiledArtifact, {
				files: workspaceFiles,
				activePath,
				imports: {
					env: {
						readByte() {
							return stdinReader.readByte();
						}
					}
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
					? `WAT module exited with code ${execution.exitCode}\n${execution.stderr}`
					: `WAT module exited with code ${execution.exitCode}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:wat-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
