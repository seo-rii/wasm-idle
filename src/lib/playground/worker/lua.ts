import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile } from '$lib/playground/options';
import {
	buildFennelCompileChunk,
	buildFennelRunChunk,
	loadFennelCompilerSource,
	parseFennelDiagnostic,
	stripHostLuaTraceback,
	type FennelCompilerAsset
} from '$lib/playground/fennelBootstrap';

declare var self: any;

let stdinBufferLua: Int32Array | null = null;
let moduleUrl = '';
let loadedModuleUrl = '';
let runtimePromise: Promise<{
	compiler: any;
	executeBrowserLuaArtifact: (
		artifact: any,
		options?: {
			args?: string[];
			onReady?: () => void;
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
// Set when this worker hosts Fennel: the verified official fennel.lua compiler source.
let fennelSource: string | null = null;
let runtimeLabel = 'Lua';

async function loadRuntime(url: string) {
	if (!url) {
		throw new Error('Lua runtime is not configured. Set runtimeAssets.lua.moduleUrl.');
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
			typeof module.createLuaCompiler === 'function'
				? module.createLuaCompiler
				: typeof module.default === 'function'
					? module.default
					: null;
		if (!factory) {
			throw new Error('wasm-lua module must export createLuaCompiler or a default factory');
		}
		if (typeof module.executeBrowserLuaArtifact !== 'function') {
			throw new Error('wasm-lua module must export executeBrowserLuaArtifact');
		}
		return {
			compiler: await factory(),
			executeBrowserLuaArtifact: module.executeBrowserLuaArtifact
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

async function compileFennel(
	runtime: Awaited<ReturnType<typeof loadRuntime>>,
	fennel: string,
	code: string,
	fileName: string
) {
	// Run the official Fennel compiler once without stdin so syntax and compile errors are
	// reported before execution starts.
	const check = await runtime.executeBrowserLuaArtifact(
		{ source: buildFennelCompileChunk(fennel, code, fileName), fileName },
		{ stdin: () => null }
	);
	if (check.exitCode !== 0) {
		const message = stripHostLuaTraceback(check.stderr);
		return {
			success: false,
			diagnostics: [parseFennelDiagnostic(message, fileName)],
			stdout: '',
			stderr: message
		};
	}
	return {
		success: true,
		artifact: { source: buildFennelRunChunk(fennel, code, fileName), fileName },
		diagnostics: [],
		stdout: '',
		stderr: ''
	};
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		fennelCompiler,
		buffer,
		code,
		prepare,
		args = [],
		stdin,
		activePath = 'main.lua',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			moduleUrl = nextModuleUrl;
			if (log) {
				console.log(`[wasm-idle:lua-worker] load moduleUrl=${moduleUrl}`);
			}
			await loadRuntime(moduleUrl);
			if (fennelCompiler) {
				fennelSource = await loadFennelCompilerSource(
					fennelCompiler as FennelCompilerAsset
				);
				runtimeLabel = 'Fennel';
				compiledArtifact = null;
				compiledCacheKey = '';
			}
			postMessage({ load: true });
			return;
		}

		stdinBufferLua = new Int32Array(buffer);
		const runtime = await loadRuntime(moduleUrl);
		const compileCacheKey = JSON.stringify({
			activePath,
			code,
			workspaceFiles
		});
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:lua-worker] compile start prepare=${String(prepare)} bytes=${code.length}`
				);
			}
			const result = fennelSource
				? await compileFennel(runtime, fennelSource, code, activePath)
				: await runtime.compiler.compile({
						code,
						fileName: activePath,
						log
					});
			if (log) {
				console.log(
					`[wasm-idle:lua-worker] compile settled success=${String(result.success)} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
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
						`${runtimeLabel} compilation failed`
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

		const hasInitialStdin = typeof stdin === 'string';
		let initialStdin: string | null = hasInitialStdin ? stdin : null;
		const execution = await runtime.executeBrowserLuaArtifact(compiledArtifact, {
			args,
			onReady: () =>
				postMessage({
					progress: {
						kind: 'ready',
						state: 'running',
						reason: 'started',
						label: 'Lua program started'
					}
				}),
			stdin: () => {
				if (hasInitialStdin) {
					const chunk = initialStdin;
					initialStdin = null;
					if (log) {
						console.log(
							chunk == null
								? '[wasm-idle:lua-stdin] read(bytes=0, eof=true)'
								: `[wasm-idle:lua-stdin] read(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
						);
					}
					return chunk;
				}
				const chunk = waitForBufferedStdin(stdinBufferLua!, () =>
					postMessage({ buffer: true })
				);
				if (chunk == null) {
					if (log) {
						console.log('[wasm-idle:lua-stdin] read(bytes=0, eof=true)');
					}
					return null;
				}
				if (log) {
					console.log(
						`[wasm-idle:lua-stdin] read(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
					);
				}
				return chunk;
			},
			stdout: (output) => {
				if (output) postMessage({ output });
			},
			stderr: (output) => {
				// Fennel errors are reported once, without the host Lua traceback, below.
				if (output && !fennelSource) postMessage({ output });
			}
		});
		if (execution.exitCode !== 0) {
			const stderr = fennelSource
				? stripHostLuaTraceback(execution.stderr)
				: execution.stderr;
			throw new Error(
				stderr
					? `${runtimeLabel} program exited with code ${execution.exitCode}\n${stderr}`
					: `${runtimeLabel} program exited with code ${execution.exitCode}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:lua-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
