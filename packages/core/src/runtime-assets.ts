export interface RuntimeAssetKeySource {
	rootUrl?: string;
	python?: { baseUrl?: string; loader?: unknown };
	java?: { baseUrl?: string; loader?: unknown };
	clang?: { baseUrl?: string; loader?: unknown };
	clangd?: { baseUrl?: string; loader?: unknown };
	rust?: { compilerUrl?: string };
	go?: { compilerUrl?: string };
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
	ruby?: { wasmUrl?: string };
	r?: { baseUrl?: string };
	octave?: { baseUrl?: string; workerUrl?: string; manifestUrl?: string };
	prolog?: { baseUrl?: string; workerUrl?: string };
	gleam?: { baseUrl?: string; workerUrl?: string; manifestUrl?: string };
	perl?: { baseUrl?: string; workerUrl?: string };
	tcl?: { baseUrl?: string; workerUrl?: string };
	sqlite?: { wasmUrl?: string };
	php?: { version?: string };
}

export type RuntimeAssetKeyInput = string | RuntimeAssetKeySource | undefined;

export function createRuntimeAssetsKey(runtimeAssets: RuntimeAssetKeyInput): string | undefined {
	if (typeof runtimeAssets === 'string') return runtimeAssets;
	if (!runtimeAssets) return undefined;
	return JSON.stringify({
		rootUrl: runtimeAssets.rootUrl || '',
		pythonBaseUrl: runtimeAssets.python?.baseUrl || '',
		hasPythonLoader: !!runtimeAssets.python?.loader,
		javaBaseUrl: runtimeAssets.java?.baseUrl || '',
		hasJavaLoader: !!runtimeAssets.java?.loader,
		clangBaseUrl: runtimeAssets.clang?.baseUrl || '',
		hasClangLoader: !!runtimeAssets.clang?.loader,
		clangdBaseUrl: runtimeAssets.clangd?.baseUrl || '',
		hasClangdLoader: !!runtimeAssets.clangd?.loader,
		rustCompilerUrl: runtimeAssets.rust?.compilerUrl || '',
		goCompilerUrl: runtimeAssets.go?.compilerUrl || '',
		dModuleUrl: runtimeAssets.d?.moduleUrl || '',
		dotnetModuleUrl: runtimeAssets.dotnet?.moduleUrl || '',
		elixirBundleUrl: runtimeAssets.elixir?.bundleUrl || '',
		erlangBundleUrl: runtimeAssets.erlang?.bundleUrl || '',
		ocamlModuleUrl: runtimeAssets.ocaml?.moduleUrl || '',
		ocamlManifestUrl: runtimeAssets.ocaml?.manifestUrl || '',
		tinygoAppUrl: runtimeAssets.tinygo?.appUrl || '',
		tinygoModuleUrl: runtimeAssets.tinygo?.moduleUrl || '',
		typeScriptModuleUrl: runtimeAssets.typescript?.moduleUrl || '',
		watModuleUrl: runtimeAssets.wat?.moduleUrl || '',
		luaModuleUrl: runtimeAssets.lua?.moduleUrl || '',
		haskellModuleUrl: runtimeAssets.haskell?.moduleUrl || '',
		haskellRootfsUrl: runtimeAssets.haskell?.rootfsUrl || '',
		haskellBsdtarUrl: runtimeAssets.haskell?.bsdtarUrl || '',
		haskellMainSoPath: runtimeAssets.haskell?.mainSoPath || '',
		haskellSearchDirs: runtimeAssets.haskell?.searchDirs?.join('\0') || '',
		zigCompilerUrl: runtimeAssets.zig?.compilerUrl || '',
		zigStdlibUrl: runtimeAssets.zig?.stdlibUrl || '',
		lispModuleUrl: runtimeAssets.lisp?.moduleUrl || '',
		rubyWasmUrl: runtimeAssets.ruby?.wasmUrl || '',
		rBaseUrl: runtimeAssets.r?.baseUrl || '',
		octaveBaseUrl: runtimeAssets.octave?.baseUrl || '',
		octaveWorkerUrl: runtimeAssets.octave?.workerUrl || '',
		octaveManifestUrl: runtimeAssets.octave?.manifestUrl || '',
		prologBaseUrl: runtimeAssets.prolog?.baseUrl || '',
		prologWorkerUrl: runtimeAssets.prolog?.workerUrl || '',
		gleamBaseUrl: runtimeAssets.gleam?.baseUrl || '',
		gleamWorkerUrl: runtimeAssets.gleam?.workerUrl || '',
		gleamManifestUrl: runtimeAssets.gleam?.manifestUrl || '',
		perlBaseUrl: runtimeAssets.perl?.baseUrl || '',
		perlWorkerUrl: runtimeAssets.perl?.workerUrl || '',
		tclBaseUrl: runtimeAssets.tcl?.baseUrl || '',
		tclWorkerUrl: runtimeAssets.tcl?.workerUrl || '',
		sqliteWasmUrl: runtimeAssets.sqlite?.wasmUrl || '',
		phpVersion: runtimeAssets.php?.version || ''
	});
}
