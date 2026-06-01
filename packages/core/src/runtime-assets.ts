export interface RuntimeAssetKeySource {
	rootUrl?: string;
	python?: { baseUrl?: string; loader?: unknown };
	java?: { baseUrl?: string; loader?: unknown };
	clang?: { baseUrl?: string; loader?: unknown };
	clangd?: { baseUrl?: string; loader?: unknown };
	rust?: { compilerUrl?: string };
	go?: { compilerUrl?: string };
	dotnet?: { moduleUrl?: string };
	elixir?: { bundleUrl?: string };
	ocaml?: { moduleUrl?: string; manifestUrl?: string };
	tinygo?: { appUrl?: string; moduleUrl?: string };
	typescript?: { moduleUrl?: string };
	haskell?: {
		moduleUrl?: string;
		rootfsUrl?: string;
		bsdtarUrl?: string;
		mainSoPath?: string;
		searchDirs?: string[];
	};
	zig?: { compilerUrl?: string; stdlibUrl?: string };
	lisp?: { moduleUrl?: string };
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
		dotnetModuleUrl: runtimeAssets.dotnet?.moduleUrl || '',
		elixirBundleUrl: runtimeAssets.elixir?.bundleUrl || '',
		ocamlModuleUrl: runtimeAssets.ocaml?.moduleUrl || '',
		ocamlManifestUrl: runtimeAssets.ocaml?.manifestUrl || '',
		tinygoAppUrl: runtimeAssets.tinygo?.appUrl || '',
		tinygoModuleUrl: runtimeAssets.tinygo?.moduleUrl || '',
		typeScriptModuleUrl: runtimeAssets.typescript?.moduleUrl || '',
		haskellModuleUrl: runtimeAssets.haskell?.moduleUrl || '',
		haskellRootfsUrl: runtimeAssets.haskell?.rootfsUrl || '',
		haskellBsdtarUrl: runtimeAssets.haskell?.bsdtarUrl || '',
		haskellMainSoPath: runtimeAssets.haskell?.mainSoPath || '',
		haskellSearchDirs: runtimeAssets.haskell?.searchDirs?.join('\0') || '',
		zigCompilerUrl: runtimeAssets.zig?.compilerUrl || '',
		zigStdlibUrl: runtimeAssets.zig?.stdlibUrl || '',
		lispModuleUrl: runtimeAssets.lisp?.moduleUrl || ''
	});
}
