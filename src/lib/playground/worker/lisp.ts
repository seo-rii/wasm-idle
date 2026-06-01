import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile } from '$lib/playground/options';

declare var self: any;

let stdinBufferLisp: Int32Array | null = null;
let moduleUrl = '';
let loadedModuleUrl = '';
let runtimePromise: Promise<{
	compiler: any;
	executeBrowserLispArtifact: (
		artifact: any,
		options?: {
			args?: string[];
			env?: Record<string, string>;
			stdin?: () => string | null;
			stdout?: (chunk: string) => void;
			stderr?: (chunk: string) => void;
			files?: SandboxWorkspaceFile[];
			activePath?: string;
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
			'Lisp runtime is not configured. Set PUBLIC_WASM_LISP_MODULE_URL or runtimeAssets.lisp.moduleUrl.'
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
			typeof module.createLispCompiler === 'function'
				? module.createLispCompiler
				: typeof module.default === 'function'
					? module.default
					: null;
		if (!factory) {
			throw new Error('wasm-lisp module must export createLispCompiler or a default factory');
		}
		if (typeof module.executeBrowserLispArtifact !== 'function') {
			throw new Error('wasm-lisp module must export executeBrowserLispArtifact');
		}
		return {
			compiler: await factory(),
			executeBrowserLispArtifact: module.executeBrowserLispArtifact
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
		buffer,
		code,
		prepare,
		args = [],
		stdin,
		activePath = 'main.scm',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			moduleUrl = nextModuleUrl;
			if (log) {
				console.log(`[wasm-idle:lisp-worker] load moduleUrl=${moduleUrl}`);
			}
			await loadRuntime(moduleUrl);
			postMessage({ load: true });
			return;
		}

		stdinBufferLisp = new Int32Array(buffer);
		const runtime = await loadRuntime(moduleUrl);
		const compileCacheKey = JSON.stringify({
			activePath,
			code,
			workspaceFiles
		});
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:lisp-worker] compile start prepare=${String(prepare)} bytes=${code.length}`
				);
			}
			const result = await runtime.compiler.compile({
				code,
				fileName: activePath,
				files: workspaceFiles,
				log
			});
			if (log) {
				console.log(
					`[wasm-idle:lisp-worker] compile settled success=${String(result.success)} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
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
						'Lisp compilation failed'
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
		const execution = await runtime.executeBrowserLispArtifact(compiledArtifact, {
			args,
			env: {
				USER: 'jungol'
			},
			files: workspaceFiles,
			activePath,
			stdin: () => {
				if (hasInitialStdin) {
					const chunk = initialStdin;
					initialStdin = null;
					if (log) {
						console.log(
							chunk == null
								? '[wasm-idle:lisp-stdin] read(bytes=0, eof=true)'
								: `[wasm-idle:lisp-stdin] read(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
						);
					}
					return chunk;
				}
				const chunk = waitForBufferedStdin(stdinBufferLisp!, () =>
					postMessage({ buffer: true })
				);
				if (chunk == null) {
					if (log) {
						console.log('[wasm-idle:lisp-stdin] read(bytes=0, eof=true)');
					}
					return null;
				}
				if (log) {
					console.log(
						`[wasm-idle:lisp-stdin] read(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
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
					? `Lisp program exited with code ${execution.exitCode}\n${execution.stderr}`
					: `Lisp program exited with code ${execution.exitCode}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:lisp-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
