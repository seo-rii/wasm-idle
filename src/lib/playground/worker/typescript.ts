import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile } from '$lib/playground/options';

declare var self: any;

let stdinBufferTypeScript: Int32Array | null = null;
let moduleUrl = '';
let loadedModuleUrl = '';
let runtimePromise: Promise<{
	compiler: any;
	executeBrowserTypeScriptArtifact: (
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
			'TypeScript runtime is not configured. Set PUBLIC_WASM_TYPESCRIPT_MODULE_URL or runtimeAssets.typescript.moduleUrl.'
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
			typeof module.createTypeScriptCompiler === 'function'
				? module.createTypeScriptCompiler
				: typeof module.default === 'function'
					? module.default
					: null;
		if (!factory) {
			throw new Error(
				'wasm-typescript module must export createTypeScriptCompiler or a default factory'
			);
		}
		if (typeof module.executeBrowserTypeScriptArtifact !== 'function') {
			throw new Error(
				'wasm-typescript module must export executeBrowserTypeScriptArtifact'
			);
		}
		return {
			compiler: await factory(),
			executeBrowserTypeScriptArtifact: module.executeBrowserTypeScriptArtifact
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
		language = 'typescript',
		activePath = language === 'typescript' ? 'main.ts' : 'main.js',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			moduleUrl = nextModuleUrl;
			if (log) {
				console.log(`[wasm-idle:typescript-worker] load moduleUrl=${moduleUrl}`);
			}
			await loadRuntime(moduleUrl);
			postMessage({ load: true });
			return;
		}

		stdinBufferTypeScript = new Int32Array(buffer);
		const runtime = await loadRuntime(moduleUrl);
		const compileCacheKey = `${language}\n${activePath}\n${code}`;
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:typescript-worker] compile start language=${language} prepare=${String(prepare)} bytes=${code.length}`
				);
			}
			const result = await runtime.compiler.compile({
				code,
				language,
				fileName: activePath,
				log
			});
			if (log) {
				console.log(
					`[wasm-idle:typescript-worker] compile settled success=${String(result.success)} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
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
						'TypeScript compilation failed'
				);
			}
			if (result.stderr) postMessage({ output: result.stderr });
			if (!result.artifact?.javascript) {
				throw new Error('wasm-typescript did not return a JavaScript artifact');
			}
			compiledArtifact = result.artifact;
			compiledCacheKey = compileCacheKey;
		}

		if (prepare) {
			postMessage({ results: true });
			return;
		}

		const execution = await runtime.executeBrowserTypeScriptArtifact(compiledArtifact, {
			args,
			env: {
				USER: 'jungol'
			},
			files: workspaceFiles,
			activePath,
			stdin: () => {
				const chunk = waitForBufferedStdin(stdinBufferTypeScript!, () =>
					postMessage({ buffer: true })
				);
				if (chunk == null) {
					if (log) {
						console.log('[wasm-idle:typescript-stdin] read(bytes=0, eof=true)');
					}
					return null;
				}
				if (log) {
					console.log(
						`[wasm-idle:typescript-stdin] read(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
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
					? `${language === 'typescript' ? 'TypeScript' : 'JavaScript'} program exited with code ${execution.exitCode}\n${execution.stderr}`
					: `${language === 'typescript' ? 'TypeScript' : 'JavaScript'} program exited with code ${execution.exitCode}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:typescript-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
