import {
	compile,
	type CompileArtifact,
	type CompileDiagnostic,
	type CompileRequest
} from '../src/index.js';
import {
	createBrowserWorkerSystemDispatcher,
	fetchBrowserNativeManifest,
	type BrowserNativeManifest
} from '../runtime/system-dispatch-browser-worker.js';

const decoder = new TextDecoder();

type NativeCompileStage = 'ocamlc' | 'js_of_ocaml' | 'wasm_of_ocaml' | 'runtime';

export type NativeCompileSummary = {
	success: boolean;
	stage: NativeCompileStage;
	stdout: string;
	stderr: string;
	thrown?: string;
	diagnostics: CompileDiagnostic[];
	artifacts: Array<{
		path: string;
		size: number;
	}>;
	runtimeOutput: string[];
};

type RuntimeExecutionResult =
	| {
			success: true;
			runtimeOutput: string[];
	  }
	| {
			success: false;
			runtimeOutput: string[];
			error: string;
	  };

let manifestPromise: Promise<BrowserNativeManifest> | undefined;

function getArtifactSize(artifact: CompileArtifact) {
	return typeof artifact.data === 'string'
		? new TextEncoder().encode(artifact.data).byteLength
		: artifact.data.byteLength;
}

function getArtifactSummary(artifacts: CompileArtifact[]) {
	return artifacts.map((artifact) => ({
		path: artifact.path,
		size: getArtifactSize(artifact)
	}));
}

function getManifest() {
	manifestPromise ||= fetchBrowserNativeManifest();
	return manifestPromise;
}

function inferCompileStage(
	request: CompileRequest,
	diagnostics: CompileDiagnostic[]
): NativeCompileStage {
	if (diagnostics.length > 0) {
		return 'ocamlc';
	}
	return request.target === 'wasm' ? 'wasm_of_ocaml' : 'js_of_ocaml';
}

function isBinaryArtifact(
	artifact: CompileArtifact
): artifact is CompileArtifact & { data: Uint8Array } {
	return artifact.data instanceof Uint8Array;
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

async function runGeneratedProgram(
	programSource: string,
	options: {
		sourcePath: string;
		assetFiles?: Array<{ path: string; data: Uint8Array }>;
	}
): Promise<RuntimeExecutionResult> {
	const runtimeOutput: string[] = [];
	const originalConsole = window.console;
	const originalFetch = window.fetch;
	const originalInstantiate = WebAssembly.instantiate.bind(
		WebAssembly
	) as typeof WebAssembly.instantiate;
	const originalInstantiateStreaming = WebAssembly.instantiateStreaming
		? (WebAssembly.instantiateStreaming.bind(
				WebAssembly
			) as typeof WebAssembly.instantiateStreaming)
		: undefined;
	const runtimePromiseKey = '__wasm_of_js_of_ocaml_runtime_promise';
	const assetResolverKey = '__wasm_of_js_of_ocaml_resolve_asset';
	const assetFiles = options.assetFiles || [];
	const sourceDir = options.sourcePath.replace(/\/[^/]+$/, '');
	const createdObjectUrls: string[] = [];
	const assetEntries = assetFiles.map((assetFile) => {
		const copiedAssetData = new Uint8Array(assetFile.data.byteLength);
		copiedAssetData.set(assetFile.data);
		const objectUrl = URL.createObjectURL(
			new Blob([copiedAssetData], { type: 'application/wasm' })
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

	window.console = {
		...originalConsole,
		log: (...args: unknown[]) => {
			runtimeOutput.push(args.map((value) => String(value)).join(' '));
			originalConsole.log(...args);
		},
		info: (...args: unknown[]) => {
			runtimeOutput.push(args.map((value) => String(value)).join(' '));
			originalConsole.info(...args);
		},
		warn: (...args: unknown[]) => {
			runtimeOutput.push(args.map((value) => String(value)).join(' '));
			originalConsole.warn(...args);
		},
		error: (...args: unknown[]) => {
			runtimeOutput.push(args.map((value) => String(value)).join(' '));
			originalConsole.error(...args);
		}
	} as Console;
	WebAssembly.instantiate = (async (
		source: BufferSource | WebAssembly.Module,
		importObject?: WebAssembly.Imports
	) => {
		runtimeOutput.push('wasm instantiate');
		return await originalInstantiate(source, importObject);
	}) as typeof WebAssembly.instantiate;
	if (originalInstantiateStreaming) {
		WebAssembly.instantiateStreaming = (async (
			source: Response | PromiseLike<Response>,
			importObject?: WebAssembly.Imports
		) => {
			runtimeOutput.push('wasm instantiateStreaming');
			return await originalInstantiateStreaming(source, importObject);
		}) as typeof WebAssembly.instantiateStreaming;
	}

	if (assetEntries.length > 0) {
		const resolveAsset = (requestedAsset: string) => {
			const candidates = [];
			candidates.push(String(requestedAsset));
			try {
				candidates.push(new URL(String(requestedAsset), window.location.href).pathname);
			} catch {
				// ignore URL parse errors and fall back to the raw request.
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
					runtimeOutput.push(`asset resolve: ${assetEntry.relativeFromSourceDir}`);
					return assetEntry.objectUrl;
				}
			}

			return null;
		};
		(globalThis as typeof globalThis & Record<string, unknown>)[assetResolverKey] =
			resolveAsset;
		window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const requestUrl =
				typeof input === 'string'
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			const resolvedAssetUrl = resolveAsset(requestUrl);
			if (resolvedAssetUrl) {
				return await originalFetch(resolvedAssetUrl, init);
			}
			return await originalFetch(input, init);
		}) as typeof fetch;
	}

	try {
		const normalizedSource = normalizeAssetLoader(programSource, runtimePromiseKey);
		new Function(`${normalizedSource}\n//# sourceURL=${options.sourcePath}`)();
		const runtimePromise = (globalThis as typeof globalThis & Record<string, unknown>)[
			runtimePromiseKey
		];
		if (runtimePromise instanceof Promise) {
			await runtimePromise;
			runtimeOutput.push('runtime promise resolved');
		}
		return {
			success: true,
			runtimeOutput
		} satisfies RuntimeExecutionResult;
	} catch (error) {
		return {
			success: false,
			runtimeOutput,
			error: error instanceof Error ? error.stack || error.message : String(error)
		} satisfies RuntimeExecutionResult;
	} finally {
		window.console = originalConsole;
		window.fetch = originalFetch;
		WebAssembly.instantiate = originalInstantiate;
		if (originalInstantiateStreaming) {
			WebAssembly.instantiateStreaming = originalInstantiateStreaming;
		}
		delete (globalThis as typeof globalThis & Record<string, unknown>)[runtimePromiseKey];
		delete (globalThis as typeof globalThis & Record<string, unknown>)[assetResolverKey];
		for (const objectUrl of createdObjectUrls) {
			URL.revokeObjectURL(objectUrl);
		}
	}
}

async function compileRequestNative(request: CompileRequest): Promise<NativeCompileSummary> {
	const manifest = await getManifest();
	const result = await compile(request, {
		system: createBrowserWorkerSystemDispatcher({ manifest }),
		toolchainRoot: '/static/toolchain'
	});
	if (!result.success) {
		return {
			success: false,
			stage: inferCompileStage(request, result.diagnostics),
			stdout: result.stdout,
			stderr: result.stderr,
			diagnostics: result.diagnostics,
			artifacts: getArtifactSummary(result.artifacts),
			runtimeOutput: []
		};
	}

	const jsArtifact = result.artifacts.find(
		(artifact) => artifact.kind === 'js' && typeof artifact.data === 'string'
	);
	if (!jsArtifact || typeof jsArtifact.data !== 'string') {
		return {
			success: false,
			stage: request.target === 'wasm' ? 'wasm_of_ocaml' : 'js_of_ocaml',
			stdout: result.stdout,
			stderr: result.stderr,
			thrown: 'browser-native compile completed without producing a JavaScript loader',
			diagnostics: result.diagnostics,
			artifacts: getArtifactSummary(result.artifacts),
			runtimeOutput: []
		};
	}

	const runtime = await runGeneratedProgram(jsArtifact.data, {
		sourcePath: jsArtifact.path,
		assetFiles: result.artifacts
			.filter((artifact) => artifact.path.endsWith('.wasm'))
			.filter(isBinaryArtifact)
			.map((artifact) => ({
				path: artifact.path,
				data: artifact.data
			}))
	});
	if (!runtime.success) {
		return {
			success: false,
			stage: 'runtime',
			stdout: result.stdout,
			stderr: result.stderr,
			thrown: runtime.error,
			diagnostics: result.diagnostics,
			artifacts: getArtifactSummary(result.artifacts),
			runtimeOutput: runtime.runtimeOutput
		};
	}

	return {
		success: true,
		stage: 'runtime',
		stdout: result.stdout,
		stderr: result.stderr,
		diagnostics: result.diagnostics,
		artifacts: getArtifactSummary(result.artifacts),
		runtimeOutput: runtime.runtimeOutput
	};
}

async function compileSingleFileFixture(options: {
	fixtureUrl: string;
	entry: string;
	target: 'js' | 'wasm';
	packages?: string[];
}) {
	const fixtureResponse = await fetch(options.fixtureUrl, { cache: 'no-store' });
	if (!fixtureResponse.ok) {
		throw new Error(
			`failed to fetch fixture: ${options.fixtureUrl} (${fixtureResponse.status})`
		);
	}
	const source = await fixtureResponse.text();
	return await compileRequestNative({
		files: {
			[options.entry]: source
		},
		entry: options.entry,
		target: options.target,
		...(options.packages?.length ? { packages: options.packages } : {})
	});
}

export async function compileHelloNative() {
	return await compileSingleFileFixture({
		fixtureUrl: '/fixtures/hello/hello.ml',
		entry: 'hello.ml',
		target: 'js'
	});
}

export async function compileHelloNativeWasm() {
	return await compileSingleFileFixture({
		fixtureUrl: '/fixtures/hello/hello.ml',
		entry: 'hello.ml',
		target: 'wasm'
	});
}

export async function compileYojsonNative() {
	return await compileSingleFileFixture({
		fixtureUrl: '/fixtures/packages/yojson_main.ml',
		entry: 'yojson_main.ml',
		target: 'js',
		packages: ['yojson']
	});
}

export async function compileYojsonNativeWasm() {
	return await compileSingleFileFixture({
		fixtureUrl: '/fixtures/packages/yojson_main.ml',
		entry: 'yojson_main.ml',
		target: 'wasm',
		packages: ['yojson']
	});
}

export async function compileDiagnosticsNative() {
	return await compileSingleFileFixture({
		fixtureUrl: '/fixtures/diagnostics/type_error.ml',
		entry: 'type_error.ml',
		target: 'js'
	});
}
