import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';

declare var self: any;

type CompilerDiagnostic = {
	file?: string;
	line?: number;
	column?: number;
	severity?: 'error' | 'warning' | 'other';
	message?: string;
};

type CompileArtifact = {
	path: string;
	kind: 'js' | 'wasm' | 'asset' | 'map' | 'text';
	data: Uint8Array | string;
};

type CompileResult = {
	success: boolean;
	stdout: string;
	stderr: string;
	diagnostics: CompilerDiagnostic[];
	artifacts: CompileArtifact[];
};

type BrowserNativeManifestFile = {
	path: string;
	url?: string;
	size: number;
};

type BrowserNativeManifestRuntimePack = {
	format: 'wasm-of-js-of-ocaml-browser-native-runtime-pack-v1';
	asset: string;
	index: string;
	fileCount: number;
	totalBytes: number;
};

type BrowserNativeManifestPackage = {
	name: string;
	rootPath: string;
	metaPath?: string;
	archiveBytePath?: string;
	requires: string[];
	files: BrowserNativeManifestFile[];
};

type BrowserNativeManifest = {
	version: 1;
	generatedAt: string;
	switchPrefix: string;
	findlibConf: string;
	tools: {
		ocamlc: string;
		js_of_ocaml: string;
		wasm_of_ocaml: string;
	};
	toolPatches?: Record<string, unknown>;
	runtimePack?: BrowserNativeManifestRuntimePack;
	ocamlLibFiles: BrowserNativeManifestFile[];
	packages: BrowserNativeManifestPackage[];
};

type CompilerModule = {
	compile: (
		request: {
			files: Record<string, string>;
			entry: string;
			target: 'js' | 'wasm';
			effectsMode?: 'cps' | 'jspi';
		},
		options: {
			system: unknown;
			toolchainRoot: string;
		}
	) => Promise<CompileResult>;
	createBrowserWorkerSystemDispatcher: (options: {
		manifest: BrowserNativeManifest;
		binaryenBridge?: {
			endpointUrl?: string;
		};
	}) => unknown;
};

type LoadRequest = {
	load: true;
	moduleUrl: string;
	manifestUrl: string;
};

type RunRequest = {
	load?: false;
	code: string;
	prepare: boolean;
	target?: 'js' | 'wasm';
	log?: boolean;
	buffer?: SharedArrayBuffer;
};

let moduleUrl = '';
let manifestUrl = '';
let loadedModuleUrl = '';
let loadedManifestUrl = '';
let compilerPromise: Promise<CompilerModule> | null = null;
let manifestPromise: Promise<BrowserNativeManifest> | null = null;
let compiledResult: CompileResult | null = null;
let compiledCacheKey = '';
let stdinBufferOcaml: Int32Array | null = null;

function appendTrailingNewline(text: string) {
	return text.endsWith('\n') ? text : `${text}\n`;
}

function normalizeAssetLoader(programSource: string, runtimePromiseKey: string) {
	let normalizedSource = programSource.includes('($=>async a=>{')
		? programSource.replace('($=>async a=>{', `globalThis.${runtimePromiseKey}=($=>async a=>{`)
		: programSource;
	const assetLoaderPattern =
		/function ([A-Za-z$_][\w$]*)\(([A-Za-z$_][\w$]*)\)\{const ([A-Za-z$_][\w$]*)=([A-Za-z$_][\w$]*)\?new URL\(\2,\4\):\2;return fetch\(\3\)\}/;
	const matchedLoader = normalizedSource.match(assetLoaderPattern);
	if (!matchedLoader) {
		return normalizedSource;
	}
	const loaderName = matchedLoader[1] || 'loadAsset';
	const argumentName = matchedLoader[2] || 'assetPath';
	const resolvedName = matchedLoader[3] || 'resolvedUrl';
	const baseName = matchedLoader[4] || 'scriptUrl';
	return normalizedSource.replace(
		assetLoaderPattern,
		`function ${loaderName}(${argumentName}){if(globalThis.__wasm_of_js_of_ocaml_resolve_asset){const resolvedAsset=globalThis.__wasm_of_js_of_ocaml_resolve_asset(${argumentName});if(resolvedAsset)return fetch(resolvedAsset)}const ${resolvedName}=${baseName}?new URL(${argumentName},${baseName}):${argumentName};return fetch(${resolvedName})}`
	);
}

function rewriteAbsoluteBundleUrl(url: string, currentManifestUrl: string) {
	if (!url || /^[a-z]+:/i.test(url)) {
		return url;
	}
	const manifestLocation = new URL(currentManifestUrl, self.location.href);
	const basePath = manifestLocation.pathname.replace(
		/\/wasm-of-js-of-ocaml\/browser-native-bundle\/browser-native-manifest\.v1\.json$/,
		''
	);
	return new URL(`${basePath}${url}`, manifestLocation.origin).toString();
}

function resolveOcamlBinaryenBridgeUrl(currentManifestUrl: string) {
	return rewriteAbsoluteBundleUrl('/api/binaryen-command', currentManifestUrl);
}

function rewriteManifest(
	manifest: BrowserNativeManifest,
	currentManifestUrl: string
): BrowserNativeManifest {
	return {
		...manifest,
		findlibConf: rewriteAbsoluteBundleUrl(manifest.findlibConf, currentManifestUrl),
		tools: {
			ocamlc: rewriteAbsoluteBundleUrl(manifest.tools.ocamlc, currentManifestUrl),
			js_of_ocaml: rewriteAbsoluteBundleUrl(manifest.tools.js_of_ocaml, currentManifestUrl),
			wasm_of_ocaml: rewriteAbsoluteBundleUrl(
				manifest.tools.wasm_of_ocaml,
				currentManifestUrl
			)
		},
		...(manifest.runtimePack
			? {
					runtimePack: {
						...manifest.runtimePack,
						asset: rewriteAbsoluteBundleUrl(
							manifest.runtimePack.asset,
							currentManifestUrl
						),
						index: rewriteAbsoluteBundleUrl(
							manifest.runtimePack.index,
							currentManifestUrl
						)
					}
				}
			: {}),
		ocamlLibFiles: manifest.ocamlLibFiles.map((file) => ({
			...file,
			...(file.url ? { url: rewriteAbsoluteBundleUrl(file.url, currentManifestUrl) } : {})
		})),
		packages: manifest.packages.map((manifestPackage) => ({
			...manifestPackage,
			files: manifestPackage.files.map((file) => ({
				...file,
				...(file.url ? { url: rewriteAbsoluteBundleUrl(file.url, currentManifestUrl) } : {})
			}))
		}))
	};
}

async function loadCompiler(nextModuleUrl: string) {
	if (!nextModuleUrl) {
		throw new Error(
			'OCaml runtime is not configured. Set runtimeAssets.ocaml.moduleUrl and runtimeAssets.ocaml.manifestUrl or sync the bundled wasm-of-js-of-ocaml assets.'
		);
	}
	if (loadedModuleUrl === nextModuleUrl && compilerPromise) {
		return await compilerPromise;
	}
	loadedModuleUrl = nextModuleUrl;
	compiledResult = null;
	compiledCacheKey = '';
	compilerPromise = (async () => {
		const module = (await import(/* @vite-ignore */ nextModuleUrl)) as Partial<CompilerModule>;
		if (typeof module.compile !== 'function') {
			throw new Error('wasm-of-js-of-ocaml bundle must export compile');
		}
		if (typeof module.createBrowserWorkerSystemDispatcher !== 'function') {
			throw new Error(
				'wasm-of-js-of-ocaml bundle must export createBrowserWorkerSystemDispatcher'
			);
		}
		return module as CompilerModule;
	})();
	return await compilerPromise;
}

async function loadManifest(nextManifestUrl: string) {
	if (!nextManifestUrl) {
		throw new Error(
			'OCaml runtime is not configured. Set runtimeAssets.ocaml.moduleUrl and runtimeAssets.ocaml.manifestUrl or sync the bundled wasm-of-js-of-ocaml assets.'
		);
	}
	if (loadedManifestUrl === nextManifestUrl && manifestPromise) {
		return await manifestPromise;
	}
	loadedManifestUrl = nextManifestUrl;
	compiledResult = null;
	compiledCacheKey = '';
	manifestPromise = (async () => {
		const response = await fetch(nextManifestUrl, { cache: 'no-store' });
		if (!response.ok) {
			throw new Error(`failed to fetch OCaml manifest: ${response.status}`);
		}
		return rewriteManifest((await response.json()) as BrowserNativeManifest, nextManifestUrl);
	})();
	return await manifestPromise;
}

function getJsArtifact(result: CompileResult) {
	const programArtifact = result.artifacts.find(
		(artifact) => artifact.kind === 'js' && typeof artifact.data === 'string'
	);
	if (!programArtifact || typeof programArtifact.data !== 'string') {
		throw new Error('OCaml compile result did not include a JavaScript artifact');
	}
	return programArtifact as CompileArtifact & { data: string };
}

async function executeCompileResult(result: CompileResult, log = false) {
	const programArtifact = getJsArtifact(result);
	const assetFiles = result.artifacts.filter(
		(artifact) => artifact.kind === 'wasm' || artifact.kind === 'asset'
	) as Array<CompileArtifact & { data: Uint8Array | string }>;
	const assetResolverKey = '__wasm_of_js_of_ocaml_resolve_asset';
	const runtimePromiseKey = '__wasm_of_js_of_ocaml_runtime_promise';
	const stdinHookKey = '__wasmIdleOcamlReadStdin';
	const sourceDir = programArtifact.path.replace(/\/[^/]+$/, '');
	const createdObjectUrls: string[] = [];
	const stdinEncoder = new TextEncoder();
	const originalConsole = globalThis.console;
	const originalFetch = globalThis.fetch.bind(globalThis);
	const originalInstantiate = WebAssembly.instantiate.bind(
		WebAssembly
	) as typeof WebAssembly.instantiate;
	const originalInstantiateStreaming = WebAssembly.instantiateStreaming
		? (WebAssembly.instantiateStreaming.bind(
				WebAssembly
			) as typeof WebAssembly.instantiateStreaming)
		: undefined;
	const runtimeGlobal = globalThis as typeof globalThis & Record<string, unknown>;
	const hadProcess = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'process');
	const hadRequire = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'require');
	const hadModule = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'module');
	const hadExports = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'exports');
	const hadFs = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'fs');
	const originalProcess = runtimeGlobal.process;
	const originalRequire = runtimeGlobal.require;
	const originalModule = runtimeGlobal.module;
	const originalExports = runtimeGlobal.exports;
	const originalFs = runtimeGlobal.fs;
	const hadStdinHook = Object.prototype.hasOwnProperty.call(runtimeGlobal, stdinHookKey);
	const originalStdinHook = runtimeGlobal[stdinHookKey];
	const assetEntries = assetFiles
		.filter(
			(artifact): artifact is CompileArtifact & { data: Uint8Array } =>
				artifact.data instanceof Uint8Array
		)
		.map((assetFile) => {
			const copiedAssetData = new Uint8Array(assetFile.data.byteLength);
			copiedAssetData.set(assetFile.data);
			const objectUrl = URL.createObjectURL(
				new Blob([copiedAssetData], {
					type: assetFile.path.endsWith('.wasm')
						? 'application/wasm'
						: 'application/octet-stream'
				})
			);
			createdObjectUrls.push(objectUrl);
			const relativeFromSourceDir = assetFile.path.startsWith(`${sourceDir}/`)
				? assetFile.path.slice(sourceDir.length + 1)
				: assetFile.path.replace(/^\/+/, '');
			return {
				path: assetFile.path,
				basename: assetFile.path.split('/').at(-1) || assetFile.path,
				relativeFromSourceDir,
				objectUrl
			};
		});

	const resolveAsset = (requestedAsset: string) => {
		const candidates = [String(requestedAsset)];
		try {
			candidates.push(new URL(String(requestedAsset), self.location.href).pathname);
		} catch {
			// ignore
		}
		for (const assetEntry of assetEntries) {
			if (
				candidates.some(
					(candidate) =>
						candidate === assetEntry.path ||
						candidate === assetEntry.relativeFromSourceDir ||
						candidate.endsWith(`/${assetEntry.relativeFromSourceDir}`) ||
						candidate.endsWith(`/${assetEntry.basename}`)
				)
			) {
				return assetEntry.objectUrl;
			}
		}
		return null;
	};

	globalThis.console = {
		...originalConsole,
		log: (...args: unknown[]) => {
			postMessage({
				output: appendTrailingNewline(args.map((value) => String(value)).join(' '))
			});
			originalConsole.log(...args);
		},
		info: (...args: unknown[]) => {
			postMessage({
				output: appendTrailingNewline(args.map((value) => String(value)).join(' '))
			});
			originalConsole.info(...args);
		},
		warn: (...args: unknown[]) => {
			postMessage({
				output: appendTrailingNewline(args.map((value) => String(value)).join(' '))
			});
			originalConsole.warn(...args);
		},
		error: (...args: unknown[]) => {
			postMessage({
				output: appendTrailingNewline(args.map((value) => String(value)).join(' '))
			});
			originalConsole.error(...args);
		}
	} as Console;
	WebAssembly.instantiate = (async (
		source: BufferSource | WebAssembly.Module,
		importObject?: WebAssembly.Imports
	) => {
		return await originalInstantiate(source, importObject);
	}) as typeof WebAssembly.instantiate;
	if (originalInstantiateStreaming) {
		WebAssembly.instantiateStreaming = (async (
			source: Response | PromiseLike<Response>,
			importObject?: WebAssembly.Imports
		) => {
			return await originalInstantiateStreaming(source, importObject);
		}) as typeof WebAssembly.instantiateStreaming;
	}
	(globalThis as typeof globalThis & Record<string, unknown>)[assetResolverKey] = resolveAsset;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const requestUrl =
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		const resolvedAssetUrl = resolveAsset(requestUrl);
		if (resolvedAssetUrl) {
			return await originalFetch(resolvedAssetUrl, init);
		}
		return await originalFetch(input, init);
	}) as typeof fetch;
	runtimeGlobal.process = undefined;
	runtimeGlobal[stdinHookKey] = () => {
		if (!stdinBufferOcaml) {
			return null;
		}
		const chunk = waitForBufferedStdin(stdinBufferOcaml, () => postMessage({ buffer: true }));
		if (chunk == null) {
			if (log) {
				console.log('[wasm-idle:ocaml-stdin] read(bytes=0, eof=true)');
			}
			return null;
		}
		const encoded = stdinEncoder.encode(chunk);
		if (log) {
			console.log(
				`[wasm-idle:ocaml-stdin] read(bytes=${encoded.byteLength}, text=${JSON.stringify(chunk)})`
			);
		}
		let byteString = '';
		for (const byte of encoded) {
			byteString += String.fromCharCode(byte);
		}
		return byteString;
	};
	let lastFsReadSequence = -1;
	const stdinFsShim = {
		readSync(
			fileDescriptor: number,
			buffer: Uint8Array,
			offset = 0,
			length = buffer.byteLength - offset
		) {
			if (fileDescriptor !== 0 || !stdinBufferOcaml) {
				return 0;
			}
			const currentSequence = Atomics.load(stdinBufferOcaml, 0);
			if (currentSequence === lastFsReadSequence) {
				return 0;
			}
			const chunk = waitForBufferedStdin(stdinBufferOcaml, () =>
				postMessage({ buffer: true })
			);
			lastFsReadSequence = Atomics.load(stdinBufferOcaml, 0);
			if (chunk == null) {
				if (log) {
					console.log('[wasm-idle:ocaml-stdin] read(bytes=0, eof=true)');
				}
				return 0;
			}
			const encoded = stdinEncoder.encode(chunk);
			const byteLength = Math.min(length, encoded.byteLength);
			buffer.set(encoded.subarray(0, byteLength), offset);
			if (log) {
				console.log(
					`[wasm-idle:ocaml-stdin] read(bytes=${byteLength}, text=${JSON.stringify(chunk)})`
				);
			}
			return byteLength;
		}
	};
	runtimeGlobal.fs = stdinFsShim;
	runtimeGlobal.require = (specifier: string) => {
		if (specifier === 'fs' || specifier === 'node:fs') {
			return stdinFsShim;
		}
		throw new Error(`unsupported OCaml runtime require: ${specifier}`);
	};
	runtimeGlobal.module = { exports: {} };
	runtimeGlobal.exports = (runtimeGlobal.module as { exports: unknown }).exports;

	try {
		let normalizedSource = normalizeAssetLoader(programArtifact.data, runtimePromiseKey);
		const stdinReadReplacement =
			'read($1,$2,$3,$4){var e=globalThis.__wasmIdleOcamlReadStdin?globalThis.__wasmIdleOcamlReadStdin($3):null;if(e==null)return 0;var h=e.length,f=new Uint8Array(h),i=0;for(;i<h;i++)f[i]=e.charCodeAt(i);var g=f.length<$3?f.length:$3;$1.set(f.subarray(0,g),$2);return g}';
		const patchedSource = normalizedSource.replace(
			/read\(([A-Za-z$_][\w$]*),([A-Za-z$_][\w$]*),([A-Za-z$_][\w$]*),([A-Za-z$_][\w$]*)\)\{cz\(\4,mc,aha,ow\)\}/,
			stdinReadReplacement
		);
		normalizedSource =
			patchedSource !== normalizedSource
				? patchedSource
				: normalizedSource.replace(
						/read\(([A-Za-z$_][\w$]*),([A-Za-z$_][\w$]*),([A-Za-z$_][\w$]*),([A-Za-z$_][\w$]*)\)\{[^{}]+\}(?=seek\([A-Za-z$_][\w$]*,[A-Za-z$_][\w$]*,[A-Za-z$_][\w$]*\)\{[^{}]+\}pos\(\)\{return-1\}close\(\)\{this\.log=undefined\}check_stream_semantics\([A-Za-z$_][\w$]*\)\{\})/,
						stdinReadReplacement
					);
		normalizedSource = normalizedSource
			.replace(/\bfs\.readSync\(/g, 'globalThis.fs.readSync(')
			.replace(
				/read:\(([^)]*)\)=>[A-Za-z$_][\w$]*\.readSync\(/g,
				'read:($1)=>globalThis.fs.readSync('
			);
		if (log && normalizedSource === programArtifact.data) {
			console.warn('[wasm-idle:ocaml-worker] stdin runtime patch did not match generated JS');
		}
		new Function(`${normalizedSource}\n//# sourceURL=${programArtifact.path}`)();
		const runtimePromise = (globalThis as typeof globalThis & Record<string, unknown>)[
			runtimePromiseKey
		];
		if (runtimePromise instanceof Promise) {
			await runtimePromise;
		}
		postMessage({ results: true });
	} finally {
		globalThis.console = originalConsole;
		globalThis.fetch = originalFetch;
		WebAssembly.instantiate = originalInstantiate;
		if (originalInstantiateStreaming) {
			WebAssembly.instantiateStreaming = originalInstantiateStreaming;
		}
		delete (globalThis as typeof globalThis & Record<string, unknown>)[runtimePromiseKey];
		delete (globalThis as typeof globalThis & Record<string, unknown>)[assetResolverKey];
		if (!hadProcess) {
			delete runtimeGlobal.process;
		} else {
			runtimeGlobal.process = originalProcess;
		}
		if (!hadRequire) {
			delete runtimeGlobal.require;
		} else {
			runtimeGlobal.require = originalRequire;
		}
		if (!hadModule) {
			delete runtimeGlobal.module;
		} else {
			runtimeGlobal.module = originalModule;
		}
		if (!hadExports) {
			delete runtimeGlobal.exports;
		} else {
			runtimeGlobal.exports = originalExports;
		}
		if (!hadFs) {
			delete runtimeGlobal.fs;
		} else {
			runtimeGlobal.fs = originalFs;
		}
		if (!hadStdinHook) {
			delete runtimeGlobal[stdinHookKey];
		} else {
			runtimeGlobal[stdinHookKey] = originalStdinHook;
		}
		for (const objectUrl of createdObjectUrls) {
			URL.revokeObjectURL(objectUrl);
		}
	}
}

self.onmessage = async (event: { data: LoadRequest | RunRequest }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		manifestUrl: nextManifestUrl,
		code,
		prepare,
		target = 'wasm',
		log = true,
		buffer
	} = event.data as LoadRequest & RunRequest;
	try {
		if (load) {
			moduleUrl = nextModuleUrl;
			manifestUrl = nextManifestUrl;
			await Promise.all([loadCompiler(moduleUrl), loadManifest(manifestUrl)]);
			postMessage({ load: true });
			return;
		}

		stdinBufferOcaml = buffer ? new Int32Array(buffer) : null;

		if (log) {
			console.log(
				`[wasm-idle:ocaml-worker] compile start prepare=${prepare} target=${target}`
			);
		}
		postMessage({ progress: { stage: 'compile-bootstrap', percent: 10 } });
		const [compilerModule, manifest] = await Promise.all([
			loadCompiler(moduleUrl),
			loadManifest(manifestUrl)
		]);
		postMessage({ progress: { stage: 'compile-ready', percent: 25 } });

		const compileKey = `${target}\n${code}`;
		let compiledFresh = false;
		if (!compiledResult || compiledCacheKey !== compileKey) {
			const result = await compilerModule.compile(
				{
					files: {
						'main.ml': code
					},
					entry: 'main.ml',
					target,
					effectsMode: 'cps'
				},
				{
					system: compilerModule.createBrowserWorkerSystemDispatcher({
						manifest,
						binaryenBridge: {
							endpointUrl: resolveOcamlBinaryenBridgeUrl(manifestUrl)
						}
					}),
					toolchainRoot: '/static/toolchain'
				}
			);
			compiledResult = result;
			compiledCacheKey = compileKey;
			compiledFresh = true;
		}

		const result = compiledResult;
		if (log) {
			console.log(
				`[wasm-idle:ocaml-worker] compile settled success=${result.success} diagnostics=${result.diagnostics?.length || 0}`
			);
		}
		if (compiledFresh && result.stdout) {
			postMessage({ output: result.stdout });
		}
		if ((compiledFresh || !result.success) && result.stderr) {
			postMessage({ output: result.stderr });
		}
		for (const diagnostic of result.diagnostics || []) {
			postMessage({
				diagnostic: {
					fileName: diagnostic.file ?? null,
					lineNumber: Math.max(1, Number(diagnostic.line || 1)),
					columnNumber:
						typeof diagnostic.column === 'number'
							? Math.max(1, diagnostic.column)
							: undefined,
					severity:
						diagnostic.severity === 'warning' || diagnostic.severity === 'other'
							? diagnostic.severity
							: 'error',
					message: String(diagnostic.message || '')
				}
			});
		}
		postMessage({ progress: { stage: 'compile-finished', percent: 90 } });

		if (!result.success) {
			throw new Error(
				result.stderr ||
					result.diagnostics?.map((diagnostic) => diagnostic.message || '').join('\n') ||
					'OCaml compilation failed'
			);
		}

		if (prepare) {
			postMessage({ results: true });
			return;
		}

		postMessage({ progress: { stage: 'runtime-start', percent: 95 } });
		await executeCompileResult(result, log);
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:ocaml-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
