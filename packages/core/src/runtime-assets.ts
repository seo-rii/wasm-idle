export interface RuntimeAssetKeySource {
	rootUrl?: string;
	python?: { baseUrl?: string; loader?: unknown };
	java?: { baseUrl?: string; loader?: unknown };
	clang?: { baseUrl?: string; loader?: unknown };
	clangd?: { baseUrl?: string; loader?: unknown };
	rust?: { compilerUrl?: string; debugModuleUrl?: string };
	go?: { compilerUrl?: string };
	assemblyscript?: { moduleUrl?: string };
	duckdb?: { moduleUrl?: string };
	d?: { moduleUrl?: string };
	dotnet?: { moduleUrl?: string };
	elixir?: { bundleUrl?: string };
	erlang?: { bundleUrl?: string };
	ocaml?: { moduleUrl?: string; manifestUrl?: string };
	tinygo?: { appUrl?: string; moduleUrl?: string };
	typescript?: { moduleUrl?: string };
	wat?: { moduleUrl?: string };
	lua?: { moduleUrl?: string };
	haskell?: {
		moduleUrl?: string;
		rootfsUrl?: string;
		bsdtarUrl?: string;
		mainSoPath?: string;
		searchDirs?: string[];
	};
	zig?: { compilerUrl?: string; stdlibUrl?: string };
	lisp?: { moduleUrl?: string };
	ruby?: { moduleUrl?: string; wasmUrl?: string };
	r?: { baseUrl?: string };
	octave?: { baseUrl?: string; workerUrl?: string; manifestUrl?: string };
	prolog?: { baseUrl?: string; workerUrl?: string };
	gleam?: { baseUrl?: string; workerUrl?: string; manifestUrl?: string };
	perl?: { baseUrl?: string; workerUrl?: string };
	tcl?: { baseUrl?: string; workerUrl?: string };
	awk?: { baseUrl?: string; workerUrl?: string };
	pascal?: { baseUrl?: string; workerUrl?: string };
	forth?: { baseUrl?: string; workerUrl?: string };
	j?: { baseUrl?: string; workerUrl?: string };
	bqn?: { baseUrl?: string; workerUrl?: string };
	janet?: { baseUrl?: string; workerUrl?: string };
	julia?: { baseUrl?: string; workerUrl?: string };
	nim?: { baseUrl?: string; workerUrl?: string };
	bash?: { moduleUrl?: string; webcUrl?: string; workerUrl?: string };
	clojurescript?: { baseUrl?: string; workerUrl?: string };
	cobol?: { baseUrl?: string };
	swift?: { baseUrl?: string; workerUrl?: string; manifestUrl?: string };
	sqlite?: { moduleUrl?: string; wasmUrl?: string };
	php?: { moduleUrl?: string };
}

export type RuntimeAssetKeyInput = string | RuntimeAssetKeySource | undefined;

type RuntimeAssetName = Exclude<keyof RuntimeAssetKeySource, 'rootUrl'>;

interface RuntimeAssetKeyField {
	runtime: RuntimeAssetName;
	property: string;
	key: string;
	serialize?: (value: unknown) => string | boolean;
}

const hasValue = (value: unknown) => !!value;

const joinStringList = (value: unknown) => (Array.isArray(value) ? value.join('\0') : '');

const RUNTIME_ASSET_KEY_FIELDS = [
	{ runtime: 'python', property: 'baseUrl', key: 'pythonBaseUrl' },
	{ runtime: 'python', property: 'loader', key: 'hasPythonLoader', serialize: hasValue },
	{ runtime: 'java', property: 'baseUrl', key: 'javaBaseUrl' },
	{ runtime: 'java', property: 'loader', key: 'hasJavaLoader', serialize: hasValue },
	{ runtime: 'clang', property: 'baseUrl', key: 'clangBaseUrl' },
	{ runtime: 'clang', property: 'loader', key: 'hasClangLoader', serialize: hasValue },
	{ runtime: 'clangd', property: 'baseUrl', key: 'clangdBaseUrl' },
	{ runtime: 'clangd', property: 'loader', key: 'hasClangdLoader', serialize: hasValue },
	{ runtime: 'rust', property: 'compilerUrl', key: 'rustCompilerUrl' },
	{ runtime: 'rust', property: 'debugModuleUrl', key: 'rustDebugModuleUrl' },
	{ runtime: 'go', property: 'compilerUrl', key: 'goCompilerUrl' },
	{ runtime: 'assemblyscript', property: 'moduleUrl', key: 'assemblyScriptModuleUrl' },
	{ runtime: 'duckdb', property: 'moduleUrl', key: 'duckDbModuleUrl' },
	{ runtime: 'd', property: 'moduleUrl', key: 'dModuleUrl' },
	{ runtime: 'dotnet', property: 'moduleUrl', key: 'dotnetModuleUrl' },
	{ runtime: 'elixir', property: 'bundleUrl', key: 'elixirBundleUrl' },
	{ runtime: 'erlang', property: 'bundleUrl', key: 'erlangBundleUrl' },
	{ runtime: 'ocaml', property: 'moduleUrl', key: 'ocamlModuleUrl' },
	{ runtime: 'ocaml', property: 'manifestUrl', key: 'ocamlManifestUrl' },
	{ runtime: 'tinygo', property: 'appUrl', key: 'tinygoAppUrl' },
	{ runtime: 'tinygo', property: 'moduleUrl', key: 'tinygoModuleUrl' },
	{ runtime: 'typescript', property: 'moduleUrl', key: 'typeScriptModuleUrl' },
	{ runtime: 'wat', property: 'moduleUrl', key: 'watModuleUrl' },
	{ runtime: 'lua', property: 'moduleUrl', key: 'luaModuleUrl' },
	{ runtime: 'haskell', property: 'moduleUrl', key: 'haskellModuleUrl' },
	{ runtime: 'haskell', property: 'rootfsUrl', key: 'haskellRootfsUrl' },
	{ runtime: 'haskell', property: 'bsdtarUrl', key: 'haskellBsdtarUrl' },
	{ runtime: 'haskell', property: 'mainSoPath', key: 'haskellMainSoPath' },
	{
		runtime: 'haskell',
		property: 'searchDirs',
		key: 'haskellSearchDirs',
		serialize: joinStringList
	},
	{ runtime: 'zig', property: 'compilerUrl', key: 'zigCompilerUrl' },
	{ runtime: 'zig', property: 'stdlibUrl', key: 'zigStdlibUrl' },
	{ runtime: 'lisp', property: 'moduleUrl', key: 'lispModuleUrl' },
	{ runtime: 'ruby', property: 'moduleUrl', key: 'rubyModuleUrl' },
	{ runtime: 'ruby', property: 'wasmUrl', key: 'rubyWasmUrl' },
	{ runtime: 'r', property: 'baseUrl', key: 'rBaseUrl' },
	{ runtime: 'octave', property: 'baseUrl', key: 'octaveBaseUrl' },
	{ runtime: 'octave', property: 'workerUrl', key: 'octaveWorkerUrl' },
	{ runtime: 'octave', property: 'manifestUrl', key: 'octaveManifestUrl' },
	{ runtime: 'prolog', property: 'baseUrl', key: 'prologBaseUrl' },
	{ runtime: 'prolog', property: 'workerUrl', key: 'prologWorkerUrl' },
	{ runtime: 'gleam', property: 'baseUrl', key: 'gleamBaseUrl' },
	{ runtime: 'gleam', property: 'workerUrl', key: 'gleamWorkerUrl' },
	{ runtime: 'gleam', property: 'manifestUrl', key: 'gleamManifestUrl' },
	{ runtime: 'perl', property: 'baseUrl', key: 'perlBaseUrl' },
	{ runtime: 'perl', property: 'workerUrl', key: 'perlWorkerUrl' },
	{ runtime: 'tcl', property: 'baseUrl', key: 'tclBaseUrl' },
	{ runtime: 'tcl', property: 'workerUrl', key: 'tclWorkerUrl' },
	{ runtime: 'awk', property: 'baseUrl', key: 'awkBaseUrl' },
	{ runtime: 'awk', property: 'workerUrl', key: 'awkWorkerUrl' },
	{ runtime: 'pascal', property: 'baseUrl', key: 'pascalBaseUrl' },
	{ runtime: 'pascal', property: 'workerUrl', key: 'pascalWorkerUrl' },
	{ runtime: 'forth', property: 'baseUrl', key: 'forthBaseUrl' },
	{ runtime: 'forth', property: 'workerUrl', key: 'forthWorkerUrl' },
	{ runtime: 'j', property: 'baseUrl', key: 'jBaseUrl' },
	{ runtime: 'j', property: 'workerUrl', key: 'jWorkerUrl' },
	{ runtime: 'bqn', property: 'baseUrl', key: 'bqnBaseUrl' },
	{ runtime: 'bqn', property: 'workerUrl', key: 'bqnWorkerUrl' },
	{ runtime: 'janet', property: 'baseUrl', key: 'janetBaseUrl' },
	{ runtime: 'janet', property: 'workerUrl', key: 'janetWorkerUrl' },
	{ runtime: 'julia', property: 'baseUrl', key: 'juliaBaseUrl' },
	{ runtime: 'julia', property: 'workerUrl', key: 'juliaWorkerUrl' },
	{ runtime: 'nim', property: 'baseUrl', key: 'nimBaseUrl' },
	{ runtime: 'nim', property: 'workerUrl', key: 'nimWorkerUrl' },
	{ runtime: 'bash', property: 'moduleUrl', key: 'bashModuleUrl' },
	{ runtime: 'bash', property: 'webcUrl', key: 'bashWebcUrl' },
	{ runtime: 'bash', property: 'workerUrl', key: 'bashWorkerUrl' },
	{ runtime: 'clojurescript', property: 'baseUrl', key: 'clojurescriptBaseUrl' },
	{ runtime: 'clojurescript', property: 'workerUrl', key: 'clojurescriptWorkerUrl' },
	{ runtime: 'cobol', property: 'baseUrl', key: 'cobolBaseUrl' },
	{ runtime: 'swift', property: 'baseUrl', key: 'swiftBaseUrl' },
	{ runtime: 'swift', property: 'workerUrl', key: 'swiftWorkerUrl' },
	{ runtime: 'swift', property: 'manifestUrl', key: 'swiftManifestUrl' },
	{ runtime: 'sqlite', property: 'moduleUrl', key: 'sqliteModuleUrl' },
	{ runtime: 'sqlite', property: 'wasmUrl', key: 'sqliteWasmUrl' },
	{ runtime: 'php', property: 'moduleUrl', key: 'phpModuleUrl' }
] satisfies RuntimeAssetKeyField[];

const runtimeAssetRecord = (runtimeAssets: RuntimeAssetKeySource, runtime: RuntimeAssetName) =>
	runtimeAssets[runtime] as Record<string, unknown> | undefined;

const readRuntimeAssetKeyField = (
	runtimeAssets: RuntimeAssetKeySource,
	field: RuntimeAssetKeyField
) => {
	const value = runtimeAssetRecord(runtimeAssets, field.runtime)?.[field.property];
	if (field.serialize) return field.serialize(value);
	return typeof value === 'string' ? value : '';
};

export function createRuntimeAssetsKey(runtimeAssets: RuntimeAssetKeyInput): string | undefined {
	if (typeof runtimeAssets === 'string') return runtimeAssets;
	if (!runtimeAssets) return undefined;
	const keyParts: Record<string, string | boolean> = {
		rootUrl: runtimeAssets.rootUrl || ''
	};
	for (const field of RUNTIME_ASSET_KEY_FIELDS) {
		keyParts[field.key] = readRuntimeAssetKeyField(runtimeAssets, field);
	}
	return JSON.stringify(keyParts);
}
