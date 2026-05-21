export const ASSEMBLYSCRIPT_PACKAGE = 'assemblyscript';
export const ASSEMBLYSCRIPT_ASC_MODULE = 'assemblyscript/asc';
export const ASSEMBLYSCRIPT_LOADER_MODULE = '@assemblyscript/loader';

export const ASSEMBLYSCRIPT_PACKAGE_ASSETS = [
	'dist/asc.js',
	'dist/assemblyscript.js',
	'dist/web.js',
	'std/assembly/index.d.ts',
	'std/portable/index.js'
] as const;

export type AssemblyScriptPackageAsset = (typeof ASSEMBLYSCRIPT_PACKAGE_ASSETS)[number];
export type AssemblyScriptRuntime = 'incremental' | 'minimal' | 'stub';
export type AssemblyScriptBindings = 'esm' | 'raw';

export interface AssemblyScriptAssetResolverOptions {
	baseUrl?: string | URL;
	currentUrl?: string | URL;
}

export interface AssemblyScriptCompileArgsOptions {
	entry?: string;
	outFile?: string;
	textFile?: string;
	runtime?: AssemblyScriptRuntime;
	bindings?: AssemblyScriptBindings;
	optimize?: boolean;
	exportRuntime?: boolean;
	sourceMap?: boolean | string;
	extraArgs?: string[];
}

export interface AssemblyScriptSourceFile {
	path: string;
	source: string;
}

export interface AssemblyScriptCompileOptions extends AssemblyScriptCompileArgsOptions {
	files?: AssemblyScriptSourceFile[] | Record<string, string>;
	source?: string;
	compiler?: AssemblyScriptCompilerModule;
	moduleName?: string;
}

export interface AssemblyScriptCompileResult {
	error?: Error;
	stdout: string;
	stderr: string;
	wasm?: Uint8Array;
	text?: string;
	files: Record<string, Uint8Array | string>;
}

export interface AssemblyScriptCompilerIo {
	stdout?: unknown;
	stderr?: unknown;
	readFile?: (filePath: string) => string | null;
	writeFile?: (filePath: string, contents: Uint8Array | string) => void;
	listFiles?: (dirPath: string, baseDir?: string) => string[] | null;
}

export interface AssemblyScriptCompilerModule {
	main?: (
		args: string[],
		options?: AssemblyScriptCompilerIo,
		callback?: unknown
	) =>
		| Promise<{ error?: Error; stdout?: unknown; stderr?: unknown }>
		| { error?: Error; stdout?: unknown; stderr?: unknown };
	[key: string]: unknown;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

export function normalizeAssemblyScriptBaseUrl(
	baseUrl: string | URL = '/assemblyscript/',
	currentUrl?: string | URL
) {
	const normalized = ensureTrailingSlash(stringifyUrl(baseUrl));
	if (currentUrl) return new URL(normalized, stringifyUrl(currentUrl)).href;
	return normalized;
}

export function resolveAssemblyScriptAssetUrl(
	asset: AssemblyScriptPackageAsset | string,
	options: AssemblyScriptAssetResolverOptions = {}
) {
	if (ABSOLUTE_URL_PATTERN.test(asset)) return asset;
	const baseUrl = normalizeAssemblyScriptBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(asset, baseUrl).href;
	return `${baseUrl}${asset.replace(/^\/+/, '')}`;
}

export function createAssemblyScriptAssetManifest(
	options: AssemblyScriptAssetResolverOptions = {}
) {
	return Object.fromEntries(
		ASSEMBLYSCRIPT_PACKAGE_ASSETS.map((asset) => [
			asset,
			resolveAssemblyScriptAssetUrl(asset, options)
		])
	) as Record<AssemblyScriptPackageAsset, string>;
}

export function createAssemblyScriptCompileArgs(options: AssemblyScriptCompileArgsOptions = {}) {
	const {
		entry = 'assembly/index.ts',
		outFile = 'module.wasm',
		textFile,
		runtime = 'incremental',
		bindings = 'esm',
		optimize = true,
		exportRuntime = true,
		sourceMap,
		extraArgs = []
	} = options;
	const args = [entry, '--outFile', outFile, '--runtime', runtime, '--bindings', bindings];
	if (textFile) args.push('--textFile', textFile);
	if (optimize) args.push('--optimize');
	if (exportRuntime) args.push('--exportRuntime');
	if (sourceMap) args.push('--sourceMap', typeof sourceMap === 'string' ? sourceMap : '');
	args.push(...extraArgs);
	return args;
}

const encodeText = (value: string) => new TextEncoder().encode(value);

const normalizeAssemblyScriptFiles = (
	options: Pick<AssemblyScriptCompileOptions, 'entry' | 'files' | 'source'>
) => {
	const entry = options.entry ?? 'assembly/index.ts';
	const files: Record<string, string> = {
		...(options.source === undefined ? {} : { [entry]: options.source })
	};
	if (Array.isArray(options.files)) {
		for (const file of options.files) files[file.path] = file.source;
	} else if (options.files) {
		Object.assign(files, options.files);
	}
	return { entry, files };
};

const createStringSink = () => {
	let value = '';
	return {
		write(chunk: Uint8Array | string) {
			value += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
		},
		toString() {
			return value;
		}
	};
};

export async function compileAssemblyScript(
	options: AssemblyScriptCompileOptions = {}
): Promise<AssemblyScriptCompileResult> {
	const { entry, files: inputFiles } = normalizeAssemblyScriptFiles(options);
	const outFile = options.outFile ?? 'module.wasm';
	const textFile = options.textFile;
	const outputFiles: Record<string, Uint8Array | string> = {};
	const stdout = createStringSink();
	const stderr = createStringSink();
	const compiler = (options.compiler ??
		(await importAssemblyScriptCompiler(options.moduleName))) as AssemblyScriptCompilerModule;
	const main = compiler.main;
	if (!main) throw new Error('AssemblyScript compiler main export was not found.');
	const result = await main(createAssemblyScriptCompileArgs({ ...options, entry, outFile }), {
		stdout,
		stderr,
		readFile(filePath) {
			return inputFiles[filePath] ?? null;
		},
		writeFile(filePath, contents) {
			outputFiles[filePath] = contents;
		},
		listFiles(dirPath) {
			const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
			return Object.keys(inputFiles).filter((filePath) => filePath.startsWith(prefix));
		}
	});
	const wasm = outputFiles[outFile];
	return {
		error: result.error,
		stdout: String(result.stdout ?? stdout),
		stderr: String(result.stderr ?? stderr),
		wasm: typeof wasm === 'string' ? encodeText(wasm) : wasm,
		text:
			textFile && typeof outputFiles[textFile] === 'string'
				? outputFiles[textFile]
				: undefined,
		files: outputFiles
	};
}

export async function importAssemblyScriptCompiler<T = AssemblyScriptCompilerModule>(
	moduleName = ASSEMBLYSCRIPT_ASC_MODULE
): Promise<T> {
	return (await import(/* @vite-ignore */ moduleName)) as T;
}

export async function importAssemblyScriptLoader<T = unknown>(
	moduleName = ASSEMBLYSCRIPT_LOADER_MODULE
): Promise<T> {
	return (await import(/* @vite-ignore */ moduleName)) as T;
}
