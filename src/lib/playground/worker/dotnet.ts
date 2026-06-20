export {};

const workerSelf = globalThis as any;

workerSelf.dotnetSidecar = true;
workerSelf.document ??= {
	addEventListener() {},
	dispatchEvent() {
		return true;
	},
	querySelectorAll() {
		return [];
	},
	removeEventListener() {}
};

type DotnetCompileLanguage = 'fsharp' | 'csharp' | 'vbnet';

type DotnetRuntimeModule = {
	createDotnetCompiler: (options?: { loadReferences?: boolean }) => {
		compile(request: {
			code: string;
			language: DotnetCompileLanguage;
			target: 'browser-wasm';
			prepare?: boolean;
			log?: boolean;
			onProgress?: (progress: unknown) => void;
		}): Promise<{
			success: boolean;
			artifact?: unknown;
			stdout?: string;
			stderr?: string;
			diagnostics?: unknown[];
			logs?: string[];
		}>;
	};
	executeBrowserDotnetArtifact: (
		artifact: unknown,
		options?: {
			args?: string[];
			env?: Record<string, string>;
			stdin?: string;
			stdout?: (chunk: string) => void;
			stderr?: (chunk: string) => void;
		}
	) => Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
	}>;
};

let moduleUrl = '';
let loadedModuleUrl = '';
let runtimePromise: Promise<DotnetRuntimeModule> | null = null;
let compiler: ReturnType<DotnetRuntimeModule['createDotnetCompiler']> | null = null;
let compiledArtifact: unknown = null;
let compiledCacheKey = '';

function languageLabel(language: DotnetCompileLanguage) {
	return language === 'csharp' ? 'C#' : language === 'vbnet' ? 'VB.NET' : 'F#';
}

async function loadRuntime(url: string) {
	if (!url) {
		throw new Error(
			'.NET runtime module is not configured. Set runtimeAssets.dotnet.moduleUrl.'
		);
	}
	if (loadedModuleUrl === url && runtimePromise && compiler) {
		return await runtimePromise;
	}
	loadedModuleUrl = url;
	compiledArtifact = null;
	compiledCacheKey = '';
	runtimePromise = (async () => {
		const runtimeModule = (await import(/* @vite-ignore */ url)) as DotnetRuntimeModule;
		if (typeof runtimeModule.createDotnetCompiler !== 'function') {
			throw new Error('wasm-dotnet module must export createDotnetCompiler');
		}
		if (typeof runtimeModule.executeBrowserDotnetArtifact !== 'function') {
			throw new Error('wasm-dotnet module must export executeBrowserDotnetArtifact');
		}
		compiler = runtimeModule.createDotnetCompiler();
		return runtimeModule;
	})();
	return await runtimePromise;
}

workerSelf.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		code,
		language = 'fsharp',
		prepare,
		args = [],
		stdin = '',
		log
	} = event.data;
	try {
		if (load) {
			moduleUrl = nextModuleUrl;
			if (log) {
				console.log(`[wasm-idle:dotnet-worker] load moduleUrl=${moduleUrl}`);
			}
			await loadRuntime(moduleUrl);
			postMessage({ load: true });
			return;
		}

		const runtime = await loadRuntime(moduleUrl);
		const compileLanguage =
			language === 'csharp' ? 'csharp' : language === 'vbnet' ? 'vbnet' : 'fsharp';
		const compileCacheKey = `${compileLanguage}\n${code}`;
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (!compiler) {
				throw new Error('.NET compiler was not initialized');
			}
			if (log) {
				console.log(
					`[wasm-idle:dotnet-worker] compile start language=${compileLanguage} prepare=${String(prepare)} bytes=${code.length}`
				);
			}
			const result = await compiler.compile({
				code,
				language: compileLanguage,
				target: 'browser-wasm',
				prepare,
				log,
				onProgress(progress: unknown) {
					postMessage({ progress });
				}
			});
			for (const diagnostic of result.diagnostics || []) {
				postMessage({ diagnostic });
			}
			for (const line of result.logs || []) {
				postMessage({ output: line.endsWith('\n') ? line : `${line}\n` });
			}
			if (result.stdout) postMessage({ output: result.stdout });
			if (!result.success || !result.artifact) {
				throw new Error(
					result.stderr ||
						result.diagnostics
							?.map((diagnostic: any) => diagnostic.message)
							.join('\n') ||
						`${languageLabel(compileLanguage)} compilation failed`
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

		const execution = await runtime.executeBrowserDotnetArtifact(compiledArtifact, {
			args,
			env: {
				USER: 'jungol'
			},
			stdin,
			stdout: (output) => {
				if (output) postMessage({ output });
			},
			stderr: (output) => {
				if (output) postMessage({ output });
			}
		});
		if (execution.exitCode !== 0) {
			throw new Error(
				`${languageLabel(compileLanguage)} program exited with code ${execution.exitCode}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:dotnet-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
