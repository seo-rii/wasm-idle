import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import { verifyRuntimeAssetIntegrity, type RuntimeAssetIntegrityEntry } from '@wasm-idle/core';
import { fetchRuntimeAssetBytes } from './runtimeAssetFetch';

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

type RuntimeGlobal = Record<string, unknown>;

type BrowserNativeManifestFile = {
	path: string;
	url?: string;
	size: number;
};

type BrowserNativeManifestAsset = {
	url: string;
	bytes: number;
	sha256: string;
};

type BrowserNativeManifestRuntimePack = {
	format: 'wasm-of-js-of-ocaml-browser-native-runtime-pack-v1';
	asset: string;
	index: string;
	indexBytes: number;
	compressedBytes: number;
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
	findlibConf: BrowserNativeManifestAsset;
	tools: {
		ocamlc: BrowserNativeManifestAsset;
		js_of_ocaml: BrowserNativeManifestAsset;
		wasm_of_ocaml: BrowserNativeManifestAsset;
	};
	binaryenTools?: {
		wasm_opt: BrowserNativeManifestAsset;
		wasm_merge: BrowserNativeManifestAsset;
		wasm_metadce: BrowserNativeManifestAsset;
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
			wasmBinaryenMode?: 'fast' | 'full';
		},
		options: {
			system: unknown;
			toolchainRoot: string;
		}
	) => Promise<CompileResult>;
	createBrowserWorkerSystemDispatcher: (options: {
		manifest: BrowserNativeManifest;
		runtimeAssets?: {
			limits?: {
				maxAssetBytes?: number;
				maxMetadataBytes?: number;
				maxEntryBytes?: number;
			};
		};
	}) => unknown;
};

type LoadRequest = {
	load: true;
	moduleUrl: string;
	manifestUrl: string;
	moduleReceipt: RuntimeAssetIntegrityEntry;
	manifestReceipt: RuntimeAssetIntegrityEntry;
	maxAssetBytes?: number;
};

type RunRequest = {
	load?: false;
	code: string;
	activePath?: string;
	workspaceFiles?: Array<{ path: string; content: string }>;
	prepare: boolean;
	target?: 'js' | 'wasm';
	wasmBinaryenMode?: 'fast' | 'full';
	log?: boolean;
	buffer?: ArrayBufferLike;
	stdin?: string;
};

const MAX_OCAML_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_OCAML_RUNTIME_ENTRY_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_OCAML_ASSET_BYTES = 128 * 1024 * 1024;
const textDecoder = new TextDecoder();

let moduleUrl = '';
let manifestUrl = '';
let moduleReceipt: OuterAssetReceipt | null = null;
let manifestReceipt: OuterAssetReceipt | null = null;
let maxAssetBytes = DEFAULT_MAX_OCAML_ASSET_BYTES;
let loadedModuleIdentity = '';
let loadedManifestIdentity = '';
let loadedManifestMaxAssetBytes = 0;
let compilerPromise: Promise<CompilerModule> | null = null;
let manifestPromise: Promise<BrowserNativeManifest> | null = null;
let compiledResult: CompileResult | null = null;
let compiledCacheKey = '';
let stdinBufferOcaml: Int32Array | null = null;

type OuterAssetReceipt = Readonly<Required<Pick<RuntimeAssetIntegrityEntry, 'bytes' | 'sha256'>>>;

function requireOuterAssetReceipt(
	value: RuntimeAssetIntegrityEntry | undefined,
	label: 'module' | 'manifest'
): OuterAssetReceipt {
	if (
		!value ||
		!Number.isSafeInteger(value.bytes) ||
		(value.bytes as number) <= 0 ||
		typeof value.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.sha256)
	) {
		throw new TypeError(`OCaml ${label} receipt is invalid`);
	}
	return Object.freeze({ bytes: value.bytes as number, sha256: value.sha256 });
}

const outerAssetIdentity = (url: string, receipt: OuterAssetReceipt) =>
	JSON.stringify([url, receipt.bytes, receipt.sha256]);

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

function rewriteManifestAsset(
	asset: BrowserNativeManifestAsset,
	currentManifestUrl: string
): BrowserNativeManifestAsset {
	return {
		...asset,
		url: rewriteAbsoluteBundleUrl(asset.url, currentManifestUrl)
	};
}

function rewriteManifest(
	manifest: BrowserNativeManifest,
	currentManifestUrl: string
): BrowserNativeManifest {
	return {
		...manifest,
		findlibConf: rewriteManifestAsset(manifest.findlibConf, currentManifestUrl),
		tools: {
			ocamlc: rewriteManifestAsset(manifest.tools.ocamlc, currentManifestUrl),
			js_of_ocaml: rewriteManifestAsset(manifest.tools.js_of_ocaml, currentManifestUrl),
			wasm_of_ocaml: rewriteManifestAsset(manifest.tools.wasm_of_ocaml, currentManifestUrl)
		},
		...(manifest.binaryenTools
			? {
					binaryenTools: {
						wasm_opt: rewriteManifestAsset(
							manifest.binaryenTools.wasm_opt,
							currentManifestUrl
						),
						wasm_merge: rewriteManifestAsset(
							manifest.binaryenTools.wasm_merge,
							currentManifestUrl
						),
						wasm_metadce: rewriteManifestAsset(
							manifest.binaryenTools.wasm_metadce,
							currentManifestUrl
						)
					}
				}
			: {}),
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

function prepareVerifiedModuleSource(bytes: Uint8Array, nextModuleUrl: string) {
	const source = textDecoder.decode(bytes);
	const withAbsoluteImports = source.replace(
		/(\bfrom\s+|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+)\2/gu,
		(_match, prefix: string, quote: string, specifier: string) =>
			`${prefix}${quote}${new URL(specifier, nextModuleUrl).href}${quote}`
	);
	return withAbsoluteImports.replace(/\bimport\.meta\.url\b/gu, JSON.stringify(nextModuleUrl));
}

async function loadCompiler(
	nextModuleUrl: string,
	nextReceipt: OuterAssetReceipt,
	nextMaxAssetBytes: number
) {
	if (!nextModuleUrl) {
		throw new Error(
			'OCaml runtime is not configured. Set runtimeAssets.ocaml.moduleUrl and runtimeAssets.ocaml.manifestUrl or sync the bundled wasm-of-js-of-ocaml assets.'
		);
	}
	if (nextReceipt.bytes > nextMaxAssetBytes) {
		throw new Error(`OCaml module exceeds the ${nextMaxAssetBytes} byte limit`);
	}
	const identity = outerAssetIdentity(nextModuleUrl, nextReceipt);
	if (loadedModuleIdentity === identity && compilerPromise) {
		return await compilerPromise;
	}
	loadedModuleIdentity = identity;
	compiledResult = null;
	compiledCacheKey = '';
	compilerPromise = (async () => {
		const bytes = await fetchRuntimeAssetBytes({
			url: nextModuleUrl,
			label: 'OCaml runtime module',
			cache: 'no-store',
			maxAssetBytes: nextReceipt.bytes
		});
		await verifyRuntimeAssetIntegrity({
			asset: nextModuleUrl,
			bytes,
			expected: nextReceipt,
			runtimeId: 'OCAML'
		});
		if (
			typeof URL.createObjectURL !== 'function' ||
			typeof URL.revokeObjectURL !== 'function'
		) {
			throw new Error('OCaml runtime requires Blob URL support');
		}
		const verifiedModuleUrl = URL.createObjectURL(
			new Blob([prepareVerifiedModuleSource(bytes, nextModuleUrl)], {
				type: 'text/javascript'
			})
		);
		let module: Partial<CompilerModule>;
		try {
			module = (await import(
				/* @vite-ignore */ verifiedModuleUrl
			)) as Partial<CompilerModule>;
		} finally {
			try {
				URL.revokeObjectURL(verifiedModuleUrl);
			} catch {
				// Blob URL cleanup must not replace the verified module import outcome.
			}
		}
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

function resolveMaxAssetBytes(value: number | undefined) {
	const resolved = value ?? DEFAULT_MAX_OCAML_ASSET_BYTES;
	if (!Number.isSafeInteger(resolved) || resolved <= 0) {
		throw new TypeError('OCaml runtime maxAssetBytes must be a positive safe integer');
	}
	return resolved;
}

function assertManifestAssetLimit(manifest: BrowserNativeManifest, limit: number) {
	const declaredAssets: Array<readonly [string, unknown]> = [
		['findlib.conf', manifest.findlibConf?.bytes],
		['ocamlc', manifest.tools?.ocamlc?.bytes],
		['js_of_ocaml', manifest.tools?.js_of_ocaml?.bytes],
		['wasm_of_ocaml', manifest.tools?.wasm_of_ocaml?.bytes],
		...Object.entries(manifest.binaryenTools || {}).map(
			([name, asset]) => [name, asset?.bytes] as const
		),
		...(manifest.runtimePack
			? [
					['runtime pack index', manifest.runtimePack.indexBytes] as const,
					[
						'runtime pack compressed payload',
						manifest.runtimePack.compressedBytes
					] as const,
					['runtime pack expanded payload', manifest.runtimePack.totalBytes] as const
				]
			: []),
		...((manifest.ocamlLibFiles || []).map((file) => [file.path, file.size] as const) as Array<
			readonly [string, unknown]
		>),
		...((manifest.packages || []).flatMap((manifestPackage) =>
			(manifestPackage.files || []).map((file) => [file.path, file.size] as const)
		) as Array<readonly [string, unknown]>)
	];
	for (const [label, declaredBytes] of declaredAssets) {
		if (Number.isSafeInteger(declaredBytes) && (declaredBytes as number) > limit) {
			throw new Error(`OCaml runtime asset ${label} exceeds the ${limit} byte limit`);
		}
	}
}

async function loadManifest(
	nextManifestUrl: string,
	nextReceipt: OuterAssetReceipt,
	nextMaxAssetBytes: number
) {
	if (!nextManifestUrl) {
		throw new Error(
			'OCaml runtime is not configured. Set runtimeAssets.ocaml.moduleUrl and runtimeAssets.ocaml.manifestUrl or sync the bundled wasm-of-js-of-ocaml assets.'
		);
	}
	const manifestLimit = Math.min(MAX_OCAML_MANIFEST_BYTES, nextMaxAssetBytes);
	if (nextReceipt.bytes > manifestLimit) {
		throw new Error(`OCaml manifest exceeds the ${manifestLimit} byte limit`);
	}
	const identity = outerAssetIdentity(nextManifestUrl, nextReceipt);
	if (
		loadedManifestIdentity === identity &&
		loadedManifestMaxAssetBytes === nextMaxAssetBytes &&
		manifestPromise
	) {
		return await manifestPromise;
	}
	loadedManifestIdentity = identity;
	loadedManifestMaxAssetBytes = nextMaxAssetBytes;
	compiledResult = null;
	compiledCacheKey = '';
	manifestPromise = (async () => {
		const bytes = await fetchRuntimeAssetBytes({
			url: nextManifestUrl,
			label: 'OCaml manifest',
			cache: 'no-store',
			maxAssetBytes: nextReceipt.bytes
		});
		await verifyRuntimeAssetIntegrity({
			asset: nextManifestUrl,
			bytes,
			expected: nextReceipt,
			runtimeId: 'OCAML'
		});
		let manifest: BrowserNativeManifest;
		try {
			manifest = JSON.parse(textDecoder.decode(bytes)) as BrowserNativeManifest;
		} catch {
			throw new Error('OCaml manifest is not valid JSON');
		}
		assertManifestAssetLimit(manifest, nextMaxAssetBytes);
		return rewriteManifest(manifest, nextManifestUrl);
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

async function executeCompileResult(result: CompileResult, log = false, stdin?: string) {
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
	const hasExplicitStdinOcaml = typeof stdin === 'string';
	let stdinChunkOcaml = hasExplicitStdinOcaml ? stdinEncoder.encode(stdin) : new Uint8Array(0);
	let stdinChunkOffsetOcaml = 0;
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
	const runtimeGlobal = globalThis as unknown as RuntimeGlobal;
	const hadProcess = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'process');
	const hadRequire = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'require');
	const hadModule = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'module');
	const hadExports = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'exports');
	const hadFs = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'fs');
	const originalProcess = runtimeGlobal['process'];
	const originalRequire = runtimeGlobal['require'];
	const originalModule = runtimeGlobal['module'];
	const originalExports = runtimeGlobal['exports'];
	const originalFs = runtimeGlobal['fs'];
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

	const readOcamlStdinBytes = (requestedBytes: number) => {
		if (!stdinBufferOcaml) {
			return null;
		}
		if (requestedBytes <= 0) {
			return new Uint8Array(0);
		}
		while (stdinChunkOffsetOcaml >= stdinChunkOcaml.length) {
			if (hasExplicitStdinOcaml) return null;
			const chunk = waitForBufferedStdin(stdinBufferOcaml, () =>
				postMessage({ buffer: true })
			);
			if (chunk == null) {
				stdinChunkOcaml = new Uint8Array(0);
				stdinChunkOffsetOcaml = 0;
				return null;
			}
			stdinChunkOcaml = stdinEncoder.encode(chunk);
			stdinChunkOffsetOcaml = 0;
		}
		const end = Math.min(stdinChunkOffsetOcaml + requestedBytes, stdinChunkOcaml.length);
		const bytes = stdinChunkOcaml.slice(stdinChunkOffsetOcaml, end);
		stdinChunkOffsetOcaml = end;
		return bytes;
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
	runtimeGlobal['process'] = undefined;
	runtimeGlobal[stdinHookKey] = (requestedBytes = Number.MAX_SAFE_INTEGER) => {
		const encoded = readOcamlStdinBytes(requestedBytes);
		if (encoded == null) {
			return null;
		}
		let byteString = '';
		for (const byte of encoded) {
			byteString += String.fromCharCode(byte);
		}
		return byteString;
	};
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
			const encoded = readOcamlStdinBytes(length);
			if (encoded == null) {
				return 0;
			}
			buffer.set(encoded, offset);
			return encoded.byteLength;
		}
	};
	runtimeGlobal['fs'] = stdinFsShim;
	runtimeGlobal['require'] = (specifier: string) => {
		if (specifier === 'fs' || specifier === 'node:fs') {
			return stdinFsShim;
		}
		throw new Error(`unsupported OCaml runtime require: ${specifier}`);
	};
	runtimeGlobal['module'] = { exports: {} };
	runtimeGlobal['exports'] = (runtimeGlobal['module'] as { exports: unknown }).exports;

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
			delete runtimeGlobal['process'];
		} else {
			runtimeGlobal['process'] = originalProcess;
		}
		if (!hadRequire) {
			delete runtimeGlobal['require'];
		} else {
			runtimeGlobal['require'] = originalRequire;
		}
		if (!hadModule) {
			delete runtimeGlobal['module'];
		} else {
			runtimeGlobal['module'] = originalModule;
		}
		if (!hadExports) {
			delete runtimeGlobal['exports'];
		} else {
			runtimeGlobal['exports'] = originalExports;
		}
		if (!hadFs) {
			delete runtimeGlobal['fs'];
		} else {
			runtimeGlobal['fs'] = originalFs;
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
	let log = true;
	try {
		if (event.data.load) {
			moduleUrl = event.data.moduleUrl;
			manifestUrl = event.data.manifestUrl;
			moduleReceipt = requireOuterAssetReceipt(event.data.moduleReceipt, 'module');
			manifestReceipt = requireOuterAssetReceipt(event.data.manifestReceipt, 'manifest');
			maxAssetBytes = resolveMaxAssetBytes(event.data.maxAssetBytes);
			await loadManifest(manifestUrl, manifestReceipt, maxAssetBytes);
			await loadCompiler(moduleUrl, moduleReceipt, maxAssetBytes);
			postMessage({ load: true });
			return;
		}
		const {
			code,
			prepare,
			target = 'wasm',
			wasmBinaryenMode = 'fast',
			log: configuredLog = true,
			buffer,
			stdin,
			activePath = 'main.ml',
			workspaceFiles = []
		} = event.data;
		log = configuredLog;

		stdinBufferOcaml = buffer ? new Int32Array(buffer) : null;

		if (log) {
			console.log(
				`[wasm-idle:ocaml-worker] compile start prepare=${prepare} target=${target} binaryen=${wasmBinaryenMode}`
			);
		}
		postMessage({ progress: { stage: 'compile-bootstrap', percent: 10 } });
		if (!moduleReceipt || !manifestReceipt) {
			throw new Error('OCaml runtime outer asset receipts are not loaded');
		}
		const manifest = await loadManifest(manifestUrl, manifestReceipt, maxAssetBytes);
		const compilerModule = await loadCompiler(moduleUrl, moduleReceipt, maxAssetBytes);
		postMessage({ progress: { stage: 'compile-ready', percent: 25 } });

		const files = Object.fromEntries([
			...workspaceFiles.map((file) => [file.path, file.content]),
			[activePath, code]
		]);
		const compileKey = JSON.stringify({
			target,
			wasmBinaryenMode,
			entry: activePath,
			files
		});
		let compiledFresh = false;
		if (!compiledResult || compiledCacheKey !== compileKey) {
			const result = await compilerModule.compile(
				{
					files,
					entry: activePath,
					target,
					effectsMode: 'cps',
					wasmBinaryenMode
				},
				{
					system: compilerModule.createBrowserWorkerSystemDispatcher({
						manifest,
						runtimeAssets: {
							limits: {
								maxAssetBytes,
								maxMetadataBytes: Math.min(MAX_OCAML_MANIFEST_BYTES, maxAssetBytes),
								maxEntryBytes: Math.min(
									MAX_OCAML_RUNTIME_ENTRY_BYTES,
									maxAssetBytes
								)
							}
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
		await executeCompileResult(result, log, stdin);
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:ocaml-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
