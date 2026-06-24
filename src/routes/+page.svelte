<script lang="ts">
	import Monaco from './Monaco.svelte';
	import Terminal, {
		createPlaygroundBinding,
		createDebugSessionController,
		cppDebugLanguageAdapter,
		goDebugLanguageAdapter,
		pythonDebugLanguageAdapter,
		rustDebugLanguageAdapter,
		isSharedArrayBufferAvailable
	} from '$lib';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { replaceState } from '$app/navigation';
	import { base } from '$app/paths';
	import { SvelteURL } from 'svelte/reactivity';
	import type { PlaygroundRuntimeAssets } from '$lib/playground/assets';
	import type { DebugLanguageAdapter } from '$lib';
	import { WASM_AWK_ASSET_VERSION } from '$lib/playground/wasmAwkVersion';
	import { WASM_BQN_ASSET_VERSION } from '$lib/playground/wasmBqnVersion';
	import { WASM_D_ASSET_VERSION } from '$lib/playground/wasmDVersion';
	import { WASM_DOTNET_ASSET_VERSION } from '$lib/playground/wasmDotnetVersion';
	import { WASM_ELIXIR_ASSET_VERSION } from '$lib/playground/wasmElixirVersion';
	import { WASM_FORTRAN_ASSET_VERSION } from '$lib/playground/wasmFortranVersion';
	import { WASM_FORTH_ASSET_VERSION } from '$lib/playground/wasmForthVersion';
	import { WASM_GO_ASSET_VERSION } from '$lib/playground/wasmGoVersion';
	import { WASM_HASKELL_ASSET_VERSION } from '$lib/playground/wasmHaskellVersion';
	import { WASM_J_ASSET_VERSION } from '$lib/playground/wasmJVersion';
	import { WASM_JANET_ASSET_VERSION } from '$lib/playground/wasmJanetVersion';
	import { WASM_JULIA_ASSET_VERSION } from '$lib/playground/wasmJuliaVersion';
	import { WASM_NIM_ASSET_VERSION } from '$lib/playground/wasmNimVersion';
	import { WASM_LUA_ASSET_VERSION } from '$lib/playground/wasmLuaVersion';
	import { WASM_LISP_ASSET_VERSION } from '$lib/playground/wasmLispVersion';
	import { WASM_OCAML_ASSET_VERSION } from '$lib/playground/wasmOcamlVersion';
	import { WASM_OCTAVE_ASSET_VERSION } from '$lib/playground/wasmOctaveVersion';
	import { WASM_PROLOG_ASSET_VERSION } from '$lib/playground/wasmPrologVersion';
	import { WASM_GLEAM_ASSET_VERSION } from '$lib/playground/wasmGleamVersion';
	import { WASM_PASCAL_ASSET_VERSION } from '$lib/playground/wasmPascalVersion';
	import { WASM_PERL_ASSET_VERSION } from '$lib/playground/wasmPerlVersion';
	import { WASM_R_ASSET_VERSION } from '$lib/playground/wasmRVersion';
	import { WASM_RUST_ASSET_VERSION } from '$lib/playground/wasmRustVersion';
	import { WASM_TCL_ASSET_VERSION } from '$lib/playground/wasmTclVersion';
	import { WASM_TINYGO_ASSET_VERSION } from '$lib/playground/wasmTinyGoVersion';
	import { WASM_TYPESCRIPT_ASSET_VERSION } from '$lib/playground/wasmTypeScriptVersion';
	import { WASM_WAT_ASSET_VERSION } from '$lib/playground/wasmWatVersion';
	import { WASM_ZIG_ASSET_VERSION } from '$lib/playground/wasmZigVersion';
	import type {
		CompilerDiagnostic,
		GoTarget,
		OcamlBackend,
		OcamlWasmBinaryenMode,
		RustTargetTriple,
		SandboxExecutionOptions,
		TinyGoTarget
	} from '$lib/playground/options';
	import type { TerminalControl } from '$lib/terminal';
	import type monaco from 'monaco-editor';
	import { executeTerminalRun } from './execute';
	import elixirRuntimeWorkerUrl from '$lib/playground/worker/elixir?worker&url';
	import {
		isEditorDefaultSource,
		isLegacyEditorDefaultSource,
		resolveEditorDefaultSource
	} from './editor-defaults';
	import {
		argsHelpLanguages,
		argsLabels,
		clangdLspLanguages,
		compilerDiagnosticLanguages,
		debugLspLanguages,
		dotnetLspLanguages,
		editorLanguages,
		editorOnlyLanguages,
		languageLabels,
		lspLanguageOverrides,
		playgroundLanguages,
		runtimeLspCapabilities,
		typescriptLspLanguages,
		type PlaygroundLanguage
	} from './language-registry';
	import rubyStdlibWasmUrl from '@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm?url';
	import sqliteWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

	type WorkspaceFile = {
		path: string;
		content: string;
	};

	type LanguageWorkspace = {
		activePath: string;
		files: WorkspaceFile[];
		openTabs: string[];
	};

	type WorkspaceSnapshot = {
		activePath: string;
		argsInput: string;
		files: WorkspaceFile[];
		goTarget: GoTarget;
		language: string;
		log: boolean;
		lspEnabled: boolean;
		ocamlBackend: OcamlBackend;
		ocamlWasmBinaryenMode: OcamlWasmBinaryenMode;
		openTabs: string[];
		rustTargetTriple: RustTargetTriple;
		sidebarOpen: boolean;
		tinygoTarget: TinyGoTarget;
		version: number;
		workspaces: Record<PlaygroundLanguage, LanguageWorkspace>;
	};
	type EditorLspStatusView = {
		label: string;
		state: 'loading' | 'ready' | 'error';
		text: string;
		title: string;
		progressPercent: number | null;
	};

	const WORKSPACE_STORAGE_KEY = 'wasm-idle:example-workspace:v3';
	const SHARE_PREFIX = 'workspace=';
	const debugLanguageAdapters: Partial<Record<PlaygroundLanguage, DebugLanguageAdapter>> = {
		CPP: cppDebugLanguageAdapter,
		GO: goDebugLanguageAdapter,
		RUST: rustDebugLanguageAdapter,
		PYTHON: pythonDebugLanguageAdapter
	};
	const debugTitles: Partial<Record<PlaygroundLanguage, string>> = {
		CPP: 'Native Trace',
		GO: 'Go Trace',
		RUST: 'Rust Trace',
		PYTHON: 'Pyodide Trace'
	};

	let path = $derived(
		page.url.pathname.endsWith('/') ? page.url.pathname.slice(0, -1) : page.url.pathname
	);
	let clangdBaseUrl = $derived(path ? `${path}/clangd` : '/clangd');
	let runtimeAssets = $derived.by<PlaygroundRuntimeAssets>(() => ({
		rootUrl: path,
		rust: {
			compilerUrl: path
				? `${path}/wasm-rust/index.js?v=${WASM_RUST_ASSET_VERSION}`
				: `/wasm-rust/index.js?v=${WASM_RUST_ASSET_VERSION}`
		},
		go: {
			compilerUrl: path
				? `${path}/wasm-go/index.js?v=${WASM_GO_ASSET_VERSION}`
				: `/wasm-go/index.js?v=${WASM_GO_ASSET_VERSION}`
		},
		d: {
			moduleUrl: path
				? `${path}/wasm-d/index.js?v=${WASM_D_ASSET_VERSION}`
				: `/wasm-d/index.js?v=${WASM_D_ASSET_VERSION}`
		},
		dotnet: {
			moduleUrl: path
				? `${path}/wasm-dotnet/index.js?v=${WASM_DOTNET_ASSET_VERSION}`
				: `/wasm-dotnet/index.js?v=${WASM_DOTNET_ASSET_VERSION}`
		},
		elixir: {
			bundleUrl: path
				? `${path}/wasm-elixir/bundle.avm?v=${WASM_ELIXIR_ASSET_VERSION}`
				: `/wasm-elixir/bundle.avm?v=${WASM_ELIXIR_ASSET_VERSION}`
		},
		erlang: {
			bundleUrl: path
				? `${path}/wasm-elixir/bundle.avm?v=${WASM_ELIXIR_ASSET_VERSION}`
				: `/wasm-elixir/bundle.avm?v=${WASM_ELIXIR_ASSET_VERSION}`
		},
		prolog: {
			baseUrl: path ? `${path}/wasm-prolog/` : '/wasm-prolog/',
			workerUrl: path
				? `${path}/wasm-prolog/runner-worker.js?v=${WASM_PROLOG_ASSET_VERSION}`
				: `/wasm-prolog/runner-worker.js?v=${WASM_PROLOG_ASSET_VERSION}`
		},
		gleam: {
			baseUrl: path ? `${path}/wasm-gleam/` : '/wasm-gleam/',
			workerUrl: path
				? `${path}/wasm-gleam/runner-worker.js?v=${WASM_GLEAM_ASSET_VERSION}`
				: `/wasm-gleam/runner-worker.js?v=${WASM_GLEAM_ASSET_VERSION}`,
			manifestUrl: path
				? `${path}/wasm-gleam/source-manifest.v1.json?v=${WASM_GLEAM_ASSET_VERSION}`
				: `/wasm-gleam/source-manifest.v1.json?v=${WASM_GLEAM_ASSET_VERSION}`
		},
		perl: {
			baseUrl: path ? `${path}/wasm-perl/` : '/wasm-perl/',
			workerUrl: path
				? `${path}/wasm-perl/runner-worker.js?v=${WASM_PERL_ASSET_VERSION}`
				: `/wasm-perl/runner-worker.js?v=${WASM_PERL_ASSET_VERSION}`
		},
		tcl: {
			baseUrl: path ? `${path}/wasm-tcl/` : '/wasm-tcl/',
			workerUrl: path
				? `${path}/wasm-tcl/runner-worker.js?v=${WASM_TCL_ASSET_VERSION}`
				: `/wasm-tcl/runner-worker.js?v=${WASM_TCL_ASSET_VERSION}`
		},
		awk: {
			baseUrl: path ? `${path}/wasm-awk/` : '/wasm-awk/',
			workerUrl: path
				? `${path}/wasm-awk/runner-worker.js?v=${WASM_AWK_ASSET_VERSION}`
				: `/wasm-awk/runner-worker.js?v=${WASM_AWK_ASSET_VERSION}`
		},
		pascal: {
			baseUrl: path ? `${path}/wasm-pascal/` : '/wasm-pascal/',
			workerUrl: path
				? `${path}/wasm-pascal/runner-worker.js?v=${WASM_PASCAL_ASSET_VERSION}`
				: `/wasm-pascal/runner-worker.js?v=${WASM_PASCAL_ASSET_VERSION}`
		},
		forth: {
			baseUrl: path ? `${path}/wasm-forth/` : '/wasm-forth/',
			workerUrl: path
				? `${path}/wasm-forth/runner-worker.js?v=${WASM_FORTH_ASSET_VERSION}`
				: `/wasm-forth/runner-worker.js?v=${WASM_FORTH_ASSET_VERSION}`
		},
		j: {
			baseUrl: path ? `${path}/wasm-j/` : '/wasm-j/',
			workerUrl: path
				? `${path}/wasm-j/runner-worker.js?v=${WASM_J_ASSET_VERSION}`
				: `/wasm-j/runner-worker.js?v=${WASM_J_ASSET_VERSION}`
		},
		bqn: {
			baseUrl: path ? `${path}/wasm-bqn/` : '/wasm-bqn/',
			workerUrl: path
				? `${path}/wasm-bqn/runner-worker.js?v=${WASM_BQN_ASSET_VERSION}`
				: `/wasm-bqn/runner-worker.js?v=${WASM_BQN_ASSET_VERSION}`
		},
		janet: {
			baseUrl: path ? `${path}/wasm-janet/` : '/wasm-janet/',
			workerUrl: path
				? `${path}/wasm-janet/runner-worker.js?v=${WASM_JANET_ASSET_VERSION}`
				: `/wasm-janet/runner-worker.js?v=${WASM_JANET_ASSET_VERSION}`
		},
		julia: {
			baseUrl: path ? `${path}/wasm-julia/` : '/wasm-julia/',
			workerUrl: path
				? `${path}/wasm-julia/runner-worker.js?v=${WASM_JULIA_ASSET_VERSION}`
				: `/wasm-julia/runner-worker.js?v=${WASM_JULIA_ASSET_VERSION}`
		},
		nim: {
			baseUrl: path ? `${path}/wasm-nim/` : '/wasm-nim/',
			workerUrl: path
				? `${path}/wasm-nim/runner-worker.js?v=${WASM_NIM_ASSET_VERSION}`
				: `/wasm-nim/runner-worker.js?v=${WASM_NIM_ASSET_VERSION}`
		},
		ocaml: {
			moduleUrl: path
				? `${path}/wasm-of-js-of-ocaml/browser-native/src/index.js?v=${WASM_OCAML_ASSET_VERSION}`
				: `/wasm-of-js-of-ocaml/browser-native/src/index.js?v=${WASM_OCAML_ASSET_VERSION}`,
			manifestUrl: path
				? `${path}/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json?v=${WASM_OCAML_ASSET_VERSION}`
				: `/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-manifest.v1.json?v=${WASM_OCAML_ASSET_VERSION}`
		},
		tinygo: {
			moduleUrl: path
				? `${path}/wasm-tinygo/runtime.js?v=${WASM_TINYGO_ASSET_VERSION}`
				: `/wasm-tinygo/runtime.js?v=${WASM_TINYGO_ASSET_VERSION}`
		},
		typescript: {
			moduleUrl: path
				? `${path}/wasm-typescript/index.js?v=${WASM_TYPESCRIPT_ASSET_VERSION}`
				: `/wasm-typescript/index.js?v=${WASM_TYPESCRIPT_ASSET_VERSION}`,
			libUrl: path
				? `${path}/lsp/typescript-libs.json.gz?v=${WASM_TYPESCRIPT_ASSET_VERSION}`
				: `/lsp/typescript-libs.json.gz?v=${WASM_TYPESCRIPT_ASSET_VERSION}`
		},
		wat: {
			moduleUrl: path
				? `${path}/wasm-wat/index.js?v=${WASM_WAT_ASSET_VERSION}`
				: `/wasm-wat/index.js?v=${WASM_WAT_ASSET_VERSION}`
		},
		lua: {
			moduleUrl: path
				? `${path}/wasm-lua/index.js?v=${WASM_LUA_ASSET_VERSION}`
				: `/wasm-lua/index.js?v=${WASM_LUA_ASSET_VERSION}`
		},
		zig: {
			compilerUrl: path
				? `${path}/wasm-zig/zig_small.wasm?v=${WASM_ZIG_ASSET_VERSION}`
				: `/wasm-zig/zig_small.wasm?v=${WASM_ZIG_ASSET_VERSION}`,
			stdlibUrl: path
				? `${path}/wasm-zig/std.zip?v=${WASM_ZIG_ASSET_VERSION}`
				: `/wasm-zig/std.zip?v=${WASM_ZIG_ASSET_VERSION}`
		},
		lisp: {
			moduleUrl: path
				? `${path}/wasm-lisp/index.js?v=${WASM_LISP_ASSET_VERSION}`
				: `/wasm-lisp/index.js?v=${WASM_LISP_ASSET_VERSION}`
		},
		ruby: {
			wasmUrl: rubyStdlibWasmUrl
		},
		haskell: {
			moduleUrl: path
				? `${path}/wasm-haskell/dyld.mjs?v=${WASM_HASKELL_ASSET_VERSION}`
				: `/wasm-haskell/dyld.mjs?v=${WASM_HASKELL_ASSET_VERSION}`,
			rootfsUrl: path
				? `${path}/wasm-haskell/rootfs.tar.zst?v=${WASM_HASKELL_ASSET_VERSION}`
				: `/wasm-haskell/rootfs.tar.zst?v=${WASM_HASKELL_ASSET_VERSION}`,
			bsdtarUrl: path
				? `${path}/wasm-haskell/bsdtar.wasm?v=${WASM_HASKELL_ASSET_VERSION}`
				: `/wasm-haskell/bsdtar.wasm?v=${WASM_HASKELL_ASSET_VERSION}`
		},
		fortran: {
			analyzerUrl: path
				? `${path}/wasm-fortran/analyzer.js?v=${WASM_FORTRAN_ASSET_VERSION}`
				: `/wasm-fortran/analyzer.js?v=${WASM_FORTRAN_ASSET_VERSION}`
		},
		r: {
			baseUrl: path
				? `${path}/webr/${WASM_R_ASSET_VERSION}/`
				: `/webr/${WASM_R_ASSET_VERSION}/`
		},
		octave: {
			baseUrl: path ? `${path}/wasm-octave/runtime/` : '/wasm-octave/runtime/',
			workerUrl: path
				? `${path}/wasm-octave/runner-worker.js?v=${WASM_OCTAVE_ASSET_VERSION}`
				: `/wasm-octave/runner-worker.js?v=${WASM_OCTAVE_ASSET_VERSION}`,
			manifestUrl: path
				? `${path}/wasm-octave/runtime/runtime-manifest.v1.json?v=${WASM_OCTAVE_ASSET_VERSION}`
				: `/wasm-octave/runtime/runtime-manifest.v1.json?v=${WASM_OCTAVE_ASSET_VERSION}`
		},
		sqlite: {
			wasmUrl: sqliteWasmUrl
		}
	}));
	const playground = $derived.by(() => createPlaygroundBinding(runtimeAssets));

	let editor = $state<monaco.editor.IStandaloneCodeEditor | null>(null),
		terminal = $state<TerminalControl | undefined>(undefined),
		compilerDiagnostics = $state<CompilerDiagnostic[]>([]),
		clangdRequested = $state(false),
		argsInput = $state(''),
		rustTargetTriple = $state<RustTargetTriple>('wasm32-wasip1'),
		goTarget = $state<GoTarget>('wasip1/wasm'),
		tinygoTarget = $state<TinyGoTarget>('wasm'),
		ocamlBackend = $state<OcamlBackend>('wasm'),
		ocamlWasmBinaryenMode = $state<OcamlWasmBinaryenMode>('fast'),
		log = $state(true),
		lspEnabled = $state(false),
		language = $state<PlaygroundLanguage>('CPP'),
		runningMode = $state<'run' | 'debug' | null>(null),
		progress = $state(-1),
		progressStage = $state(''),
		stdinInput = $state(''),
		init = $state(false),
		editorLspStatus = $state<EditorLspStatusView | null>(null),
		examplePane = $state<HTMLElement | null>(null),
		examplePaneWidth = $state(0),
		terminalPaneWidth = $state<number | null>(null),
		resizingPane = $state(false);

	const initialWorkspace = createDefaultWorkspace('CPP');
	let languageWorkspaces = $state<Record<PlaygroundLanguage, LanguageWorkspace>>({
		...createDefaultLanguageWorkspaces(),
		CPP: cloneWorkspace(initialWorkspace)
	});
	let files = $state<WorkspaceFile[]>(cloneFiles(initialWorkspace.files));
	let activePath = $state(initialWorkspace.activePath);
	let openTabs = $state<string[]>([...initialWorkspace.openTabs]);
	let sidebarOpen = $state(true);
	let saveStatus = $state('Ready');
	let workspaceInitialized = false;
	let workspaceSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let fileInput = $state<HTMLInputElement | null>(null);
	let dragActive = $state(false);
	const sharedBufferAvailable = $derived(!browser || isSharedArrayBufferAvailable());

	const executionOptionResolvers: Partial<
		Record<PlaygroundLanguage, () => Partial<SandboxExecutionOptions>>
	> = {
		RUST: () => ({ rustTargetTriple }),
		GO: () => ({ goTarget }),
		TINYGO: () => ({ tinygoTarget }),
		OCAML: () => ({ ocamlBackend, ocamlWasmBinaryenMode }),
		ZIG: () => ({ zigTargetTriple: 'wasm64-wasi' })
	};
	const languageExecutionOptions = $derived.by<Partial<SandboxExecutionOptions>>(
		() => executionOptionResolvers[language]?.() ?? {}
	);
	const editorLanguage = $derived(editorLanguages[language]);
	const executionAvailable = $derived(!editorOnlyLanguages.has(language));
	const argsLabel = $derived(argsLabels[language] ?? 'Args');
	const monacoLspLanguage = $derived(lspLanguageOverrides[language] ?? editorLanguage);
	const activeRuntimeLspCapability = $derived(runtimeLspCapabilities[language] ?? null);
	const clangdLspEnabled = $derived(
		lspEnabled && (clangdRequested || clangdLspLanguages.has(language))
	);
	const dotnetLspEnabled = $derived(lspEnabled && dotnetLspLanguages.has(language));
	const dotnetLspModuleUrl = $derived(
		dotnetLspEnabled ? runtimeAssets.dotnet?.moduleUrl : undefined
	);
	const elixirLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'elixir');
	const elixirLspBundleUrl = $derived(
		elixirLspEnabled ? runtimeAssets.elixir?.bundleUrl : undefined
	);
	const erlangLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'erlang');
	const erlangLspBundleUrl = $derived(
		erlangLspEnabled ? runtimeAssets.erlang?.bundleUrl : undefined
	);
	const beamLspWorkerUrl = $derived(
		elixirLspEnabled || erlangLspEnabled ? elixirRuntimeWorkerUrl : undefined
	);
	const gleamLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'gleam');
	const gleamLspBaseUrl = $derived(gleamLspEnabled ? runtimeAssets.gleam?.baseUrl : undefined);
	const gleamLspManifestUrl = $derived(
		gleamLspEnabled ? runtimeAssets.gleam?.manifestUrl : undefined
	);
	const dLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'd');
	const dLspModuleUrl = $derived(dLspEnabled ? runtimeAssets.d?.moduleUrl : undefined);
	const tclLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'tcl');
	const tclLspBaseUrl = $derived(tclLspEnabled ? runtimeAssets.tcl?.baseUrl : undefined);
	const tclLspWorkerUrl = $derived(tclLspEnabled ? runtimeAssets.tcl?.workerUrl : undefined);
	const pascalLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'pascal');
	const pascalLspBaseUrl = $derived(pascalLspEnabled ? runtimeAssets.pascal?.baseUrl : undefined);
	const pascalLspWorkerUrl = $derived(
		pascalLspEnabled ? runtimeAssets.pascal?.workerUrl : undefined
	);
	const goLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'go');
	const goLspCompilerUrl = $derived(goLspEnabled ? runtimeAssets.go?.compilerUrl : undefined);
	const rustLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'rust');
	const rustLspCompilerUrl = $derived(
		rustLspEnabled ? runtimeAssets.rust?.compilerUrl : undefined
	);
	const zigLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'zig');
	const zigLspCompilerUrl = $derived(zigLspEnabled ? runtimeAssets.zig?.compilerUrl : undefined);
	const zigLspStdlibUrl = $derived(zigLspEnabled ? runtimeAssets.zig?.stdlibUrl : undefined);
	const luaLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'lua');
	const luaLspModuleUrl = $derived(luaLspEnabled ? runtimeAssets.lua?.moduleUrl : undefined);
	const janetLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'janet');
	const janetLspBaseUrl = $derived(janetLspEnabled ? runtimeAssets.janet?.baseUrl : undefined);
	const janetLspWorkerUrl = $derived(
		janetLspEnabled ? runtimeAssets.janet?.workerUrl : undefined
	);
	const lispLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'lisp');
	const lispLspModuleUrl = $derived(lispLspEnabled ? runtimeAssets.lisp?.moduleUrl : undefined);
	const ocamlLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'ocaml');
	const ocamlLspModuleUrl = $derived(
		ocamlLspEnabled ? runtimeAssets.ocaml?.moduleUrl : undefined
	);
	const ocamlLspManifestUrl = $derived(
		ocamlLspEnabled ? runtimeAssets.ocaml?.manifestUrl : undefined
	);
	const haskellLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'haskell');
	const haskellLspModuleUrl = $derived(
		haskellLspEnabled ? runtimeAssets.haskell?.moduleUrl : undefined
	);
	const haskellLspRootfsUrl = $derived(
		haskellLspEnabled ? runtimeAssets.haskell?.rootfsUrl : undefined
	);
	const haskellLspBsdtarUrl = $derived(
		haskellLspEnabled ? runtimeAssets.haskell?.bsdtarUrl : undefined
	);
	const fortranLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'fortran');
	const fortranLspAnalyzerUrl = $derived(
		fortranLspEnabled ? runtimeAssets.fortran?.analyzerUrl : undefined
	);
	const sqlLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'sql');
	const sqlLspWasmUrl = $derived(sqlLspEnabled ? runtimeAssets.sqlite?.wasmUrl : undefined);
	const prologLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'prolog');
	const prologLspBaseUrl = $derived(prologLspEnabled ? runtimeAssets.prolog?.baseUrl : undefined);
	const prologLspWorkerUrl = $derived(
		prologLspEnabled ? runtimeAssets.prolog?.workerUrl : undefined
	);
	const rubyLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'ruby');
	const rubyLspWasmUrl = $derived(rubyLspEnabled ? runtimeAssets.ruby?.wasmUrl : undefined);
	const rLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'r');
	const rLspBaseUrl = $derived(rLspEnabled ? runtimeAssets.r?.baseUrl : undefined);
	const octaveLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'octave');
	const octaveLspBaseUrl = $derived(octaveLspEnabled ? runtimeAssets.octave?.baseUrl : undefined);
	const octaveLspWorkerUrl = $derived(
		octaveLspEnabled ? runtimeAssets.octave?.workerUrl : undefined
	);
	const octaveLspManifestUrl = $derived(
		octaveLspEnabled ? runtimeAssets.octave?.manifestUrl : undefined
	);
	const awkLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'awk');
	const awkLspBaseUrl = $derived(awkLspEnabled ? runtimeAssets.awk?.baseUrl : undefined);
	const awkLspWorkerUrl = $derived(awkLspEnabled ? runtimeAssets.awk?.workerUrl : undefined);
	const perlLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'perl');
	const perlLspBaseUrl = $derived(perlLspEnabled ? runtimeAssets.perl?.baseUrl : undefined);
	const perlLspWorkerUrl = $derived(perlLspEnabled ? runtimeAssets.perl?.workerUrl : undefined);
	const pythonLspBaseUrl = $derived(path ? `${path}/pyodide/` : '/pyodide/');
	const typescriptLspLibUrl = $derived(
		lspEnabled && typescriptLspLanguages.has(language)
			? runtimeAssets.typescript?.libUrl
			: undefined
	);
	const compact = $derived(examplePaneWidth > 0 && examplePaneWidth <= 760);
	const activeFile = $derived(files.find((file) => file.path === activePath) ?? files[0]);
	const sortedFiles = $derived([...files].sort((a, b) => a.path.localeCompare(b.path)));
	const activeLines = $derived(activeFile ? activeFile.content.split(/\r\n|\r|\n/).length : 0);
	const activeBytes = $derived(activeFile ? new Blob([activeFile.content]).size : 0);
	const workspaceSaveKey = $derived(
		JSON.stringify({
			argsInput,
			goTarget,
			language,
			log,
			lspEnabled,
			ocamlBackend,
			ocamlWasmBinaryenMode,
			rustTargetTriple,
			sidebarOpen,
			tinygoTarget,
			workspaces: workspaceMapForSnapshot()
		})
	);

	const progressRef = {
		set(value: number, stage?: string) {
			progress = value;
			if (stage) progressStage = stage;
		}
	};

	const debugLanguage = $derived(debugLanguageAdapters[language] ?? null);
	const debug = createDebugSessionController({
		syncBreakpointsWhile: () => runningMode === 'debug'
	});
	const debugStatusLabel = $derived(debug.paused ? 'Paused' : debug.active ? 'Running' : 'Ready');
	const debugStatusIcon = $derived(
		debug.paused ? 'pause_circle' : debug.active ? 'play_circle' : 'adjust'
	);
	const knownRustTargetTriples = ['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'] as const;
	const knownGoTargets = ['wasip1/wasm', 'wasip2/wasm', 'wasip3/wasm', 'js/wasm'] as const;
	const knownTinyGoTargets = ['wasm', 'wasip1', 'wasip2', 'wasip3'] as const;
	const debugTitle = $derived(debugTitles[language] ?? 'Pyodide Trace');
	const loading = $derived(progress >= 0 && progress < 1);
	const progressValue = $derived(progress < 0 ? 0 : progress > 1 ? 1 : progress);
	const progressPercent = $derived(Math.round(progressValue * 100));
	const progressLabel = $derived(
		runningMode === 'debug' ? 'Preparing debug session' : progressStage || 'Loading runtime'
	);
	const examplePaneHorizontalPadding = 40;
	const panelResizerWidth = 14;
	const desktopExampleLayout = $derived(examplePaneWidth > 960);
	const resizablePaneWidth = $derived(
		desktopExampleLayout
			? Math.max(0, examplePaneWidth - examplePaneHorizontalPadding - panelResizerWidth)
			: examplePaneWidth
	);
	const minTerminalPaneWidth = $derived(
		desktopExampleLayout
			? Math.min(420, Math.max(320, Math.floor(resizablePaneWidth * 0.28)))
			: 0
	);
	const maxTerminalPaneWidth = $derived(
		desktopExampleLayout
			? Math.max(minTerminalPaneWidth, resizablePaneWidth - minTerminalPaneWidth)
			: resizablePaneWidth
	);
	const terminalPanePixelWidth = $derived.by(() => {
		if (!desktopExampleLayout || !resizablePaneWidth) return null;
		const fallbackWidth = Math.round(resizablePaneWidth * 0.5);
		const requestedWidth = terminalPaneWidth ?? fallbackWidth;
		return Math.min(Math.max(requestedWidth, minTerminalPaneWidth), maxTerminalPaneWidth);
	});
	let availableRustTargetTriples = $state<RustTargetTriple[]>(['wasm32-wasip1', 'wasm32-wasip2']);
	let availableGoTargets = $state<GoTarget[]>(['wasip1/wasm']);
	type WasmIdleDebugApi = {
		writeTerminalInput: (text: string, eof?: boolean) => Promise<void>;
		getEditorValue: () => string;
		setEditorValue: (text: string) => Promise<boolean>;
		setPreloadedStdin: (text: string) => void;
	};
	let browserDebugHookVersion = 0;
	type WasmRustRuntimeModule = {
		preloadBrowserRustRuntime?: (options?: {
			targetTriple?: RustTargetTriple;
		}) => Promise<void>;
	};
	type WasmGoRuntimeModule = {
		preloadBrowserGoRuntime?: (options?: { target?: GoTarget }) => Promise<void>;
	};

	function cloneFiles(value: WorkspaceFile[]) {
		return value.map((file) => ({ path: file.path, content: file.content }));
	}

	function cloneWorkspace(value: LanguageWorkspace): LanguageWorkspace {
		return {
			activePath: value.activePath,
			files: cloneFiles(value.files),
			openTabs: [...value.openTabs]
		};
	}

	function createDefaultLanguageWorkspaces() {
		return Object.fromEntries(
			playgroundLanguages.map((nextLanguage) => [
				nextLanguage,
				createDefaultWorkspace(nextLanguage)
			])
		) as Record<PlaygroundLanguage, LanguageWorkspace>;
	}

	function createDefaultWorkspace(
		nextLanguage: PlaygroundLanguage = language
	): LanguageWorkspace {
		const path = defaultPathForLanguage(nextLanguage);
		return {
			activePath: path,
			files: [{ path, content: defaultSourceForLanguage(nextLanguage) }],
			openTabs: [path]
		};
	}

	function normalizePath(value: string) {
		return value
			.trim()
			.replaceAll('\\', '/')
			.split('/')
			.filter((part) => part && part !== '.' && part !== '..')
			.join('/');
	}

	function basename(value: string) {
		return value.split('/').pop() || value;
	}

	function extension(value: string) {
		const name = basename(value);
		const index = name.lastIndexOf('.');
		return index === -1 ? '' : name.slice(index).toLowerCase();
	}

	function languageForPath(filePath: string): PlaygroundLanguage | null {
		if (filePath.toLowerCase().endsWith('.as.ts')) return 'ASSEMBLYSCRIPT';
		const ext = extension(filePath);
		const match: Record<string, PlaygroundLanguage> = {
			'.c': 'C',
			'.cc': 'CPP',
			'.cpp': 'CPP',
			'.cxx': 'CPP',
			'.h': 'CPP',
			'.hpp': 'CPP',
			'.java': 'JAVA',
			'.py': 'PYTHON',
			'.rs': 'RUST',
			'.go': 'GO',
			'.d': 'D',
			'.cs': 'CSHARP',
			'.fs': 'FSHARP',
			'.fsx': 'FSHARP',
			'.fsi': 'FSHARP',
			'.vb': 'VBNET',
			'.ex': 'ELIXIR',
			'.exs': 'ELIXIR',
			'.erl': 'ERLANG',
			'.hrl': 'ERLANG',
			'.prolog': 'PROLOG',
			'.pro': 'PROLOG',
			'.gleam': 'GLEAM',
			'.pl': 'PERL',
			'.pm': 'PERL',
			'.tcl': 'TCL',
			'.awk': 'AWK',
			'.gawk': 'AWK',
			'.pas': 'PASCAL',
			'.pp': 'PASCAL',
			'.fth': 'FORTH',
			'.forth': 'FORTH',
			'.4th': 'FORTH',
			'.ijs': 'J',
			'.ijt': 'J',
			'.ijx': 'J',
			'.bqn': 'BQN',
			'.janet': 'JANET',
			'.jl': 'JULIA',
			'.nim': 'NIM',
			'.nims': 'NIM',
			'.ml': 'OCAML',
			'.mli': 'OCAML',
			'.js': 'JAVASCRIPT',
			'.mjs': 'JAVASCRIPT',
			'.cjs': 'JAVASCRIPT',
			'.ts': 'TYPESCRIPT',
			'.mts': 'TYPESCRIPT',
			'.cts': 'TYPESCRIPT',
			'.wat': 'WAT',
			'.wast': 'WAT',
			'.wasm': 'WASM',
			'.lua': 'LUA',
			'.zig': 'ZIG',
			'.scm': 'LISP',
			'.ss': 'LISP',
			'.sls': 'LISP',
			'.lisp': 'LISP',
			'.lsp': 'LISP',
			'.rb': 'RUBY',
			'.hs': 'HASKELL',
			'.lhs': 'HASKELL',
			'.r': 'R',
			'.m': 'OCTAVE',
			'.f': 'FORTRAN',
			'.f90': 'FORTRAN',
			'.f95': 'FORTRAN',
			'.for': 'FORTRAN',
			'.graphql': 'GRAPHQL',
			'.gql': 'GRAPHQL',
			'.duckdb': 'DUCKDB',
			'.sql': 'SQLITE',
			'.sqlite': 'SQLITE',
			'.php': 'PHP',
			'.json': 'JSON',
			'.jsonc': 'JSON',
			'.yaml': 'YAML',
			'.yml': 'YAML',
			'.toml': 'TOML',
			'.html': 'HTML',
			'.htm': 'HTML',
			'.css': 'CSS',
			'.md': 'MARKDOWN',
			'.markdown': 'MARKDOWN'
		};
		return match[ext] || null;
	}

	function defaultPathForLanguage(nextLanguage: PlaygroundLanguage = language) {
		const match: Record<PlaygroundLanguage, string> = {
			C: 'main.c',
			CPP: 'main.cpp',
			JAVA: 'Main.java',
			PYTHON: 'main.py',
			RUST: 'main.rs',
			GO: 'main.go',
			D: 'main.d',
			CSHARP: 'Program.cs',
			FSHARP: 'Program.fsx',
			VBNET: 'Program.vb',
			ELIXIR: 'main.exs',
			ERLANG: 'main.erl',
			PROLOG: 'main.prolog',
			GLEAM: 'main.gleam',
			PERL: 'main.pl',
			TCL: 'main.tcl',
			AWK: 'main.awk',
			PASCAL: 'main.pas',
			FORTH: 'main.fth',
			J: 'main.ijs',
			BQN: 'main.bqn',
			JANET: 'main.janet',
			JULIA: 'main.jl',
			NIM: 'main.nim',
			OCAML: 'main.ml',
			TINYGO: 'main.go',
			JAVASCRIPT: 'main.js',
			TYPESCRIPT: 'main.ts',
			ASSEMBLYSCRIPT: 'main.as.ts',
			WAT: 'main.wat',
			WASM: 'main.wasm',
			LUA: 'main.lua',
			ZIG: 'main.zig',
			LISP: 'main.scm',
			RUBY: 'main.rb',
			HASKELL: 'main.hs',
			R: 'main.R',
			OCTAVE: 'main.m',
			FORTRAN: 'main.f90',
			GRAPHQL: 'main.graphql',
			DUCKDB: 'main.duckdb',
			SQLITE: 'main.sql',
			PHP: 'main.php',
			JSON: 'main.json',
			YAML: 'main.yaml',
			TOML: 'main.toml',
			HTML: 'index.html',
			CSS: 'styles.css',
			MARKDOWN: 'README.md'
		};
		return match[nextLanguage];
	}

	function defaultSourceForLanguage(nextLanguage: PlaygroundLanguage = language) {
		const defaultLanguage = {
			C: 'c',
			CPP: 'cpp',
			PYTHON: 'python',
			JAVA: 'java',
			RUST: 'rust',
			GO: 'go',
			D: 'd',
			CSHARP: 'csharp',
			FSHARP: 'fsharp',
			VBNET: 'vbnet',
			ELIXIR: 'elixir',
			ERLANG: 'erlang',
			PROLOG: 'prolog',
			GLEAM: 'gleam',
			PERL: 'perl',
			TCL: 'tcl',
			AWK: 'awk',
			PASCAL: 'pascal',
			FORTH: 'forth',
			J: 'j',
			BQN: 'bqn',
			JANET: 'janet',
			JULIA: 'julia',
			NIM: 'nim',
			OCAML: 'ocaml',
			TINYGO: 'go',
			JAVASCRIPT: 'javascript',
			TYPESCRIPT: 'typescript',
			ASSEMBLYSCRIPT: 'assemblyscript',
			WAT: 'wat',
			WASM: 'wasm',
			LUA: 'lua',
			ZIG: 'zig',
			LISP: 'lisp',
			RUBY: 'ruby',
			HASKELL: 'haskell',
			R: 'r',
			OCTAVE: 'octave',
			FORTRAN: 'fortran',
			GRAPHQL: 'graphql',
			DUCKDB: 'duckdb',
			SQLITE: 'sqlite',
			PHP: 'php',
			JSON: 'json',
			YAML: 'yaml',
			TOML: 'toml',
			HTML: 'html',
			CSS: 'css',
			MARKDOWN: 'markdown'
		} as const satisfies Record<
			PlaygroundLanguage,
			Parameters<typeof resolveEditorDefaultSource>[0]
		>;
		return resolveEditorDefaultSource(defaultLanguage[nextLanguage], rustTargetTriple);
	}

	function migrateWorkspaceFileContent(content: string, nextLanguage: PlaygroundLanguage) {
		const nextDefaultSource = defaultSourceForLanguage(nextLanguage);
		if (content === nextDefaultSource) {
			return content;
		}
		if (isEditorDefaultSource(content) || isLegacyEditorDefaultSource(content)) {
			return nextDefaultSource;
		}
		return content;
	}

	function sanitizeWorkspace(
		value: Partial<LanguageWorkspace> | undefined,
		nextLanguage: PlaygroundLanguage
	): LanguageWorkspace {
		const fallback = createDefaultWorkspace(nextLanguage);
		const nextFiles = sanitizeFiles(value?.files);
		const files = (nextFiles.length ? nextFiles : fallback.files).map((file) => ({
			path: file.path,
			content: migrateWorkspaceFileContent(file.content, nextLanguage)
		}));
		const requestedActivePath =
			typeof value?.activePath === 'string' ? normalizePath(value.activePath) : '';
		const activePath = files.some((file) => file.path === requestedActivePath)
			? requestedActivePath
			: files[0].path;
		const openTabs =
			value?.openTabs?.filter((tab) => files.some((file) => file.path === tab)) ?? [];
		return {
			activePath,
			files,
			openTabs: openTabs.length ? openTabs : [activePath]
		};
	}

	function currentWorkspace(): LanguageWorkspace {
		return sanitizeWorkspace({ activePath, files, openTabs }, language);
	}

	function workspaceMapForSnapshot() {
		const workspaces = createDefaultLanguageWorkspaces();
		for (const nextLanguage of playgroundLanguages) {
			workspaces[nextLanguage] = cloneWorkspace(
				languageWorkspaces[nextLanguage] ?? createDefaultWorkspace(nextLanguage)
			);
		}
		workspaces[language] = currentWorkspace();
		return workspaces;
	}

	function activateWorkspace(workspace: LanguageWorkspace) {
		const nextWorkspace = sanitizeWorkspace(workspace, language);
		files = cloneFiles(nextWorkspace.files);
		activePath = nextWorkspace.activePath;
		openTabs = [...nextWorkspace.openTabs];
	}

	function switchLanguage(nextLanguage: PlaygroundLanguage, message?: string) {
		if (nextLanguage === language) return;
		languageWorkspaces = {
			...languageWorkspaces,
			[language]: currentWorkspace()
		};
		language = nextLanguage;
		activateWorkspace(languageWorkspaces[nextLanguage] ?? createDefaultWorkspace(nextLanguage));
		saveStatus = message ?? `${languageLabels[nextLanguage]} workspace`;
		if (!debugLspLanguages.has(language)) clangdRequested = false;
	}

	function handleLanguageChange(event: Event) {
		const nextLanguage = normalizeRequestedLanguage(
			(event.currentTarget as HTMLSelectElement).value
		);
		if (nextLanguage) switchLanguage(nextLanguage);
	}

	function uniquePath(requestedPath: string) {
		const safePath = normalizePath(requestedPath) || 'untitled.txt';
		if (!files.some((file) => file.path === safePath)) return safePath;
		const slash = safePath.lastIndexOf('/');
		const directory = slash === -1 ? '' : safePath.slice(0, slash + 1);
		const name = slash === -1 ? safePath : safePath.slice(slash + 1);
		const dot = name.lastIndexOf('.');
		const base = dot === -1 ? name : name.slice(0, dot);
		const ext = dot === -1 ? '' : name.slice(dot);
		let index = 2;
		let next = `${directory}${base}-${index}${ext}`;
		while (files.some((file) => file.path === next)) {
			index += 1;
			next = `${directory}${base}-${index}${ext}`;
		}
		return next;
	}

	function sanitizeFiles(value: unknown) {
		if (!Array.isArray(value)) return [];
		const seen: string[] = [];
		const nextFiles: WorkspaceFile[] = [];
		for (const file of value) {
			if (!file || typeof file.path !== 'string' || typeof file.content !== 'string')
				continue;
			const safePath = normalizePath(file.path);
			if (!safePath || seen.includes(safePath)) continue;
			seen.push(safePath);
			nextFiles.push({ path: safePath, content: file.content });
		}
		return nextFiles;
	}

	function updateActiveContent(value: string) {
		const file = activeFile;
		if (!file || file.content === value) return;
		file.content = value;
		saveStatus = 'Saving...';
	}

	function selectFile(filePath: string) {
		if (!files.some((file) => file.path === filePath)) return;
		activePath = filePath;
		if (!openTabs.includes(filePath)) openTabs = [...openTabs, filePath];
		if (compact) sidebarOpen = false;
	}

	function addWorkspaceFile(filePath: string, content = '', select = true) {
		const nextPath = uniquePath(filePath);
		files = [...files, { path: nextPath, content }];
		if (select) selectFile(nextPath);
		saveStatus = `${basename(nextPath)} added`;
		return nextPath;
	}

	function newFile() {
		const requested = prompt('File name', defaultPathForLanguage());
		if (!requested) return;
		const nextLanguage = languageForPath(requested) || language;
		addWorkspaceFile(requested, defaultSourceForLanguage(nextLanguage));
	}

	function renameActiveFile() {
		const file = activeFile;
		if (!file) return;
		const requested = prompt('Rename file', file.path);
		if (!requested) return;
		const nextPath = normalizePath(requested);
		if (!nextPath || nextPath === file.path) return;
		if (files.some((item) => item.path === nextPath)) {
			saveStatus = 'File already exists';
			return;
		}
		const previousPath = file.path;
		file.path = nextPath;
		activePath = nextPath;
		openTabs = openTabs.map((tab) => (tab === previousPath ? nextPath : tab));
		saveStatus = `${basename(nextPath)} renamed`;
	}

	function duplicateActiveFile() {
		const file = activeFile;
		if (!file) return;
		addWorkspaceFile(file.path, file.content);
	}

	function deleteActiveFile() {
		const file = activeFile;
		if (!file) return;
		if (files.length === 1) {
			saveStatus = 'Keep at least one file';
			return;
		}
		if (!confirm(`Delete ${file.path}?`)) return;
		const deletedPath = file.path;
		const previousIndex = files.findIndex((item) => item.path === deletedPath);
		files = files.filter((item) => item.path !== deletedPath);
		openTabs = openTabs.filter((tab) => tab !== deletedPath);
		const nextFile = files[Math.max(0, Math.min(previousIndex, files.length - 1))];
		selectFile(nextFile.path);
		saveStatus = `${basename(deletedPath)} deleted`;
	}

	function closeTab(filePath: string, event: MouseEvent) {
		event.stopPropagation();
		if (openTabs.length === 1) return;
		const tabIndex = openTabs.indexOf(filePath);
		openTabs = openTabs.filter((tab) => tab !== filePath);
		if (activePath === filePath) {
			const nextPath = openTabs[Math.max(0, Math.min(tabIndex, openTabs.length - 1))];
			if (nextPath) selectFile(nextPath);
		}
	}

	function parseArgs(value: string) {
		return value.trim() ? value.trim().split(/\s+/) : [];
	}

	function encodeBase64Url(value: string) {
		const bytes = new TextEncoder().encode(value);
		let binary = '';
		for (let index = 0; index < bytes.length; index += 0x8000) {
			binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
		}
		return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
	}

	function readHashSnapshot() {
		if (!browser || !location.hash.startsWith(`#${SHARE_PREFIX}`)) return null;
		try {
			const decoded = decodeBase64Url(location.hash.slice(SHARE_PREFIX.length + 1));
			if (!decoded) return null;
			return JSON.parse(decoded) as Partial<WorkspaceSnapshot>;
		} catch {
			saveStatus = 'Invalid share URL';
			return null;
		}
	}

	function snapshot(): WorkspaceSnapshot {
		return {
			activePath,
			argsInput,
			files: files.map((file) => ({ path: file.path, content: file.content })),
			goTarget,
			language,
			log,
			lspEnabled,
			ocamlBackend,
			ocamlWasmBinaryenMode,
			openTabs: openTabs.filter((tab) => files.some((file) => file.path === tab)),
			rustTargetTriple,
			sidebarOpen,
			tinygoTarget,
			version: 5,
			workspaces: workspaceMapForSnapshot()
		};
	}

	function applySnapshot(value?: Partial<WorkspaceSnapshot>, message = 'Workspace restored') {
		const nextLanguage =
			normalizeRequestedLanguage(
				typeof value?.language === 'string' ? value.language : null
			) ??
			languageForPath(typeof value?.activePath === 'string' ? value.activePath : '') ??
			'CPP';
		const nextWorkspaces = createDefaultLanguageWorkspaces();
		for (const nextLanguageKey of playgroundLanguages) {
			const workspace = value?.workspaces?.[nextLanguageKey];
			nextWorkspaces[nextLanguageKey] = sanitizeWorkspace(workspace, nextLanguageKey);
		}
		if (!value?.workspaces) {
			nextWorkspaces[nextLanguage] = sanitizeWorkspace(
				{
					activePath: value?.activePath,
					files: value?.files,
					openTabs: value?.openTabs
				},
				nextLanguage
			);
		}
		languageWorkspaces = nextWorkspaces;
		language = nextLanguage;
		activateWorkspace(nextWorkspaces[nextLanguage]);
		if (typeof value?.argsInput === 'string') argsInput = value.argsInput;
		if (typeof value?.log === 'boolean') log = value.log;
		if (typeof value?.lspEnabled === 'boolean') lspEnabled = value.lspEnabled;
		if (
			value?.rustTargetTriple === 'wasm32-wasip1' ||
			value?.rustTargetTriple === 'wasm32-wasip2' ||
			value?.rustTargetTriple === 'wasm32-wasip3'
		)
			rustTargetTriple = value.rustTargetTriple;
		if (
			value?.goTarget === 'wasip1/wasm' ||
			value?.goTarget === 'wasip2/wasm' ||
			value?.goTarget === 'wasip3/wasm' ||
			value?.goTarget === 'js/wasm'
		)
			goTarget = value.goTarget;
		if (
			value?.tinygoTarget === 'wasm' ||
			value?.tinygoTarget === 'wasip1' ||
			value?.tinygoTarget === 'wasip2' ||
			value?.tinygoTarget === 'wasip3'
		)
			tinygoTarget = value.tinygoTarget;
		if (value?.ocamlBackend === 'js' || value?.ocamlBackend === 'wasm')
			ocamlBackend = value.ocamlBackend;
		if (value?.ocamlWasmBinaryenMode === 'fast' || value?.ocamlWasmBinaryenMode === 'full')
			ocamlWasmBinaryenMode = value.ocamlWasmBinaryenMode;
		sidebarOpen = value?.sidebarOpen ?? !compact;
		saveStatus = message;
	}

	function saveWorkspace(showStatus = false) {
		if (!browser) return;
		localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(snapshot()));
		if (showStatus) saveStatus = 'Saved locally';
		else
			saveStatus = `Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
	}

	async function shareWorkspace() {
		if (!browser) return;
		saveWorkspace();
		const shareHash = `${SHARE_PREFIX}${encodeBase64Url(JSON.stringify(snapshot()))}`;
		const url = new SvelteURL(location.href);
		const routePath =
			base && url.pathname.startsWith(base)
				? url.pathname.slice(base.length) || '/'
				: url.pathname;
		url.hash = shareHash;
		replaceState(`${routePath}${url.search}#${shareHash}`, page.state);
		await navigator.clipboard?.writeText(url.toString());
		saveStatus =
			url.toString().length > 60000 ? 'Share URL copied, but large' : 'Share URL copied';
	}

	function downloadBlob(blob: Blob, fileName: string) {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = fileName;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	function downloadActiveFile() {
		const file = activeFile;
		if (!file) return;
		downloadBlob(
			new Blob([file.content], { type: 'text/plain;charset=utf-8' }),
			basename(file.path)
		);
		saveStatus = `${basename(file.path)} downloaded`;
	}

	async function downloadZip() {
		const zip = await import('@zip.js/zip.js');
		const writer = new zip.ZipWriter(new zip.BlobWriter('application/zip'));
		for (const file of files) {
			await writer.add(file.path, new zip.TextReader(file.content));
		}
		downloadBlob(await writer.close(), 'wasm-idle-workspace.zip');
		saveStatus = 'ZIP downloaded';
	}

	async function importZip(file: File) {
		const zip = await import('@zip.js/zip.js');
		const reader = new zip.ZipReader(new zip.BlobReader(file));
		const entries = await reader.getEntries();
		const imported: string[] = [];
		for (const entry of entries) {
			if (entry.directory || !entry.filename) continue;
			const blob = await entry.getData?.(new zip.BlobWriter());
			if (!blob) continue;
			imported.push(addWorkspaceFile(entry.filename, await blob.text(), false));
		}
		await reader.close();
		return imported;
	}

	async function importFiles(fileList: File[]) {
		const imported: string[] = [];
		for (const file of fileList) {
			if (file.name.toLowerCase().endsWith('.zip')) {
				imported.push(...(await importZip(file)));
			} else if (file.name.toLowerCase().endsWith('.wasm')) {
				const bytes = new Uint8Array(await file.arrayBuffer());
				let binary = '';
				for (let index = 0; index < bytes.length; index += 0x8000) {
					binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
				}
				imported.push(
					addWorkspaceFile(
						(file as File & { webkitRelativePath?: string }).webkitRelativePath ||
							file.name,
						`data:application/wasm;base64,${btoa(binary)}`,
						false
					)
				);
			} else {
				imported.push(
					addWorkspaceFile(
						(file as File & { webkitRelativePath?: string }).webkitRelativePath ||
							file.name,
						await file.text(),
						false
					)
				);
			}
		}
		if (imported[0]) selectFile(imported[0]);
		saveStatus = `${imported.length} file${imported.length === 1 ? '' : 's'} imported`;
	}

	async function handleUpload(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (!input.files?.length) return;
		await importFiles([...input.files]);
		input.value = '';
	}

	function handleDragOver(event: DragEvent) {
		if (!event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		dragActive = true;
	}

	async function handleDrop(event: DragEvent) {
		if (!event.dataTransfer?.files.length) return;
		event.preventDefault();
		dragActive = false;
		await importFiles([...event.dataTransfer.files]);
	}

	function resetWorkspace() {
		if (!confirm(`Reset ${languageLabels[language]} workspace?`)) return;
		const nextWorkspace = createDefaultWorkspace(language);
		languageWorkspaces = {
			...languageWorkspaces,
			[language]: cloneWorkspace(nextWorkspace)
		};
		activateWorkspace(nextWorkspace);
		saveStatus = `${languageLabels[language]} workspace reset`;
		saveWorkspace();
	}

	async function stopExecution() {
		if (!terminal || !runningMode) return;
		if (runningMode === 'debug') {
			await debug.stop();
			return;
		}
		await terminal.stop?.();
	}

	async function sendTerminalEof() {
		if (!terminal || !runningMode) return;
		await terminal.eof?.();
	}

	function decodeBase64Url(value: string | null) {
		if (!value) return null;
		try {
			const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
			const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
			const binary = atob(padded);
			const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
			return new TextDecoder().decode(bytes);
		} catch {
			return null;
		}
	}

	function normalizeRequestedLanguage(value: string | null): PlaygroundLanguage | null {
		if (!value) return null;
		const normalized = value.trim().toLowerCase();
		const aliases: Record<string, PlaygroundLanguage> = {
			python: 'PYTHON',
			python3: 'PYTHON',
			pypy3: 'PYTHON',
			c: 'C',
			cpp: 'CPP',
			cxx: 'CPP',
			java: 'JAVA',
			rust: 'RUST',
			go: 'GO',
			d: 'D',
			dlang: 'D',
			csharp: 'CSHARP',
			'c#': 'CSHARP',
			cs: 'CSHARP',
			fsharp: 'FSHARP',
			'f#': 'FSHARP',
			fs: 'FSHARP',
			vbnet: 'VBNET',
			vb: 'VBNET',
			visualbasic: 'VBNET',
			elixir: 'ELIXIR',
			erlang: 'ERLANG',
			erl: 'ERLANG',
			prolog: 'PROLOG',
			swipl: 'PROLOG',
			swi: 'PROLOG',
			gleam: 'GLEAM',
			perl: 'PERL',
			tcl: 'TCL',
			tclsh: 'TCL',
			awk: 'AWK',
			gawk: 'AWK',
			pascal: 'PASCAL',
			pas: 'PASCAL',
			fpc: 'PASCAL',
			forth: 'FORTH',
			gforth: 'FORTH',
			j: 'J',
			bqn: 'BQN',
			janet: 'JANET',
			julia: 'JULIA',
			jl: 'JULIA',
			nim: 'NIM',
			nimrod: 'NIM',
			ocaml: 'OCAML',
			tinygo: 'TINYGO',
			javascript: 'JAVASCRIPT',
			js: 'JAVASCRIPT',
			typescript: 'TYPESCRIPT',
			ts: 'TYPESCRIPT',
			assemblyscript: 'ASSEMBLYSCRIPT',
			as: 'ASSEMBLYSCRIPT',
			wat: 'WAT',
			wast: 'WAT',
			wasm: 'WASM',
			wasm32: 'WASM',
			lua: 'LUA',
			zig: 'ZIG',
			lisp: 'LISP',
			scheme: 'LISP',
			scm: 'LISP',
			ruby: 'RUBY',
			rb: 'RUBY',
			haskell: 'HASKELL',
			hs: 'HASKELL',
			r: 'R',
			octave: 'OCTAVE',
			matlab: 'OCTAVE',
			fortran: 'FORTRAN',
			f90: 'FORTRAN',
			f95: 'FORTRAN',
			graphql: 'GRAPHQL',
			gql: 'GRAPHQL',
			duckdb: 'DUCKDB',
			sqlite: 'SQLITE',
			sql: 'SQLITE',
			php: 'PHP',
			json: 'JSON',
			jsonc: 'JSON',
			yaml: 'YAML',
			yml: 'YAML',
			toml: 'TOML',
			html: 'HTML',
			htm: 'HTML',
			css: 'CSS',
			markdown: 'MARKDOWN',
			md: 'MARKDOWN'
		};
		return aliases[normalized] ?? null;
	}

	function onCompileDiagnostic(diagnostic: CompilerDiagnostic) {
		compilerDiagnostics = [...compilerDiagnostics, diagnostic];
	}

	async function exec(enableDebug = false) {
		if (!editor || !terminal || !activeFile) return;
		if (!executionAvailable) return;
		if (enableDebug && !debugLanguage) return;
		if (enableDebug && !sharedBufferAvailable) return;
		if (runningMode) return;
		runningMode = enableDebug ? 'debug' : 'run';
		if (enableDebug && debugLspLanguages.has(language)) clangdRequested = true;
		if (enableDebug) {
			debug.begin();
		} else {
			debug.reset();
		}
		compilerDiagnostics = [];
		const codeToRun = activeFile.content;
		const args = parseArgs(argsInput);
		if (browser) {
			localStorage.setItem('code', codeToRun);
			localStorage.setItem('language', language);
			localStorage.setItem('argsInput', argsInput);
			localStorage.setItem('rustTargetTriple', rustTargetTriple);
			localStorage.setItem('goTarget', goTarget);
			localStorage.setItem('tinygoTarget', tinygoTarget);
			localStorage.setItem('ocamlBackend', ocamlBackend);
			localStorage.setItem('ocamlWasmBinaryenMode', ocamlWasmBinaryenMode);
			saveWorkspace();
		}
		try {
			progress = 0;
			progressStage = '';
			const preloadedStdin = sharedBufferAvailable ? undefined : stdinInput;
			await executeTerminalRun({
				terminal,
				language,
				code: codeToRun,
				log,
				progress: progressRef,
				args,
				options: {
					debug: enableDebug,
					breakpoints: [...debug.effectiveBreakpoints],
					activePath,
					workspaceFiles: files.map((file) => ({
						path: file.path,
						content: file.path === activePath ? codeToRun : file.content
					})),
					pauseOnEntry: enableDebug,
					...languageExecutionOptions,
					stdin: preloadedStdin
				}
			});
		} finally {
			progress = -1;
			progressStage = '';
			runningMode = null;
			if (!debug.paused) debug.reset();
		}
	}

	$effect(() => {
		if (browser && editor && !init) {
			const sharedWorkspace = readHashSnapshot();
			if (sharedWorkspace) {
				applySnapshot(sharedWorkspace, 'Shared workspace loaded');
				workspaceInitialized = true;
				init = true;
				return;
			}

			const storedWorkspace = localStorage.getItem(WORKSPACE_STORAGE_KEY);
			if (storedWorkspace) {
				try {
					applySnapshot(JSON.parse(storedWorkspace), 'Workspace restored');
					workspaceInitialized = true;
					init = true;
					return;
				} catch {
					localStorage.removeItem(WORKSPACE_STORAGE_KEY);
				}
			}

			const code = localStorage.getItem('code');
			const lang = localStorage.getItem('language');
			const storedArgs = localStorage.getItem('argsInput');
			const storedGoTarget = localStorage.getItem('goTarget');
			const storedTinyGoTarget = localStorage.getItem('tinygoTarget');
			const storedOcamlBackend = localStorage.getItem('ocamlBackend');
			const storedOcamlWasmBinaryenMode = localStorage.getItem('ocamlWasmBinaryenMode');
			const requestedCode =
				decodeBase64Url(page.url.searchParams.get('code64')) ??
				page.url.searchParams.get('code');
			const requestedLanguage = normalizeRequestedLanguage(page.url.searchParams.get('lang'));
			const requestedArgs =
				decodeBase64Url(page.url.searchParams.get('args64')) ??
				page.url.searchParams.get('args');
			const storedLanguage = normalizeRequestedLanguage(lang);
			const requestedRustTargetTriple = page.url.searchParams.get('rustTargetTriple');
			const requestedGoTarget = page.url.searchParams.get('goTarget');
			const requestedTinyGoTarget = page.url.searchParams.get('tinygoTarget');
			const requestedOcamlBackend = page.url.searchParams.get('ocamlBackend');
			const requestedOcamlWasmBinaryenMode =
				page.url.searchParams.get('ocamlWasmBinaryenMode');
			if (requestedLanguage ?? storedLanguage) {
				switchLanguage(
					requestedLanguage ?? storedLanguage ?? language,
					'Workspace restored'
				);
			}
			if (requestedCode ?? code) activeFile.content = requestedCode ?? code ?? '';
			if (requestedArgs !== null) argsInput = requestedArgs;
			else if (storedArgs !== null) argsInput = storedArgs;
			if (
				requestedGoTarget === 'wasip1/wasm' ||
				requestedGoTarget === 'wasip2/wasm' ||
				requestedGoTarget === 'wasip3/wasm' ||
				requestedGoTarget === 'js/wasm'
			) {
				goTarget = requestedGoTarget;
			} else if (
				storedGoTarget === 'wasip1/wasm' ||
				storedGoTarget === 'wasip2/wasm' ||
				storedGoTarget === 'wasip3/wasm' ||
				storedGoTarget === 'js/wasm'
			) {
				goTarget = storedGoTarget;
			}
			if (
				requestedTinyGoTarget === 'wasm' ||
				requestedTinyGoTarget === 'wasip1' ||
				requestedTinyGoTarget === 'wasip2' ||
				requestedTinyGoTarget === 'wasip3'
			) {
				tinygoTarget = requestedTinyGoTarget;
			} else if (
				storedTinyGoTarget === 'wasm' ||
				storedTinyGoTarget === 'wasip1' ||
				storedTinyGoTarget === 'wasip2' ||
				storedTinyGoTarget === 'wasip3'
			) {
				tinygoTarget = storedTinyGoTarget;
			}
			if (requestedOcamlBackend === 'js' || requestedOcamlBackend === 'wasm') {
				ocamlBackend = requestedOcamlBackend;
			} else if (storedOcamlBackend === 'js' || storedOcamlBackend === 'wasm') {
				ocamlBackend = storedOcamlBackend;
			}
			if (
				requestedOcamlWasmBinaryenMode === 'fast' ||
				requestedOcamlWasmBinaryenMode === 'full'
			) {
				ocamlWasmBinaryenMode = requestedOcamlWasmBinaryenMode;
			} else if (
				storedOcamlWasmBinaryenMode === 'fast' ||
				storedOcamlWasmBinaryenMode === 'full'
			) {
				ocamlWasmBinaryenMode = storedOcamlWasmBinaryenMode;
			}
			if (
				requestedRustTargetTriple === 'wasm32-wasip1' ||
				requestedRustTargetTriple === 'wasm32-wasip2' ||
				requestedRustTargetTriple === 'wasm32-wasip3'
			) {
				rustTargetTriple = requestedRustTargetTriple;
			}
			workspaceInitialized = true;
			init = true;
		}
	});

	$effect(() => {
		if (!browser || !workspaceInitialized) return;
		const key = workspaceSaveKey;
		if (!key) return;
		if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer);
		workspaceSaveTimer = setTimeout(() => saveWorkspace(), 400);
		return () => {
			if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer);
		};
	});

	$effect(() => {
		if (!browser || language !== 'RUST') return;
		let cancelled = false;
		(async () => {
			const manifestUrl = path
				? `${path}/wasm-rust/runtime/runtime-manifest.v3.json?v=${WASM_RUST_ASSET_VERSION}`
				: `/wasm-rust/runtime/runtime-manifest.v3.json?v=${WASM_RUST_ASSET_VERSION}`;
			try {
				const response = await fetch(manifestUrl, { cache: 'no-store' });
				if (!response.ok) {
					throw new Error(`failed to load ${manifestUrl}: ${response.status}`);
				}
				const manifest = (await response.json()) as {
					defaultTargetTriple?: string;
					targets?: Record<string, unknown>;
				};
				const nextAvailableRustTargetTriples = knownRustTargetTriples.filter(
					(targetTriple) =>
						Object.prototype.hasOwnProperty.call(manifest.targets || {}, targetTriple)
				);
				if (!nextAvailableRustTargetTriples.length || cancelled) return;
				availableRustTargetTriples = [...nextAvailableRustTargetTriples];
				const storedRustTargetTriple = localStorage.getItem('rustTargetTriple');
				const nextDefaultTargetTriple = nextAvailableRustTargetTriples.includes(
					manifest.defaultTargetTriple as RustTargetTriple
				)
					? (manifest.defaultTargetTriple as RustTargetTriple)
					: nextAvailableRustTargetTriples[0];
				if (
					storedRustTargetTriple &&
					nextAvailableRustTargetTriples.includes(
						storedRustTargetTriple as RustTargetTriple
					)
				) {
					rustTargetTriple = storedRustTargetTriple as RustTargetTriple;
					return;
				}
				if (!nextAvailableRustTargetTriples.includes(rustTargetTriple)) {
					rustTargetTriple = nextDefaultTargetTriple;
				}
			} catch {
				if (cancelled) return;
				availableRustTargetTriples = ['wasm32-wasip1', 'wasm32-wasip2'];
				const storedRustTargetTriple = localStorage.getItem('rustTargetTriple');
				if (
					(storedRustTargetTriple === 'wasm32-wasip1' ||
						storedRustTargetTriple === 'wasm32-wasip2') &&
					availableRustTargetTriples.includes(storedRustTargetTriple)
				) {
					rustTargetTriple = storedRustTargetTriple;
					return;
				}
				if (!availableRustTargetTriples.includes(rustTargetTriple)) {
					rustTargetTriple = 'wasm32-wasip1';
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (!browser || language !== 'RUST') return;
		const compilerUrl = runtimeAssets.rust?.compilerUrl;
		const preloadTargetTriple = availableRustTargetTriples.includes(rustTargetTriple)
			? rustTargetTriple
			: availableRustTargetTriples[0];
		if (!compilerUrl || !preloadTargetTriple) return;
		let cancelled = false;
		(async () => {
			const runtimeModule = (await import(
				/* @vite-ignore */ compilerUrl
			)) as WasmRustRuntimeModule;
			if (cancelled) return;
			await runtimeModule.preloadBrowserRustRuntime?.({
				targetTriple: preloadTargetTriple
			});
		})().catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (!browser || language !== 'GO') return;
		let cancelled = false;
		(async () => {
			const manifestUrl = path
				? `${path}/wasm-go/runtime/runtime-manifest.v1.json?v=${WASM_GO_ASSET_VERSION}`
				: `/wasm-go/runtime/runtime-manifest.v1.json?v=${WASM_GO_ASSET_VERSION}`;
			try {
				const response = await fetch(manifestUrl, { cache: 'no-store' });
				if (!response.ok) {
					throw new Error(`failed to load ${manifestUrl}: ${response.status}`);
				}
				const manifest = (await response.json()) as {
					defaultTarget?: string;
					targets?: Record<string, unknown>;
				};
				const nextAvailableGoTargets = knownGoTargets.filter((target) =>
					Object.prototype.hasOwnProperty.call(manifest.targets || {}, target)
				);
				if (!nextAvailableGoTargets.length || cancelled) return;
				availableGoTargets = [...nextAvailableGoTargets];
				const storedGoTarget = localStorage.getItem('goTarget');
				const nextDefaultGoTarget = nextAvailableGoTargets.includes(
					manifest.defaultTarget as GoTarget
				)
					? (manifest.defaultTarget as GoTarget)
					: nextAvailableGoTargets[0];
				if (storedGoTarget && nextAvailableGoTargets.includes(storedGoTarget as GoTarget)) {
					goTarget = storedGoTarget as GoTarget;
					return;
				}
				if (!nextAvailableGoTargets.includes(goTarget)) {
					goTarget = nextDefaultGoTarget;
				}
			} catch {
				if (cancelled) return;
				availableGoTargets = ['wasip1/wasm'];
				const storedGoTarget = localStorage.getItem('goTarget');
				if (storedGoTarget === 'wasip1/wasm') {
					goTarget = storedGoTarget;
					return;
				}
				if (!availableGoTargets.includes(goTarget)) {
					goTarget = 'wasip1/wasm';
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (!browser || language !== 'GO') return;
		const compilerUrl = runtimeAssets.go?.compilerUrl;
		const preloadTarget = availableGoTargets.includes(goTarget)
			? goTarget
			: availableGoTargets[0];
		if (!compilerUrl || !preloadTarget) return;
		let cancelled = false;
		(async () => {
			const runtimeModule = (await import(
				/* @vite-ignore */ compilerUrl
			)) as WasmGoRuntimeModule;
			if (cancelled) return;
			await runtimeModule.preloadBrowserGoRuntime?.({
				target: preloadTarget
			});
		})().catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		debug.setTerminal(terminal);
	});

	$effect(() => {
		debug.setAdapter(debugLanguage);
	});

	$effect(() => {
		if (!browser) return;
		const target = window as Window &
			typeof globalThis & { __wasmIdleDebug?: WasmIdleDebugApi };
		const debugHookVersion = ++browserDebugHookVersion;
		const debugApi: WasmIdleDebugApi = {
			async writeTerminalInput(text: string, eof = false) {
				if (!terminal) return;
				await terminal.waitForInput?.();
				await terminal.write(text);
				if (eof) await terminal.eof?.();
			},
			getEditorValue() {
				return editor?.getValue() || '';
			},
			async setEditorValue(text: string) {
				if (!editor) return false;
				editor.setValue(text);
				updateActiveContent(text);
				await Promise.resolve();
				return editor.getValue() === text && activeFile?.content === text;
			},
			setPreloadedStdin(text: string) {
				stdinInput = text;
			}
		};
		target.__wasmIdleDebug = debugApi;
		return () => {
			if (browserDebugHookVersion === debugHookVersion) delete target.__wasmIdleDebug;
		};
	});

	$effect(() => {
		if (!debugLspLanguages.has(language)) clangdRequested = false;
		if (!debugLanguage) {
			debug.setBreakpoints([]);
			debug.setCursorLine(null);
			debug.reset();
		}
		if (!compilerDiagnosticLanguages.has(language)) compilerDiagnostics = [];
	});
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined&display=block"
		rel="stylesheet"
		crossorigin="anonymous"
	/>
</svelte:head>

<svelte:window
	ondragover={handleDragOver}
	ondragleave={() => (dragActive = false)}
	ondrop={handleDrop}
/>

<main bind:this={examplePane} bind:clientWidth={examplePaneWidth} class:drag-active={dragActive}>
	<input
		bind:this={fileInput}
		class="hidden-input"
		multiple
		onchange={handleUpload}
		type="file"
	/>
	{#if sidebarOpen}
		<button
			aria-label="Close explorer"
			class="sidebar-backdrop"
			onclick={() => (sidebarOpen = false)}
		></button>
		<aside class="workspace-sidebar">
			<header class="workspace-sidebar__header">
				<div>
					<span class="material-symbols-outlined">folder_open</span>
					<strong>Explorer</strong>
				</div>
				<button aria-label="Close explorer" onclick={() => (sidebarOpen = false)}>
					<span class="material-symbols-outlined">close</span>
				</button>
			</header>
			<div class="workspace-files">
				{#each sortedFiles as file (file.path)}
					<button
						class:active={file.path === activePath}
						onclick={() => selectFile(file.path)}
						title={file.path}
					>
						<span>{basename(file.path)}</span>
						<small>{extension(file.path).replace('.', '') || 'txt'}</small>
					</button>
				{/each}
			</div>
			<div class="workspace-sidebar__actions">
				<button onclick={newFile}>New</button>
				<button onclick={renameActiveFile}>Rename</button>
				<button onclick={duplicateActiveFile}>Duplicate</button>
				<button onclick={deleteActiveFile}>Delete</button>
				<button onclick={() => fileInput?.click()}>Upload</button>
				<button onclick={downloadActiveFile}>Download</button>
				<button onclick={downloadZip}>ZIP</button>
				<button onclick={resetWorkspace}>Reset</button>
			</div>
		</aside>
	{/if}
	<div
		class="terminal-pane"
		style:width={terminalPanePixelWidth === null ? undefined : `${terminalPanePixelWidth}px`}
	>
		<section class="toolbar">
			<div class="toolbar-row">
				<div class="path-chip">
					<span class="material-symbols-outlined">terminal</span>
					<code>{path || '/'}</code>
				</div>
				<div class="action-group">
					{#if runningMode === 'run'}
						<button class="action-button action-button--stop" onclick={stopExecution}>
							<span class="material-symbols-outlined">stop_circle</span>
							<span>Stop Running</span>
						</button>
					{:else}
						<button
							class="action-button action-button--run"
							onclick={() => exec(false)}
							disabled={runningMode === 'debug' || !executionAvailable}
						>
							<span class="material-symbols-outlined">play_arrow</span>
							<span>Run</span>
						</button>
					{/if}
					{#if runningMode === 'debug'}
						<button class="action-button action-button--stop" onclick={stopExecution}>
							<span class="material-symbols-outlined">stop_circle</span>
							<span>Stop Debug</span>
						</button>
					{:else}
						<button
							class="action-button action-button--debug"
							onclick={() => exec(true)}
							disabled={!!runningMode || !debugLanguage || !sharedBufferAvailable}
							title={!sharedBufferAvailable
								? 'Debugging requires SharedArrayBuffer'
								: 'Debug'}
						>
							<span class="material-symbols-outlined">bug_report</span>
							<span>Debug</span>
						</button>
					{/if}
					<button
						class="action-button action-button--icon"
						onclick={sendTerminalEof}
						disabled={!runningMode}
						title="Send EOF"
						aria-label="Send EOF"
					>
						<span class="material-symbols-outlined">keyboard_tab_rtl</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => debug.sendCommand('continue')}
						disabled={!debug.paused}
						title="Continue"
						aria-label="Continue"
					>
						<span class="material-symbols-outlined">skip_next</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => debug.runToCursor()}
						disabled={!debug.canRunToCursor}
						title={debug.cursorLine
							? `Run to Cursor (L${debug.cursorLine})`
							: 'Run to Cursor'}
						aria-label={debug.cursorLine
							? `Run to Cursor (L${debug.cursorLine})`
							: 'Run to Cursor'}
					>
						<span class="material-symbols-outlined">play_circle</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => debug.sendCommand('stepInto')}
						disabled={!debug.paused}
						title="Step Into"
						aria-label="Step Into"
					>
						<span class="material-symbols-outlined">login</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => debug.sendCommand('nextLine')}
						disabled={!debug.paused}
						title="Next Line"
						aria-label="Next Line"
					>
						<span class="material-symbols-outlined">redo</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => debug.sendCommand('stepOut')}
						disabled={!debug.paused}
						title="Step Out"
						aria-label="Step Out"
					>
						<span class="material-symbols-outlined">logout</span>
					</button>
				</div>
			</div>
			{#if !sharedBufferAvailable}
				<div class="stdin-panel">
					<div>
						<strong>Preloaded stdin</strong>
						<span
							>SharedArrayBuffer is unavailable here, so terminal input cannot be sent
							while the program is running. Enter stdin before Run; extra reads
							receive EOF.</span
						>
					</div>
					<textarea
						bind:value={stdinInput}
						placeholder="Input to pass before running"
						spellcheck={false}
					></textarea>
				</div>
			{/if}
			<div class="toolbar-row toolbar-row--secondary">
				<button class="tool-button" onclick={() => (sidebarOpen = !sidebarOpen)}>
					<span class="material-symbols-outlined">folder_open</span>
					<span>Files</span>
				</button>
				<button class="tool-button" onclick={() => saveWorkspace(true)}>
					<span class="material-symbols-outlined">save</span>
					<span>Save</span>
				</button>
				<button class="tool-button" onclick={shareWorkspace}>
					<span class="material-symbols-outlined">share</span>
					<span>Share</span>
				</button>
				<label class="toggle-chip" for="log-toggle">
					<input id="log-toggle" type="checkbox" bind:checked={log} />
					<span class="material-symbols-outlined">notes</span>
					<span>Log</span>
				</label>
				<label class="toggle-chip" for="lsp-toggle">
					<input id="lsp-toggle" type="checkbox" bind:checked={lspEnabled} />
					<span class="material-symbols-outlined">hub</span>
					<span>LSP</span>
				</label>
				<label class="select-chip">
					<span class="material-symbols-outlined">code_blocks</span>
					<select id="language-select" value={language} onchange={handleLanguageChange}>
						<option value="C">C</option>
						<option value="CPP">C++</option>
						<option value="PYTHON">Python</option>
						<option value="JAVA">Java</option>
						<option value="RUST">Rust</option>
						<option value="GO">Go</option>
						<option value="D">D</option>
						<option value="CSHARP">C#</option>
						<option value="FSHARP">F#</option>
						<option value="VBNET">VB.NET</option>
						<option value="ELIXIR">Elixir</option>
						<option value="ERLANG">Erlang</option>
						<option value="PROLOG">Prolog</option>
						<option value="GLEAM">Gleam</option>
						<option value="PERL">Perl</option>
						<option value="TCL">Tcl</option>
						<option value="AWK">AWK</option>
						<option value="PASCAL">Pascal</option>
						<option value="FORTH">Forth</option>
						<option value="J">J</option>
						<option value="BQN">BQN</option>
						<option value="JANET">Janet</option>
						<option value="JULIA">Julia</option>
						<option value="NIM">Nim</option>
						<option value="OCAML">OCaml</option>
						<option value="TINYGO">TinyGo</option>
						<option value="JAVASCRIPT">JavaScript</option>
						<option value="TYPESCRIPT">TypeScript</option>
						<option value="ASSEMBLYSCRIPT">AssemblyScript</option>
						<option value="WAT">WAT</option>
						<option value="WASM">WASM</option>
						<option value="LUA">Lua</option>
						<option value="ZIG">Zig</option>
						<option value="LISP">Scheme</option>
						<option value="RUBY">Ruby</option>
						<option value="HASKELL">Haskell</option>
						<option value="R">R</option>
						<option value="OCTAVE">Octave</option>
						<option value="FORTRAN">Fortran</option>
						<option value="GRAPHQL">GraphQL</option>
						<option value="DUCKDB">DuckDB</option>
						<option value="SQLITE">SQLite</option>
						<option value="PHP">PHP</option>
						<option value="JSON">JSON</option>
						<option value="YAML">YAML</option>
						<option value="TOML">TOML</option>
						<option value="HTML">HTML</option>
						<option value="CSS">CSS</option>
						<option value="MARKDOWN">Markdown</option>
					</select>
				</label>
				{#if argsHelpLanguages.has(language)}
					<label class="args-chip">
						<span class="material-symbols-outlined">list_alt</span>
						<input bind:value={argsInput} placeholder="3 4 5" spellcheck={false} />
						<span>{argsLabel}</span>
					</label>
				{/if}
				{#if language === 'RUST'}
					<label class="select-chip">
						<span class="material-symbols-outlined">conversion_path</span>
						<select id="rust-target-triple" bind:value={rustTargetTriple}>
							{#each availableRustTargetTriples as targetTriple (targetTriple)}
								<option value={targetTriple}>{targetTriple}</option>
							{/each}
						</select>
					</label>
				{/if}
				{#if language === 'GO'}
					<label class="select-chip">
						<span class="material-symbols-outlined">conversion_path</span>
						<select id="go-target" bind:value={goTarget}>
							{#each availableGoTargets as target (target)}
								<option value={target}>{target}</option>
							{/each}
						</select>
					</label>
				{/if}
				{#if language === 'TINYGO'}
					<label class="select-chip">
						<span class="material-symbols-outlined">conversion_path</span>
						<select id="tinygo-target" bind:value={tinygoTarget}>
							{#each knownTinyGoTargets as target (target)}
								<option value={target}>{target}</option>
							{/each}
						</select>
					</label>
				{/if}
				{#if language === 'OCAML'}
					<label class="select-chip">
						<span class="material-symbols-outlined">conversion_path</span>
						<select id="ocaml-backend" bind:value={ocamlBackend}>
							<option value="wasm">wasm_of_ocaml</option>
							<option value="js">js_of_ocaml</option>
						</select>
					</label>
					{#if ocamlBackend === 'wasm'}
						<label class="select-chip">
							<span class="material-symbols-outlined">memory</span>
							<select id="ocaml-binaryen-mode" bind:value={ocamlWasmBinaryenMode}>
								<option value="fast">Binaryen fast</option>
								<option value="full">Binaryen full</option>
							</select>
						</label>
					{/if}
				{/if}
			</div>
			{#if loading}
				<div class="progress-shell" aria-live="polite">
					<div class="progress-copy">
						<div class="progress-copy__text">
							<span class="material-symbols-outlined">downloading</span>
							<strong>{progressLabel}</strong>
						</div>
						<span class="progress-percent">{progressPercent}%</span>
					</div>
					<div
						class="progress-track"
						role="progressbar"
						aria-label={progressLabel}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={progressPercent}
					>
						<div
							class="progress-fill"
							style={`transform: scaleX(${progressValue})`}
						></div>
					</div>
				</div>
			{/if}
		</section>
		{#if language === 'JAVA'}
			<p class="hint">Run after that type into the terminal below and press Enter.</p>
		{/if}
		{#if language === 'RUST'}
			<p class="hint">
				Type into the terminal below and press Enter to send a line. The selector only shows
				Rust targets advertised by the bundled wasm-rust runtime manifest. `wasm32-wasip1`
				uses preview1 core wasm. {#if availableRustTargetTriples.includes('wasm32-wasip2')}
					`wasm32-wasip2` uses preview2 component execution.
				{/if}
				{#if availableRustTargetTriples.includes('wasm32-wasip3')}
					`wasm32-wasip3` is only shown for the current transitional component path while
					upstream Rust still requires the documented libc patch.
				{/if} Use Ctrl+D or the EOF button while running if the program reads stdin until EOF.
			</p>
		{/if}
		{#if language === 'GO'}
			<p class="hint">
				Go uses the bundled `wasm-go` browser compiler runtime. The selector only shows Go
				targets advertised by the bundled runtime manifest. `wasip1/wasm` runs as preview1
				core wasm. {#if availableGoTargets.includes('wasip2/wasm')}
					`wasip2/wasm` follows the bundled runtime manifest and currently still maps to
					the preview1 core backend in the official Go bundle until upstream Go ships a
					native preview2 port.
				{/if}
				{#if availableGoTargets.includes('wasip3/wasm')}
					`wasip3/wasm` is only shown when the runtime bundle advertises the transitional
					preview3 path.
				{/if}
				{#if availableGoTargets.includes('js/wasm')}
					`js/wasm` runs through the bundled `wasm_exec.js` browser host.
				{/if}
				Pass CLI args here, type into the terminal below, and use Ctrl+D or the EOF button while
				running if the program reads stdin until EOF.
			</p>
		{/if}
		{#if language === 'D'}
			<p class="hint">
				D compiles in the browser with the bundled LDC WASI compiler and Emscripten LLD
				linker assets, then executes the emitted WASI artifact locally. Pass CLI args here,
				type into the terminal below, and use Ctrl+D or the EOF button if the program reads
				stdin until EOF.
			</p>
		{/if}
		{#if language === 'CSHARP' || language === 'FSHARP' || language === 'VBNET'}
			<p class="hint">
				{language === 'CSHARP' ? 'C#' : language === 'VBNET' ? 'VB.NET' : 'F#'} uses a `wasm-dotnet`
				browser runtime module plus its bundled static .NET `browser-wasm` compiler app. The page
				loads `runtime/dotnet.js`, compiles in the browser, and runs the generated assembly in
				the same runtime. Pass CLI args here; terminal input submitted before or during preparation
				is passed to `Console.In`.
			</p>
		{/if}
		{#if language === 'OCAML'}
			<p class="hint">
				OCaml uses the bundled `wasm-of-js-of-ocaml` browser-native toolchain. The backend
				selector switches between `wasm_of_ocaml` and `js_of_ocaml`. Binaryen fast is the
				default low-memory wasm path; Binaryen full runs the original static `wasm-metadce`
				and `wasm-opt` passes. The current playground path focuses on browser
				compile-and-run for standalone source files. Type into the terminal below and press
				Enter to send a line; use Ctrl+D or the EOF button while running if the program
				reads stdin until EOF.
			</p>
		{/if}
		{#if language === 'ELIXIR'}
			<p class="hint">
				Elixir runs through a bundled Popcorn evaluator. Each run boots a fresh `.avm`
				bundle, evaluates the editor contents with `Code.eval_string`, streams stdout and
				stderr into the terminal, and prints the final expression as `=&gt; ...`. Type into
				the terminal below and press Enter to send stdin. CLI args are still disabled.
			</p>
		{/if}
		{#if language === 'ERLANG'}
			<p class="hint">
				Erlang runs through the bundled Popcorn/AtomVM evaluator. Expression files use
				`erl_eval`, module files compile with the bundled Erlang compiler and then call
				`main/0`. Use `io:get_line("")` or `io:get_chars("", N)` for stdin.
			</p>
		{/if}
		{#if language === 'PROLOG'}
			<p class="hint">
				Prolog runs through bundled SWI-Prolog WebAssembly assets. Define `main/0` to run
				after consult; use `read_line_to_string(user_input, Line)` for line input.
			</p>
		{/if}
		{#if language === 'GLEAM'}
			<p class="hint">
				Gleam compiles in the browser with the bundled Gleam WebAssembly compiler and runs
				the JavaScript target output locally. Import `wasm_idle/stdin` for line input.
			</p>
		{/if}
		{#if language === 'PERL'}
			<p class="hint">
				Perl runs through bundled WebPerl WebAssembly assets. Use `&lt;STDIN&gt;` for line
				input and pass CLI args here.
			</p>
		{/if}
		{#if language === 'TCL'}
			<p class="hint">
				Tcl runs through bundled Wacl WebAssembly assets. Use `gets stdin line` for line
				input and read CLI args from `$argv`.
			</p>
		{/if}
		{#if language === 'AWK'}
			<p class="hint">
				AWK runs through bundled GoAWK WebAssembly assets. Input records are read from stdin
				by default; CLI args are exposed through `ARGV` and `var=value` assignments.
			</p>
		{/if}
		{#if language === 'PASCAL'}
			<p class="hint">
				Pascal compiles in the browser with bundled `pas2js` assets and runs the generated
				JavaScript locally. Use `ReadLn` for line input.
			</p>
		{/if}
		{#if language === 'FORTH'}
			<p class="hint">
				Forth runs through bundled WAForth WebAssembly assets. Use `KEY`, `ACCEPT`, or
				`REFILL` for stdin.
			</p>
		{/if}
		{#if language === 'J'}
			<p class="hint">
				J runs through the official J playground WebAssembly runtime. Use `1!:1 [ 1` to read
				stdin.
			</p>
		{/if}
		{#if language === 'BQN'}
			<p class="hint">
				BQN runs through bundled CBQN WebAssembly assets. Use `•GetLine @` for line input.
			</p>
		{/if}
		{#if language === 'JANET'}
			<p class="hint">
				Janet runs through the upstream Janet VM compiled to WebAssembly. Use `getline` or
				`file/read stdin :line` for line input.
			</p>
		{/if}
		{#if language === 'JULIA'}
			<p class="hint">
				Julia runs through the bundled Julia 1.0.4 WebAssembly runtime. Use `readline()` for
				line input; the worker connects terminal stdin with a Julia `IOBuffer` before
				running the source.
			</p>
		{/if}
		{#if language === 'NIM'}
			<p class="hint">
				Nim runs through the bundled Nim 2.2.4 WebAssembly compiler, then links generated C
				with clang/lld WebAssembly assets. Use `readLine(stdin)` for line input.
			</p>
		{/if}
		{#if language === 'TINYGO'}
			<p class="hint">
				TinyGo runs through the bundled wasm-tinygo browser pipeline by default, loads its
				direct runtime module, and runs the resulting WASI artifact in the local playground
				runtime. `wasip2` and `wasip3` use the wasm-tinygo preview target profiles. Pass CLI
				args here, type into the terminal below, and use Ctrl+D or the EOF button if the
				program reads stdin until EOF.
			</p>
		{/if}
		{#if language === 'JAVASCRIPT' || language === 'TYPESCRIPT'}
			<p class="hint">
				{language === 'JAVASCRIPT' ? 'JavaScript' : 'TypeScript'} runs through the bundled `wasm-typescript`
				browser module. `require('fs')`, `require('node:fs')`, and `fs.readLineSync(0)` are available
				for Enter-submitted line input. `fs.readFileSync('/dev/stdin', 'utf8')` and `fs.readFileSync(0,
				'utf8')` are also available for full-input reads; send Ctrl+D or the EOF button after
				typing input.
			</p>
		{/if}
		{#if language === 'ASSEMBLYSCRIPT'}
			<p class="hint">
				AssemblyScript compiles in the browser with the bundled `assemblyscript` compiler,
				then instantiates the emitted WebAssembly locally. `_start` or `main` runs first; if
				neither exists, zero-argument numeric, boolean, and string exports are printed to
				the terminal. Import `readLine`, `readAll`, or `readByte` from `env` for stdin; use
				Ctrl+D or the EOF button for full-input reads.
			</p>
		{/if}
		{#if language === 'WAT'}
			<p class="hint">
				WAT compiles through the bundled WABT browser module, then instantiates the emitted
				WebAssembly locally. Zero-argument numeric exports are called automatically and
				printed to the terminal. Import `env.readByte` for byte-oriented stdin; it returns
				`-1` after EOF.
			</p>
		{/if}
		{#if language === 'WASM'}
			<p class="hint">
				WASM executes a WebAssembly binary from base64, hex, or a `data:application/wasm`
				URL. Uploading a `.wasm` file stores it as base64 in the workspace. `_start`,
				`main`, or zero-argument numeric exports run automatically; WASI preview1 stdin,
				stdout, stderr, and `env.readByte` are wired to the terminal.
			</p>
		{/if}
		{#if language === 'LUA'}
			<p class="hint">
				Lua runs through the bundled `wasmoon` Lua VM, backed by its local wasm payload.
				Pass CLI args here, type into the terminal below, and use Ctrl+D or the EOF button
				if the program reads stdin until EOF.
			</p>
		{/if}
		{#if language === 'RUBY'}
			<p class="hint">
				Ruby runs through bundled CRuby WebAssembly assets from `ruby.wasm`. Pass CLI args
				here, type into the terminal below, and use Ctrl+D or the EOF button if the program
				reads stdin until EOF.
			</p>
		{/if}
		{#if language === 'R'}
			<p class="hint">
				R runs through bundled webR WebAssembly assets. Type into the terminal below and
				press Enter before code using `stdin()` reads a line.
			</p>
		{/if}
		{#if language === 'OCTAVE'}
			<p class="hint">
				Octave runs through bundled GNU Octave WebAssembly assets. Type into the terminal
				below and press Enter before code using `stdin` reads a line.
			</p>
		{/if}
		{#if language === 'SQLITE'}
			<p class="hint">
				SQLite runs through bundled sql.js WebAssembly assets against a fresh in-memory
				database on every run. SELECT results are printed as tab-separated tables.
			</p>
		{/if}
		{#if language === 'DUCKDB'}
			<p class="hint">
				DuckDB runs through `@duckdb/duckdb-wasm` in a browser worker against a fresh
				in-memory database on every run. Workspace `.csv`, `.json`, `.parquet`, `.sql`, and
				`.duckdb` files are registered before the active query; SELECT results are printed
				as tab-separated tables.
			</p>
		{/if}
		{#if language === 'PHP'}
			<p class="hint">
				PHP runs through `@php-wasm/web` in the browser worker. Pass CLI args here; terminal
				stdin is provided as `php://input`, so use Ctrl+D or the EOF button after typing
				full-input data.
			</p>
		{/if}
		{#if language === 'ZIG'}
			<p class="hint">
				Zig runs the bundled `zig_small.wasm` compiler. It uses the `std.zip` standard
				library inside the browser worker, compiles for `wasm64-wasi`. It executes the
				emitted WASI artifact locally. Pass CLI args here, type into the terminal below, and
				use Ctrl+D or the EOF button if the program reads stdin until EOF.
			</p>
		{/if}
		{#if language === 'HASKELL'}
			<p class="hint">
				Haskell loads a wasm GHC/GHCi root filesystem in the browser worker and invokes the
				bundled `ghc-in-browser` entry point locally. The argument field is passed to GHC;
				program stdin is currently treated as EOF by the upstream browser runtime.
			</p>
		{/if}
		{#if debugLanguage && debug.active}
			<section
				class={[
					'debug-shell',
					debug.paused && 'debug-shell--paused',
					debug.active && !debug.paused && 'debug-shell--active'
				]}
			>
				<div class="debug-hero">
					<div class="debug-hero__intro">
						<div class="debug-hero__badge">
							<span class="material-symbols-outlined">bug_report</span>
						</div>
						<div class="debug-hero__copy">
							<p class="debug-hero__eyebrow">Debug Workspace</p>
							<h2>{debugTitle}</h2>
						</div>
					</div>
					<div class="debug-hero__stats">
						<div
							class={[
								'debug-status-pill',
								debug.paused
									? 'debug-status-pill--paused'
									: debug.active
										? 'debug-status-pill--active'
										: 'debug-status-pill--idle'
							]}
						>
							<span class="material-symbols-outlined">{debugStatusIcon}</span>
							<span>{debugStatusLabel}</span>
						</div>
						<div class="debug-metric">
							<span>Breakpoints</span>
							<strong>{debug.breakpoints.length}</strong>
						</div>
						<div class="debug-metric">
							<span>Watches</span>
							<strong>{debug.watchExpressions.length}</strong>
						</div>
						<div class="debug-metric">
							<span>Line</span>
							<strong
								>{debug.pausedLine === null ? '—' : `L${debug.pausedLine}`}</strong
							>
						</div>
					</div>
				</div>
				<div class="debug-panels">
					<section class="debug-panel">
						<header class="debug-panel__header">
							<div class="debug-panel__title">
								<span class="material-symbols-outlined">data_object</span>
								<div class="debug-panel__copy">
									<h3>Locals</h3>
								</div>
							</div>
							<span class="debug-count">{debug.locals.length}</span>
						</header>
						{#if debug.locals.length}
							<ul>
								{#each debug.locals as variable (variable.name)}
									<li class="debug-entry debug-entry--local">
										<code class="debug-key">{variable.name}</code>
										<code class="debug-value">{variable.value}</code>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="empty">
								<span class="material-symbols-outlined">info</span>
								<span>No locals yet</span>
							</p>
						{/if}
					</section>
					<section class="debug-panel">
						<header class="debug-panel__header">
							<div class="debug-panel__title">
								<span class="material-symbols-outlined">visibility</span>
								<div class="debug-panel__copy">
									<h3>Watch</h3>
								</div>
							</div>
							<span class="debug-count">{debug.watchExpressions.length}</span>
						</header>
						<div class="watch-row">
							<input
								bind:value={debug.watchInput}
								placeholder="a == b"
								onkeydown={(event) =>
									event.key === 'Enter' && debug.addWatchExpression()}
							/>
							<button class="watch-add" onclick={() => debug.addWatchExpression()}>
								<span class="material-symbols-outlined">add</span>
								<span>Add</span>
							</button>
						</div>
						{#if debug.watchValues.length}
							<ul>
								{#each debug.watchValues as watch (watch.expression)}
									<li class="debug-entry debug-entry--watch">
										<div class="debug-entry__body">
											<span class="debug-expression">{watch.expression}</span>
											<code class="debug-value">{watch.value}</code>
										</div>
										<button
											class="remove"
											onclick={() =>
												debug.removeWatchExpression(watch.expression)}
											aria-label={`Remove watch expression ${watch.expression}`}
										>
											<span class="material-symbols-outlined">close</span>
										</button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="empty">
								<span class="material-symbols-outlined">info</span>
								<span>No watches yet</span>
							</p>
						{/if}
					</section>
					<section class="debug-panel">
						<header class="debug-panel__header">
							<div class="debug-panel__title">
								<span class="material-symbols-outlined">layers</span>
								<div class="debug-panel__copy">
									<h3>Call Stack</h3>
								</div>
							</div>
							<span class="debug-count">{debug.callStack.length}</span>
						</header>
						{#if debug.callStack.length}
							<ul>
								{#each debug.callStack as frame, index (`${frame.functionName}:${frame.line}:${index}`)}
									<li
										class={[
											'debug-entry',
											'debug-entry--stack',
											index === 0 && 'debug-entry--current'
										]}
									>
										<div class="stack-meta">
											<span class="stack-order">{index + 1}</span>
											<span class="stack-function"
												>{frame.functionName || '(entry)'}</span
											>
										</div>
										<code class="stack-line">L{frame.line}</code>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="empty">
								<span class="material-symbols-outlined">info</span>
								<span>No frames yet</span>
							</p>
						{/if}
					</section>
				</div>
			</section>
		{/if}
		<div class="terminal-shell">
			<Terminal
				bind:terminal
				{playground}
				ondebug={debug.handleEvent}
				oncompilediagnostic={onCompileDiagnostic}
			/>
		</div>
	</div>
	<div
		class:panel-resizer--active={resizingPane}
		class="panel-resizer"
		role="slider"
		aria-label="Resize example panes"
		aria-orientation="horizontal"
		aria-hidden={!desktopExampleLayout}
		tabindex={desktopExampleLayout ? 0 : -1}
		aria-valuemin={desktopExampleLayout ? minTerminalPaneWidth : undefined}
		aria-valuemax={desktopExampleLayout ? maxTerminalPaneWidth : undefined}
		aria-valuenow={desktopExampleLayout ? (terminalPanePixelWidth ?? undefined) : undefined}
		onpointerdown={(event) => {
			if (!desktopExampleLayout || !examplePane) return;
			event.preventDefault();
			const handle = event.currentTarget as HTMLDivElement;
			const pointerId = event.pointerId;
			const rect = examplePane.getBoundingClientRect();
			const updateWidth = (clientX: number) => {
				terminalPaneWidth = Math.min(
					Math.max(
						clientX -
							rect.left -
							examplePaneHorizontalPadding / 2 -
							panelResizerWidth / 2,
						minTerminalPaneWidth
					),
					maxTerminalPaneWidth
				);
			};
			updateWidth(event.clientX);
			resizingPane = true;
			handle.setPointerCapture(pointerId);
			const handlePointerMove = (moveEvent: PointerEvent) => {
				updateWidth(moveEvent.clientX);
			};
			const handlePointerUp = () => {
				resizingPane = false;
				handle.releasePointerCapture(pointerId);
				handle.removeEventListener('pointermove', handlePointerMove);
				handle.removeEventListener('pointerup', handlePointerUp);
				handle.removeEventListener('pointercancel', handlePointerUp);
			};
			handle.addEventListener('pointermove', handlePointerMove);
			handle.addEventListener('pointerup', handlePointerUp);
			handle.addEventListener('pointercancel', handlePointerUp);
		}}
		onkeydown={(event) => {
			if (!desktopExampleLayout) return;
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
			event.preventDefault();
			const step = event.key === 'ArrowLeft' ? -24 : 24;
			const currentWidth = terminalPanePixelWidth ?? Math.round(resizablePaneWidth * 0.5);
			terminalPaneWidth = Math.min(
				Math.max(currentWidth + step, minTerminalPaneWidth),
				maxTerminalPaneWidth
			);
		}}
	>
		<span class="panel-resizer__thumb" aria-hidden="true"></span>
	</div>
	<section class="editor-column">
		<nav class="file-tabs" aria-label="Open files">
			{#each openTabs as tab (tab)}
				<div class:active={tab === activePath} class="file-tab" title={tab}>
					<button onclick={() => selectFile(tab)}>{basename(tab)}</button>
					{#if openTabs.length > 1}
						<button
							aria-label={`Close ${tab}`}
							onclick={(event) => closeTab(tab, event)}
						>
							<span class="material-symbols-outlined">close</span>
						</button>
					{/if}
				</div>
			{/each}
			<div class="workspace-status">
				{#if editorLspStatus}
					<span
						class="lsp-status lsp-status--{editorLspStatus.state}"
						data-lsp-state={editorLspStatus.state}
						title={editorLspStatus.title}
						aria-live="polite"
					>
						{#if editorLspStatus.state === 'loading'}
							<span class="lsp-status__spinner" aria-hidden="true"></span>
						{:else}
							<span class="material-symbols-outlined" aria-hidden="true">
								{editorLspStatus.state === 'error' ? 'error' : 'check_circle'}
							</span>
						{/if}
						<span class="lsp-status__text">{editorLspStatus.text}</span>
						{#if editorLspStatus.state === 'loading'}
							{#if editorLspStatus.progressPercent === null}
								<span
									class="lsp-status__progress lsp-status__progress--indeterminate"
									role="progressbar"
									aria-label={`${editorLspStatus.label} loading progress`}
								>
									<span class="lsp-status__progress-fill"></span>
								</span>
							{:else}
								<span
									class="lsp-status__progress"
									role="progressbar"
									aria-label={`${editorLspStatus.label} loading progress`}
									aria-valuemin="0"
									aria-valuemax="100"
									aria-valuenow={editorLspStatus.progressPercent}
									style={`--lsp-progress-scale: ${editorLspStatus.progressPercent / 100};`}
								>
									<span class="lsp-status__progress-fill"></span>
								</span>
							{/if}
						{/if}
					</span>
				{/if}
				<span>{saveStatus}</span>
				<span>{activeLines} lines</span>
				<span>{activeBytes} bytes</span>
			</div>
		</nav>
		{#key `${language}:${activePath}`}
			<Monaco
				language={editorLanguage}
				lspLanguage={monacoLspLanguage}
				filePath={activePath}
				rustTargetTriple={languageExecutionOptions.rustTargetTriple}
				goTarget={languageExecutionOptions.goTarget}
				bind:editor
				value={activeFile?.content ?? ''}
				onChange={updateActiveContent}
				{compact}
				{lspEnabled}
				clangdEnabled={clangdLspEnabled}
				{clangdBaseUrl}
				{dotnetLspEnabled}
				{dotnetLspModuleUrl}
				{elixirLspEnabled}
				{elixirLspBundleUrl}
				elixirLspWorkerUrl={beamLspWorkerUrl}
				{erlangLspEnabled}
				{erlangLspBundleUrl}
				erlangLspWorkerUrl={beamLspWorkerUrl}
				{gleamLspEnabled}
				{gleamLspBaseUrl}
				{gleamLspManifestUrl}
				{dLspEnabled}
				{dLspModuleUrl}
				{tclLspEnabled}
				{tclLspBaseUrl}
				{tclLspWorkerUrl}
				{pascalLspEnabled}
				{pascalLspBaseUrl}
				{pascalLspWorkerUrl}
				{goLspEnabled}
				{goLspCompilerUrl}
				{rustLspEnabled}
				{rustLspCompilerUrl}
				{zigLspEnabled}
				{zigLspCompilerUrl}
				{zigLspStdlibUrl}
				{luaLspEnabled}
				{luaLspModuleUrl}
				{janetLspEnabled}
				{janetLspBaseUrl}
				{janetLspWorkerUrl}
				{lispLspEnabled}
				{lispLspModuleUrl}
				{ocamlLspEnabled}
				{ocamlLspModuleUrl}
				{ocamlLspManifestUrl}
				{haskellLspEnabled}
				{haskellLspModuleUrl}
				{haskellLspRootfsUrl}
				{haskellLspBsdtarUrl}
				{fortranLspAnalyzerUrl}
				{sqlLspEnabled}
				{sqlLspWasmUrl}
				{prologLspEnabled}
				{prologLspBaseUrl}
				{prologLspWorkerUrl}
				{rubyLspEnabled}
				{rubyLspWasmUrl}
				{rLspEnabled}
				{rLspBaseUrl}
				{octaveLspEnabled}
				{octaveLspBaseUrl}
				{octaveLspWorkerUrl}
				{octaveLspManifestUrl}
				{awkLspEnabled}
				{awkLspBaseUrl}
				{awkLspWorkerUrl}
				{perlLspEnabled}
				{perlLspBaseUrl}
				{perlLspWorkerUrl}
				{pythonLspBaseUrl}
				{typescriptLspLibUrl}
				breakpoints={debug.effectiveBreakpoints}
				debugLocals={debug.locals}
				{debugLanguage}
				{compilerDiagnostics}
				pausedLine={debug.pausedLine}
				bind:lspStatus={editorLspStatus}
				onCursorLineChange={debug.setCursorLine}
				onRunToCursor={debug.runToCursor}
				onBreakpointsChange={debug.setBreakpoints}
			/>
		{/key}
	</section>
</main>

<style>
	main {
		width: 100%;
		height: 100vh;
		height: 100dvh;
		display: flex;
		flex-direction: row;
		padding: 20px;
		box-sizing: border-box;
		overflow: hidden;
		background:
			radial-gradient(circle at top left, rgba(20, 184, 166, 0.08), transparent 28%),
			linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%);
	}

	.hidden-input {
		display: none;
	}

	.sidebar-backdrop {
		display: none;
	}

	.workspace-sidebar {
		flex: 0 0 250px;
		width: 250px;
		min-width: 220px;
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
		margin-right: 12px;
		border: 1px solid rgba(148, 163, 184, 0.26);
		border-radius: 16px;
		background: rgba(15, 23, 42, 0.94);
		color: #e5edf7;
		overflow: hidden;
		box-shadow: 0 22px 40px rgba(15, 23, 42, 0.12);
	}

	.workspace-sidebar__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-height: 44px;
		padding: 0 10px;
		border-bottom: 1px solid rgba(148, 163, 184, 0.18);
	}

	.workspace-sidebar__header > div {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.workspace-sidebar__header button,
	.workspace-sidebar__actions button,
	.tool-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 30px;
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: 10px;
		background: rgba(248, 250, 252, 0.92);
		color: #0f172a;
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		cursor: pointer;
	}

	.workspace-sidebar__header button {
		width: 30px;
		padding: 0;
		background: rgba(255, 255, 255, 0.08);
		color: #e5edf7;
	}

	.workspace-files {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		padding: 8px;
	}

	.workspace-files button {
		width: 100%;
		min-height: 34px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 0 9px;
		border: 1px solid transparent;
		border-radius: 10px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.workspace-files button.active,
	.workspace-files button:hover {
		border-color: rgba(74, 222, 128, 0.18);
		background: rgba(59, 130, 246, 0.18);
	}

	.workspace-files span {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.workspace-files small {
		color: #94a3b8;
		font-size: 10px;
		text-transform: uppercase;
	}

	.workspace-sidebar__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 8px;
		border-top: 1px solid rgba(148, 163, 184, 0.18);
	}

	.workspace-sidebar__actions button {
		flex: 1 1 calc(50% - 6px);
		background: rgba(30, 41, 59, 0.92);
		color: #e5edf7;
	}

	.tool-button {
		padding: 0 10px;
	}

	.editor-column {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid rgba(148, 163, 184, 0.24);
		border-radius: 16px;
		background: rgba(15, 23, 42, 0.96);
	}

	.file-tabs {
		flex: 0 0 38px;
		display: flex;
		align-items: stretch;
		min-width: 0;
		overflow-x: auto;
		border-bottom: 1px solid rgba(148, 163, 184, 0.18);
		background: #111827;
	}

	.file-tab {
		display: flex;
		align-items: center;
		min-width: 112px;
		max-width: 210px;
		border-right: 1px solid rgba(148, 163, 184, 0.14);
		background: rgba(30, 41, 59, 0.82);
		color: #cbd5e1;
	}

	.file-tab.active {
		background: #1e293b;
		color: #f8fafc;
	}

	.file-tab button {
		min-width: 0;
		height: 100%;
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.file-tab button:first-child {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
		padding: 0 10px;
	}

	.file-tab button:last-child {
		width: 32px;
		display: grid;
		place-items: center;
		color: #94a3b8;
	}

	.file-tab .material-symbols-outlined {
		font-size: 14px;
	}

	.workspace-status {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 0 0 auto;
		padding: 0 10px;
		color: #94a3b8;
		font-size: 11px;
		white-space: nowrap;
	}

	.lsp-status {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: min(260px, 42vw);
		min-height: 24px;
		padding: 0 8px 3px;
		border: 1px solid rgba(148, 163, 184, 0.28);
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.72);
		color: #cbd5e1;
		font-weight: 650;
		overflow: hidden;
	}

	.lsp-status__text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lsp-status .material-symbols-outlined {
		flex: 0 0 auto;
		font-size: 14px;
	}

	.lsp-status--loading {
		border-color: rgba(56, 189, 248, 0.4);
		color: #bae6fd;
	}

	.lsp-status--ready {
		border-color: rgba(34, 197, 94, 0.34);
		color: #bbf7d0;
	}

	.lsp-status--error {
		border-color: rgba(248, 113, 113, 0.42);
		color: #fecaca;
	}

	.lsp-status__spinner {
		flex: 0 0 auto;
		width: 10px;
		height: 10px;
		border: 2px solid rgba(186, 230, 253, 0.28);
		border-top-color: currentColor;
		border-radius: 999px;
		animation: lsp-status-spin 0.8s linear infinite;
	}

	.lsp-status__progress {
		position: absolute;
		right: 8px;
		bottom: 3px;
		left: 8px;
		height: 2px;
		overflow: hidden;
		border-radius: 999px;
		background: rgba(125, 211, 252, 0.2);
	}

	.lsp-status__progress-fill {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: inherit;
		background: currentColor;
		transform: scaleX(var(--lsp-progress-scale, 0));
		transform-origin: left center;
	}

	.lsp-status__progress--indeterminate .lsp-status__progress-fill {
		width: 42%;
		transform: translateX(-120%);
		animation: lsp-status-progress 1.1s ease-in-out infinite;
	}

	@keyframes lsp-status-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes lsp-status-progress {
		to {
			transform: translateX(260%);
		}
	}

	.drag-active::after {
		content: 'Drop files to import';
		position: fixed;
		inset: 20px;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px dashed #14b8a6;
		border-radius: 18px;
		background: rgba(15, 23, 42, 0.72);
		color: white;
		font-weight: 800;
		pointer-events: none;
	}

	.terminal-pane {
		flex: 0 0 auto;
		width: 50%;
		min-width: 320px;
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
		padding-bottom: 6px;
		padding-right: 6px;
		box-sizing: border-box;
		overflow-y: auto;
	}

	.panel-resizer {
		flex: 0 0 14px;
		width: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 0;
		background: transparent;
		appearance: none;
		cursor: col-resize;
		touch-action: none;
		user-select: none;
		position: relative;
	}

	.panel-resizer::before {
		content: '';
		width: 1px;
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(
			180deg,
			rgba(148, 163, 184, 0),
			rgba(148, 163, 184, 0.72),
			rgba(148, 163, 184, 0)
		);
	}

	.panel-resizer__thumb {
		position: absolute;
		width: 6px;
		height: 72px;
		border-radius: 999px;
		background: linear-gradient(180deg, rgba(15, 118, 110, 0.76), rgba(20, 184, 166, 0.98));
		box-shadow:
			0 10px 18px rgba(20, 184, 166, 0.18),
			0 0 0 4px rgba(20, 184, 166, 0.08);
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease,
			background 0.18s ease;
	}

	.panel-resizer:hover .panel-resizer__thumb,
	.panel-resizer:focus-visible .panel-resizer__thumb,
	.panel-resizer--active .panel-resizer__thumb {
		transform: scaleX(1.15);
		box-shadow:
			0 12px 22px rgba(20, 184, 166, 0.22),
			0 0 0 5px rgba(20, 184, 166, 0.12);
	}

	.toolbar {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 8px;
		padding: 10px;
		border: 1px solid rgba(148, 163, 184, 0.25);
		border-radius: 14px;
		background: rgba(255, 255, 255, 0.82);
		backdrop-filter: blur(14px);
		box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
	}

	.toolbar-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	.toolbar-row--secondary {
		gap: 8px;
	}

	.stdin-panel {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 8px;
		padding: 10px;
		border: 1px solid rgba(245, 158, 11, 0.28);
		border-radius: 12px;
		background: rgba(255, 251, 235, 0.92);
		color: #451a03;
	}

	.stdin-panel > div {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 12px;
		line-height: 1.35;
	}

	.stdin-panel strong {
		font-size: 12px;
	}

	.stdin-panel textarea {
		width: 100%;
		min-height: 86px;
		resize: vertical;
		box-sizing: border-box;
		padding: 8px 9px;
		border: 1px solid rgba(180, 83, 9, 0.22);
		border-radius: 10px;
		background: rgba(255, 255, 255, 0.88);
		color: #0f172a;
		font:
			12px/1.45 ui-monospace,
			SFMono-Regular,
			Menlo,
			Monaco,
			Consolas,
			monospace;
	}

	.stdin-panel textarea:focus {
		outline: 2px solid rgba(245, 158, 11, 0.24);
		border-color: rgba(217, 119, 6, 0.45);
	}

	.progress-shell {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px;
		border-radius: 14px;
		border: 1px solid rgba(45, 212, 191, 0.2);
		background:
			linear-gradient(180deg, rgba(240, 253, 250, 0.96), rgba(236, 253, 245, 0.92)),
			radial-gradient(circle at top left, rgba(20, 184, 166, 0.16), transparent 42%);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.9),
			0 12px 24px rgba(20, 184, 166, 0.08);
	}

	.progress-copy {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.progress-copy__text {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		color: #0f172a;
		font-size: 12px;
	}

	.progress-copy__text strong {
		font-size: 12px;
	}

	.progress-percent {
		font-size: 12px;
		font-weight: 700;
		color: #0f766e;
	}

	.progress-track {
		height: 8px;
		overflow: hidden;
		border-radius: 999px;
		background: rgba(148, 163, 184, 0.18);
		box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.08);
	}

	.progress-fill {
		width: 100%;
		height: 100%;
		border-radius: inherit;
		transform-origin: left center;
		background: linear-gradient(90deg, #0f766e 0%, #14b8a6 52%, #34d399 100%);
		box-shadow: 0 0 24px rgba(20, 184, 166, 0.28);
		transition: transform 0.18s ease;
	}

	.path-chip,
	.toggle-chip,
	.select-chip,
	.args-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 30px;
		padding: 0 9px;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.28);
		background: rgba(248, 250, 252, 0.92);
		color: #0f172a;
		box-sizing: border-box;
	}

	.path-chip {
		max-width: 100%;
		font-size: 11px;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
	}

	.path-chip code {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
	}

	.action-group {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.action-button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 30px;
		padding: 0 9px;
		border: 1px solid transparent;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.01em;
		cursor: pointer;
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease,
			border-color 0.18s ease,
			background-color 0.18s ease;
	}

	.action-button:enabled:hover {
		transform: translateY(-1px);
	}

	.action-button:enabled:active {
		transform: translateY(0);
	}

	.action-button:disabled {
		opacity: 0.48;
		cursor: not-allowed;
		box-shadow: none;
	}

	.action-button--run {
		background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%);
		color: #f8fffe;
		box-shadow: 0 12px 22px rgba(20, 184, 166, 0.28);
	}

	.action-button--debug {
		background: linear-gradient(135deg, #4338ca 0%, #6366f1 100%);
		color: #f8faff;
		box-shadow: 0 12px 22px rgba(99, 102, 241, 0.24);
	}

	.action-button--stop {
		background: linear-gradient(135deg, #b91c1c 0%, #ef4444 100%);
		color: #fff8f8;
		box-shadow: 0 12px 22px rgba(239, 68, 68, 0.24);
	}

	.action-button--icon {
		width: 30px;
		min-width: 30px;
		padding: 0;
		justify-content: center;
		background: rgba(255, 255, 255, 0.92);
		border-color: rgba(148, 163, 184, 0.32);
		color: #0f172a;
		box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
	}

	.terminal-shell {
		flex: 1 1 auto;
		min-height: 0;
		min-height: 280px;
	}

	.terminal-shell :global(.xterm .xterm-viewport) {
		scrollbar-width: thin;
		scrollbar-color: rgba(15, 118, 110, 0.62) rgba(148, 163, 184, 0.12);
	}

	.terminal-shell :global(.xterm .xterm-viewport::-webkit-scrollbar) {
		width: 12px;
	}

	.terminal-shell :global(.xterm .xterm-viewport::-webkit-scrollbar-track) {
		margin: 8px 0;
		border-radius: 999px;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.58), rgba(226, 232, 240, 0.26)),
			rgba(148, 163, 184, 0.08);
		box-shadow:
			inset 0 0 0 1px rgba(148, 163, 184, 0.08),
			inset 0 1px 2px rgba(15, 23, 42, 0.05);
	}

	.terminal-shell :global(.xterm .xterm-viewport::-webkit-scrollbar-thumb) {
		border: 3px solid transparent;
		border-radius: 999px;
		background: linear-gradient(180deg, rgba(45, 212, 191, 0.86), rgba(15, 118, 110, 0.94))
			padding-box;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.42),
			0 4px 10px rgba(15, 118, 110, 0.18);
	}

	.terminal-shell :global(.xterm:hover .xterm-viewport::-webkit-scrollbar-thumb),
	.terminal-shell :global(.xterm .xterm-viewport::-webkit-scrollbar-thumb:hover) {
		background: linear-gradient(180deg, rgba(52, 211, 153, 0.94), rgba(13, 148, 136, 1))
			padding-box;
	}

	.material-symbols-outlined {
		font-family: 'Material Symbols Outlined';
		font-weight: normal;
		font-style: normal;
		font-size: 15px;
		line-height: 1;
		letter-spacing: normal;
		text-transform: none;
		display: inline-block;
		white-space: nowrap;
		word-wrap: normal;
		direction: ltr;
		font-feature-settings: 'liga';
		-webkit-font-feature-settings: 'liga';
		-webkit-font-smoothing: antialiased;
		font-variation-settings:
			'FILL' 0,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.action-button--icon .material-symbols-outlined {
		font-size: 16px;
	}

	.hint {
		margin: 0 0 8px;
		font-size: 12px;
		color: #475569;
	}

	.debug-shell {
		--debug-accent: #6366f1;
		--debug-accent-soft: rgba(99, 102, 241, 0.14);
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin: 8px 0 10px;
		padding: 12px;
		border: 1px solid rgba(148, 163, 184, 0.24);
		border-radius: 18px;
		background:
			radial-gradient(circle at top left, var(--debug-accent-soft), transparent 34%),
			linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.9));
		box-shadow: 0 22px 40px rgba(15, 23, 42, 0.08);
	}

	.debug-shell--active {
		--debug-accent: #0f766e;
		--debug-accent-soft: rgba(20, 184, 166, 0.16);
	}

	.debug-shell--paused {
		--debug-accent: #7c3aed;
		--debug-accent-soft: rgba(124, 58, 237, 0.16);
	}

	.debug-hero {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.debug-hero__intro {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		flex: 1 1 260px;
		min-width: 0;
	}

	.debug-hero__badge {
		width: 42px;
		height: 42px;
		display: grid;
		place-items: center;
		border-radius: 14px;
		background: linear-gradient(135deg, var(--debug-accent) 0%, #0f172a 180%);
		color: white;
		box-shadow: 0 14px 28px rgba(15, 23, 42, 0.14);
		flex: 0 0 auto;
	}

	.debug-hero__badge .material-symbols-outlined {
		font-size: 20px;
		font-variation-settings:
			'FILL' 1,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.debug-hero__copy {
		min-width: 0;
	}

	.debug-hero__eyebrow {
		margin: 0 0 4px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--debug-accent);
	}

	.debug-hero__copy h2 {
		margin: 0;
		font-size: 18px;
		line-height: 1.1;
		color: #0f172a;
	}

	.debug-hero__stats {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: flex-end;
	}

	.debug-status-pill,
	.debug-metric {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 32px;
		padding: 0 10px;
		border-radius: 999px;
		border: 1px solid rgba(148, 163, 184, 0.26);
		background: rgba(255, 255, 255, 0.86);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);
	}

	.debug-status-pill {
		font-size: 11px;
		font-weight: 700;
		color: #0f172a;
	}

	.debug-status-pill--idle {
		color: #475569;
	}

	.debug-status-pill--active {
		color: #0f766e;
	}

	.debug-status-pill--paused {
		color: #7c3aed;
	}

	.debug-metric {
		flex-direction: column;
		align-items: flex-start;
		gap: 1px;
		padding-top: 6px;
		padding-bottom: 6px;
		border-radius: 14px;
	}

	.debug-metric span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #64748b;
	}

	.debug-metric strong {
		font-size: 13px;
		line-height: 1;
		color: #0f172a;
	}

	.debug-panels {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 10px;
	}

	.debug-panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
		border: 1px solid rgba(203, 213, 225, 0.72);
		border-radius: 16px;
		padding: 12px;
		background: rgba(255, 255, 255, 0.82);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.88),
			0 12px 24px rgba(15, 23, 42, 0.05);
		font-size: 12px;
	}

	.debug-panel__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}

	.debug-panel__title {
		display: flex;
		gap: 10px;
		min-width: 0;
	}

	.debug-panel__title > .material-symbols-outlined {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: rgba(99, 102, 241, 0.08);
		color: var(--debug-accent);
		flex: 0 0 auto;
	}

	.debug-panel__copy {
		min-width: 0;
	}

	.debug-panel h3 {
		margin: 0;
		font-size: 12px;
		color: #0f172a;
	}

	.debug-count {
		min-width: 22px;
		height: 22px;
		display: inline-grid;
		place-items: center;
		padding: 0 6px;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.06);
		color: #334155;
		font-size: 11px;
		font-weight: 700;
	}

	.debug-panel ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.debug-entry {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
		padding: 10px;
		border: 1px solid rgba(226, 232, 240, 0.92);
		border-radius: 12px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.9));
	}

	.debug-entry--local {
		align-items: flex-start;
	}

	.debug-entry__body {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex: 1;
		min-width: 0;
	}

	.debug-expression,
	.stack-function {
		font-weight: 600;
		color: #0f172a;
		word-break: break-word;
	}

	.debug-key,
	.stack-line,
	.debug-value {
		max-width: 100%;
		padding: 4px 7px;
		border-radius: 9px;
		background: rgba(241, 245, 249, 0.95);
		border: 1px solid rgba(226, 232, 240, 0.95);
	}

	.debug-key {
		color: var(--debug-accent);
		font-weight: 700;
	}

	.debug-value {
		color: #334155;
		overflow-wrap: anywhere;
	}

	.debug-entry--stack {
		align-items: center;
	}

	.debug-entry--current {
		border-color: rgba(99, 102, 241, 0.24);
		box-shadow: 0 8px 18px rgba(99, 102, 241, 0.08);
	}

	.stack-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.stack-order {
		width: 20px;
		height: 20px;
		display: inline-grid;
		place-items: center;
		border-radius: 999px;
		background: rgba(15, 23, 42, 0.08);
		color: #475569;
		font-size: 10px;
		font-weight: 700;
	}

	.watch-row {
		display: flex;
		gap: 8px;
	}

	.watch-row input {
		flex: 1;
		min-width: 0;
		padding: 0 12px;
		min-height: 36px;
		border: 1px solid rgba(148, 163, 184, 0.3);
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.94);
		font: inherit;
		color: #0f172a;
		outline: none;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}

	.watch-row input:focus {
		border-color: rgba(99, 102, 241, 0.42);
		box-shadow:
			0 0 0 3px rgba(99, 102, 241, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.8);
	}

	.watch-add {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 36px;
		padding: 0 12px;
		border: 0;
		border-radius: 12px;
		background: linear-gradient(135deg, #4338ca 0%, #6366f1 100%);
		color: #f8faff;
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 10px 18px rgba(99, 102, 241, 0.22);
	}

	.watch-add .material-symbols-outlined {
		font-size: 16px;
	}

	.toggle-chip input {
		margin: 0;
		accent-color: #14b8a6;
	}

	.select-chip select,
	.args-chip input {
		border: 0;
		background: transparent;
		font: inherit;
		color: inherit;
		outline: none;
	}

	.select-chip select {
		padding-right: 4px;
	}

	.args-chip input {
		min-width: 64px;
	}

	.remove {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: rgba(239, 68, 68, 0.09);
		color: #b91c1c;
		cursor: pointer;
		flex: 0 0 auto;
	}

	.remove .material-symbols-outlined {
		font-size: 15px;
	}

	.empty {
		margin: 0;
		padding: 14px 12px;
		display: flex;
		align-items: center;
		gap: 8px;
		border: 1px dashed rgba(148, 163, 184, 0.35);
		border-radius: 12px;
		background: rgba(248, 250, 252, 0.76);
		color: #64748b;
	}

	@media (max-width: 960px) {
		main {
			height: auto;
			min-height: 100vh;
			min-height: 100dvh;
			flex-direction: column;
			padding: 16px;
			overflow: auto;
		}

		.sidebar-backdrop {
			position: fixed;
			inset: 0;
			z-index: 20;
			display: block;
			border: 0;
			background: rgba(15, 23, 42, 0.48);
		}

		.workspace-sidebar {
			position: fixed;
			inset: 16px auto 16px 16px;
			z-index: 21;
			width: min(340px, calc(100vw - 32px));
			max-width: calc(100vw - 32px);
			height: auto;
			margin-right: 0;
		}

		.terminal-pane {
			width: 100% !important;
			min-width: 0;
			height: auto;
			padding-right: 0;
			padding-bottom: 0;
		}

		.editor-column {
			width: 100%;
			min-height: 440px;
			flex: 0 0 auto;
		}

		.file-tabs {
			flex-basis: 42px;
		}

		.file-tab {
			min-width: 108px;
		}

		.workspace-status > span:nth-child(n + 2):not(.lsp-status) {
			display: none;
		}

		.tool-button,
		.action-button,
		.path-chip,
		.toggle-chip,
		.select-chip,
		.args-chip {
			min-height: 38px;
		}

		.args-chip input {
			font-size: 16px;
		}

		.panel-resizer {
			display: none;
		}

		.debug-hero__stats {
			width: 100%;
			justify-content: flex-start;
		}
	}
</style>
