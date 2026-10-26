<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { parseDebugInteger } from './debugInteger';
	import Monaco from './Monaco.svelte';
	import DebuggerLog from './DebuggerLog.svelte';
	import Terminal, { type TerminalControl } from '@wasm-idle/terminal';
	import type { ProgressLike } from '@wasm-idle/core';
	import { compilePython, isSharedArrayBufferAvailable, type PythonCompileOptions } from '$lib';
	import { createContainerPlaygroundBinding } from '$lib/playground/container/binding';
	import { mergeContainerWorkspace } from '$lib/playground/container/workspace';
	import ContainerExplorer from '$lib/playground/container/ContainerExplorer.svelte';
	import { resolveInitialWorkspace } from './initialWorkspace';
	import type { ContainerWorkspaceEntry } from '$lib/playground/container/protocol';
	import {
		createDebugSessionController,
		cppDebugLanguageAdapter,
		goDebugLanguageAdapter,
		javaDebugLanguageAdapter,
		luaDebugLanguageAdapter,
		vDebugLanguageAdapter,
		pythonDebugLanguageAdapter,
		rubyDebugLanguageAdapter,
		rustDebugLanguageAdapter,
		type DebugLanguageAdapter,
		type DebugVariableNode,
		type DebugSnapshotVariable
	} from '@wasm-idle/debug';
	import { page } from '$app/state';
	import { browser } from '$app/env';
	import * as publicEnvironment from '$app/env/public';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteURL } from 'svelte/reactivity';
	import {
		createApplicationAssetResolver,
		createApplicationRuntimeAssets
	} from '$lib/playground/applicationAssets';
	import { createLoadingProgressController } from '$lib/playground/loadingProgress';
	import {
		createExecutionObserver,
		type ExecutionObservation
	} from '$lib/playground/executionObservation';
	import { resolveDebugRuntimeUrls } from '$lib/playground/assets';
	import { RUST_NON_DEBUG_RESOURCE_REQUIREMENTS } from '$lib/playground/rustWorkerLimits';
	import type {
		CompilerDiagnostic,
		BrowserDebugMode,
		DebugDataBreakpoint,
		DebugDataBreakpointAccessType,
		DebugDataBreakpointInfo,
		DebugDataBreakpointInfoArguments,
		DebugResolvedDataBreakpoint,
		GoTarget,
		OcamlBackend,
		OcamlWasmBinaryenMode,
		RustTargetTriple,
		RustOptimizationProfile,
		SandboxExecutionOptions,
		DebugFrame,
		DebugSessionEvent,
		DebugScope,
		DebugVariable
	} from '$lib/playground/options';
	import type monaco from 'monaco-editor';
	import { executeTerminalRun } from './execute';
	import { parseArgs } from './parseArgs';
	import CompilerOptions from './CompilerOptions.svelte';
	import {
		clangCompilerLanguages,
		compilerArgumentConfig,
		defaultCompilerSettings,
		resolveClangdCompilerArguments,
		resolveCompilerArguments,
		resolveCompilerSourceLanguage,
		restoreCompilerOptions,
		type CompilerOptionsByLanguage
	} from './compilerOptions';
	import { createWorkspaceStorage, type WorkspaceSaveState } from './workspaceStorage';
	import { normalizeWorkspacePath, resolveCompilerDiagnosticPath } from './workspacePath';
	import {
		createSharedWorkspaceUrl,
		WORKSPACE_STORAGE_KEY,
		workspaceStorageKey
	} from './workspaceContext';
	import { migrateLegacyWorkspaceFile } from './workspaceMigration';
	import { normalizeWorkspaceTabs, validateWorkspaceSnapshot } from './workspaceSnapshot';
	import { preserveUnrestoredWorkspace } from './workspaceRecovery';
	import { copyWorkspaceShare } from './workspaceShare';
	import { serializeWorkspaceBackup } from './workspaceBackup';
	import { requestWorkspaceArchive, type WorkspaceArchiveRequest } from './workspaceArchive';
	import { stageWorkspaceImport } from './workspaceImport';
	import {
		captureWorkspaceImportDestination,
		WorkspaceImportCancelled
	} from './workspaceImportDestination';
	import { applyExampleRuntimeEnvironment } from './runtimeEnvironment';
	import { createExecutionPreflightGate } from './executionPreflight';
	import elixirRuntimeWorkerUrl from '$lib/playground/worker/elixir?worker&url';
	import { resolveEditorDefaultSource } from './editor-defaults';
	import {
		argsHelpLanguages,
		argsLabels,
		clangdLspLanguages,
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

	import {
		isBinaryWorkspaceFile,
		workspaceFileBlob,
		workspaceFileFromBytes,
		workspaceFileBytes,
		type WorkspaceFile
	} from './workspaceCodec';
	type LanguageWorkspace = {
		activePath: string;
		files: WorkspaceFile[];
		openTabs: string[];
	};
	const knownCppVersions = [
		'CPP98',
		'CPP03',
		'CPP11',
		'CPP14',
		'CPP17',
		'CPP20',
		'CPP23',
		'CPP26'
	] as const;
	type CppVersion = (typeof knownCppVersions)[number];
	const cppVersionLabels: Record<CppVersion, string> = {
		CPP98: 'C++98',
		CPP03: 'C++03',
		CPP11: 'C++11',
		CPP14: 'C++14',
		CPP17: 'C++17',
		CPP20: 'C++20',
		CPP23: 'C++23',
		CPP26: 'C++26'
	};

	type WorkspaceSnapshot = {
		activePath: string;
		argsInput: string;
		compilerOptions: CompilerOptionsByLanguage;
		cppVersion: CppVersion;
		files: WorkspaceFile[];
		goTarget: GoTarget;
		language: string;
		log: boolean;
		lspEnabled: boolean;
		ocamlBackend: OcamlBackend;
		ocamlWasmBinaryenMode: OcamlWasmBinaryenMode;
		openTabs: string[];
		rustTargetTriple: RustTargetTriple;
		rustOptimizationProfile: RustOptimizationProfile;
		sidebarOpen: boolean;
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
	type DebugMemoryView = {
		address?: string;
		memoryReference: string;
		offset: number;
		unreadableBytes: number;
	};
	type DebugMemoryRow = {
		ascii: string;
		bytes: Array<number | null>;
		offset: number;
	};
	type ActiveDebugDataBreakpoint = {
		accessType: DebugDataBreakpointAccessType;
		address?: string;
		bytes?: number;
		dataId?: string;
		description: string;
		id?: number;
	};

	const SHARE_PREFIX = 'workspace=';
	const MAX_DEBUG_MEMORY_BYTES = 256;
	const lldbDebugLanguages = new Set<PlaygroundLanguage>([
		'C',
		'CPP',
		'RUST',
		'OBJC',
		'OBJECTIVECXX',
		'V'
	]);
	const traceFallbackLanguages = new Set<PlaygroundLanguage>(['C', 'CPP', 'RUST', 'OBJC']);
	// Runtimes that consume stdin once at start, even when terminal streaming is available.
	const preloadedStdinLanguages = new Set<PlaygroundLanguage>(['BASH', 'POSTGRESQL']);
	const debugLanguageAdapters: Partial<Record<PlaygroundLanguage, DebugLanguageAdapter>> = {
		C: cppDebugLanguageAdapter,
		CPP: cppDebugLanguageAdapter,
		OBJC: cppDebugLanguageAdapter,
		OBJECTIVECXX: cppDebugLanguageAdapter,
		V: vDebugLanguageAdapter,
		GO: goDebugLanguageAdapter,
		JAVA: javaDebugLanguageAdapter,
		LUA: luaDebugLanguageAdapter,
		RUBY: rubyDebugLanguageAdapter,
		RUST: rustDebugLanguageAdapter,
		PYTHON: pythonDebugLanguageAdapter
	};
	const debugTitles: Partial<Record<PlaygroundLanguage, string>> = {
		C: 'C · LLDB / WAMR',
		CPP: 'C++ · LLDB / WAMR',
		OBJC: 'Objective-C · LLDB / WAMR',
		OBJECTIVECXX: 'Objective-C++ · LLDB / WAMR',
		V: 'V · LLDB / WAMR',
		GO: 'Go Trace',
		JAVA: 'Java · Trace',
		LUA: 'Lua · MobDebug',
		RUBY: 'Ruby · TracePoint',
		RUST: 'Rust · LLDB / WAMR',
		PYTHON: 'Pyodide Trace'
	};

	let path = $derived(
		page.url.pathname.endsWith('/') ? page.url.pathname.slice(0, -1) : page.url.pathname
	);
	const applicationRootUrl = resolve('');
	const resolveApplicationAsset = createApplicationAssetResolver(applicationRootUrl);
	let clangdBaseUrl = $derived(resolveApplicationAsset('clangd/'));
	let runtimeAssets = $derived.by(() =>
		applyExampleRuntimeEnvironment(
			{
				...createApplicationRuntimeAssets(applicationRootUrl),
				debug: {
					baseUrl: path ? `${path}/wasm-debug/` : '/wasm-debug/',
					manifestUrl: path
						? `${path}/wasm-debug/runtime-manifest.v2.json`
						: '/wasm-debug/runtime-manifest.v2.json'
				}
			},
			publicEnvironment
		)
	);
	const playground = $derived.by(() =>
		createContainerPlaygroundBinding(runtimeAssets, {
			applicationRootURL: browser
				? new URL(`${applicationRootUrl.replace(/\/$/, '')}/`, location.href).href
				: '/',
			workspaceId: currentWorkspaceStorageKey,
			getLanguage: () => untrack(() => language)
		})
	);

	let editor = $state<monaco.editor.IStandaloneCodeEditor | null>(null),
		terminal = $state<TerminalControl | undefined>(undefined),
		compilerDiagnostics = $state<CompilerDiagnostic[]>([]),
		clangdRequested = $state(false),
		argsInput = $state(''),
		compilerOptions = $state<CompilerOptionsByLanguage>({}),
		cppVersion = $state<CppVersion>('CPP20'),
		rustTargetTriple = $state<RustTargetTriple>('wasm32-wasip1'),
		rustOptimizationProfile = $state<RustOptimizationProfile>('interactive'),
		goTarget = $state<GoTarget>('wasip1/wasm'),
		ocamlBackend = $state<OcamlBackend>('wasm'),
		ocamlWasmBinaryenMode = $state<OcamlWasmBinaryenMode>('fast'),
		log = $state(true),
		lspEnabled = $state(true),
		prewarmEnabled = $state(true),
		language = $state<PlaygroundLanguage>('CPP'),
		runningMode = $state<'run' | 'debug' | 'compile' | null>(null),
		activeDebugBackend = $state<BrowserDebugMode | null>(null),
		progressVisible = $state(false),
		progress = $state(0),
		progressStage = $state(''),
		progressIndeterminate = $state(false),
		stdinInput = $state(''),
		editorLspStatus = $state<EditorLspStatusView | null>(null),
		splitPane = $state<HTMLDivElement>(),
		splitPaneWidth = $state(0),
		examplePane = $state<HTMLElement | null>(null),
		examplePaneWidth = $state(0),
		terminalPaneWidth = $state<number | null>(null),
		resizingPane = $state(false);
	let restartDebugPending = $state(false);
	let executionStopPending = $state(false);
	let executionGeneration = 0;
	// Compiler diagnostics resolve against the workspace their run compiled.
	let compilerDiagnosticRun: { entryPath: string; workspacePaths: string[] } | null = null;
	let restartRequestGeneration = 0;
	let activeExecution: Promise<void> | null = null;
	const executionPreflight = createExecutionPreflightGate();
	let pythonCompileAbortController: AbortController | undefined;
	let pythonInvalidationMode =
		$state<NonNullable<PythonCompileOptions['invalidationMode']>>('checked-hash');
	let pythonTimestampInput = $state('0');
	const pythonTimestamp = $derived(Number(pythonTimestampInput));
	const pythonCompileOptionError = $derived(
		pythonInvalidationMode === 'timestamp' &&
			(!pythonTimestampInput.trim() ||
				!Number.isInteger(pythonTimestamp) ||
				pythonTimestamp < 0 ||
				pythonTimestamp > 0xffffffff)
			? 'Timestamp must be a whole number from 0 to 4294967295.'
			: null
	);
	onDestroy(() => {
		const controller = pythonCompileAbortController;
		pythonCompileAbortController = undefined;
		controller?.abort();
	});

	const initialSelection = browser
		? resolveInitialWorkspace({
				url: new URL(location.href),
				readStorage: (key) => localStorage.getItem(key),
				isolateStorage: !navigator.locks,
				normalizeLanguage: normalizeRequestedLanguage,
				languageForPath,
				fallbackLanguage: 'CPP' as PlaygroundLanguage
			})
		: null;
	const initialLanguage = initialSelection?.language ?? 'CPP';
	if (initialSelection) language = initialLanguage;
	const initialWorkspace = createDefaultWorkspace(initialLanguage);
	let languageWorkspaces = $state<Record<PlaygroundLanguage, LanguageWorkspace>>({
		...createDefaultLanguageWorkspaces(),
		[initialLanguage]: cloneWorkspace(initialWorkspace)
	});
	let files = $state<WorkspaceFile[]>(cloneFiles(initialWorkspace.files));
	let activePath = $state(initialWorkspace.activePath);
	let openTabs = $state<string[]>([...initialWorkspace.openTabs]);
	let sidebarOpen = $state(true);
	let debugPanelOpen = $state({ variables: true, memory: true, watch: true, stack: true });
	let languageMenuOpen = $state(false);
	let languageQuery = $state('');
	let languageHighlight = $state(0);
	let languagePicker = $state<HTMLDivElement>();
	let languageTrigger = $state<HTMLButtonElement>();
	let languageSearchInput = $state<HTMLInputElement>();
	let languageMenuList = $state<HTMLUListElement>();
	const themeStorageKey = 'wasm-idle:theme';
	let themePreference = $state<'light' | 'dark' | null>(null);
	let systemDark = $state(false);
	const darkMode = $derived(themePreference ? themePreference === 'dark' : systemDark);

	$effect(() => {
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		systemDark = media.matches;
		try {
			const stored = localStorage.getItem(themeStorageKey);
			if (stored === 'light' || stored === 'dark') themePreference = stored;
		} catch {
			// Storage can be unavailable in private or sandboxed contexts.
		}
		const handleChange = (event: MediaQueryListEvent) => (systemDark = event.matches);
		media.addEventListener('change', handleChange);
		return () => media.removeEventListener('change', handleChange);
	});

	$effect(() => {
		document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
	});

	function toggleTheme() {
		themePreference = darkMode ? 'light' : 'dark';
		try {
			localStorage.setItem(themeStorageKey, themePreference);
		} catch {
			// The theme still applies for this session.
		}
	}
	let saveStatus = $state('Ready');
	let manualShareUrl = $state('');
	let unrestoredWorkspace = $state<string | null>(null);
	let workspaceRecoveryKey = $state<string | null>(null);
	let recoveryBackupDownloaded = $state(false);
	let workspaceSaveState = $state<WorkspaceSaveState>({
		phase: 'dirty',
		revision: 0,
		savedRevision: -1,
		error: null
	});
	let currentWorkspaceStorageKey = $state(initialSelection?.storageKey ?? WORKSPACE_STORAGE_KEY);
	let editorWorkspaceRevision = $state(0);
	const workspaceStorage = createWorkspaceStorage(
		(value, key) => localStorage.setItem(key, value),
		(state) => {
			workspaceSaveState = state;
		},
		{
			read: (key) => localStorage.getItem(key),
			initialStorageIdentity: initialSelection?.storageKey ?? WORKSPACE_STORAGE_KEY,
			initialSnapshot: initialSelection?.storedSnapshot ?? null,
			withLock: async (key, write) =>
				navigator.locks ? await navigator.locks.request(key, write) : write()
		}
	);
	let workspaceInitialized = $state(false);
	let workspaceEditorInitialized = $state(false);
	const workspaceEditorReady = $derived(workspaceInitialized && !!editor);
	let workspaceSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let activeProgressSession: ProgressLike | undefined;
	let executionAbortController: AbortController | undefined;
	let fileInput = $state<HTMLInputElement | null>(null);
	let dragActive = $state(false);
	const sharedBufferAvailable = $derived(!browser || isSharedArrayBufferAvailable());

	const executionOptionResolvers: Partial<
		Record<PlaygroundLanguage, () => Partial<SandboxExecutionOptions>>
	> = {
		CPP: () => ({ cppVersion }),
		RUST: () => ({
			rustTargetTriple,
			rustOptimizationProfile,
			limits: RUST_NON_DEBUG_RESOURCE_REQUIREMENTS
		}),
		GO: () => ({ goTarget }),
		TINYGO: () => ({ limits: { maxWasmMemoryBytes: 2 * 1024 * 1024 * 1024 } }),
		OCAML: () => ({ ocamlBackend, ocamlWasmBinaryenMode }),
		ZIG: () => ({ zigTargetTriple: 'wasm64-wasi' })
	};
	const currentCompilerSettings = $derived(compilerOptions[language] ?? defaultCompilerSettings);
	const compilerSourceLanguage = $derived(resolveCompilerSourceLanguage(language, activePath));
	const parsedCompilerArgs = $derived.by(() => {
		try {
			return {
				args: resolveCompilerArguments(
					language,
					currentCompilerSettings,
					cppVersion,
					activePath
				),
				error: null
			};
		} catch (error) {
			return { args: null, error: error instanceof Error ? error.message : String(error) };
		}
	});
	const clangdCompilerArgs = $derived.by(() => {
		try {
			return resolveClangdCompilerArguments(
				language,
				currentCompilerSettings,
				cppVersion,
				activePath
			);
		} catch {
			return [];
		}
	});
	const languageExecutionOptions = $derived.by<Partial<SandboxExecutionOptions>>(() => ({
		...executionOptionResolvers[compilerSourceLanguage]?.(),
		...(compilerArgumentConfig[language] ? { compileArgs: parsedCompilerArgs.args ?? [] } : {}),
		...(language === 'C' ? { cVersion: currentCompilerSettings.cVersion } : {}),
		...(language === 'OBJC' || language === 'OBJECTIVECXX'
			? {
					cVersion: currentCompilerSettings.cVersion,
					cppVersion,
					objectivecGnuExtensions: currentCompilerSettings.gnuExtensions
				}
			: {})
	}));
	const editorLanguage = $derived(editorLanguages[language]);
	const executionAvailable = $derived(!editorOnlyLanguages.has(language));
	const argsLabel = $derived(argsLabels[language] ?? 'Args');
	const monacoLspLanguage = $derived(lspLanguageOverrides[language] ?? editorLanguage);
	const activeRuntimeLspCapability = $derived(runtimeLspCapabilities[language] ?? null);
	const javaLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'java');
	const javaLspRuntime = $derived(
		javaLspEnabled
			? {
					...runtimeAssets.javaLsp,
					baseUrl:
						runtimeAssets.javaLsp?.baseUrl || resolveApplicationAsset('wasm-java-lsp/')
				}
			: undefined
	);
	const javaLspWorkspaceFiles = $derived(
		javaLspEnabled
			? files
					.filter(
						(file) =>
							file.path !== activePath &&
							file.path.endsWith('.java') &&
							!isBinaryWorkspaceFile(file)
					)
					.map((file) => ({ path: file.path, content: file.content }))
			: []
	);
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
	const elixirLspIntegrity = $derived(
		elixirLspEnabled ? runtimeAssets.elixir?.integrity : undefined
	);
	const erlangLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'erlang');
	const erlangLspBundleUrl = $derived(
		erlangLspEnabled ? runtimeAssets.erlang?.bundleUrl : undefined
	);
	const erlangLspIntegrity = $derived(
		erlangLspEnabled ? runtimeAssets.erlang?.integrity : undefined
	);
	const beamLspWorkerUrl = $derived(
		elixirLspEnabled || erlangLspEnabled ? elixirRuntimeWorkerUrl : undefined
	);
	const gleamLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'gleam');
	const phpLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'php');
	const phpLspWasmUrl = $derived(
		phpLspEnabled ? resolveApplicationAsset('wasm-phpantom-lsp/phpantom_lsp.wasm') : undefined
	);
	const forthLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'forth');
	const forthLspWasmUrl = $derived(
		forthLspEnabled ? resolveApplicationAsset('wasm-forth-lsp/forth_lsp.wasm') : undefined
	);
	const c3LspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'c3');
	const c3LspBaseUrl = $derived(
		c3LspEnabled ? resolveApplicationAsset('wasm-c3-lsp/') : undefined
	);
	const vLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'v');
	const vLspBaseUrl = $derived(vLspEnabled ? resolveApplicationAsset('wasm-v-lsp/') : undefined);
	const gleamLspBaseUrl = $derived(gleamLspEnabled ? runtimeAssets.gleam?.baseUrl : undefined);
	const gleamLspManifestUrl = $derived(
		gleamLspEnabled ? runtimeAssets.gleam?.manifestUrl : undefined
	);
	const gleamLspManifestFingerprint = $derived(
		gleamLspEnabled ? runtimeAssets.gleam?.manifestFingerprint : undefined
	);
	const dLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'd');
	const dLspModuleUrl = $derived(dLspEnabled ? runtimeAssets.d?.moduleUrl : undefined);
	const dLspManifestUrl = $derived(dLspEnabled ? runtimeAssets.d?.manifestUrl : undefined);
	const dLspIntegrity = $derived(dLspEnabled ? runtimeAssets.d?.integrity : undefined);
	const lean4LspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'lean4');
	const lean4LspBaseUrl = $derived(
		lean4LspEnabled
			? runtimeAssets.lean4?.baseUrl || resolveApplicationAsset('wasm-lean4/')
			: undefined
	);
	const tclLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'tcl');
	const tclLspBaseUrl = $derived(tclLspEnabled ? runtimeAssets.tcl?.baseUrl : undefined);
	const tclLspWorkerUrl = $derived(tclLspEnabled ? runtimeAssets.tcl?.workerUrl : undefined);
	const pascalLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'pascal');
	const pascalLspRuntime = $derived(pascalLspEnabled ? runtimeAssets.pascal : undefined);
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
	const janetLspRuntime = $derived(janetLspEnabled ? runtimeAssets.janet : undefined);
	const lispLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'lisp');
	const lispLspModuleUrl = $derived(lispLspEnabled ? runtimeAssets.lisp?.moduleUrl : undefined);
	const lispLspManifestUrl = $derived(
		lispLspEnabled ? runtimeAssets.lisp?.manifestUrl : undefined
	);
	const lispLspManifestFingerprint = $derived(
		lispLspEnabled ? runtimeAssets.lisp?.manifestFingerprint : undefined
	);
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
	const haskellLspIntegrity = $derived(
		haskellLspEnabled ? runtimeAssets.haskell?.integrity : undefined
	);
	const fortranLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'fortran');
	const fortranLspAnalyzerUrl = $derived(
		fortranLspEnabled ? runtimeAssets.fortran?.analyzerUrl : undefined
	);
	const assemblyScriptLspModuleUrl = $derived(runtimeAssets.assemblyscript?.moduleUrl);
	const duckDbLspModuleUrl = $derived(runtimeAssets.duckdb?.moduleUrl);
	const bashLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'bash');
	const bashLspModuleUrl = $derived(
		bashLspEnabled
			? resolveApplicationAsset('wasm-bash-lsp/runtime.mjs', '5.8.1-browser-v1')
			: undefined
	);
	const bashLspFiles = $derived.by(() =>
		bashLspEnabled
			? Object.fromEntries(
					files
						.filter((file) => file.path !== activePath && !isBinaryWorkspaceFile(file))
						.map((file) => [file.path, file.content])
				)
			: undefined
	);
	const cobolLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'cobol');
	const cobolLspBaseUrl = $derived(
		cobolLspEnabled ? resolveApplicationAsset('wasm-cobol-lsp/') : undefined
	);
	const cobolLspWorkspaceFiles = $derived.by(() =>
		cobolLspEnabled
			? files
					.filter((file) => file.path !== activePath && !isBinaryWorkspaceFile(file))
					.map((file) => ({ path: file.path, content: file.content }))
			: undefined
	);
	const nimLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'nim');
	const nimLspBaseUrl = $derived(
		nimLspEnabled ? resolveApplicationAsset('wasm-nim-lsp/') : undefined
	);
	const nimLspWorkspaceFiles = $derived.by(() =>
		nimLspEnabled
			? files
					.filter((file) => file.path !== activePath && !isBinaryWorkspaceFile(file))
					.map((file) => ({ path: file.path, content: file.content }))
			: undefined
	);
	const sqlLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'sql');
	const sqlLspModuleUrl = $derived(sqlLspEnabled ? runtimeAssets.sqlite?.moduleUrl : undefined);
	const postgresqlLspEnabled = $derived(
		lspEnabled && activeRuntimeLspCapability === 'postgresql'
	);
	const postgresqlLspModuleUrl = $derived(
		postgresqlLspEnabled
			? resolveApplicationAsset('wasm-postgresql-lsp/dist/lsp.js', '0.28.2')
			: undefined
	);
	const prologLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'prolog');
	const prologLspBaseUrl = $derived(prologLspEnabled ? runtimeAssets.prolog?.baseUrl : undefined);
	const prologLspWorkerUrl = $derived(
		prologLspEnabled ? runtimeAssets.prolog?.workerUrl : undefined
	);
	const rubyLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'ruby');
	const rubyLspRuntime = $derived(rubyLspEnabled ? runtimeAssets.ruby : undefined);
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
	const perlLspRuntime = $derived(perlLspEnabled ? runtimeAssets.perl : undefined);
	const fennelLspBaseUrl = $derived(resolveApplicationAsset('wasm-fennel-lsp/'));
	const pythonLspBaseUrl = $derived(resolveApplicationAsset('pyodide/'));
	const grainLspBaseUrl = $derived(resolveApplicationAsset('wasm-grain-lsp/'));
	const grainLspWorkspaceFiles = $derived(
		files
			.filter((file) => file.path !== activePath && file.path.endsWith('.gr'))
			.map((file) => ({ path: file.path, content: file.content }))
	);
	const rescriptLspBaseUrl = $derived(resolveApplicationAsset('wasm-rescript-lsp/'));
	const rescriptLspWorkspaceFiles = $derived(
		files
			.filter(
				(file) =>
					file.path !== activePath &&
					(/\.resi?$/.test(file.path) || /(?:^|\/)rescript\.json$/.test(file.path))
			)
			.map((file) => ({ path: file.path, content: file.content }))
	);
	const typescriptLspLibUrl = $derived(
		lspEnabled && typescriptLspLanguages.has(language)
			? runtimeAssets.typescript?.libUrl
			: undefined
	);
	const compact = $derived(examplePaneWidth > 0 && examplePaneWidth <= 760);
	const activeFile = $derived(files.find((file) => file.path === activePath) ?? files[0]);
	const activeDebugSourcePath = $derived(
		`/workspace/${normalizePath(activePath) || defaultPathForLanguage()}`
	);
	const editorFilePaths = $derived(files.map((file) => file.path));
	const sortedFiles = $derived([...files].sort((a, b) => a.path.localeCompare(b.path)));
	const activeLines = $derived(activeFile ? activeFile.content.split(/\r\n|\r|\n/).length : 0);
	const activeBytes = $derived(activeFile ? new Blob([activeFile.content]).size : 0);
	const workspaceSaveKey = $derived(JSON.stringify(snapshot()));

	const loadingProgress = createLoadingProgressController({
		onChange(state) {
			progressVisible = state.visible;
			progress = state.value;
			progressStage = state.stage;
			progressIndeterminate = state.indeterminate;
		}
	});
	const executionObserver = createExecutionObserver();

	const debugLanguage = $derived(debugLanguageAdapters[language] ?? null);
	const selectedDebugMode = $derived(
		lldbDebugLanguages.has(language)
			? ('lldb' as const)
			: language === 'LUA'
				? ('mobdebug' as const)
				: language === 'RUBY'
					? ('tracepoint' as const)
					: ('trace' as const)
	);
	const debugTargetAvailable = $derived(
		language !== 'RUST' || rustTargetTriple === 'wasm32-wasip1'
	);
	const debugUnavailableReason = $derived(
		!sharedBufferAvailable
			? 'Debugging requires SharedArrayBuffer'
			: !debugTargetAvailable
				? 'Rust LLDB debugging currently supports wasm32-wasip1 only'
				: 'Debug'
	);
	let debugScopeOpen = $state<Record<string, boolean>>({});
	const debug = createDebugSessionController({
		syncBreakpointsWhile: () => runningMode === 'debug'
	});
	const debugHoverOptions = {
		resolve: (expression: string) => debug.resolveHover(expression),
		loadChildren: (reference: number, start: number, count: number) =>
			debug.loadVariableChildren(reference, start, count),
		onAddWatch: (expression: string) => {
			debug.addWatchExpression(expression);
		}
	};
	let debugInteractionError = $state('');
	let breakpointEditOpen = $state(false);
	let breakpointLine = $state(1);
	let breakpointEnabled = $state(true);
	let breakpointCondition = $state('');
	let breakpointHitCondition = $state('');
	let breakpointLogMessage = $state('');
	function editDebugBreakpoint(line: number) {
		const spec = debug.structuredBreakpoints.find((entry) => entry.line === line);
		breakpointLine = line;
		breakpointEnabled = spec?.enabled !== false;
		breakpointCondition = spec?.condition ?? '';
		breakpointHitCondition = spec?.hitCondition ?? '';
		breakpointLogMessage = spec?.logMessage ?? '';
		breakpointEditOpen = true;
	}
	async function saveDebugBreakpoint() {
		debugInteractionError = '';
		try {
			const next = debug.structuredBreakpoints.filter(
				(entry) => entry.line !== breakpointLine
			);
			next.push({
				line: breakpointLine,
				enabled: breakpointEnabled,
				...(breakpointCondition.trim() ? { condition: breakpointCondition.trim() } : {}),
				...(breakpointHitCondition.trim()
					? { hitCondition: breakpointHitCondition.trim() }
					: {}),
				...(breakpointLogMessage.trim() ? { logMessage: breakpointLogMessage.trim() } : {})
			});
			if (await debug.setStructuredBreakpoints(next)) breakpointEditOpen = false;
		} catch (error) {
			debugInteractionError = error instanceof Error ? error.message : String(error);
		}
	}
	let memoryReference = $state('0x0');
	let memoryOffsetInput = $state('0');
	let memoryCountInput = $state('4');
	let memoryResult = $state.raw<DebugMemoryView | null>(null);
	let memoryRows = $state.raw<DebugMemoryRow[]>([]);
	let memoryError = $state('');
	let memoryLoading = $state(false);
	let memoryRequestVersion = 0;
	let memoryWriteInput = $state('');
	let memoryWriteStatus = $state.raw<{
		bytesWritten: number;
		requestedBytes: number;
	} | null>(null);
	let dataBreakpointAccessType = $state<DebugDataBreakpointAccessType>('write');
	let activeDataBreakpoint = $state.raw<ActiveDebugDataBreakpoint | null>(null);
	let dataBreakpointError = $state('');
	let dataBreakpointLoading = $state(false);
	let dataBreakpointRequestVersion = 0;
	let dataBreakpointLoadingOwner: number | null = null;
	const debugStatusLabel = $derived(
		debug.paused
			? 'Paused'
			: activeDebugBackend === 'trace' && lldbDebugLanguages.has(language)
				? 'Trace fallback'
				: debug.active
					? 'Running'
					: 'Ready'
	);
	const debugStatusIcon = $derived(
		debug.paused ? 'pause_circle' : debug.active ? 'play_circle' : 'adjust'
	);
	const knownRustTargetTriples = ['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3'] as const;
	const knownGoTargets = ['wasip1/wasm', 'wasip2/wasm', 'wasip3/wasm', 'js/wasm'] as const;
	const debugTitle = $derived(
		activeDebugBackend === 'trace' && lldbDebugLanguages.has(language)
			? `${languageLabels[language] ?? language} · Trace fallback`
			: (debugTitles[language] ?? 'Pyodide Trace')
	);
	const loading = $derived(progressVisible);
	const progressValue = $derived(progress > 1 ? 1 : progress);
	const progressPercent = $derived(Math.round(progressValue * 100));
	const progressLabel = $derived(
		progressStage || (runningMode === 'debug' ? 'Preparing debug session' : 'Loading runtime')
	);
	const panelResizerWidth = 12;
	const terminalFont =
		"'JetBrains Mono', 'D2 coding', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
	const desktopExampleLayout = $derived(examplePaneWidth > 960);
	const resizablePaneWidth = $derived(
		desktopExampleLayout ? Math.max(0, splitPaneWidth - panelResizerWidth) : examplePaneWidth
	);
	const minTerminalPaneWidth = $derived(
		desktopExampleLayout
			? Math.min(420, Math.max(300, Math.floor(resizablePaneWidth * 0.28)))
			: 0
	);
	const maxTerminalPaneWidth = $derived(
		desktopExampleLayout
			? Math.max(minTerminalPaneWidth, resizablePaneWidth - minTerminalPaneWidth)
			: resizablePaneWidth
	);
	const terminalPanePixelWidth = $derived.by(() => {
		if (!desktopExampleLayout || !resizablePaneWidth) return null;
		const fallbackWidth = Math.round(resizablePaneWidth * 0.42);
		const requestedWidth = terminalPaneWidth ?? fallbackWidth;
		return Math.min(Math.max(requestedWidth, minTerminalPaneWidth), maxTerminalPaneWidth);
	});
	// Keep the explorer open by default only when the editor and console still have room beside it.
	let lastRoomyLayout: boolean | null = null;
	$effect(() => {
		if (!examplePaneWidth) return;
		const roomy = examplePaneWidth > 1200;
		if (roomy === lastRoomyLayout) return;
		lastRoomyLayout = roomy;
		sidebarOpen = roomy;
	});
	let availableRustTargetTriples = $state<RustTargetTriple[]>(['wasm32-wasip1', 'wasm32-wasip2']);
	let availableGoTargets = $state<GoTarget[]>(['wasip1/wasm']);
	type WasmIdleDebugApi = {
		writeTerminalInput: (text: string, eof?: boolean) => Promise<void>;
		getEditorValue: () => string;
		setEditorValue: (text: string) => Promise<boolean>;
		setWorkspaceFiles: (files: WorkspaceFile[], activePath?: string) => Promise<boolean>;
		setBreakpoints: (lines: number[]) => void;
		getDebugState: () => {
			paused: boolean;
			pausedLine: number | null;
			sourcePath: string;
			pausedSourcePath: string | null;
			sourceRevisionStale: boolean;
			frameId: number | null;
			callStack: DebugFrame[];
			scopes: DebugScope[];
			variablesByReference: Array<[number, DebugVariable[]]>;
		};
		selectDebugFrame: (frameId: number) => Promise<boolean>;
		loadDebugVariables: (
			variablesReference: number,
			start?: number,
			count?: number
		) => Promise<DebugVariable[]>;
		readDebugMemory: (
			memoryReference: string,
			offset: number,
			count: number
		) => Promise<{
			address?: string;
			data: number[];
			unreadableBytes: number;
		} | null>;
		setPreloadedStdin: (text: string) => void;
	};
	type WasmIdleDebugTestApi = WasmIdleDebugApi & {
		getExecutionState: () => ExecutionObservation;
		getBuildIdentity: () => typeof __WASM_IDLE_BUILD__ & { serviceWorkerUrl: string | null };
		writeDebugMemory: (
			memoryReference: string,
			offset: number,
			data: number[],
			allowPartial?: boolean
		) => Promise<{ offset?: number; bytesWritten: number } | null>;
		dataBreakpointInfo: (
			arguments_: DebugDataBreakpointInfoArguments
		) => Promise<DebugDataBreakpointInfo | null>;
		setDataBreakpoints: (
			breakpoints: DebugDataBreakpoint[]
		) => Promise<DebugResolvedDataBreakpoint[]>;
	};
	let browserDebugHookVersion = 0;
	function cloneFiles(value: WorkspaceFile[]) {
		return value.map((file) => ({ ...file }));
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
		try {
			return normalizeWorkspacePath(value);
		} catch {
			// Debug/source lookups can refer outside the user workspace.
			return '';
		}
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
		if ((ext === '.m' || ext === '.h') && language === 'OBJC') return 'OBJC';
		if ((ext === '.lisp' || ext === '.lsp') && language === 'COMMONLISP') return 'COMMONLISP';
		if ((ext === '.mm' || ext === '.h') && language === 'OBJECTIVECXX') return 'OBJECTIVECXX';
		if (ext === '.m' && language === 'OBJECTIVECXX') return 'OBJC';
		const match: Record<string, PlaygroundLanguage> = {
			'.ws': 'WHITESPACE',
			'.mal': 'MALBOLGE',
			'.aheui': 'AHEUI',
			'.um': 'UHMLANG',
			'.umm': 'UHMLANG',
			'.lol': 'LOLCODE',
			'.ape': 'APECODE',
			'.gs': 'GOLFSCRIPT',
			'.bf': 'BRAINFUCK',
			'.b93': 'BEFUNGE93',
			'.c': 'C',
			'.cc': 'CPP',
			'.cpp': 'CPP',
			'.cxx': 'CPP',
			'.objc': 'OBJC',
			'.mm': 'OBJECTIVECXX',
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
			'.gr': 'GRAIN',
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
			'.c3': 'C3',
			'.lean': 'LEAN4',
			'.nim': 'NIM',
			'.nims': 'NIM',
			'.sh': 'BASH',
			'.bash': 'BASH',
			'.cljs': 'CLOJURESCRIPT',
			'.hy': 'HY',
			'.cljc': 'CLOJURESCRIPT',
			'.res': 'RESCRIPT',
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
			'.fnl': 'FENNEL',
			'.zig': 'ZIG',
			'.scm': 'LISP',
			'.ss': 'LISP',
			'.sls': 'LISP',
			'.lisp': 'LISP',
			'.lsp': 'LISP',
			'.cl': 'COMMONLISP',
			'.rb': 'RUBY',
			'.hs': 'HASKELL',
			'.lhs': 'HASKELL',
			'.r': 'R',
			'.m': 'OCTAVE',
			'.f': 'FORTRAN',
			'.f90': 'FORTRAN',
			'.f95': 'FORTRAN',
			'.for': 'FORTRAN',
			'.cob': 'COBOL',
			'.cbl': 'COBOL',
			'.cpy': 'COBOL',
			'.v': 'V',
			'.graphql': 'GRAPHQL',
			'.gql': 'GRAPHQL',
			'.duckdb': 'DUCKDB',
			'.sql': 'SQLITE',
			'.sqlite': 'SQLITE',
			'.pgsql': 'POSTGRESQL',
			'.psql': 'POSTGRESQL',
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
			OBJC: 'main.m',
			OBJECTIVECXX: 'main.mm',
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
			GRAIN: 'main.gr',
			PERL: 'main.pl',
			TCL: 'main.tcl',
			AWK: 'main.awk',
			PASCAL: 'main.pas',
			FORTH: 'main.fth',
			J: 'main.ijs',
			BQN: 'main.bqn',
			JANET: 'main.janet',
			JULIA: 'main.jl',
			C3: 'main.c3',
			NIM: 'main.nim',
			BASH: 'main.sh',
			CLOJURESCRIPT: 'main.cljs',
			RESCRIPT: 'Main.res',
			HY: 'main.hy',
			TINYGO: 'main.go',
			OCAML: 'main.ml',
			JAVASCRIPT: 'main.js',
			TYPESCRIPT: 'main.ts',
			ASSEMBLYSCRIPT: 'main.as.ts',
			WAT: 'main.wat',
			WASM: 'main.wasm',
			WHITESPACE: 'main.ws',
			MALBOLGE: 'main.mal',
			AHEUI: 'main.aheui',
			UHMLANG: 'main.um',
			LOLCODE: 'main.lol',
			APECODE: 'main.ape',
			GOLFSCRIPT: 'main.gs',
			BRAINFUCK: 'main.bf',
			BEFUNGE93: 'main.b93',
			LUA: 'main.lua',
			FENNEL: 'main.fnl',
			ZIG: 'main.zig',
			LISP: 'main.scm',
			COMMONLISP: 'main.lisp',
			RUBY: 'main.rb',
			HASKELL: 'main.hs',
			R: 'main.R',
			OCTAVE: 'main.m',
			LFORTRAN: 'main.f90',
			LEAN4: 'Main.lean',
			FORTRAN: 'main.f',
			COBOL: 'main.cob',
			V: 'main.v',
			GRAPHQL: 'main.graphql',
			DUCKDB: 'main.duckdb',
			SQLITE: 'main.sql',
			POSTGRESQL: 'main.sql',
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
			OBJC: 'objectivec',
			OBJECTIVECXX: 'objectivecxx',
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
			GRAIN: 'grain',
			PERL: 'perl',
			TCL: 'tcl',
			AWK: 'awk',
			PASCAL: 'pascal',
			FORTH: 'forth',
			J: 'j',
			BQN: 'bqn',
			JANET: 'janet',
			JULIA: 'julia',
			C3: 'c3',
			NIM: 'nim',
			BASH: 'bash',
			CLOJURESCRIPT: 'clojurescript',
			RESCRIPT: 'rescript',
			HY: 'hy',
			TINYGO: 'go',
			OCAML: 'ocaml',
			JAVASCRIPT: 'javascript',
			TYPESCRIPT: 'typescript',
			ASSEMBLYSCRIPT: 'assemblyscript',
			WAT: 'wat',
			WASM: 'wasm',
			WHITESPACE: 'whitespace',
			MALBOLGE: 'malbolge',
			AHEUI: 'aheui',
			UHMLANG: 'uhmlang',
			LOLCODE: 'lolcode',
			APECODE: 'apecode',
			GOLFSCRIPT: 'golfscript',
			BRAINFUCK: 'brainfuck',
			BEFUNGE93: 'befunge93',
			LUA: 'lua',
			FENNEL: 'fennel',
			ZIG: 'zig',
			LISP: 'lisp',
			COMMONLISP: 'commonlisp',
			RUBY: 'ruby',
			HASKELL: 'haskell',
			R: 'r',
			OCTAVE: 'octave',
			LFORTRAN: 'lfortran',
			LEAN4: 'lean4',
			FORTRAN: 'fortran',
			COBOL: 'cobol',
			V: 'v',
			GRAPHQL: 'graphql',
			DUCKDB: 'duckdb',
			SQLITE: 'sqlite',
			POSTGRESQL: 'postgresql',
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

	function sanitizeWorkspace(
		value: Partial<LanguageWorkspace> | undefined,
		nextLanguage: PlaygroundLanguage,
		snapshotVersion?: number
	): LanguageWorkspace {
		const fallback = createDefaultWorkspace(nextLanguage);
		const nextFiles = sanitizeFiles(value?.files);
		const files = (nextFiles.length ? nextFiles : fallback.files).map((file) =>
			migrateLegacyWorkspaceFile(file, {
				version: snapshotVersion,
				language: nextLanguage,
				entryPath: defaultPathForLanguage(nextLanguage),
				defaultSource: defaultSourceForLanguage(nextLanguage)
			})
		);
		const requestedActivePath =
			typeof value?.activePath === 'string' ? normalizePath(value.activePath) : '';
		const activePath = files.some((file) => file.path === requestedActivePath)
			? requestedActivePath
			: files[0].path;
		const openTabs = normalizeWorkspaceTabs(value?.openTabs, files, activePath);
		return {
			activePath,
			files,
			openTabs
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

	let containerWorkspaceConflict = '';
	let containerRefresh: Promise<void> | undefined;
	let containerRefreshPending = false;
	let containerRefreshForcePending = false;
	let containerEditorRefreshDeferred = $state(false);
	let sharedWorkspaceFiles = $state<ContainerWorkspaceEntry[]>([]);
	let shellDirectoryPending = $state(false);
	let shellDirectoryGeneration = 0;
	let sharedWorkspaceOpening = $state(false);
	const containerFiles = (values: readonly WorkspaceFile[]) =>
		values.map((file) => ({ path: file.path, content: workspaceFileBytes(file) }));
	const editorFiles = (values: readonly { path: string; content: string | Uint8Array }[]) =>
		values.map((file) =>
			workspaceFileFromBytes(
				file.path,
				typeof file.content === 'string'
					? new TextEncoder().encode(file.content)
					: file.content
			)
		);
	async function publishContainerWorkspace(
		selectedLanguage: string,
		values: readonly WorkspaceFile[]
	) {
		if (containerWorkspaceConflict === selectedLanguage)
			throw new Error(
				'An editor buffer conflicts with terminal edits. Refresh files to resolve it.'
			);
		await playground.syncWorkspace(selectedLanguage, containerFiles(values));
	}
	async function refreshContainerWorkspace(force = false) {
		if (!browser || !workspaceInitialized) return;
		if (containerRefresh) {
			containerRefreshPending = true;
			containerRefreshForcePending ||= force;
			return containerRefresh;
		}
		const binding = playground,
			selectedLanguage = language;
		containerRefresh = (async () => {
			const metadata = await binding.listWorkspaceFiles();
			if (playground !== binding) return;
			sharedWorkspaceFiles = metadata.sort((a, b) => a.path.localeCompare(b.path));
			if (runningMode) {
				containerEditorRefreshDeferred = true;
				return;
			}
			const before = editorFiles(binding.publishedWorkspace(selectedLanguage));
			const remote = await binding.readWorkspace(selectedLanguage);
			if (playground !== binding) return;
			if (runningMode || language !== selectedLanguage) {
				containerEditorRefreshDeferred = true;
				return;
			}
			containerEditorRefreshDeferred = false;
			const remoteFiles = editorFiles(remote);
			const result = mergeContainerWorkspace(files, before, remoteFiles);
			if (
				result.conflicts.length &&
				(!force ||
					!confirm(
						`Replace editor buffers changed in both the editor and terminal? ${result.conflicts.join(', ')}`
					))
			) {
				containerWorkspaceConflict = selectedLanguage;
				saveStatus = `Editor buffer preserved: terminal also changed ${result.conflicts.join(', ')}. Refresh files to resolve.`;
				return;
			}
			containerWorkspaceConflict = '';
			const nextFiles = result.conflicts.length
				? mergeContainerWorkspace(files, before, remoteFiles, {
						acceptRemoteConflicts: true
					}).files
				: result.files;
			binding.acceptWorkspace(selectedLanguage, remote);
			if (
				files.length === nextFiles.length &&
				files.every((file, index) => {
					const next = nextFiles[index];
					return (
						file.path === next.path &&
						file.content === next.content &&
						(file.encoding ?? 'utf-8') === (next.encoding ?? 'utf-8')
					);
				})
			)
				return;
			const activeBefore = activeFile?.content;
			files = nextFiles;
			openTabs = openTabs.filter((path) => files.some((file) => file.path === path));
			if (!files.some((file) => file.path === activePath)) activePath = files[0]?.path ?? '';
			if (activePath && !openTabs.includes(activePath)) openTabs = [...openTabs, activePath];
			if (debug.active && activeBefore !== activeFile?.content)
				debug.markSourceRevisionStale(`/workspace/${activePath}`);
			saveStatus = 'Workspace updated from terminal';
		})();
		try {
			await containerRefresh;
		} finally {
			containerRefresh = undefined;
			if (containerRefreshPending) {
				const queuedForce = containerRefreshForcePending;
				containerRefreshPending = false;
				containerRefreshForcePending = false;
				void refreshContainerWorkspace(queuedForce).catch((error) => {
					saveStatus = `Workspace refresh failed: ${error instanceof Error ? error.message : String(error)}`;
				});
			}
		}
	}
	function sharedFileProject(entry: ContainerWorkspaceEntry) {
		if (entry.type !== 'file') return null;
		const [project, ...parts] = entry.path.split('/');
		if (!parts.length || !playgroundLanguages.includes(project as PlaygroundLanguage))
			return null;
		return { language: project as PlaygroundLanguage, path: parts.join('/') };
	}
	async function selectSharedWorkspaceFile(entry: ContainerWorkspaceEntry) {
		const target = sharedFileProject(entry);
		if (!target || runningMode || sharedWorkspaceOpening) return;
		const binding = playground,
			previousLanguage = language;
		sharedWorkspaceOpening = true;
		try {
			// Read before switching: the language-change publisher must not overwrite a
			// terminal-created file with the target project's older editor snapshot.
			const remote = await binding.readWorkspace(target.language);
			if (playground !== binding || language !== previousLanguage || runningMode) return;
			const remoteFiles = editorFiles(remote);
			if (!remoteFiles.some((file) => file.path === target.path)) {
				saveStatus = `/workspace/${entry.path} is no longer available`;
				await refreshContainerWorkspace();
				return;
			}
			const previousWorkspace =
				target.language === language
					? currentWorkspace()
					: (languageWorkspaces[target.language] ??
						createDefaultWorkspace(target.language));
			const baseline = editorFiles(binding.publishedWorkspace(target.language));
			const merged = mergeContainerWorkspace(previousWorkspace.files, baseline, remoteFiles);
			if (
				merged.conflicts.length &&
				!confirm(
					`Replace editor buffers changed in both the editor and terminal? ${merged.conflicts.join(', ')}`
				)
			)
				return;
			const nextFiles = merged.conflicts.length
				? mergeContainerWorkspace(previousWorkspace.files, baseline, remoteFiles, {
						acceptRemoteConflicts: true
					}).files
				: merged.files;
			binding.acceptWorkspace(target.language, remote);
			if (language !== target.language) switchLanguage(target.language);
			activateWorkspace({ ...previousWorkspace, files: nextFiles, activePath: target.path });
			selectFile(target.path);
			containerWorkspaceConflict = '';
			saveStatus = `Opened /workspace/${entry.path}`;
		} catch (error) {
			saveStatus = `Could not open shared file: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			sharedWorkspaceOpening = false;
		}
	}

	function activateWorkspace(workspace: LanguageWorkspace) {
		const nextWorkspace = sanitizeWorkspace(workspace, language);
		files = cloneFiles(nextWorkspace.files);
		activePath = nextWorkspace.activePath;
		openTabs = [...nextWorkspace.openTabs];
		compilerDiagnostics = [];
		compilerDiagnosticRun = null;
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
		// Initial storage/share restoration owns the workspace until it completes, and a run or
		// debug session owns it until it settles.
		if (!workspaceInitialized || runningMode) return;
		const nextLanguage = normalizeRequestedLanguage(
			(event.currentTarget as HTMLSelectElement).value
		);
		if (nextLanguage) switchLanguage(nextLanguage);
	}

	const compactSearchText = (text: string) => text.toLowerCase().replace(/[^a-z0-9#+]/g, '');
	const filteredLanguages = $derived.by(() => {
		const query = compactSearchText(languageQuery);
		if (!query) return playgroundLanguages;
		const matches = playgroundLanguages
			.map((option) => {
				const label = compactSearchText(languageLabels[option]);
				const id = compactSearchText(option);
				const rank = label.startsWith(query) || id.startsWith(query) ? 0 : 1;
				return label.includes(query) || id.includes(query) ? { option, rank } : null;
			})
			.filter((match) => match !== null);
		return matches.sort((left, right) => left.rank - right.rank).map((match) => match.option);
	});

	function openLanguageMenu() {
		if (!workspaceInitialized || runningMode) return;
		languageQuery = '';
		languageHighlight = Math.max(0, playgroundLanguages.indexOf(language));
		languageMenuOpen = true;
	}

	function closeLanguageMenu(restoreFocus = false) {
		languageMenuOpen = false;
		if (restoreFocus) languageTrigger?.focus();
	}

	function chooseLanguage(nextLanguage: PlaygroundLanguage) {
		closeLanguageMenu(true);
		if (workspaceInitialized && !runningMode) switchLanguage(nextLanguage);
	}

	function handleLanguageSearchKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			closeLanguageMenu(true);
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!filteredLanguages.length) return;
			const step = event.key === 'ArrowDown' ? 1 : -1;
			languageHighlight =
				(languageHighlight + step + filteredLanguages.length) % filteredLanguages.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const highlighted = filteredLanguages[languageHighlight];
			if (highlighted) chooseLanguage(highlighted);
		}
	}

	$effect(() => {
		if (!languageMenuOpen) return;
		languageSearchInput?.focus();
		languageMenuList
			?.querySelector(`[data-index="${languageHighlight}"]`)
			?.scrollIntoView({ block: 'nearest' });
	});

	function uniquePath(requestedPath: string) {
		const safePath = normalizeWorkspacePath(requestedPath) || 'untitled.txt';
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
			const safePath = normalizeWorkspacePath(file.path);
			if (!safePath) throw new Error('Workspace file path cannot be empty');
			if (seen.includes(safePath)) throw new Error(`Duplicate workspace path: ${safePath}`);
			seen.push(safePath);
			nextFiles.push({
				path: safePath,
				content: file.content,
				...(isBinaryWorkspaceFile(file)
					? { encoding: 'data-url' as const }
					: file.encoding === 'utf-8'
						? { encoding: 'utf-8' as const }
						: {})
			});
		}
		return nextFiles;
	}

	function updateActiveContent(value: string) {
		const file = activeFile;
		if (!file || file.content === value) return;
		file.content = value;
		if (debug.active) {
			debug.markSourceRevisionStale(`/workspace/${file.path}`);
		}
		saveStatus = 'Saving...';
	}

	function selectFile(filePath: string) {
		if (!files.some((file) => file.path === filePath)) return;
		activePath = filePath;
		if (!openTabs.includes(filePath)) openTabs = [...openTabs, filePath];
		// Below the desktop breakpoint the explorer overlays the editor (see the 960px media query).
		if (!desktopExampleLayout) sidebarOpen = false;
	}

	function addWorkspaceFile(
		filePath: string,
		content = '',
		select = true,
		encoding?: WorkspaceFile['encoding']
	) {
		const nextPath = uniquePath(filePath);
		files = [...files, { path: nextPath, content, encoding }];
		if (select) selectFile(nextPath);
		saveStatus = `${basename(nextPath)} added`;
		return nextPath;
	}

	function newFile() {
		const requested = prompt('File name', defaultPathForLanguage());
		if (!requested) return;
		const nextLanguage = languageForPath(requested) || language;
		try {
			addWorkspaceFile(requested, defaultSourceForLanguage(nextLanguage));
		} catch (error) {
			saveStatus = error instanceof Error ? error.message : String(error);
		}
	}

	function renameActiveFile() {
		const file = activeFile;
		if (!file || runningMode) return;
		const requested = prompt('Rename file', file.path);
		if (!requested) return;
		let nextPath: string;
		try {
			nextPath = normalizeWorkspacePath(requested);
		} catch (error) {
			saveStatus = error instanceof Error ? error.message : String(error);
			return;
		}
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
		addWorkspaceFile(file.path, file.content, true, file.encoding);
	}

	function deleteActiveFile() {
		const file = activeFile;
		if (!file || runningMode) return;
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

	const parsedArgs = $derived.by(() => {
		try {
			return { args: parseArgs(argsInput), error: null };
		} catch (error) {
			return { args: null, error: error instanceof Error ? error.message : String(error) };
		}
	});

	function encodeBase64Url(value: string) {
		const bytes = new TextEncoder().encode(value);
		let binary = '';
		for (let index = 0; index < bytes.length; index += 0x8000) {
			binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
		}
		return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
	}

	function snapshot(): WorkspaceSnapshot {
		return {
			activePath,
			argsInput,
			compilerOptions: Object.fromEntries(
				Object.entries(compilerOptions).map(([key, value]) => [key, { ...value }])
			),
			cppVersion,
			files: files.map((file) => ({ ...file })),
			goTarget,
			language,
			log,
			lspEnabled,
			ocamlBackend,
			ocamlWasmBinaryenMode,
			openTabs: openTabs.filter((tab) => files.some((file) => file.path === tab)),
			rustTargetTriple,
			rustOptimizationProfile,
			sidebarOpen,
			version: 6,
			workspaces: workspaceMapForSnapshot()
		};
	}

	function applySnapshot(input: unknown, message = 'Workspace restored') {
		validateWorkspaceSnapshot(input);
		const value = input as Partial<WorkspaceSnapshot>;
		const nextLanguage =
			normalizeRequestedLanguage(
				typeof value?.language === 'string' ? value.language : null
			) ??
			languageForPath(typeof value?.activePath === 'string' ? value.activePath : '') ??
			'CPP';
		const nextWorkspaces = createDefaultLanguageWorkspaces();
		for (const nextLanguageKey of playgroundLanguages) {
			const workspace = value?.workspaces?.[nextLanguageKey];
			nextWorkspaces[nextLanguageKey] = sanitizeWorkspace(
				workspace,
				nextLanguageKey,
				value?.version
			);
		}
		if (!value?.workspaces) {
			nextWorkspaces[nextLanguage] = sanitizeWorkspace(
				{
					activePath: value?.activePath,
					files: value?.files,
					openTabs: value?.openTabs
				},
				nextLanguage,
				value?.version
			);
		}
		editorWorkspaceRevision += 1;
		languageWorkspaces = nextWorkspaces;
		language = nextLanguage;
		activateWorkspace(nextWorkspaces[nextLanguage]);
		const restoredCompilerOptions = restoreCompilerOptions(
			value.compilerOptions,
			nextLanguage,
			typeof value.argsInput === 'string' ? value.argsInput : ''
		);
		compilerOptions = restoredCompilerOptions.compilerOptions;
		argsInput = restoredCompilerOptions.argsInput;
		if (knownCppVersions.includes(value?.cppVersion as CppVersion))
			cppVersion = value?.cppVersion as CppVersion;
		if (typeof value?.log === 'boolean') log = value.log;
		if (typeof value?.lspEnabled === 'boolean') lspEnabled = value.lspEnabled;
		if (
			value?.rustTargetTriple === 'wasm32-wasip1' ||
			value?.rustTargetTriple === 'wasm32-wasip2' ||
			value?.rustTargetTriple === 'wasm32-wasip3'
		)
			rustTargetTriple = value.rustTargetTriple;
		if (
			value?.rustOptimizationProfile === 'interactive' ||
			value?.rustOptimizationProfile === 'speed' ||
			value?.rustOptimizationProfile === 'size'
		)
			rustOptimizationProfile = value.rustOptimizationProfile;
		if (
			value?.goTarget === 'wasip1/wasm' ||
			value?.goTarget === 'wasip2/wasm' ||
			value?.goTarget === 'wasip3/wasm' ||
			value?.goTarget === 'js/wasm'
		)
			goTarget = value.goTarget;
		if (value?.ocamlBackend === 'js' || value?.ocamlBackend === 'wasm')
			ocamlBackend = value.ocamlBackend;
		if (value?.ocamlWasmBinaryenMode === 'fast' || value?.ocamlWasmBinaryenMode === 'full')
			ocamlWasmBinaryenMode = value.ocamlWasmBinaryenMode;
		sidebarOpen = value?.sidebarOpen ?? desktopExampleLayout;
		saveStatus = message;
	}

	async function saveWorkspace(showStatus = false) {
		if (!browser || !workspaceEditorInitialized || unrestoredWorkspace !== null) return false;
		const saved = await workspaceStorage.save(workspaceSaveKey, currentWorkspaceStorageKey);
		if (saved && showStatus) saveStatus = 'Saved locally';
		return saved;
	}

	async function saveWorkspaceCopy() {
		if (runningMode) return;
		const copyUrl = createSharedWorkspaceUrl(new URL(location.href));
		currentWorkspaceStorageKey = workspaceStorageKey(copyUrl);
		replaceState(copyUrl, page.state);
		await saveWorkspace(true);
	}

	function handleWorkspaceStorageChange(event: StorageEvent) {
		if (event.key === null || event.key === currentWorkspaceStorageKey)
			workspaceStorage.checkExternalChanges(currentWorkspaceStorageKey);
	}

	function downloadWorkspaceBackup() {
		downloadBlob(
			new Blob([serializeWorkspaceBackup(snapshot())], { type: 'application/json' }),
			'wasm-idle-workspace.json'
		);
		saveStatus = 'Workspace backup downloaded';
	}

	function downloadUnrestoredWorkspace() {
		if (unrestoredWorkspace === null) return;
		downloadBlob(
			new Blob([unrestoredWorkspace], { type: 'application/json' }),
			'wasm-idle-recovery.json'
		);
		recoveryBackupDownloaded = true;
	}

	function startNewWorkspaceAfterRecovery() {
		if (unrestoredWorkspace === null) return;
		if (!workspaceRecoveryKey && !recoveryBackupDownloaded) {
			workspaceRecoveryKey = preserveUnrestoredWorkspace(
				(key, value) => localStorage.setItem(key, value),
				currentWorkspaceStorageKey,
				unrestoredWorkspace
			);
			if (!workspaceRecoveryKey) {
				saveStatus = 'Download the original snapshot before starting a new workspace';
				return;
			}
		}
		unrestoredWorkspace = null;
		saveWorkspace(true);
	}

	function warnUnsavedChanges(event: BeforeUnloadEvent) {
		if (!workspaceEditorInitialized) return;
		workspaceStorage.observe(workspaceSaveKey, currentWorkspaceStorageKey);
		workspaceStorage.checkExternalChanges(currentWorkspaceStorageKey);
		const state = workspaceStorage.getState();
		if (state.phase === 'saved' && state.revision === state.savedRevision) return;
		// An asynchronous cross-tab lock cannot finish reliably during unload.
		// Keep the tab open until saving finishes, or let the user export its edits.
		void saveWorkspace();
		event.preventDefault();
		event.returnValue = '';
	}

	async function shareWorkspace() {
		if (!browser) return;
		saveWorkspace();
		const shareHash = `${SHARE_PREFIX}${encodeBase64Url(JSON.stringify(snapshot()))}`;
		const url = new SvelteURL(location.href);
		url.hash = shareHash;
		url.searchParams.delete('workspace');
		if (await copyWorkspaceShare(url.toString(), navigator.clipboard)) {
			manualShareUrl = '';
			saveStatus =
				url.toString().length > 60000 ? 'Share URL copied, but large' : 'Share URL copied';
		} else {
			manualShareUrl = url.toString();
			saveStatus = 'Select and copy the share URL below';
		}
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
		downloadBlob(workspaceFileBlob(file), basename(file.path));
		saveStatus = `${basename(file.path)} downloaded`;
	}

	async function compileActivePythonFile() {
		const file = activeFile;
		if (
			!workspaceEditorReady ||
			runningMode ||
			language !== 'PYTHON' ||
			!file ||
			isBinaryWorkspaceFile(file) ||
			extension(file.path) !== '.py'
		)
			return;
		if (pythonCompileOptionError) {
			saveStatus = pythonCompileOptionError;
			return;
		}
		// Keep the source, filename, and options paired if the editor changes during compilation.
		const fileName = file.path;
		const source = file.content;
		const invalidationMode = pythonInvalidationMode;
		const timestamp = pythonTimestamp;
		const controller = new AbortController();
		pythonCompileAbortController = controller;
		runningMode = 'compile';
		saveStatus = `Compiling ${basename(fileName)}…`;
		try {
			const result = await compilePython(source, {
				fileName,
				invalidationMode,
				...(invalidationMode === 'timestamp' ? { timestamp } : {}),
				runtimeAssets,
				signal: controller.signal,
				progress: loadingProgress.start('Loading Python compiler')
			});
			if (controller.signal.aborted || pythonCompileAbortController !== controller) return;
			downloadBlob(
				new Blob([Uint8Array.from(result.data)], { type: 'application/x-python-code' }),
				basename(result.path)
			);
			saveStatus = `${basename(result.path)} downloaded (Python ${result.pythonVersion})`;
		} catch (error) {
			if (pythonCompileAbortController !== controller) return;
			saveStatus = controller.signal.aborted
				? 'Python compilation cancelled'
				: `Python compilation failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			if (pythonCompileAbortController === controller) {
				pythonCompileAbortController = undefined;
				runningMode = null;
				loadingProgress.reset();
			}
		}
	}

	async function runWorkspaceArchive(
		request: WorkspaceArchiveRequest,
		transfer: Transferable[] = []
	) {
		const { default: WorkspaceArchiveWorker } =
			await import('./workspaceArchive.worker?worker');
		const worker = new WorkspaceArchiveWorker();
		return await requestWorkspaceArchive(worker, request, transfer);
	}

	async function downloadZip() {
		const response = await runWorkspaceArchive({
			type: 'create',
			files: files.map((file) => ({ ...file }))
		});
		if (response.type !== 'created') throw new Error('ZIP worker returned an invalid response');
		downloadBlob(
			new Blob([response.archive], { type: 'application/zip' }),
			'wasm-idle-workspace.zip'
		);
		saveStatus = 'ZIP downloaded';
	}

	async function extractImportedZip(archive: Uint8Array) {
		const archiveBuffer = archive.slice().buffer;
		const response = await runWorkspaceArchive({ type: 'extract', archive: archiveBuffer }, [
			archiveBuffer
		]);
		if (response.type !== 'extracted')
			throw new Error('ZIP worker returned an invalid response');
		return response.files;
	}

	async function openImportedZipWorkspace(
		importedFiles: WorkspaceFile[],
		destination: ReturnType<typeof captureWorkspaceImportDestination>
	) {
		if (!importedFiles.length) throw new Error('ZIP archive contains no files');
		const nextActivePath = importedFiles.some((file) => file.path === activePath)
			? activePath
			: importedFiles[0].path;
		if (!(await saveWorkspace()))
			throw new Error('Save the current workspace before opening a ZIP');
		destination.assertCurrent();
		const importedUrl = createSharedWorkspaceUrl(new URL(location.href));
		currentWorkspaceStorageKey = workspaceStorageKey(importedUrl);
		const importedWorkspace = {
			files: cloneFiles(importedFiles),
			activePath: nextActivePath,
			openTabs: [nextActivePath]
		};
		languageWorkspaces = { ...languageWorkspaces, [language]: importedWorkspace };
		activateWorkspace(importedWorkspace);
		destination.advance();
		await replaceState(importedUrl, page.state);
		destination.assertCurrent();
		return importedFiles.map((file) => file.path);
	}

	async function importFiles(fileList: File[]) {
		if (runningMode) {
			saveStatus = 'Stop the running program before importing files';
			return;
		}
		const destination = captureWorkspaceImportDestination(() => ({
			language,
			files,
			running: !!runningMode
		}));
		try {
			const plan = await stageWorkspaceImport(fileList, {
				extractZip: extractImportedZip,
				assertDestination: destination.assertCurrent
			});
			destination.assertCurrent();
			// A run or debug session that started while the import was staged owns the workspace.
			if (runningMode) {
				saveStatus = 'Stop the running program before importing files';
				return;
			}
			let imported: string[] = [];
			if (plan.kind === 'backup') {
				applySnapshot(plan.backup, 'Workspace backup restored');
				return;
			} else if (plan.fromZip) {
				imported = await openImportedZipWorkspace(plan.files, destination);
			} else {
				imported = plan.files.map((file) =>
					addWorkspaceFile(file.path, file.content, false, file.encoding)
				);
			}
			if (imported[0]) selectFile(imported[0]);
			saveStatus = `${imported.length} file${imported.length === 1 ? '' : 's'} imported`;
		} catch (error) {
			if (!(error instanceof WorkspaceImportCancelled)) throw error;
			saveStatus = error.message;
		}
	}

	async function handleUpload(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		if (!input.files?.length) return;
		try {
			await importFiles([...input.files]);
		} catch (error) {
			saveStatus = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			input.value = '';
		}
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
		try {
			await importFiles([...event.dataTransfer.files]);
		} catch (error) {
			saveStatus = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	function resetWorkspace() {
		if (runningMode) return;
		if (!confirm(`Reset ${languageLabels[language]} workspace?`)) return;
		const nextWorkspace = createDefaultWorkspace(language);
		editorWorkspaceRevision += 1;
		languageWorkspaces = {
			...languageWorkspaces,
			[language]: cloneWorkspace(nextWorkspace)
		};
		activateWorkspace(nextWorkspace);
		saveStatus = `${languageLabels[language]} workspace reset`;
		saveWorkspace();
	}

	async function restartRuntime() {
		if (!terminal || runningMode || !executionAvailable) return;
		await terminal.restartRuntime();
		saveStatus = `${languageLabels[language]} runtime restarted`;
	}

	function completeExecutionGeneration(generation: number) {
		if (executionGeneration !== generation) return;
		loadingProgress.reset();
		runningMode = null;
		activeExecution = null;
		if (!debug.paused) debug.reset();
	}

	async function settleExecutionTeardown(
		stoppedMode: 'run' | 'debug',
		previousExecution: Promise<void> | null
	) {
		const [stopResult, executionResult] = await Promise.allSettled([
			(async () => {
				if (stoppedMode === 'debug') {
					await debug.stop();
					return;
				}
				await terminal?.stop?.();
			})(),
			previousExecution ?? Promise.resolve()
		]);
		if (stopResult.status === 'rejected') throw stopResult.reason;
		if (executionResult.status === 'rejected') throw executionResult.reason;
	}

	function reportExecutionTeardownFailure(action: 'stop' | 'restart', error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		saveStatus = `Unable to ${action} execution: ${message}`;
		console.error(`Unable to ${action} execution cleanly.`, error);
	}

	async function stopExecution() {
		if (runningMode === 'compile') {
			pythonCompileAbortController?.abort(
				new DOMException('Python compilation cancelled by the user', 'AbortError')
			);
			return;
		}
		if (!terminal || !runningMode || executionStopPending || restartDebugPending) return;
		const stoppedMode = runningMode;
		const previousExecution = activeExecution;
		const stopGeneration = ++executionGeneration;
		restartRequestGeneration += 1;
		restartDebugPending = false;
		executionStopPending = true;
		if (executionAbortController && !executionAbortController.signal.aborted) {
			executionAbortController.abort(
				new DOMException('Execution stopped by the user', 'AbortError')
			);
		}
		executionPreflight.cancel();
		try {
			await settleExecutionTeardown(stoppedMode, previousExecution);
		} catch (error) {
			reportExecutionTeardownFailure('stop', error);
		} finally {
			completeExecutionGeneration(stopGeneration);
			executionStopPending = false;
		}
	}

	async function restartDebugExecution() {
		if (!terminal || runningMode !== 'debug' || restartDebugPending || executionStopPending)
			return;
		const requestGeneration = ++restartRequestGeneration;
		const previousExecution = activeExecution;
		const teardownGeneration = ++executionGeneration;
		restartDebugPending = true;
		if (executionAbortController && !executionAbortController.signal.aborted) {
			executionAbortController.abort(
				new DOMException('Execution restarted by the user', 'AbortError')
			);
		}
		executionPreflight.cancel();
		try {
			try {
				await settleExecutionTeardown('debug', previousExecution);
			} catch (error) {
				reportExecutionTeardownFailure('restart', error);
				return;
			}
			if (restartRequestGeneration !== requestGeneration) return;
			completeExecutionGeneration(teardownGeneration);
			restartDebugPending = false;
			await exec(true);
		} finally {
			if (restartRequestGeneration === requestGeneration) {
				completeExecutionGeneration(teardownGeneration);
				restartDebugPending = false;
			}
		}
	}

	async function sendTerminalEof() {
		if (!terminal || !runningMode || runningMode === 'compile') return;
		await terminal.eof?.();
	}

	function normalizeRequestedLanguage(value: string | null): PlaygroundLanguage | null {
		if (!value) return null;
		const normalized = value.trim().toLowerCase();
		const aliases: Record<string, PlaygroundLanguage> = {
			whitespace: 'WHITESPACE',
			malbolge: 'MALBOLGE',
			aheui: 'AHEUI',
			아희: 'AHEUI',
			uhmlang: 'UHMLANG',
			umjunsik: 'UHMLANG',
			엄준식: 'UHMLANG',
			lolcode: 'LOLCODE',
			lol: 'LOLCODE',
			apecode: 'APECODE',
			ape: 'APECODE',
			golfscript: 'GOLFSCRIPT',
			'golf-script': 'GOLFSCRIPT',
			brainfuck: 'BRAINFUCK',
			bf: 'BRAINFUCK',
			befunge93: 'BEFUNGE93',
			befunge: 'BEFUNGE93',
			'befunge-93': 'BEFUNGE93',
			python: 'PYTHON',
			python3: 'PYTHON',
			pypy3: 'PYTHON',
			c: 'C',
			cpp: 'CPP',
			cxx: 'CPP',
			objc: 'OBJC',
			objectivec: 'OBJC',
			'objective-c': 'OBJC',
			objective_c: 'OBJC',
			objcxx: 'OBJECTIVECXX',
			objcpp: 'OBJECTIVECXX',
			objectivecxx: 'OBJECTIVECXX',
			'objective-c++': 'OBJECTIVECXX',
			objective_cxx: 'OBJECTIVECXX',
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
			grain: 'GRAIN',
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
			c3: 'C3',
			nim: 'NIM',
			nimrod: 'NIM',
			bash: 'BASH',
			sh: 'BASH',
			shell: 'BASH',
			clojurescript: 'CLOJURESCRIPT',
			cljs: 'CLOJURESCRIPT',
			rescript: 'RESCRIPT',
			res: 'RESCRIPT',
			hy: 'HY',
			hylang: 'HY',
			ocaml: 'OCAML',
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
			fennel: 'FENNEL',
			fnl: 'FENNEL',
			zig: 'ZIG',
			lisp: 'LISP',
			scheme: 'LISP',
			scm: 'LISP',
			commonlisp: 'COMMONLISP',
			'common-lisp': 'COMMONLISP',
			cl: 'COMMONLISP',
			ecl: 'COMMONLISP',
			ruby: 'RUBY',
			rb: 'RUBY',
			haskell: 'HASKELL',
			hs: 'HASKELL',
			r: 'R',
			octave: 'OCTAVE',
			matlab: 'OCTAVE',
			lfortran: 'LFORTRAN',
			lean: 'LEAN4',
			lean4: 'LEAN4',
			fortran: 'FORTRAN',
			f90: 'FORTRAN',
			f95: 'FORTRAN',
			cobol: 'COBOL',
			cob: 'COBOL',
			cbl: 'COBOL',
			gnucobol: 'COBOL',
			v: 'V',
			vlang: 'V',
			tinygo: 'TINYGO',
			graphql: 'GRAPHQL',
			gql: 'GRAPHQL',
			duckdb: 'DUCKDB',
			sqlite: 'SQLITE',
			sql: 'SQLITE',
			postgresql: 'POSTGRESQL',
			postgres: 'POSTGRESQL',
			pgsql: 'POSTGRESQL',
			pglite: 'POSTGRESQL',
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
		const run = compilerDiagnosticRun;
		if (!run) return;
		compilerDiagnostics = [
			...compilerDiagnostics,
			{
				...diagnostic,
				fileName: resolveCompilerDiagnosticPath(
					diagnostic.fileName,
					run.entryPath,
					run.workspacePaths
				)
			}
		];
	}

	function onDebugEvent(event: DebugSessionEvent) {
		if (event.type === 'resume' || event.type === 'stop') {
			invalidateMemoryInspector();
		}
		if (event.type === 'resume') {
			dataBreakpointRequestVersion += 1;
			dataBreakpointError = '';
		}
		if (event.type === 'stop') {
			dataBreakpointRequestVersion += 1;
			dataBreakpointLoadingOwner = null;
			activeDataBreakpoint = null;
			dataBreakpointError = '';
			dataBreakpointLoading = false;
		}
		if (event.type === 'pause') {
			activeProgressSession?.report?.({
				kind: 'ready',
				state: 'paused',
				reason: 'debug-paused',
				label: 'Debugger paused'
			});
			const sourcePath = event.sourcePath || event.callStack[0]?.sourcePath;
			const workspacePath = normalizePath(sourcePath?.replace(/^\/workspace\//u, '') || '');
			if (workspacePath && files.some((file) => file.path === workspacePath)) {
				debug.setSourcePath(`/workspace/${workspacePath}`);
				selectFile(workspacePath);
			}
		}
		debug.handleEvent(event);
	}

	async function selectDebugFrame(frame: DebugFrame) {
		dataBreakpointRequestVersion += 1;
		invalidateMemoryInspector();
		if (!frame.id || !(await debug.selectFrame(frame.id))) return;
		const workspacePath = normalizePath(frame.sourcePath?.replace(/^\/workspace\//u, '') || '');
		if (!workspacePath || !files.some((file) => file.path === workspacePath)) return;
		selectFile(workspacePath);
		debug.setSourcePath(`/workspace/${workspacePath}`);
	}

	function observeDebugFrame(frameId: number | undefined) {
		return (node: HTMLElement) => {
			if (!frameId) return;
			const observer = new IntersectionObserver((entries) => {
				if (entries.some((entry) => entry.isIntersecting))
					void debug.loadFrameArguments([frameId]);
			});
			observer.observe(node);
			return () => observer.disconnect();
		};
	}

	function invalidateMemoryInspector() {
		memoryRequestVersion += 1;
		memoryResult = null;
		memoryRows = [];
		memoryError = '';
		memoryLoading = false;
		memoryWriteStatus = null;
	}

	function inspectDebugVariable(variable: DebugVariable) {
		if (!variable.memoryReference) return;
		invalidateMemoryInspector();
		memoryReference = variable.memoryReference;
		memoryOffsetInput = '0';
	}

	async function readDebugMemoryPage(pageDelta = 0) {
		const requestedReference = memoryReference.trim();
		const offsetText = memoryOffsetInput.trim();
		const countText = memoryCountInput.trim();
		const countPattern = /^(?:[1-9][0-9]*)$/u;
		const requestedOffset = parseDebugInteger(offsetText);
		const count = countPattern.test(countText) ? Number(countText) : Number.NaN;

		if (!requestedReference) {
			memoryError = 'Enter a memory reference.';
			return;
		}
		if (!Number.isSafeInteger(requestedOffset)) {
			memoryError = 'Offset must be a safe decimal or hexadecimal integer.';
			return;
		}
		if (!Number.isSafeInteger(count) || count < 1 || count > MAX_DEBUG_MEMORY_BYTES) {
			memoryError = `Byte count must be between 1 and ${MAX_DEBUG_MEMORY_BYTES}.`;
			return;
		}
		const offset = requestedOffset + pageDelta * count;
		if (!Number.isSafeInteger(offset)) {
			memoryError = 'The requested page exceeds the safe offset range.';
			return;
		}
		if (activeDebugBackend !== 'lldb' || !debug.paused) {
			memoryError = 'Pause an LLDB debug session before reading memory.';
			return;
		}

		memoryOffsetInput = String(offset);
		memoryError = '';
		memoryResult = null;
		memoryLoading = true;
		const requestVersion = ++memoryRequestVersion;
		const frameId = debug.frameId;
		try {
			const memory = await debug.readMemory(requestedReference, offset, count);
			if (
				requestVersion !== memoryRequestVersion ||
				!debug.paused ||
				debug.frameId !== frameId
			)
				return;
			if (!memory) {
				memoryError = 'Memory reading is unavailable for this session.';
				return;
			}
			const bytes: Array<number | null> = [
				...memory.data,
				...Array.from({ length: memory.unreadableBytes }, () => null)
			];
			const rows: DebugMemoryRow[] = [];
			for (let rowOffset = 0; rowOffset < bytes.length; rowOffset += 16) {
				const rowBytes = bytes.slice(rowOffset, rowOffset + 16);
				rows.push({
					ascii: rowBytes
						.map((byte) =>
							byte === null
								? '·'
								: byte >= 32 && byte <= 126
									? String.fromCharCode(byte)
									: '.'
						)
						.join(''),
					bytes: rowBytes,
					offset: rowOffset
				});
			}
			memoryResult = {
				address: memory.address,
				memoryReference: requestedReference,
				offset,
				unreadableBytes: memory.unreadableBytes
			};
			memoryRows = rows;
		} catch (error) {
			if (requestVersion !== memoryRequestVersion || !debug.paused) return;
			memoryError = error instanceof Error ? error.message : String(error);
		} finally {
			if (requestVersion === memoryRequestVersion) memoryLoading = false;
		}
	}

	async function writeDebugMemoryPage() {
		const requestedReference = memoryReference.trim();
		const offsetText = memoryOffsetInput.trim();
		const offset = parseDebugInteger(offsetText);
		const byteText = memoryWriteInput.trim();
		const byteTokens = byteText ? byteText.split(/[\s,]+/u) : [];

		if (!requestedReference) {
			memoryError = 'Enter a memory reference.';
			return;
		}
		if (!Number.isSafeInteger(offset)) {
			memoryError = 'Offset must be a safe decimal or hexadecimal integer.';
			return;
		}
		if (
			byteTokens.length < 1 ||
			byteTokens.length > MAX_DEBUG_MEMORY_BYTES ||
			byteTokens.some((token) => !/^(?:[0-9a-fA-F]{2}|0[xX][0-9a-fA-F]{2})$/u.test(token))
		) {
			memoryError = `Enter 1–${MAX_DEBUG_MEMORY_BYTES} two-digit hexadecimal bytes separated by spaces or commas.`;
			return;
		}
		if (activeDebugBackend !== 'lldb' || !debug.paused) {
			memoryError = 'Pause an LLDB debug session before writing memory.';
			return;
		}

		const bytes = byteTokens.map((token) => Number.parseInt(token.replace(/^0[xX]/u, ''), 16));
		memoryError = '';
		memoryWriteStatus = null;
		memoryLoading = true;
		const requestVersion = ++memoryRequestVersion;
		const frameId = debug.frameId;
		let refresh = false;
		try {
			const result = await debug.writeMemory(
				requestedReference,
				offset,
				Uint8Array.from(bytes),
				false
			);
			if (
				requestVersion !== memoryRequestVersion ||
				!debug.paused ||
				debug.frameId !== frameId
			)
				return;
			if (!result) {
				memoryError = 'Memory writing is unavailable for this session.';
				return;
			}
			memoryWriteStatus = {
				bytesWritten: result.bytesWritten,
				requestedBytes: bytes.length
			};
			memoryCountInput = String(bytes.length);
			refresh = result.bytesWritten > 0;
		} catch (error) {
			if (requestVersion !== memoryRequestVersion || !debug.paused) return;
			memoryError = error instanceof Error ? error.message : String(error);
		} finally {
			if (requestVersion === memoryRequestVersion) memoryLoading = false;
		}
		if (refresh && debug.capabilities.readMemory) await readDebugMemoryPage();
	}

	async function setMemoryDataBreakpoint() {
		if (dataBreakpointLoadingOwner !== null) return;
		const requestedReference = memoryReference.trim();
		const offsetText = memoryOffsetInput.trim();
		const countText = memoryCountInput.trim();
		const countPattern = /^(?:[1-9][0-9]*)$/u;
		const offset = parseDebugInteger(offsetText);
		const bytes = countPattern.test(countText) ? Number(countText) : Number.NaN;
		if (!requestedReference) {
			dataBreakpointError = 'Enter a memory reference.';
			return;
		}
		if (!Number.isSafeInteger(offset)) {
			dataBreakpointError = 'Offset must be a safe decimal or hexadecimal integer.';
			return;
		}
		if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_DEBUG_MEMORY_BYTES) {
			dataBreakpointError = `Byte count must be between 1 and ${MAX_DEBUG_MEMORY_BYTES}.`;
			return;
		}
		if (activeDebugBackend !== 'lldb' || !debug.paused) {
			dataBreakpointError = 'Pause an LLDB debug session before setting a data breakpoint.';
			return;
		}
		let address: string;
		try {
			const resolvedAddress = BigInt(requestedReference) + BigInt(offset);
			if (resolvedAddress < 0n) throw new RangeError('negative address');
			address = `0x${resolvedAddress.toString(16)}`;
		} catch {
			dataBreakpointError = 'Reference must be a decimal or hexadecimal address.';
			return;
		}

		dataBreakpointError = '';
		const accessType = dataBreakpointAccessType;
		const requestVersion = ++dataBreakpointRequestVersion;
		dataBreakpointLoadingOwner = requestVersion;
		dataBreakpointLoading = true;
		const frameId = debug.frameId;
		try {
			const info = await debug.dataBreakpointInfo({
				name: address,
				asAddress: true,
				bytes
			});
			if (
				requestVersion !== dataBreakpointRequestVersion ||
				!debug.paused ||
				debug.frameId !== frameId
			)
				return;
			if (!info?.dataId) {
				dataBreakpointError =
					info?.description || 'Data breakpoints are unavailable for this memory range.';
				return;
			}
			if (info.accessTypes && !info.accessTypes.includes(accessType)) {
				dataBreakpointError = `${accessType} access is unavailable for this memory range.`;
				return;
			}
			activeDataBreakpoint = null;
			const resolved = await debug.setDataBreakpoints([{ dataId: info.dataId, accessType }]);
			if (
				requestVersion !== dataBreakpointRequestVersion ||
				!debug.paused ||
				debug.frameId !== frameId
			)
				return;
			const breakpoint = resolved[0];
			if (!breakpoint?.verified) {
				dataBreakpointError =
					breakpoint?.message || 'LLDB could not set the data breakpoint.';
				return;
			}
			activeDataBreakpoint = {
				accessType,
				address,
				bytes,
				dataId: info.dataId,
				description: info.description,
				...(breakpoint.id === undefined ? {} : { id: breakpoint.id })
			};
		} catch (error) {
			if (requestVersion !== dataBreakpointRequestVersion || !debug.paused) return;
			dataBreakpointError = error instanceof Error ? error.message : String(error);
		} finally {
			if (dataBreakpointLoadingOwner === requestVersion) {
				dataBreakpointLoadingOwner = null;
				dataBreakpointLoading = false;
			}
		}
	}

	async function clearMemoryDataBreakpoint() {
		if (dataBreakpointLoadingOwner !== null) return;
		if (activeDebugBackend !== 'lldb' || !debug.paused) return;
		dataBreakpointError = '';
		const requestVersion = ++dataBreakpointRequestVersion;
		dataBreakpointLoadingOwner = requestVersion;
		dataBreakpointLoading = true;
		activeDataBreakpoint = null;
		try {
			await debug.setDataBreakpoints([]);
		} catch (error) {
			if (requestVersion !== dataBreakpointRequestVersion || !debug.paused) return;
			dataBreakpointError = error instanceof Error ? error.message : String(error);
		} finally {
			if (dataBreakpointLoadingOwner === requestVersion) {
				dataBreakpointLoadingOwner = null;
				dataBreakpointLoading = false;
			}
		}
	}

	function runToCursorWhileDataBreakpointIdle(targetLine?: number | null) {
		if (dataBreakpointLoadingOwner !== null) return Promise.resolve(false);
		return debug.runToCursor(targetLine);
	}

	async function watchDebugVariable(node: DebugVariableNode) {
		if (dataBreakpointLoadingOwner !== null || !debug.paused) return;
		const requestVersion = ++dataBreakpointRequestVersion;
		const frame = debug.frameId;
		dataBreakpointLoadingOwner = requestVersion;
		dataBreakpointLoading = true;
		dataBreakpointError = '';
		try {
			const resolved = await debug.watchVariable(node.path, 'write', {
				replaceExisting: true
			});
			if (
				requestVersion !== dataBreakpointRequestVersion ||
				!debug.paused ||
				debug.frameId !== frame
			)
				return;
			if (!resolved[0]?.verified) {
				if (resolved.length) activeDataBreakpoint = null;
				dataBreakpointError =
					resolved[0]?.message || 'This variable cannot be watched for writes.';
				return;
			}
			activeDataBreakpoint = {
				accessType: 'write',
				description: node.expression ?? node.variable.name,
				id: resolved[0].id
			};
		} catch (error) {
			if (requestVersion === dataBreakpointRequestVersion && debug.paused)
				dataBreakpointError = String(error);
		} finally {
			if (dataBreakpointLoadingOwner === requestVersion) {
				dataBreakpointLoadingOwner = null;
				dataBreakpointLoading = false;
			}
		}
	}

	function exec(enableDebug = false): Promise<void> {
		const args = argsHelpLanguages.has(language) ? parsedArgs.args : [];
		if (!args) return Promise.resolve();
		if (compilerArgumentConfig[language] && !parsedCompilerArgs.args) return Promise.resolve();
		if (!editor || !terminal || !activeFile) return Promise.resolve();
		if (!executionAvailable) return Promise.resolve();
		if (enableDebug && !debugLanguage) return Promise.resolve();
		if (enableDebug && !sharedBufferAvailable) return Promise.resolve();
		if (enableDebug && !debugTargetAvailable) return Promise.resolve();
		if (runningMode) return Promise.resolve();
		const generation = ++executionGeneration;
		const preflight = executionPreflight.begin();
		const execution = (async () => {
			const abortController = new AbortController();
			const progressSession = executionObserver.start(
				generation,
				language,
				loadingProgress.start(`Loading ${language} runtime`)
			);
			executionAbortController = abortController;
			activeProgressSession = progressSession;
			let progressOutcome: 'completed' | 'failed' | 'cancelled' | 'timed-out' = 'completed';
			let executionError: unknown;
			let executionDebugMode: NonNullable<SandboxExecutionOptions['debugMode']> = enableDebug
				? selectedDebugMode
				: 'none';
			let executionDebugSteppingOptions: SandboxExecutionOptions['debugSteppingOptions'];
			runningMode = enableDebug ? 'debug' : 'run';
			activeDebugBackend = enableDebug ? selectedDebugMode : null;
			if (enableDebug && debugLspLanguages.has(language)) clangdRequested = true;
			if (enableDebug) {
				invalidateMemoryInspector();
				debug.begin();
			} else {
				debug.reset();
				debug.clearDiagnostics();
			}
			compilerDiagnostics = [];
			compilerDiagnosticRun = {
				entryPath: activePath,
				workspacePaths: files.map((file) => file.path)
			};
			const codeToRun = activeFile.content;
			// Tab switches and new files stay available during the LLDB check below; run what Run saw.
			const runActivePath = activePath;
			const runWorkspaceFiles = files.map((file) => ({
				path: file.path,
				content: file.path === runActivePath ? codeToRun : file.content
			}));
			const runLanguageOptions = {
				...languageExecutionOptions,
				...(languageExecutionOptions.compileArgs
					? { compileArgs: [...languageExecutionOptions.compileArgs] }
					: {})
			};
			if (browser) {
				saveWorkspace();
				try {
					localStorage.setItem('code', codeToRun);
					localStorage.setItem('language', language);
					localStorage.setItem('argsInput', argsInput);
					localStorage.setItem('rustTargetTriple', rustTargetTriple);
					localStorage.setItem('rustOptimizationProfile', rustOptimizationProfile);
					localStorage.setItem('goTarget', goTarget);
					localStorage.setItem('ocamlBackend', ocamlBackend);
					localStorage.setItem('ocamlWasmBinaryenMode', ocamlWasmBinaryenMode);
				} catch {
					// The complete workspace above is authoritative; legacy keys are optional.
				}
			}
			try {
				await publishContainerWorkspace(
					language,
					files.map((file) => ({ ...file }))
				);
				if (executionDebugMode === 'lldb') {
					try {
						progressSession.report?.({
							kind: 'activity',
							phase: 'resolving',
							label: 'Checking LLDB debug runtime'
						});
						const debugRuntime = resolveDebugRuntimeUrls(
							runtimeAssets,
							globalThis.location.href
						);
						const { loadVerifiedDebugRuntimeManifest } =
							await import('$lib/playground/lldbManifest');
						const manifest = await loadVerifiedDebugRuntimeManifest(
							debugRuntime.manifestUrl,
							debugRuntime.manifestReceipt,
							fetch,
							abortController.signal
						);
						const capabilities = manifest.debugger.capabilities;
						if (capabilities.skipLibraryCode === true)
							executionDebugSteppingOptions = debug.steppingOptions;
						if (
							!capabilities.breakpoints ||
							!capabilities.stepping ||
							!capabilities.stackTrace ||
							!capabilities.locals
						) {
							throw new Error('LLDB runtime is missing required debug capabilities.');
						}
						if (!executionPreflight.isCurrent(preflight)) {
							progressOutcome = 'cancelled';
							return;
						}
						activeDebugBackend = 'lldb';
					} catch (error) {
						if (!executionPreflight.isCurrent(preflight)) {
							progressOutcome = 'cancelled';
							return;
						}
						if (!traceFallbackLanguages.has(language)) throw error;
						executionDebugMode = 'trace';
						activeDebugBackend = 'trace';
						console.warn(
							'LLDB debug runtime is unavailable; using trace debugging for this run.',
							error
						);
					}
				}
				if (!executionPreflight.isCurrent(preflight)) {
					progressOutcome = 'cancelled';
					return;
				}
				const preloadedStdin =
					sharedBufferAvailable && !preloadedStdinLanguages.has(language)
						? undefined
						: stdinInput;
				const result = await executeTerminalRun({
					terminal,
					language,
					code: codeToRun,
					log,
					progress: progressSession,
					args,
					options: {
						debugMode: executionDebugMode,
						debug: enableDebug,
						interactive: enableDebug,
						...(executionDebugSteppingOptions
							? { debugSteppingOptions: executionDebugSteppingOptions }
							: {}),
						breakpoints: [...debug.effectiveBreakpoints],
						sourceBreakpoints: debug.sourceBreakpoints.filter(({ sourcePath }) =>
							runWorkspaceFiles.some(
								(file) => `/workspace/${normalizePath(file.path)}` === sourcePath
							)
						),
						activePath: runActivePath,
						workspaceFiles: runWorkspaceFiles,
						pauseOnEntry: enableDebug,
						...runLanguageOptions,
						...(clangCompilerLanguages.has(language) ? { programArgs: args } : {}),
						...(language === 'HASKELL' ? { programArgs: [] } : {}),
						signal: abortController.signal,
						stdin: preloadedStdin
					}
				});
				if (result === false) {
					executionError = terminal.getExecutionError?.();
					progressOutcome = abortController.signal.aborted ? 'cancelled' : 'failed';
				}
			} catch (error) {
				executionError = error;
				const executionWasCancelled = abortController.signal.aborted;
				const executionTimedOut = error instanceof Error && error.name === 'TimeoutError';
				progressOutcome = executionWasCancelled
					? 'cancelled'
					: executionTimedOut
						? 'timed-out'
						: 'failed';
				if (!executionWasCancelled && !executionTimedOut) throw error;
			} finally {
				executionObserver.finish(generation, progressOutcome, executionError);
				progressSession.report?.({ kind: 'settled', outcome: progressOutcome });
				if (executionAbortController === abortController)
					executionAbortController = undefined;
				if (activeProgressSession === progressSession) activeProgressSession = undefined;
				executionPreflight.finish(preflight);
				completeExecutionGeneration(generation);
				void refreshContainerWorkspace().catch((error) => {
					saveStatus = `Unable to refresh files: ${error instanceof Error ? error.message : String(error)}`;
				});
			}
		})();
		activeExecution = execution;
		return execution;
	}

	// Only URL publication waits for the router. Workspace restoration is synchronous
	// so Monaco, the terminal and prewarming all observe the selected language first.
	$effect(() => {
		if (initialSelection?.replacementUrl)
			untrack(() => replaceState(initialSelection.replacementUrl!, page.state));
	});

	$effect(() => {
		if (workspaceEditorReady) workspaceEditorInitialized = true;
	});

	$effect(() => {
		if (!browser || !workspaceEditorInitialized || unrestoredWorkspace !== null) return;
		const key = workspaceSaveKey;
		if (!key) return;
		workspaceStorage.observe(key, currentWorkspaceStorageKey);
		if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer);
		workspaceSaveTimer = setTimeout(() => saveWorkspace(), 400);
		return () => {
			if (workspaceSaveTimer) clearTimeout(workspaceSaveTimer);
		};
	});

	$effect(() => {
		if (!browser || language !== 'RUST') return;
		const manifestUrl = runtimeAssets.rust?.manifestUrl;
		if (!manifestUrl) return;
		let cancelled = false;
		(async () => {
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
				const nextDefaultTargetTriple = nextAvailableRustTargetTriples.includes(
					manifest.defaultTargetTriple as RustTargetTriple
				)
					? (manifest.defaultTargetTriple as RustTargetTriple)
					: nextAvailableRustTargetTriples[0];
				// The restored or just-picked target owns the selection; only replace an unavailable one.
				if (!nextAvailableRustTargetTriples.includes(rustTargetTriple)) {
					rustTargetTriple = nextDefaultTargetTriple;
				}
			} catch {
				if (cancelled) return;
				availableRustTargetTriples = ['wasm32-wasip1', 'wasm32-wasip2'];
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
		if (!browser || language !== 'GO') return;
		const manifestUrl = runtimeAssets.go?.manifestUrl;
		if (!manifestUrl) return;
		let cancelled = false;
		(async () => {
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
				const nextDefaultGoTarget = nextAvailableGoTargets.includes(
					manifest.defaultTarget as GoTarget
				)
					? (manifest.defaultTarget as GoTarget)
					: nextAvailableGoTargets[0];
				// The restored or just-picked target owns the selection; only replace an unavailable one.
				if (!nextAvailableGoTargets.includes(goTarget)) {
					goTarget = nextDefaultGoTarget;
				}
			} catch {
				if (cancelled) return;
				availableGoTargets = ['wasip1/wasm'];
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
		if (!browser || !workspaceInitialized) return;
		const binding = playground;
		const selectedLanguage = language;
		const generation = ++shellDirectoryGeneration;
		shellDirectoryPending = true;
		void binding.setShellDirectory(selectedLanguage).then(
			() => {
				if (generation === shellDirectoryGeneration) shellDirectoryPending = false;
			},
			(error) => {
				if (generation !== shellDirectoryGeneration) return;
				shellDirectoryPending = false;
				saveStatus = `Shell directory change failed: ${error instanceof Error ? error.message : String(error)}`;
			}
		);
	});

	$effect(() => {
		if (!browser || !workspaceInitialized) return;
		const binding = playground,
			selectedLanguage = language;
		const values = files.map((file) => ({ ...file }));
		const executing = runningMode;
		const timer = setTimeout(
			() => {
				void publishContainerWorkspace(selectedLanguage, values).catch((error) => {
					saveStatus = `Workspace sync failed: ${error instanceof Error ? error.message : String(error)}`;
				});
			},
			executing ? 0 : 80
		);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (!browser || !workspaceInitialized) return;
		const binding = playground;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const remove = binding.onWorkspaceChange(() => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				void refreshContainerWorkspace().catch((error) => {
					saveStatus = `Workspace refresh failed: ${error instanceof Error ? error.message : String(error)}`;
				});
			}, 120);
		});
		void untrack(() => refreshContainerWorkspace()).catch((error) => {
			saveStatus = `Workspace refresh failed: ${error instanceof Error ? error.message : String(error)}`;
		});
		return () => {
			clearTimeout(timer);
			remove();
		};
	});

	$effect(() => {
		if (!browser || !workspaceInitialized || runningMode || !containerEditorRefreshDeferred)
			return;
		// Metadata keeps following guest writes during a Run; editor buffers are
		// reconciled once that execution releases them, even without another event.
		void untrack(() => refreshContainerWorkspace()).catch((error) => {
			saveStatus = `Workspace refresh failed: ${error instanceof Error ? error.message : String(error)}`;
		});
	});

	$effect(() => {
		if (!browser) return;
		const binding = playground;
		const target = window as Window & typeof globalThis & { __wasmIdleContainer?: unknown };
		const api = {
			inspect: () => binding.inspect(),
			readWorkspace: (selectedLanguage: string) => binding.readWorkspace(selectedLanguage),
			syncWorkspace: (selectedLanguage: string, values: WorkspaceFile[]) =>
				binding.syncWorkspace(selectedLanguage, containerFiles(values)),
			refreshWorkspace: () => refreshContainerWorkspace(),
			shellWrite: (text: string) => binding.shell.write(text),
			shellEof: () => binding.shell.eof(),
			shellInterrupt: () => binding.shell.interrupt()
		};
		target.__wasmIdleContainer = api;
		return () => {
			if (target.__wasmIdleContainer === api) delete target.__wasmIdleContainer;
		};
	});

	$effect(() => {
		const binding = playground;
		return () => {
			void binding.dispose?.().catch(() => {});
		};
	});

	$effect(() => {
		if (!browser || !workspaceInitialized) return;
		const binding = playground;
		const enabled = prewarmEnabled;
		const selectedLanguage = language;
		// A run owns its sandbox already. Never replace it with speculative work.
		// Run must claim the pending warm-up; changing runningMode must not cancel it.
		const executing = untrack(() => !!runningMode);
		void binding.setPrewarmEnabled?.(enabled).catch(() => {});
		if (enabled && !executing) void binding.prewarm?.(selectedLanguage).catch(() => {});
		return () => {
			void binding.cancelPrewarm?.().catch(() => {});
		};
	});

	$effect(() => {
		debug.setTerminal(terminal);
	});

	$effect(() => {
		debug.setAdapter(debugLanguage);
	});

	$effect(() => {
		debug.setSourcePath(activeDebugSourcePath);
	});

	$effect(() => {
		if (!browser) return;
		const target = window as Window &
			typeof globalThis & { __wasmIdleDebug?: WasmIdleDebugTestApi };
		const debugHookVersion = ++browserDebugHookVersion;
		const debugApi: WasmIdleDebugTestApi = {
			getExecutionState() {
				return executionObserver.snapshot();
			},
			getBuildIdentity() {
				return {
					...__WASM_IDLE_BUILD__,
					serviceWorkerUrl: navigator.serviceWorker?.controller?.scriptURL ?? null
				};
			},
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
			async setWorkspaceFiles(nextFiles: WorkspaceFile[], nextActivePath?: string) {
				const nextActiveFilePath =
					normalizePath(nextActivePath || activePath) || defaultPathForLanguage();
				const activeContent = editor?.getValue() || activeFile?.content || '';
				const previousWorkspaceFiles = new Map(
					files.map((file) => [file.path, file.content])
				);
				const sanitizedFiles = sanitizeFiles(nextFiles).filter(
					(file) => file.path !== nextActiveFilePath
				);
				const replacementWorkspaceFiles = new Map(
					sanitizedFiles.map((file) => [file.path, file.content])
				);
				const replacedSourcePaths = new Set(
					[...previousWorkspaceFiles.keys(), ...replacementWorkspaceFiles.keys()].filter(
						(sourcePath) => sourcePath !== nextActiveFilePath
					)
				);
				for (const sourcePath of replacedSourcePaths) {
					if (
						debug.active &&
						previousWorkspaceFiles.get(sourcePath) !==
							replacementWorkspaceFiles.get(sourcePath)
					) {
						debug.markSourceRevisionStale(`/workspace/${sourcePath}`);
					}
				}
				files = [{ path: nextActiveFilePath, content: activeContent }, ...sanitizedFiles];
				activePath = nextActiveFilePath;
				openTabs = [nextActiveFilePath];
				updateActiveContent(activeContent);
				await Promise.resolve();
				return (
					activePath === nextActiveFilePath &&
					files.some((file) => file.path === nextActiveFilePath)
				);
			},
			setBreakpoints(lines: number[]) {
				debug.setBreakpoints(lines);
			},
			getDebugState() {
				return {
					paused: debug.paused,
					pausedLine: debug.pausedLine,
					sourcePath: debug.sourcePath,
					pausedSourcePath: debug.pausedSourcePath,
					sourceRevisionStale: debug.sourceRevisionStale,
					frameId: debug.frameId,
					callStack: debug.callStack.map((frame) => ({ ...frame })),
					scopes: debug.scopes.map((scope) => ({
						...scope,
						variables: scope.variables.map((variable) => ({ ...variable }))
					})),
					variablesByReference: Array.from(
						debug.variablesByReference,
						([reference, variables]) => [
							reference,
							variables.map((variable) => ({ ...variable }))
						]
					)
				};
			},
			selectDebugFrame(frameId: number) {
				return debug.selectFrame(frameId);
			},
			loadDebugVariables(variablesReference: number, start?: number, count?: number) {
				return debug.loadVariableChildren(variablesReference, start, count);
			},
			async readDebugMemory(memoryReference: string, offset: number, count: number) {
				const memory = await debug.readMemory(memoryReference, offset, count);
				return memory ? { ...memory, data: Array.from(memory.data) } : null;
			},
			writeDebugMemory(
				memoryReference: string,
				offset: number,
				data: number[],
				allowPartial?: boolean
			) {
				return debug.writeMemory(
					memoryReference,
					offset,
					Uint8Array.from(data),
					allowPartial
				);
			},
			dataBreakpointInfo(arguments_: DebugDataBreakpointInfoArguments) {
				return debug.dataBreakpointInfo(arguments_);
			},
			setDataBreakpoints(breakpoints: DebugDataBreakpoint[]) {
				return debug.setDataBreakpoints(breakpoints);
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
	});
	untrack(() => {
		if (initialSelection) {
			if (initialSelection.snapshot) {
				applySnapshot(
					initialSelection.snapshot,
					initialSelection.source === 'share'
						? 'Shared workspace loaded'
						: 'Workspace restored'
				);
			} else {
				const {
					code,
					argsInput: restoredArgs,
					rustTargetTriple: restoredRustTarget,
					rustOptimizationProfile: restoredRustOptimizationProfile,
					goTarget: restoredGoTarget,
					ocamlBackend: restoredOcamlBackend,
					ocamlWasmBinaryenMode: restoredBinaryenMode
				} = initialSelection.overrides;
				if (code !== null && activeFile) activeFile.content = code;
				if (restoredArgs !== null) {
					const restored = restoreCompilerOptions(undefined, language, restoredArgs);
					compilerOptions = restored.compilerOptions;
					argsInput = restored.argsInput;
				}
				if (
					restoredRustTarget === 'wasm32-wasip1' ||
					restoredRustTarget === 'wasm32-wasip2' ||
					restoredRustTarget === 'wasm32-wasip3'
				)
					rustTargetTriple = restoredRustTarget;
				if (
					restoredRustOptimizationProfile === 'interactive' ||
					restoredRustOptimizationProfile === 'speed' ||
					restoredRustOptimizationProfile === 'size'
				)
					rustOptimizationProfile = restoredRustOptimizationProfile;
				if (
					restoredGoTarget === 'wasip1/wasm' ||
					restoredGoTarget === 'wasip2/wasm' ||
					restoredGoTarget === 'wasip3/wasm' ||
					restoredGoTarget === 'js/wasm'
				)
					goTarget = restoredGoTarget;
				if (restoredOcamlBackend === 'js' || restoredOcamlBackend === 'wasm')
					ocamlBackend = restoredOcamlBackend;
				if (restoredBinaryenMode === 'fast' || restoredBinaryenMode === 'full')
					ocamlWasmBinaryenMode = restoredBinaryenMode;
				if (initialSelection.source === 'query') saveStatus = 'URL workspace loaded';
			}
			if (initialSelection.unrestoredWorkspace !== null) {
				unrestoredWorkspace = initialSelection.unrestoredWorkspace;
				workspaceRecoveryKey = preserveUnrestoredWorkspace(
					(key, value) => localStorage.setItem(key, value),
					currentWorkspaceStorageKey,
					unrestoredWorkspace
				);
				saveStatus = 'Stored workspace could not be restored';
			} else if (initialSelection.invalidShare) saveStatus = 'Invalid share URL';
			workspaceInitialized = true;
		}
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
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
		rel="stylesheet"
		crossorigin="anonymous"
	/>
</svelte:head>

<svelte:window
	onbeforeunload={warnUnsavedChanges}
	onstorage={handleWorkspaceStorageChange}
	onpointerdown={(event) => {
		if (languageMenuOpen && !languagePicker?.contains(event.target as Node))
			closeLanguageMenu();
	}}
	ondragover={handleDragOver}
	ondragleave={() => (dragActive = false)}
	ondrop={handleDrop}
/>

<main
	bind:this={examplePane}
	bind:clientWidth={examplePaneWidth}
	class="ide"
	class:drag-active={dragActive}
	data-theme={darkMode ? 'dark' : 'light'}
>
	<input
		bind:this={fileInput}
		class="hidden-input"
		multiple
		onchange={handleUpload}
		type="file"
	/>
	{#snippet consoleTail()}
		{#snippet debugNodeRows(nodes: readonly DebugVariableNode[])}
			{#each nodes as node (node.path)}
				{@const variable = node.variable}
				<li
					class={[
						'debug-entry debug-entry--local',
						{ 'debug-entry--changed': node.changed }
					]}
					data-variable-path={node.path}
				>
					<div class="debug-entry__body">
						<code class="debug-key">{variable.name}</code>
						{#if variable.type}<span class="debug-variable-type">{variable.type}</span
							>{/if}
					</div>
					{#if node.previousValue !== undefined && node.changed}<code
							class="debug-previous-value">{node.previousValue} →</code
						>{/if}
					<code class="debug-value">{variable.value}</code>
					{#if node.expression}
						<button
							class="debug-expand"
							aria-label={`Add watch for ${variable.name}`}
							onclick={() => debug.addWatchFromVariable(node.path)}
							disabled={!debug.paused || debug.selectedHistoryId !== null}
							>Watch</button
						>
					{/if}
					{#if debug.capabilities.dataBreakpoints}
						<button
							class="debug-expand"
							aria-label={`Break on write to ${variable.name}`}
							disabled={!debug.paused ||
								dataBreakpointLoading ||
								debug.selectedHistoryId !== null}
							onclick={() => watchDebugVariable(node)}>Watch writes</button
						>
					{/if}
					{#if activeDebugBackend === 'lldb' && debug.paused && variable.memoryReference && (debug.capabilities.readMemory || debug.capabilities.writeMemory)}
						<button
							class="debug-memory-inspect"
							onclick={() => inspectDebugVariable(variable)}
							aria-label={`Inspect memory for ${variable.name}`}
							><span class="material-symbols-outlined" aria-hidden="true">memory</span
							></button
						>
					{/if}
					{#if (variable.variablesReference ?? 0) > 0}
						<button
							class="debug-expand"
							onclick={() => debug.expandVariable(node.path, !node.expanded)}
							disabled={node.loading || debug.selectedHistoryId !== null}
							aria-expanded={node.expanded}
							aria-label={`${node.expanded ? 'Collapse' : 'Load children for'} ${variable.name}`}
							><span class="material-symbols-outlined" aria-hidden="true"
								>{node.expanded ? 'expand_more' : 'chevron_right'}</span
							></button
						>
					{/if}
				</li>
				{#if node.expanded}
					<li class="debug-variable-children">
						<ul>{@render debugNodeRows(node.children)}</ul>
						{#if node.hasMore}<button
								class="debug-load-scope"
								onclick={() => debug.loadMoreVariablePath(node.path)}
								disabled={node.loading || debug.selectedHistoryId !== null}
								aria-label={`Load more children for ${variable.name}`}
								>Load more ({node.children.length} / {(variable.namedVariables ??
									0) + (variable.indexedVariables ?? 0)})</button
							>{/if}
					</li>
				{/if}
			{/each}
		{/snippet}
		{#snippet debugSnapshotRows(nodes: readonly DebugSnapshotVariable[])}
			{#each nodes as node (node.path)}
				<li>
					<code>{node.name}</code>: <code>{node.value}</code>{#if node.children.length}<ul
						>
							{@render debugSnapshotRows(node.children)}
						</ul>{/if}
				</li>
			{/each}
		{/snippet}

		{#if debugLanguage && (debug.active || debug.history.length > 0)}
			<section
				class={[
					'debug-shell',
					debug.paused && 'debug-shell--paused',
					debug.active && !debug.paused && 'debug-shell--active'
				]}
			>
				<header class="debug-hero">
					<div class="debug-hero__intro">
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
							<span class="material-symbols-outlined" aria-hidden="true"
								>{debugStatusIcon}</span
							>
							<span>{debugStatusLabel}</span>
						</div>
						<div class="debug-hero__copy">
							<h2>{debugTitle}</h2>
						</div>
					</div>
					<div class="debug-controls" role="group" aria-label="Debugger controls">
						<button
							class={[
								'action-button',
								'debug-control',
								debug.paused && 'debug-control--primary'
							]}
							onclick={() => debug.sendCommand('continue')}
							disabled={!debug.paused || dataBreakpointLoading}
							title="Continue"
							aria-label="Continue"
						>
							<span class="material-symbols-outlined" aria-hidden="true"
								>play_arrow</span
							>
							<span class="debug-control__label">Continue</span>
						</button>
						<button
							class="action-button debug-control"
							onclick={() => debug.pause()}
							disabled={(activeDebugBackend !== 'lldb' &&
								!(language === 'JAVA' && activeDebugBackend === 'trace')) ||
								!debug.active ||
								debug.paused}
							title={language === 'JAVA'
								? 'Pause at the next Java statement'
								: 'Pause'}
							aria-label="Pause"
						>
							<span class="material-symbols-outlined" aria-hidden="true">pause</span>
						</button>
						<span class="debug-controls__divider" aria-hidden="true"></span>
						<button
							class="action-button debug-control"
							onclick={() => debug.sendCommand('nextLine')}
							disabled={!debug.paused || dataBreakpointLoading}
							title="Next Line"
							aria-label="Next Line"
						>
							<span class="material-symbols-outlined" aria-hidden="true">redo</span>
						</button>
						<button
							class="action-button debug-control"
							onclick={() => debug.sendCommand('stepInto')}
							disabled={!debug.paused || dataBreakpointLoading}
							title="Step Into"
							aria-label="Step Into"
						>
							<span class="material-symbols-outlined" aria-hidden="true">login</span>
						</button>
						<button
							class="action-button debug-control"
							onclick={() => debug.sendCommand('stepOut')}
							disabled={!debug.paused || dataBreakpointLoading}
							title="Step Out"
							aria-label="Step Out"
						>
							<span class="material-symbols-outlined" aria-hidden="true">logout</span>
						</button>
						<button
							class="action-button debug-control"
							onclick={() => runToCursorWhileDataBreakpointIdle()}
							disabled={!debug.canRunToCursor || dataBreakpointLoading}
							title={debug.cursorLine
								? `Run to Cursor (L${debug.cursorLine})`
								: 'Run to Cursor'}
							aria-label={debug.cursorLine
								? `Run to Cursor (L${debug.cursorLine})`
								: 'Run to Cursor'}
						>
							<span class="material-symbols-outlined" aria-hidden="true"
								>play_circle</span
							>
						</button>
					</div>
				</header>
				<div class="debug-hero__stats">
					<div class="debug-metric">
						<span>Breakpoints</span>
						<strong>
							{debug.resolvedBreakpoints.length
								? `${debug.resolvedBreakpoints.filter((breakpoint) => breakpoint.verified).length}/${debug.resolvedBreakpoints.length}`
								: debug.breakpoints.length}
						</strong>
					</div>
					<div class="debug-metric">
						<span>Watches</span>
						<strong>{debug.watchExpressions.length}</strong>
					</div>
					<div class="debug-metric">
						<span>Line</span>
						<strong>{debug.pausedLine === null ? '—' : `L${debug.pausedLine}`}</strong>
					</div>
					{#if debug.paused && debug.threadId !== null}
						<div class="debug-metric">
							<span>Thread</span>
							<strong>{debug.threadId}</strong>
						</div>
					{/if}
					{#if debug.paused && debug.stoppedReason}
						<div class="debug-metric">
							<span>Reason</span>
							<strong>{debug.stoppedReason}</strong>
						</div>
					{/if}
					{#if debug.paused && debug.sourceRevisionStale}
						<div
							class="debug-metric"
							title="The editor source changed after this debug session started."
						>
							<span>Source</span>
							<strong>Changed</strong>
						</div>
					{/if}
				</div>
				<div class="debug-panels">
					<section class="debug-panel">
						<header class="debug-panel__header">
							<button
								class="debug-panel__toggle"
								aria-expanded={debugPanelOpen.variables}
								aria-controls="debug-panel-variables"
								onclick={() =>
									(debugPanelOpen.variables = !debugPanelOpen.variables)}
							>
								<span
									class="material-symbols-outlined debug-panel__chevron"
									aria-hidden="true">expand_more</span
								>
								<span class="visually-hidden">Toggle variables</span>
							</button>
							<div class="debug-panel__title">
								<span class="material-symbols-outlined" aria-hidden="true"
									>data_object</span
								>
								<h3>{debug.scopes.length ? 'Variables' : 'Locals'}</h3>
							</div>
							<span class="debug-count">
								{debug.scopes.length
									? debug.scopes.reduce(
											(total, scope) =>
												total +
												(
													debug.variablesByReference.get(
														scope.variablesReference
													) ?? scope.variables
												).length,
											0
										)
									: debug.locals.length}
							</span>
						</header>
						{#if debugPanelOpen.variables}
							<div class="debug-panel__body" id="debug-panel-variables">
								{#if language === 'JAVA'}
									<p>
										Java shows local values and array elements for the currently
										stopped frame. Other objects are shown by type and identity.
									</p>
								{/if}
								{#if debug.scopes.length}
									<div class="debug-scopes">
										{#each debug.scopes as scope (scope.variablesReference)}
											{@const loadedScopeVariables =
												debug.variablesByReference.get(
													scope.variablesReference
												) ??
												(scope.variables.length
													? scope.variables
													: undefined)}
											<details
												class="debug-scope"
												bind:open={
													() => debugScopeOpen[scope.name] ?? true,
													(open) => (debugScopeOpen[scope.name] = open)
												}
											>
												<summary><h4>{scope.name}</h4></summary>
												{#if loadedScopeVariables?.length}
													<ul>
														{@render debugNodeRows(
															debug.scopeNodes(scope)
														)}
													</ul>
													{#if loadedScopeVariables.length >= 50 && (scope.namedVariables === undefined ? loadedScopeVariables.length % 50 === 0 : loadedScopeVariables.length < scope.namedVariables + (scope.indexedVariables ?? 0))}
														<button
															class="debug-load-scope"
															disabled={debug.loadingVariableReferences.has(
																scope.variablesReference
															)}
															onclick={() =>
																debug.loadVariableChildren(
																	scope.variablesReference,
																	loadedScopeVariables.length,
																	50
																)}
														>
															Load more {scope.name.toLowerCase()}
														</button>
													{/if}
												{:else if loadedScopeVariables === undefined && scope.variablesReference > 0}
													<button
														class="debug-load-scope"
														disabled={debug.loadingVariableReferences.has(
															scope.variablesReference
														)}
														onclick={() =>
															debug.loadVariableChildren(
																scope.variablesReference
															)}
													>
														Load {scope.name.toLowerCase()}
													</button>
												{:else}
													<p class="empty">No variables</p>
												{/if}
											</details>
										{/each}
									</div>
								{:else if debug.locals.length}
									<ul>
										{@render debugNodeRows(debug.variableNodes)}
									</ul>
								{:else}
									<p class="empty">
										<span class="material-symbols-outlined" aria-hidden="true"
											>info</span
										>
										<span>No locals yet</span>
									</p>
								{/if}
							</div>
						{/if}
					</section>
					<section class="debug-panel">
						<header class="debug-panel__header">
							<button
								class="debug-panel__toggle"
								aria-expanded={debugPanelOpen.watch}
								aria-controls="debug-panel-watch"
								onclick={() => (debugPanelOpen.watch = !debugPanelOpen.watch)}
							>
								<span
									class="material-symbols-outlined debug-panel__chevron"
									aria-hidden="true">expand_more</span
								>
								<span class="visually-hidden">Toggle watch</span>
							</button>
							<div class="debug-panel__title">
								<span class="material-symbols-outlined" aria-hidden="true"
									>visibility</span
								>
								<h3>Watch</h3>
							</div>
							<span class="debug-count">{debug.watchExpressions.length}</span>
						</header>
						{#if debugPanelOpen.watch}
							<div class="debug-panel__body" id="debug-panel-watch">
								{#if language === 'JAVA'}
									<p>
										Java watches use a read-only snapshot of primitive and
										String values.
									</p>
								{/if}
								<div class="watch-row">
									<input
										bind:value={debug.watchInput}
										maxlength={4096}
										placeholder="pair.first or items[2]"
										onkeydown={(event) =>
											event.key === 'Enter' && debug.addWatchExpression()}
									/>
									<button
										class="watch-add"
										onclick={() => debug.addWatchExpression()}
									>
										<span class="material-symbols-outlined" aria-hidden="true"
											>add</span
										>
										<span>Add</span>
									</button>
								</div>
								{#if debug.watchValues.length}
									<ul>
										{#each debug.watchValues as watch (watch.expression)}
											<li
												class={[
													'debug-entry debug-entry--watch',
													{ 'debug-entry--changed': watch.node?.changed }
												]}
											>
												<div class="debug-entry__body">
													<span class="debug-expression"
														>{watch.expression}</span
													>
													{#if watch.node?.changed && watch.node.previousValue !== undefined}<code
															class="debug-previous-value"
															>{watch.node.previousValue} →</code
														>{/if}
													<code class="debug-value">{watch.value}</code>
												</div>
												<button
													class="remove"
													onclick={() =>
														debug.removeWatchExpression(
															watch.expression
														)}
													aria-label={`Remove watch expression ${watch.expression}`}
												>
													<span
														class="material-symbols-outlined"
														aria-hidden="true">close</span
													>
												</button>
												{#if watch.node && (watch.node.variable.variablesReference ?? 0) > 0}
													<button
														class="debug-expand"
														disabled={watch.node.loading ||
															debug.selectedHistoryId !== null}
														aria-label={`${watch.node.expanded ? 'Collapse' : 'Expand'} watch ${watch.expression}`}
														aria-expanded={watch.node.expanded}
														onclick={() =>
															watch.node &&
															debug.expandVariable(
																watch.node.path,
																!watch.node.expanded
															)}
														>{watch.node.expanded
															? 'Collapse'
															: 'Expand'}</button
													>
												{/if}
											</li>
											{#if watch.node?.expanded}
												<li class="debug-variable-children">
													<ul>
														{@render debugNodeRows(watch.node.children)}
													</ul>
													{#if watch.node.hasMore}<button
															class="debug-load-scope"
															onclick={() =>
																watch.node &&
																debug.loadMoreVariablePath(
																	watch.node.path
																)}
															disabled={watch.node.loading}
															>Load more</button
														>{/if}
												</li>
											{/if}
										{/each}
									</ul>
								{:else}
									<p class="empty">
										<span class="material-symbols-outlined" aria-hidden="true"
											>info</span
										>
										<span>No watches yet</span>
									</p>
								{/if}
							</div>
						{/if}
					</section>
					<section class="debug-panel">
						<header class="debug-panel__header">
							<button
								class="debug-panel__toggle"
								aria-expanded={debugPanelOpen.stack}
								aria-controls="debug-panel-stack"
								onclick={() => (debugPanelOpen.stack = !debugPanelOpen.stack)}
							>
								<span
									class="material-symbols-outlined debug-panel__chevron"
									aria-hidden="true">expand_more</span
								>
								<span class="visually-hidden">Toggle call stack</span>
							</button>
							<div class="debug-panel__title">
								<span class="material-symbols-outlined" aria-hidden="true"
									>layers</span
								>
								<h3>Call Stack</h3>
							</div>
							<span class="debug-count">{debug.callStack.length}</span>
						</header>
						{#if debugPanelOpen.stack}
							<div class="debug-panel__body" id="debug-panel-stack">
								{#if debug.callStack.length}
									<ul>
										{#each debug.callStack as frame, index (`${frame.functionName}:${frame.line}:${index}`)}
											<li
												class={[
													'debug-entry',
													'debug-entry--stack',
													debug.frameId === frame.id &&
														'debug-entry--current'
												]}
											>
												<button
													class="debug-frame-select"
													data-frame-id={frame.id}
													{@attach observeDebugFrame(frame.id)}
													disabled={!frame.id || dataBreakpointLoading}
													onclick={() => selectDebugFrame(frame)}
												>
													<div class="stack-meta">
														<span class="stack-order">{index + 1}</span>
														<span class="stack-function"
															>{frame.displayName ??
																(frame.argumentsSummary ===
																undefined
																	? frame.functionName ||
																		'(entry)'
																	: `${frame.functionName.replace(/\([^()]*\)$/u, '')}(${frame.argumentsSummary})`)}</span
														>
													</div>
													<code class="stack-line">L{frame.line}</code>
												</button>
											</li>
										{/each}
									</ul>
								{:else}
									<p class="empty">
										<span class="material-symbols-outlined" aria-hidden="true"
											>info</span
										>
										<span>No frames yet</span>
									</p>
								{/if}
							</div>
						{/if}
					</section>
					<section class="debug-panel">
						<details class="debug-feature-panel" bind:open={breakpointEditOpen}>
							<summary>Breakpoints</summary>
							<ul>
								{#each debug.structuredBreakpoints as spec (spec.line)}<li>
										<button onclick={() => editDebugBreakpoint(spec.line)}
											>Line {spec.line}{spec.enabled === false
												? ' (disabled)'
												: ''}{spec.hitCondition
												? ` · hit ${spec.hitCondition}`
												: ''}{spec.condition
												? ` · ${spec.condition}`
												: ''}{spec.logMessage ? ' · log' : ''}</button
										>
									</li>{/each}
							</ul>
							<form
								class="debug-breakpoint-editor"
								onsubmit={(event) => {
									event.preventDefault();
									void saveDebugBreakpoint();
								}}
							>
								<label
									>Line<input
										aria-label="Breakpoint line"
										type="number"
										min="1"
										required
										value={breakpointLine}
										oninput={(event) =>
											(breakpointLine = Number(event.currentTarget.value))}
									/></label
								>
								<label
									><input type="checkbox" bind:checked={breakpointEnabled} /> Enabled</label
								>
								{#if debug.capabilities.hitConditionalBreakpoints}<label
										>Hit count<input
											aria-label="Breakpoint hit count"
											bind:value={breakpointHitCondition}
											maxlength={4096}
											placeholder="100"
										/></label
									>{/if}
								{#if debug.capabilities.conditionalBreakpoints}<label
										>Condition<input
											aria-label="Breakpoint condition"
											bind:value={breakpointCondition}
											maxlength={4096}
										/></label
									>{/if}
								{#if debug.capabilities.logPoints}<label
										>Log message<input
											aria-label="Breakpoint log message"
											bind:value={breakpointLogMessage}
											maxlength={4096}
										/></label
									>{/if}
								<button
									type="submit"
									disabled={!Number.isSafeInteger(breakpointLine) ||
										breakpointLine < 1 ||
										dataBreakpointLoading}>Save breakpoint</button
								>
							</form>
							{#if debug.breakpointError}<p role="alert">
									{debug.breakpointError}
								</p>{/if}
						</details>
						{#if debug.capabilities.skipLibraryCode}<label class="debug-feature-panel"
								><input
									type="checkbox"
									checked={debug.steppingOptions.skipLibraryCode}
									disabled={!debug.paused || dataBreakpointLoading}
									onchange={(event) => {
										void debug
											.setSteppingOptions({
												skipLibraryCode: event.currentTarget.checked
											})
											.catch(
												(error) => (debugInteractionError = String(error))
											);
									}}
								/> Skip standard library calls</label
							>{/if}
						{#if debugInteractionError}<p role="alert">{debugInteractionError}</p>{/if}
					</section>
					<section class="debug-panel">
						<details class="debug-feature-panel">
							<summary>Recent stops ({debug.history.length})</summary>
							<ol>
								{#each debug.history as stop (stop.id)}<li>
										<button
											aria-pressed={debug.selectedHistoryId === stop.id}
											onclick={() => debug.selectHistory(stop.id)}
											>#{stop.id}
											{stop.callStack[0]?.functionName ?? ''} · line {stop.line ??
												'?'} · {stop.reason ?? 'stop'}</button
										>
									</li>{/each}
							</ol>
							{#if debug.selectedHistory}
								<button onclick={() => debug.selectHistory(null)}
									>Back to live values</button
								>
								<p>
									Recorded values. Execution controls apply to the current stop.
								</p>
								<ul>
									{@render debugSnapshotRows(debug.selectedHistory.variables)}
								</ul>
								{#each debug.selectedHistory.watches as watch (watch.expression)}
									<p>
										<code>{watch.expression}</code>: <code>{watch.value}</code>
									</p>
									{#if watch.node?.children.length}
										<ul>{@render debugSnapshotRows(watch.node.children)}</ul>
									{/if}
								{/each}
								{#if debug.selectedHistory.truncated}<p>
										Some values were omitted from this snapshot.
									</p>{/if}
							{/if}
						</details>
					</section>
					{#if activeDebugBackend === 'lldb' && debug.paused && (debug.capabilities.readMemory || debug.capabilities.writeMemory || debug.capabilities.dataBreakpoints)}
						<section class="debug-panel debug-memory-panel">
							<header class="debug-panel__header">
								<button
									class="debug-panel__toggle"
									aria-expanded={debugPanelOpen.memory}
									aria-controls="debug-panel-memory"
									onclick={() => (debugPanelOpen.memory = !debugPanelOpen.memory)}
								>
									<span
										class="material-symbols-outlined debug-panel__chevron"
										aria-hidden="true">expand_more</span
									>
									<span class="visually-hidden">Toggle memory</span>
								</button>
								<div class="debug-panel__title">
									<span class="material-symbols-outlined" aria-hidden="true"
										>memory</span
									>
									<h3>Memory</h3>
								</div>
								<span class="debug-count">max {MAX_DEBUG_MEMORY_BYTES} B</span>
							</header>
							{#if debugPanelOpen.memory}
								<div class="debug-panel__body" id="debug-panel-memory">
									<div class="debug-memory-controls">
										<label>
											<span>Reference</span>
											<input
												bind:value={memoryReference}
												aria-label="Memory reference"
											/>
										</label>
										<label>
											<span>Offset</span>
											<input
												bind:value={memoryOffsetInput}
												aria-label="Memory offset"
											/>
										</label>
										<label>
											<span>Bytes</span>
											<input
												bind:value={memoryCountInput}
												inputmode="numeric"
												aria-label="Memory byte count"
											/>
										</label>
										{#if debug.capabilities.readMemory}
											<button
												class="debug-memory-read"
												onclick={() => void readDebugMemoryPage()}
												disabled={memoryLoading}
											>
												{memoryLoading ? 'Reading…' : 'Read'}
											</button>
										{/if}
									</div>
									{#if debug.capabilities.writeMemory}
										<div class="debug-memory-watch-controls">
											<label class="debug-memory-write-field">
												<span>Write hex bytes</span>
												<input
													bind:value={memoryWriteInput}
													placeholder="64 00 00 00"
													aria-label="Memory write bytes"
												/>
											</label>
											<button
												class="debug-memory-write"
												onclick={() => void writeDebugMemoryPage()}
												disabled={memoryLoading}
												aria-label="Write memory"
											>
												{memoryLoading ? 'Writing…' : 'Write memory'}
											</button>
										</div>
									{/if}
									{#if debug.capabilities.writeMemory && memoryWriteStatus}
										<p class="debug-memory-write-status">
											<strong
												>{memoryWriteStatus.bytesWritten} bytes written</strong
											>
											{#if memoryWriteStatus.bytesWritten < memoryWriteStatus.requestedBytes}
												<span
													>of {memoryWriteStatus.requestedBytes} requested</span
												>
											{/if}
										</p>
									{/if}
									{#if debug.capabilities.dataBreakpoints}
										<div class="debug-memory-watch-controls">
											<label>
												<span>Break on</span>
												<select
													bind:value={dataBreakpointAccessType}
													disabled={dataBreakpointLoading}
													aria-label="Data breakpoint access"
												>
													<option value="write">Write</option>
													<option value="read">Read</option>
													<option value="readWrite">Read or write</option>
												</select>
											</label>
											<button
												class="debug-data-breakpoint-set"
												onclick={() => void setMemoryDataBreakpoint()}
												disabled={dataBreakpointLoading}
												aria-label="Set data breakpoint"
											>
												{dataBreakpointLoading && !activeDataBreakpoint
													? 'Setting…'
													: 'Set data breakpoint'}
											</button>
											<button
												class="debug-data-breakpoint-clear"
												onclick={() => void clearMemoryDataBreakpoint()}
												disabled={dataBreakpointLoading}
												aria-label="Clear data breakpoint"
											>
												Clear
											</button>
										</div>
									{/if}
									{#if debug.capabilities.dataBreakpoints && activeDataBreakpoint}
										<p class="debug-data-breakpoint-status">
											<strong>{activeDataBreakpoint.accessType}</strong>
											<span>{activeDataBreakpoint.description}</span>
										</p>
									{/if}
									{#if debug.capabilities.dataBreakpoints && dataBreakpointError}
										<p class="debug-memory-error" role="alert">
											{dataBreakpointError}
										</p>
									{/if}
									{#if memoryError}
										<p class="debug-memory-error" role="alert">{memoryError}</p>
									{/if}
									{#if debug.capabilities.readMemory && memoryResult}
										<div class="debug-memory-toolbar">
											<button onclick={() => void readDebugMemoryPage(-1)}
												>Previous</button
											>
											<code
												>{memoryResult.address ??
													memoryResult.memoryReference}</code
											>
											<button onclick={() => void readDebugMemoryPage(1)}
												>Next</button
											>
										</div>
										<div
											class="debug-memory-table"
											role="table"
											aria-label="Memory contents"
										>
											{#each memoryRows as row (row.offset)}
												<div class="debug-memory-row" role="row">
													<code class="debug-memory-address">
														{memoryResult.address ??
															memoryResult.memoryReference}
														{#if row.offset > 0}+0x{row.offset.toString(
																16
															)}{/if}
													</code>
													<div class="debug-memory-hex" role="cell">
														{#each row.bytes as byte, index (index)}
															{#if byte === null}
																<code
																	class="debug-memory-byte debug-memory-byte--unreadable"
																	>??</code
																>
															{:else}
																<code class="debug-memory-byte"
																	>{byte
																		.toString(16)
																		.padStart(2, '0')}</code
																>
															{/if}
														{/each}
													</div>
													<div role="cell">
														<code class="debug-memory-ascii"
															>{row.ascii}</code
														>
													</div>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</section>
					{/if}
				</div>
			</section>
		{/if}
		<DebuggerLog
			diagnostics={debug.diagnostics}
			importantDiagnostic={debug.latestImportantDiagnostic}
		/>
		<div class="terminal-shell">
			<Terminal
				bind:terminal
				{playground}
				shell={playground.shell}
				font={terminalFont}
				dark={darkMode}
				ondebug={onDebugEvent}
				oncompilediagnostic={onCompileDiagnostic}
			/>
		</div>
	{/snippet}
	<header class="topbar">
		<div class="topbar__lead">
			<button
				class="icon-button"
				class:icon-button--active={sidebarOpen}
				onclick={() => (sidebarOpen = !sidebarOpen)}
				title={sidebarOpen ? 'Hide files' : 'Show files'}
				aria-label={sidebarOpen ? 'Hide files' : 'Show files'}
				aria-pressed={sidebarOpen}
			>
				<span class="material-symbols-outlined" aria-hidden="true">dock_to_right</span>
			</button>
			<div class="brand">
				<span class="brand__mark" aria-hidden="true">
					<svg viewBox="0 0 24 24" width="16" height="16" fill="none">
						<path
							d="M9 7 4 12l5 5M15 7l5 5-5 5"
							stroke="currentColor"
							stroke-width="2.4"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</span>
				<strong>wasm-idle</strong>
			</div>
			<span class="topbar__divider" aria-hidden="true"></span>
			<div class="topbar__config">
				<div class="language-picker" bind:this={languagePicker}>
					<button
						bind:this={languageTrigger}
						class="select-chip language-trigger"
						type="button"
						disabled={!workspaceInitialized || !!runningMode}
						aria-haspopup="listbox"
						aria-expanded={languageMenuOpen}
						aria-label={`Language: ${languageLabels[language]}`}
						onclick={() =>
							languageMenuOpen ? closeLanguageMenu() : openLanguageMenu()}
					>
						<span class="material-symbols-outlined" aria-hidden="true">code_blocks</span
						>
						<span class="language-trigger__label">{languageLabels[language]}</span>
						<span
							class="material-symbols-outlined language-trigger__chevron"
							aria-hidden="true">expand_more</span
						>
					</button>
					<!-- The native select stays the source of truth for automation and form semantics. -->
					<select
						id="language-select"
						class="language-picker__native"
						tabindex="-1"
						aria-hidden="true"
						value={language}
						disabled={!workspaceInitialized || !!runningMode}
						data-workspace-ready={workspaceEditorReady}
						onchange={handleLanguageChange}
					>
						{#each playgroundLanguages as languageOption (languageOption)}
							<option value={languageOption}>{languageLabels[languageOption]}</option>
						{/each}
					</select>
					{#if languageMenuOpen}
						<div class="language-menu">
							<div class="language-menu__search">
								<span class="material-symbols-outlined" aria-hidden="true"
									>search</span
								>
								<input
									bind:this={languageSearchInput}
									bind:value={languageQuery}
									oninput={() => (languageHighlight = 0)}
									onkeydown={handleLanguageSearchKeydown}
									type="search"
									role="combobox"
									aria-label="Search languages"
									aria-expanded="true"
									aria-controls="language-menu-list"
									aria-activedescendant={filteredLanguages[languageHighlight]
										? `language-option-${filteredLanguages[languageHighlight]}`
										: undefined}
									placeholder="Search languages"
									autocomplete="off"
									spellcheck={false}
								/>
								<span class="language-menu__count">{filteredLanguages.length}</span>
							</div>
							<ul
								bind:this={languageMenuList}
								id="language-menu-list"
								class="language-menu__list"
								role="listbox"
								aria-label="Languages"
							>
								{#each filteredLanguages as languageOption, index (languageOption)}
									<!-- Keyboard selection goes through the combobox input (aria-activedescendant). -->
									<!-- svelte-ignore a11y_click_events_have_key_events -->
									<li
										id={`language-option-${languageOption}`}
										role="option"
										aria-selected={languageOption === language}
										data-index={index}
										class:highlighted={index === languageHighlight}
										onpointermove={() => (languageHighlight = index)}
										onpointerdown={(event) => event.preventDefault()}
										onclick={() => chooseLanguage(languageOption)}
									>
										<span>{languageLabels[languageOption]}</span>
										{#if languageOption === language}
											<span
												class="material-symbols-outlined"
												aria-hidden="true">check</span
											>
										{/if}
									</li>
								{:else}
									<li class="language-menu__empty" role="presentation">
										No languages match “{languageQuery}”
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
				{#if argsHelpLanguages.has(language)}
					<label class="args-chip">
						<span class="material-symbols-outlined" aria-hidden="true">list_alt</span>
						<input
							bind:value={argsInput}
							placeholder="--name &quot;Hong Gil&quot; &quot;&quot;"
							aria-label="Program arguments"
							aria-invalid={!!parsedArgs.error}
							title="Separate arguments with spaces. Single or double quotes group an argument, including empty strings. Backslash escapes the next character outside single quotes."
							spellcheck={false}
						/>
						<span>{argsLabel}</span>
					</label>
					{#if parsedArgs.error}
						<span role="alert">{parsedArgs.error}</span>
					{/if}
				{/if}
				{#if compilerSourceLanguage === 'CPP' || compilerSourceLanguage === 'OBJECTIVECXX'}
					<label class="select-chip">
						<span class="material-symbols-outlined" aria-hidden="true">tune</span>
						<span class="visually-hidden">C++ standard</span>
						<select id="cpp-version" bind:value={cppVersion}>
							{#each knownCppVersions as version (version)}
								<option value={version}>{cppVersionLabels[version]}</option>
							{/each}
						</select>
					</label>
				{/if}
				{#if language === 'RUST'}
					<label class="select-chip">
						<span class="material-symbols-outlined" aria-hidden="true"
							>conversion_path</span
						>
						<span class="visually-hidden">Rust target</span>
						<select id="rust-target-triple" bind:value={rustTargetTriple}>
							{#each availableRustTargetTriples as targetTriple (targetTriple)}
								<option value={targetTriple}>{targetTriple}</option>
							{/each}
						</select>
					</label>
					<label
						class="select-chip"
						title="Optimized runs may take longer to compile. Debug always uses the interactive profile."
					>
						<span class="material-symbols-outlined" aria-hidden="true">speed</span>
						<span class="visually-hidden">Rust run profile</span>
						<select id="rust-optimization-profile" bind:value={rustOptimizationProfile}>
							<option value="interactive">Interactive</option>
							<option value="speed">Optimize speed</option>
							<option value="size">Optimize size</option>
						</select>
					</label>
				{/if}
				{#if language === 'GO'}
					<label class="select-chip">
						<span class="material-symbols-outlined" aria-hidden="true"
							>conversion_path</span
						>
						<span class="visually-hidden">Go target</span>
						<select id="go-target" bind:value={goTarget}>
							{#each availableGoTargets as target (target)}
								<option value={target}>{target}</option>
							{/each}
						</select>
					</label>
				{/if}
				{#if language === 'OCAML'}
					<label class="select-chip">
						<span class="material-symbols-outlined" aria-hidden="true"
							>conversion_path</span
						>
						<span class="visually-hidden">OCaml backend</span>
						<select id="ocaml-backend" bind:value={ocamlBackend}>
							<option value="wasm">wasm_of_ocaml</option>
							<option value="js">js_of_ocaml</option>
						</select>
					</label>
					{#if ocamlBackend === 'wasm'}
						<label class="select-chip">
							<span class="material-symbols-outlined" aria-hidden="true">memory</span>
							<span class="visually-hidden">Binaryen mode</span>
							<select id="ocaml-binaryen-mode" bind:value={ocamlWasmBinaryenMode}>
								<option value="fast">Binaryen fast</option>
								<option value="full">Binaryen full</option>
							</select>
						</label>
					{/if}
				{/if}
			</div>
		</div>
		<div class="topbar__actions">
			<button
				class="icon-button"
				onclick={toggleTheme}
				title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
				aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
			>
				<span class="material-symbols-outlined" aria-hidden="true"
					>{darkMode ? 'light_mode' : 'dark_mode'}</span
				>
			</button>
			<a
				class="icon-button"
				href="https://github.com/seo-rii/wasm-idle"
				target="_blank"
				rel="noopener noreferrer"
				title="View on GitHub"
				aria-label="View wasm-idle on GitHub"
			>
				<svg
					viewBox="0 0 16 16"
					width="19"
					height="19"
					fill="currentColor"
					aria-hidden="true"
				>
					<path
						d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
					/>
				</svg>
			</a>
			<button class="tool-button" onclick={() => saveWorkspace(true)} title="Save workspace">
				<span class="material-symbols-outlined" aria-hidden="true">save</span>
				<span>Save</span>
			</button>
			<button class="tool-button" onclick={shareWorkspace} title="Copy share link">
				<span class="material-symbols-outlined" aria-hidden="true">share</span>
				<span>Share</span>
			</button>
			{#if currentWorkspaceStorageKey !== WORKSPACE_STORAGE_KEY}
				<a
					class="tool-button"
					href={resolve('/')}
					data-sveltekit-reload
					title="Open your original local workspace"
					aria-label="Local workspace"
				>
					<span class="material-symbols-outlined" aria-hidden="true">home</span>
					<span>Local workspace</span>
				</a>
			{/if}
			<button
				class="tool-button"
				onclick={restartRuntime}
				disabled={!terminal || !!runningMode || !executionAvailable}
				title="Restart runtime"
			>
				<span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
				<span>Restart Runtime</span>
			</button>
			<span class="topbar__divider" aria-hidden="true"></span>
			<div class="action-group">
				{#if language === 'PYTHON'}
					{#if runningMode === 'compile'}
						<button
							class="action-button action-button--stop"
							onclick={stopExecution}
							title="Cancel Python compilation"
							aria-label="Cancel Python compilation"
						>
							<span class="material-symbols-outlined" aria-hidden="true"
								>stop_circle</span
							>
							<span>Cancel compilation</span>
						</button>
					{:else}
						<button
							class="action-button action-button--compile"
							onclick={compileActivePythonFile}
							disabled={!workspaceEditorReady ||
								!!runningMode ||
								!!pythonCompileOptionError ||
								!activeFile ||
								isBinaryWorkspaceFile(activeFile) ||
								extension(activeFile.path) !== '.py'}
							title="Compile the active Python file and download .pyc"
							aria-label="Compile .pyc"
						>
							<span class="material-symbols-outlined" aria-hidden="true"
								>download</span
							>
							<span>Compile .pyc</span>
						</button>
					{/if}
				{/if}
				{#if runningMode === 'debug'}
					<button
						class="action-button action-button--debug-restart"
						onclick={restartDebugExecution}
						disabled={restartDebugPending || executionStopPending}
						aria-label="Restart Debug"
					>
						<span class="material-symbols-outlined" aria-hidden="true">restart_alt</span
						>
						<span>{restartDebugPending ? 'Restarting…' : 'Restart Debug'}</span>
					</button>
					<button
						class="action-button action-button--stop"
						onclick={stopExecution}
						disabled={executionStopPending || restartDebugPending}
					>
						<span class="material-symbols-outlined" aria-hidden="true">stop_circle</span
						>
						<span>Stop Debug</span>
					</button>
				{:else}
					<button
						class="action-button action-button--debug"
						onclick={() => exec(true)}
						disabled={!!runningMode ||
							!debugLanguage ||
							!sharedBufferAvailable ||
							!debugTargetAvailable}
						title={debugUnavailableReason}
					>
						<span class="material-symbols-outlined" aria-hidden="true">bug_report</span>
						<span>Debug</span>
					</button>
				{/if}
				{#if runningMode === 'run'}
					<button
						class="action-button action-button--stop"
						onclick={stopExecution}
						disabled={executionStopPending}
					>
						<span class="material-symbols-outlined" aria-hidden="true">stop_circle</span
						>
						<span>Stop Running</span>
					</button>
				{:else}
					<button
						class="action-button action-button--run"
						onclick={() => exec(false)}
						disabled={!!runningMode || !executionAvailable}
					>
						<span class="material-symbols-outlined" aria-hidden="true">play_arrow</span>
						<span>Run</span>
					</button>
				{/if}
			</div>
		</div>
	</header>
	<div class="workspace-configuration">
		{#if language === 'PYTHON'}
			<details class="python-bytecode-options">
				<summary>Python bytecode options</summary>
				<div class="python-bytecode-options__body">
					<div class="python-bytecode-options__field">
						<label for="python-bytecode-mode">Bytecode invalidation mode</label>
						<select
							id="python-bytecode-mode"
							bind:value={pythonInvalidationMode}
							disabled={!!runningMode}
							aria-describedby="python-bytecode-help"
						>
							<option value="checked-hash">Checked hash (reproducible default)</option
							>
							<option value="unchecked-hash">Unchecked hash</option>
							<option value="timestamp">Timestamp</option>
						</select>
					</div>
					{#if pythonInvalidationMode === 'timestamp'}
						<div class="python-bytecode-options__field">
							<label for="python-bytecode-timestamp">Timestamp (Unix seconds)</label>
							<input
								id="python-bytecode-timestamp"
								type="number"
								min="0"
								max="4294967295"
								step="1"
								required
								value={pythonTimestampInput}
								oninput={(event) =>
									(pythonTimestampInput = event.currentTarget.value)}
								disabled={!!runningMode}
								aria-invalid={!!pythonCompileOptionError}
								aria-describedby={pythonCompileOptionError
									? 'python-bytecode-help python-bytecode-error'
									: 'python-bytecode-help'}
							/>
						</div>
					{/if}
					<p id="python-bytecode-help">
						{#if pythonInvalidationMode === 'checked-hash'}
							Checks the source hash on import. The same source, options, and Python
							version produce identical .pyc files.
						{:else if pythonInvalidationMode === 'unchecked-hash'}
							Stores a source hash without checking it on import.
						{:else}
							Checks the chosen timestamp and source size on import. The default
							timestamp is 0.
						{/if}
					</p>
					{#if pythonCompileOptionError}
						<p id="python-bytecode-error" role="alert">{pythonCompileOptionError}</p>
					{/if}
				</div>
			</details>
		{/if}
		{#if compilerArgumentConfig[language]}
			<CompilerOptions
				language={compilerSourceLanguage}
				settings={currentCompilerSettings}
				error={parsedCompilerArgs.error}
				onchange={(settings) =>
					(compilerOptions = { ...compilerOptions, [language]: settings })}
			/>
		{/if}
		{#if unrestoredWorkspace !== null}
			<div class="workspace-save-error" role="alert" data-workspace-recovery>
				<span>
					Stored workspace could not be restored. The original snapshot is kept; automatic
					saving is paused.
				</span>
				<button onclick={downloadUnrestoredWorkspace}>Download original snapshot</button>
				<button onclick={startNewWorkspaceAfterRecovery}>Start new workspace</button>
			</div>
		{/if}
	</div>
	{#if manualShareUrl}
		<div class="workspace-share">
			<label class="args-chip">
				<span>Share URL</span>
				<input
					aria-label="Share URL"
					value={manualShareUrl}
					readonly
					onfocus={(event) => event.currentTarget.select()}
					onclick={(event) => event.currentTarget.select()}
				/>
			</label>
			<button class="tool-button" onclick={() => (manualShareUrl = '')}
				>Close share URL</button
			>
		</div>
	{/if}
	<div class="workbench">
		{#if sidebarOpen}
			<button
				aria-label="Close explorer"
				class="sidebar-backdrop"
				onclick={() => (sidebarOpen = false)}
			></button>
			<aside class="workspace-sidebar">
				<header class="workspace-sidebar__header">
					<div class="workspace-sidebar__title">
						<strong>Files</strong>
						<span class="count-badge">{sortedFiles.length}</span>
					</div>
					<div class="workspace-sidebar__tools">
						<button
							aria-label="Refresh workspace files"
							title="Refresh files changed in the terminal"
							onclick={() => refreshContainerWorkspace(true)}
						>
							<span class="material-symbols-outlined" aria-hidden="true">refresh</span
							>
						</button>
						<button aria-label="New file" title="New file" onclick={newFile}>
							<span class="material-symbols-outlined" aria-hidden="true">add</span>
						</button>
						<button
							aria-label="Upload files"
							title="Upload files"
							onclick={() => fileInput?.click()}
							disabled={!!runningMode}
						>
							<span class="material-symbols-outlined" aria-hidden="true">upload</span>
						</button>
						<button
							class="workspace-sidebar__close"
							aria-label="Close explorer"
							onclick={() => (sidebarOpen = false)}
						>
							<span class="material-symbols-outlined" aria-hidden="true">close</span>
						</button>
					</div>
				</header>
				<p class="workspace-path" title={`Current editor project: /workspace/${language}`}>
					/workspace/{language}
				</p>
				<div class="workspace-files">
					{#each sortedFiles as file (file.path)}
						<button
							class:active={file.path === activePath}
							onclick={() => selectFile(file.path)}
							title={file.path}
						>
							<i class="file-dot" aria-hidden="true"></i>
							<span>{basename(file.path)}</span>
							<small>{extension(file.path).replace('.', '') || 'txt'}</small>
						</button>
					{/each}
				</div>
				<section class="shared-workspace" aria-label="Shared workspace files">
					<header>
						<strong>/workspace</strong>
						<span class="count-badge">{sharedWorkspaceFiles.length}</span>
					</header>
					<p>Shared with Bash. Selecting a language also changes the shell directory.</p>
					{#if shellDirectoryPending}
						<p role="status">Shell directory change queued until Bash is ready.</p>
					{/if}
					<ContainerExplorer
						entries={sharedWorkspaceFiles}
						selectedPath={`${language}/${activePath}`}
						initialDirectory={language}
						busy={!!runningMode || sharedWorkspaceOpening}
						onOpenFile={selectSharedWorkspaceFile}
					/>

					<p>
						Files outside language projects and symbolic links are listed for terminal
						access.
					</p>
				</section>
				<div class="workspace-sidebar__section">
					<p class="section-label">Active file</p>
					<div class="workspace-sidebar__actions">
						<button onclick={renameActiveFile} disabled={!!runningMode}>
							<span class="material-symbols-outlined" aria-hidden="true">edit</span>
							<span>Rename</span>
						</button>
						<button onclick={duplicateActiveFile}>
							<span class="material-symbols-outlined" aria-hidden="true"
								>content_copy</span
							>
							<span>Duplicate</span>
						</button>
						<button onclick={downloadActiveFile}>
							<span class="material-symbols-outlined" aria-hidden="true"
								>download</span
							>
							<span>Download</span>
						</button>
						<button class="danger" onclick={deleteActiveFile} disabled={!!runningMode}>
							<span class="material-symbols-outlined" aria-hidden="true">delete</span>
							<span>Delete</span>
						</button>
					</div>
					<p class="section-label">Workspace</p>
					<div class="workspace-sidebar__actions">
						<button onclick={downloadZip}>
							<span class="material-symbols-outlined" aria-hidden="true"
								>folder_zip</span
							>
							<span>ZIP</span>
						</button>
						<button onclick={resetWorkspace} disabled={!!runningMode}>
							<span class="material-symbols-outlined" aria-hidden="true">history</span
							>
							<span>Reset</span>
						</button>
					</div>
				</div>
			</aside>
		{/if}
		<div class="workbench-split" bind:this={splitPane} bind:clientWidth={splitPaneWidth}>
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
									<span class="material-symbols-outlined" aria-hidden="true"
										>close</span
									>
								</button>
							{/if}
						</div>
					{/each}
				</nav>
				<div class="editor-surface">
					{#key `${currentWorkspaceStorageKey}:${language}:${editorWorkspaceRevision}`}
						<Monaco
							language={editorLanguage}
							lspLanguage={monacoLspLanguage}
							filePath={activePath}
							workspacePaths={editorFilePaths}
							rustTargetTriple={languageExecutionOptions.rustTargetTriple}
							goTarget={languageExecutionOptions.goTarget}
							bind:editor
							value={activeFile?.content ?? ''}
							onChange={updateActiveContent}
							{compact}
							dark={darkMode}
							{lspEnabled}
							{grainLspBaseUrl}
							{grainLspWorkspaceFiles}
							{rescriptLspBaseUrl}
							{rescriptLspWorkspaceFiles}
							{javaLspEnabled}
							{javaLspRuntime}
							{javaLspWorkspaceFiles}
							clangdEnabled={clangdLspEnabled}
							{clangdBaseUrl}
							clangdRuntimeAssets={runtimeAssets}
							clangdCppVersion={cppVersion}
							clangdCVersion={languageExecutionOptions.cVersion}
							clangdCompileArgs={clangdCompilerArgs}
							clangdSourceLanguage={compilerSourceLanguage === 'C'
								? 'C'
								: compilerSourceLanguage === 'OBJC'
									? 'OBJC'
									: compilerSourceLanguage === 'OBJECTIVECXX'
										? 'OBJCXX'
										: 'CPP'}
							{dotnetLspEnabled}
							{dotnetLspModuleUrl}
							{elixirLspEnabled}
							{elixirLspBundleUrl}
							elixirLspWorkerUrl={beamLspWorkerUrl}
							{elixirLspIntegrity}
							{erlangLspEnabled}
							{erlangLspBundleUrl}
							erlangLspWorkerUrl={beamLspWorkerUrl}
							{erlangLspIntegrity}
							{gleamLspEnabled}
							{phpLspEnabled}
							{phpLspWasmUrl}
							{forthLspEnabled}
							{forthLspWasmUrl}
							{c3LspEnabled}
							{c3LspBaseUrl}
							{vLspEnabled}
							{vLspBaseUrl}
							{gleamLspBaseUrl}
							{gleamLspManifestUrl}
							{gleamLspManifestFingerprint}
							{dLspEnabled}
							{dLspModuleUrl}
							{dLspManifestUrl}
							{dLspIntegrity}
							{lean4LspEnabled}
							{lean4LspBaseUrl}
							{tclLspEnabled}
							{tclLspBaseUrl}
							{tclLspWorkerUrl}
							{pascalLspEnabled}
							{pascalLspRuntime}
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
							{janetLspRuntime}
							{lispLspEnabled}
							{lispLspModuleUrl}
							{lispLspManifestUrl}
							{lispLspManifestFingerprint}
							{ocamlLspEnabled}
							{ocamlLspModuleUrl}
							{ocamlLspManifestUrl}
							{haskellLspEnabled}
							{haskellLspModuleUrl}
							{haskellLspRootfsUrl}
							{haskellLspBsdtarUrl}
							{haskellLspIntegrity}
							{fortranLspAnalyzerUrl}
							{assemblyScriptLspModuleUrl}
							{duckDbLspModuleUrl}
							{cobolLspEnabled}
							{cobolLspBaseUrl}
							{cobolLspWorkspaceFiles}
							{nimLspEnabled}
							{nimLspBaseUrl}
							{nimLspWorkspaceFiles}
							{sqlLspEnabled}
							{sqlLspModuleUrl}
							{postgresqlLspEnabled}
							{postgresqlLspModuleUrl}
							{bashLspEnabled}
							{bashLspModuleUrl}
							{bashLspFiles}
							{prologLspEnabled}
							{prologLspBaseUrl}
							{prologLspWorkerUrl}
							{rubyLspEnabled}
							{rubyLspRuntime}
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
							{perlLspRuntime}
							{fennelLspBaseUrl}
							{pythonLspBaseUrl}
							{typescriptLspLibUrl}
							breakpoints={debug.effectiveBreakpoints}
							debugLocals={debug.locals}
							{debugLanguage}
							{compilerDiagnostics}
							pausedLine={debug.pausedLine}
							bind:lspStatus={editorLspStatus}
							onCursorLineChange={debug.setCursorLine}
							onRunToCursor={runToCursorWhileDataBreakpointIdle}
							onAddWatch={(expression) => {
								debug.addWatchExpression(expression);
							}}
							onEditBreakpoint={editDebugBreakpoint}
							{debugHoverOptions}
							debugHoverEnabled={debug.paused &&
								!debug.sourceRevisionStale &&
								debug.selectedHistoryId === null}
							debugStopKey={`${debug.history.at(-1)?.id ?? 0}:${debug.frameId ?? 0}`}
							onBreakpointsChange={debug.setBreakpoints}
						/>
					{/key}
				</div>
			</section>
			<!-- A focusable separator is the WAI-ARIA window splitter widget, not static content. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class:panel-resizer--active={resizingPane}
				class="panel-resizer"
				role="separator"
				aria-label="Resize example panes"
				aria-orientation="vertical"
				aria-hidden={!desktopExampleLayout}
				tabindex={desktopExampleLayout ? 0 : -1}
				aria-valuemin={desktopExampleLayout ? minTerminalPaneWidth : undefined}
				aria-valuemax={desktopExampleLayout ? maxTerminalPaneWidth : undefined}
				aria-valuenow={desktopExampleLayout
					? (terminalPanePixelWidth ?? undefined)
					: undefined}
				onpointerdown={(event) => {
					if (!desktopExampleLayout || !splitPane) return;
					event.preventDefault();
					const handle = event.currentTarget as HTMLDivElement;
					const pointerId = event.pointerId;
					const rect = splitPane.getBoundingClientRect();
					const updateWidth = (clientX: number) => {
						terminalPaneWidth = Math.min(
							Math.max(
								rect.right - clientX - panelResizerWidth / 2,
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
					const step = event.key === 'ArrowLeft' ? 24 : -24;
					const currentWidth =
						terminalPanePixelWidth ?? Math.round(resizablePaneWidth * 0.42);
					terminalPaneWidth = Math.min(
						Math.max(currentWidth + step, minTerminalPaneWidth),
						maxTerminalPaneWidth
					);
				}}
			>
				<span class="panel-resizer__thumb" aria-hidden="true"></span>
			</div>
			<div
				class="terminal-pane"
				style:width={terminalPanePixelWidth === null
					? undefined
					: `${terminalPanePixelWidth}px`}
			>
				<header class="pane-header">
					<div class="pane-title">
						<span class="material-symbols-outlined" aria-hidden="true">terminal</span>
						<strong>Console</strong>
						{#if runningMode}
							<span
								class="run-indicator"
								class:run-indicator--debug={runningMode === 'debug'}
							>
								<i aria-hidden="true"></i>
								{runningMode === 'debug'
									? 'Debugging'
									: runningMode === 'compile'
										? 'Compiling'
										: 'Running'}
							</span>
						{/if}
					</div>
					<div class="console-controls">
						<button
							class="action-button action-button--icon"
							onclick={sendTerminalEof}
							disabled={!runningMode || runningMode === 'compile'}
							title="Send EOF"
							aria-label="Send EOF"
						>
							<span class="material-symbols-outlined" aria-hidden="true"
								>keyboard_tab_rtl</span
							>
						</button>
					</div>
				</header>
				<div class="console-body">
					{#if loading}
						<div class="progress-shell" aria-live="polite">
							<div class="progress-copy">
								<div class="progress-copy__text">
									<span class="material-symbols-outlined" aria-hidden="true"
										>hourglass_top</span
									>
									<strong>{progressLabel}</strong>
								</div>
								{#if !progressIndeterminate}
									<span class="progress-percent">{progressPercent}%</span>
								{/if}
							</div>
							<div
								class="progress-track"
								class:progress-track--indeterminate={progressIndeterminate}
								role="progressbar"
								aria-label={progressLabel}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={progressIndeterminate ? undefined : progressPercent}
								aria-valuetext={progressIndeterminate
									? progressLabel
									: `${progressPercent}%`}
								data-progress-mode={progressIndeterminate
									? 'indeterminate'
									: 'determinate'}
							>
								<div
									class="progress-fill"
									style={progressIndeterminate
										? undefined
										: `transform: scaleX(${progressValue})`}
								></div>
							</div>
						</div>
					{/if}
					{#if workspaceSaveState.phase === 'conflict'}
						<div class="workspace-save-error" role="alert">
							<span
								>Another tab changed this workspace. Your edits are still in this
								tab.</span
							>
							<button onclick={saveWorkspaceCopy} disabled={!!runningMode}
								>Save a separate copy</button
							>
							<button onclick={downloadWorkspaceBackup}>Export workspace</button>
						</div>
					{:else if workspaceSaveState.phase === 'error'}
						<div class="workspace-save-error" role="alert">
							<span
								>Not saved locally. Keep this tab open and retry or download a
								workspace backup.</span
							>
							<button onclick={() => saveWorkspace(true)}>Retry save</button>
							<button onclick={downloadWorkspaceBackup}>Export workspace</button>
						</div>
					{/if}
					{#if !sharedBufferAvailable || preloadedStdinLanguages.has(language)}
						<div class="stdin-panel">
							<div>
								<strong>Preloaded stdin</strong>
								<span>
									{language === 'BASH'
										? 'The Bash WASIX package accepts stdin when the process starts. Enter it before Run; extra reads receive EOF.'
										: language === 'POSTGRESQL'
											? "PostgreSQL reads this input as the server file '/dev/blob' (COPY ... FROM '/dev/blob' or pg_read_file('/dev/blob')). Enter it before Run."
											: 'SharedArrayBuffer is unavailable here, so terminal input cannot be sent while the program is running. Enter stdin before Run; extra reads receive EOF.'}
								</span>
							</div>
							<textarea
								bind:value={stdinInput}
								aria-label="Preloaded stdin"
								placeholder="Input to pass before running"
								spellcheck={false}></textarea>
						</div>
					{/if}
					{@render consoleTail()}
				</div>
			</div>
		</div>
	</div>
	<footer class="statusbar">
		<div class="statusbar__group">
			<!-- Not a live region: autosave flips this after every edit; failed saves raise an alert. -->
			<span
				class="save-state save-state--{workspaceSaveState.phase}"
				data-workspace-save-state={workspaceSaveState.phase}
			>
				<i aria-hidden="true"></i>
				{workspaceSaveState.phase === 'saved'
					? 'Saved locally'
					: workspaceSaveState.phase === 'saving'
						? 'Saving…'
						: 'Not saved locally'}
			</span>
			<span class="statusbar__message">{saveStatus}</span>
		</div>
		<div class="statusbar__group statusbar__group--end">
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
			<span class="statusbar__meta">{activeLines} lines</span>
			<span class="statusbar__meta">{activeBytes} bytes</span>
			<span class="statusbar__divider" aria-hidden="true"></span>
			<label class="switch" for="log-toggle" title="Show runtime logs in the console">
				<input id="log-toggle" type="checkbox" bind:checked={log} />
				<span>Log</span>
			</label>
			<label
				class="switch"
				for="prewarm-toggle"
				title="Prepare the selected runtime during idle time. Does not run your code."
			>
				<input id="prewarm-toggle" type="checkbox" bind:checked={prewarmEnabled} />
				<span>Prewarm</span>
			</label>
			<label class="switch" for="lsp-toggle" title="Language server features in the editor">
				<input id="lsp-toggle" type="checkbox" bind:checked={lspEnabled} />
				<span>LSP</span>
			</label>
		</div>
	</footer>
</main>

<style>
	:global(body) {
		background: #f2f4f6;
	}

	:global(html[data-theme='dark'] body) {
		background: #101012;
	}

	.ide {
		--bg: #f2f4f6;
		--surface: #ffffff;
		--surface-muted: #f9fafb;
		--fill: #f2f4f6;
		--fill-strong: #e5e8eb;
		--line: #e5e8eb;
		--line-soft: #f2f4f6;
		--text: #191f28;
		--text-2: #4e5968;
		--text-3: #8b95a1;
		--text-4: #b0b8c1;
		--primary: #3182f6;
		--primary-strong: #1b64da;
		--primary-soft: #e8f3ff;
		--danger: #f04452;
		--danger-soft: #ffeeee;
		--success: #03b26c;
		--warning: #ff9f00;
		--warning-soft: #fff6e5;
		--debug-tone: #7b61ff;
		--debug-tone-soft: #f1edff;
		--primary-soft-strong: #d6e8ff;
		--success-soft: #e5f8f0;
		--warning-text: #6b4500;
		--danger-text: #b0202d;
		--topbar-bg: rgba(255, 255, 255, 0.86);
		--overlay: rgba(232, 243, 255, 0.86);
		color-scheme: light;
		--radius-lg: 16px;
		--radius-md: 12px;
		--radius-sm: 8px;
		--shadow-card: 0 1px 2px rgba(0, 23, 51, 0.04), 0 2px 12px rgba(0, 23, 51, 0.04);
		--mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		width: 100%;
		height: 100vh;
		height: 100dvh;
		min-width: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto auto auto minmax(0, 1fr) auto;
		box-sizing: border-box;
		overflow: hidden;
		background: var(--bg);
		color: var(--text);
		font-family:
			-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, 'Apple SD Gothic Neo',
			Pretendard, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif;
		font-size: 13px;
		letter-spacing: -0.01em;
		-webkit-font-smoothing: antialiased;
	}

	.ide[data-theme='dark'] {
		--bg: #101012;
		--surface: #1b1b1e;
		--surface-muted: #222226;
		--fill: #2a2a2f;
		--fill-strong: #35353b;
		--line: #2a2a2f;
		--line-soft: #25252a;
		--text: #f2f3f5;
		--text-2: #c3c7ce;
		--text-3: #8b9099;
		--text-4: #5c6169;
		--primary: #4593fc;
		--primary-strong: #2f80f0;
		--primary-soft: rgba(69, 147, 252, 0.16);
		--primary-soft-strong: rgba(69, 147, 252, 0.26);
		--danger: #f5525f;
		--danger-soft: rgba(245, 82, 95, 0.15);
		--danger-text: #ff8a94;
		--success: #2ac985;
		--success-soft: rgba(42, 201, 133, 0.15);
		--warning: #ffb331;
		--warning-soft: rgba(255, 179, 49, 0.12);
		--warning-text: #ffd48a;
		--debug-tone: #9d8bff;
		--debug-tone-soft: rgba(157, 139, 255, 0.16);
		--topbar-bg: rgba(27, 27, 30, 0.82);
		--overlay: rgba(16, 16, 18, 0.8);
		--shadow-card: 0 0 0 1px rgba(255, 255, 255, 0.04), 0 2px 12px rgba(0, 0, 0, 0.3);
		color-scheme: dark;
	}

	.ide,
	.ide div,
	.ide section,
	.ide aside,
	.ide header,
	.ide nav,
	.ide footer,
	.ide label,
	.ide button,
	.ide input,
	.ide select,
	.ide textarea {
		box-sizing: border-box;
	}

	.ide button,
	.ide input,
	.ide select,
	.ide textarea {
		font-family: inherit;
		letter-spacing: inherit;
	}

	.ide button {
		-webkit-tap-highlight-color: transparent;
	}

	.ide :global(:focus-visible) {
		outline: 2px solid rgba(49, 130, 246, 0.45);
		outline-offset: 2px;
	}

	.hidden-input {
		display: none;
	}

	/* ---------- Top bar ---------- */

	.topbar {
		grid-row: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 60px;
		padding: 10px 16px;
		background: var(--topbar-bg);
		backdrop-filter: saturate(180%) blur(20px);
		-webkit-backdrop-filter: saturate(180%) blur(20px);
		border-bottom: 1px solid var(--line);
		position: relative;
		z-index: 5;
	}

	.topbar__lead,
	.topbar__actions,
	.topbar__config {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.topbar__lead {
		flex: 1 1 auto;
	}

	.topbar__config {
		flex-wrap: wrap;
	}

	.topbar__actions {
		flex: 0 0 auto;
	}

	.topbar__divider,
	.statusbar__divider {
		width: 1px;
		height: 20px;
		background: var(--line);
		flex: 0 0 auto;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		padding-right: 4px;
		white-space: nowrap;
	}

	.brand strong {
		font-size: 15px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.brand__mark {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		border-radius: 9px;
		background: linear-gradient(145deg, #4c9bff 0%, #3182f6 55%, #1b64da 100%);
		color: white;
		box-shadow: 0 4px 10px rgba(49, 130, 246, 0.28);
	}

	.icon-button {
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		padding: 0;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.icon-button:hover {
		background: var(--fill);
	}

	.icon-button--active {
		color: var(--primary);
	}

	.icon-button .material-symbols-outlined {
		font-size: 20px;
	}

	.select-chip,
	.args-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 6px 0 10px;
		border-radius: 10px;
		background: var(--fill);
		color: var(--text);
		font-weight: 600;
		transition: background-color 0.15s ease;
	}

	.select-chip:hover,
	.args-chip:focus-within {
		background: var(--fill-strong);
	}

	.select-chip .material-symbols-outlined,
	.args-chip .material-symbols-outlined {
		color: var(--text-3);
		font-size: 18px;
	}

	.select-chip select,
	.args-chip input {
		height: 100%;
		border: 0;
		background: transparent;
		font: inherit;
		font-weight: 600;
		color: inherit;
		outline: none;
	}

	.select-chip select {
		padding-right: 2px;
		cursor: pointer;
	}

	.select-chip select:disabled {
		cursor: progress;
		color: var(--text-3);
	}

	.language-picker {
		position: relative;
		display: inline-flex;
	}

	.language-trigger {
		border: 0;
		padding: 0 8px 0 10px;
		font-size: 14px;
		font-weight: 700;
		cursor: pointer;
	}

	.language-trigger:disabled {
		cursor: progress;
		color: var(--text-3);
	}

	.language-trigger[aria-expanded='true'] {
		background: var(--fill-strong);
	}

	.language-trigger__label {
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.select-chip .language-trigger__chevron {
		font-size: 18px;
		transition: transform 0.15s ease;
	}

	.language-trigger[aria-expanded='true'] .language-trigger__chevron {
		transform: rotate(180deg);
	}

	/* Invisible but still "visible" to automation so selectOption keeps working. */
	.language-picker__native {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		pointer-events: none;
	}

	.language-menu {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 30;
		width: min(300px, calc(100vw - 24px));
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow:
			0 0 0 1px var(--line),
			0 16px 40px rgba(0, 23, 51, 0.16);
		overflow: hidden;
		animation: language-menu-in 0.14s ease-out;
	}

	@keyframes language-menu-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}

	.language-menu__search {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 48px;
		padding: 0 12px;
		border-bottom: 1px solid var(--line-soft);
	}

	.language-menu__search .material-symbols-outlined {
		color: var(--text-3);
		font-size: 18px;
	}

	.language-menu__search input {
		flex: 1 1 auto;
		min-width: 0;
		height: 100%;
		border: 0;
		background: transparent;
		color: var(--text);
		font-size: 15px;
		font-weight: 500;
		outline: none;
	}

	.language-menu__search input:focus-visible {
		outline: none;
	}

	.language-menu__search input::placeholder {
		color: var(--text-4);
	}

	.language-menu__search input::-webkit-search-cancel-button {
		display: none;
	}

	.language-menu__count {
		padding: 2px 7px;
		border-radius: 6px;
		background: var(--fill);
		color: var(--text-3);
		font-size: 11px;
		font-weight: 600;
	}

	.language-menu__list {
		max-height: min(360px, 60vh);
		margin: 0;
		padding: 6px;
		overflow-y: auto;
		list-style: none;
		overscroll-behavior: contain;
	}

	.language-menu__list li[role='option'] {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-height: 36px;
		padding: 0 10px;
		border-radius: 8px;
		color: var(--text);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
	}

	.language-menu__list li.highlighted {
		background: var(--fill);
	}

	.language-menu__list li[aria-selected='true'] {
		color: var(--primary);
		font-weight: 700;
	}

	.language-menu__list li .material-symbols-outlined {
		font-size: 18px;
	}

	.language-menu__empty {
		padding: 20px 10px;
		color: var(--text-3);
		font-size: 13px;
		text-align: center;
	}

	.args-chip input {
		width: 180px;
		min-width: 64px;
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 500;
	}

	.args-chip input::placeholder {
		color: var(--text-4);
	}

	.args-chip > span:last-child {
		padding: 2px 7px;
		border-radius: 6px;
		background: var(--surface);
		color: var(--text-3);
		font-size: 11px;
		font-weight: 600;
		white-space: nowrap;
	}

	.args-chip:has(input[aria-invalid='true']) {
		background: var(--danger-soft);
	}

	.topbar__config > [role='alert'] {
		color: var(--danger);
		font-size: 12px;
		font-weight: 600;
	}

	.tool-button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 12px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: var(--text-2);
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
	}

	.tool-button:enabled:hover {
		background: var(--fill);
		color: var(--text);
	}

	.tool-button:disabled {
		color: var(--text-4);
		cursor: not-allowed;
	}

	.tool-button .material-symbols-outlined {
		font-size: 18px;
	}

	.action-group {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.action-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 36px;
		padding: 0 16px;
		border: 0;
		border-radius: 10px;
		font-size: 14px;
		font-weight: 700;
		white-space: nowrap;
		cursor: pointer;
		transition:
			transform 0.12s ease,
			background-color 0.15s ease,
			box-shadow 0.15s ease,
			opacity 0.15s ease;
	}

	.action-button:enabled:active {
		transform: scale(0.97);
	}

	.action-button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.action-button .material-symbols-outlined {
		font-size: 19px;
		font-variation-settings:
			'FILL' 1,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.action-button--run {
		min-width: 92px;
		background: var(--primary);
		color: white;
		box-shadow: 0 4px 12px rgba(49, 130, 246, 0.3);
	}

	.action-button--run:enabled:hover {
		background: var(--primary-strong);
	}

	.action-button--debug,
	.action-button--debug-restart {
		background: var(--primary-soft);
		color: var(--primary);
	}

	.action-button--debug:enabled:hover,
	.action-button--debug-restart:enabled:hover {
		background: var(--primary-soft-strong);
	}

	.action-button--stop {
		min-width: 92px;
		background: var(--danger);
		color: white;
		box-shadow: 0 4px 12px rgba(240, 68, 82, 0.28);
	}

	.action-button--stop:enabled:hover {
		background: #d22030;
	}

	/* ---------- Workbench ---------- */

	.workbench {
		grid-row: 4;
		display: flex;
		gap: 8px;
		min-height: 0;
		padding: 8px;
	}

	.sidebar-backdrop {
		display: none;
	}

	.workspace-sidebar {
		flex: 0 0 240px;
		width: 240px;
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}

	.workspace-sidebar__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		height: 48px;
		padding: 0 8px 0 16px;
	}

	.workspace-sidebar__title {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.workspace-sidebar__title strong {
		font-size: 14px;
		font-weight: 700;
	}

	.count-badge {
		min-width: 20px;
		height: 20px;
		display: inline-grid;
		place-items: center;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--fill);
		color: var(--text-3);
		font-size: 11px;
		font-weight: 700;
	}

	.workspace-sidebar__tools {
		display: flex;
		gap: 2px;
	}

	.workspace-sidebar__tools button {
		width: 30px;
		height: 30px;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--text-2);
		cursor: pointer;
	}

	.workspace-sidebar__tools button:hover {
		background: var(--fill);
		color: var(--text);
	}

	.workspace-sidebar__tools button:disabled {
		background: transparent;
		color: var(--text-4);
		cursor: not-allowed;
	}

	.workspace-sidebar__tools .material-symbols-outlined {
		font-size: 19px;
	}

	.workspace-sidebar__close {
		display: none !important;
	}

	.workspace-files {
		flex: 1 1 auto;
		min-height: 0;
		overflow: auto;
		padding: 0 8px 8px;
	}

	.workspace-path {
		margin: 0 16px 8px;
		color: var(--text-3);
		font-family: var(--mono);
		font-size: 11px;
		overflow-wrap: anywhere;
	}

	.shared-workspace {
		display: flex;
		flex: 0 1 280px;
		flex-direction: column;
		min-height: 140px;
		border-top: 1px solid var(--line-soft);
		padding: 10px 8px;
	}

	.shared-workspace header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 8px;
	}

	.shared-workspace header strong {
		font-family: var(--mono);
		font-size: 12px;
	}

	.shared-workspace p {
		margin: 6px 8px;
		color: var(--text-3);
		font-size: 10px;
		line-height: 1.45;
	}

	.workspace-files button {
		width: 100%;
		height: 36px;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 0 10px;
		border: 0;
		border-radius: 10px;
		background: transparent;
		color: var(--text-2);
		font-size: 13px;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		transition: background-color 0.12s ease;
	}

	.workspace-files button:hover {
		background: var(--surface-muted);
		color: var(--text);
	}

	.workspace-files button.active {
		background: var(--primary-soft);
		color: var(--primary-strong);
		font-weight: 650;
	}

	.file-dot {
		width: 8px;
		height: 8px;
		flex: 0 0 auto;
		border-radius: 3px;
		background: var(--text-4);
	}

	.workspace-files button.active .file-dot {
		background: var(--primary);
	}

	.workspace-files span {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.workspace-files small {
		color: var(--text-3);
		font-family: var(--mono);
		font-size: 10px;
		text-transform: lowercase;
	}

	.workspace-sidebar__section {
		padding: 12px 12px 14px;
		border-top: 1px solid var(--line-soft);
	}

	.section-label {
		margin: 4px 4px 8px;
		color: var(--text-3);
		font-size: 11px;
		font-weight: 600;
	}

	.section-label:not(:first-child) {
		margin-top: 14px;
	}

	.workspace-sidebar__actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 6px;
	}

	.workspace-sidebar__actions button {
		height: 34px;
		display: inline-flex;
		align-items: center;
		justify-content: flex-start;
		gap: 6px;
		padding: 0 10px;
		border: 0;
		border-radius: 9px;
		background: var(--fill);
		color: var(--text-2);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 0.12s ease;
	}

	.workspace-sidebar__actions button:hover {
		background: var(--fill-strong);
		color: var(--text);
	}

	.workspace-sidebar__actions button.danger:hover {
		background: var(--danger-soft);
		color: var(--danger);
	}

	.workspace-sidebar__actions button:disabled,
	.workspace-sidebar__actions button.danger:disabled {
		background: var(--fill);
		color: var(--text-4);
		cursor: not-allowed;
	}

	.workspace-sidebar__actions .material-symbols-outlined {
		font-size: 16px;
	}

	.workbench-split {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		display: flex;
	}

	/* ---------- Editor ---------- */

	.editor-column {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-card);
	}

	.file-tabs {
		flex: 0 0 48px;
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		padding: 0 8px;
		overflow-x: auto;
		border-bottom: 1px solid var(--line-soft);
		scrollbar-width: none;
	}

	.file-tab {
		display: flex;
		align-items: center;
		flex: 0 0 auto;
		max-width: 220px;
		height: 32px;
		border-radius: 8px;
		color: var(--text-3);
		transition:
			background-color 0.12s ease,
			color 0.12s ease;
	}

	.file-tab:hover {
		background: var(--surface-muted);
		color: var(--text-2);
	}

	.file-tab.active {
		background: var(--fill);
		color: var(--text);
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
		padding: 0 12px;
		font-size: 13px;
		font-weight: 600;
	}

	.file-tab button:nth-child(2) {
		width: 24px;
		height: 24px;
		margin-right: 4px;
		display: grid;
		place-items: center;
		padding: 0;
		border-radius: 6px;
		color: var(--text-3);
	}

	.file-tab button:nth-child(2):hover {
		background: var(--fill-strong);
		color: var(--text);
	}

	.file-tab:has(button:nth-child(2)) button:first-child {
		padding-right: 4px;
	}

	.file-tab .material-symbols-outlined {
		font-size: 15px;
	}

	.editor-surface {
		letter-spacing: normal;
		flex: 1 1 auto;
		min-height: 0;
		position: relative;
		display: flex;
		flex-direction: column;
	}

	/* ---------- Resizer ---------- */

	.panel-resizer {
		flex: 0 0 12px;
		width: 12px;
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

	.panel-resizer__thumb {
		width: 4px;
		height: 40px;
		border-radius: 999px;
		background: var(--fill-strong);
		transition:
			height 0.18s ease,
			background-color 0.18s ease;
	}

	.panel-resizer:hover .panel-resizer__thumb,
	.panel-resizer:focus-visible .panel-resizer__thumb,
	.panel-resizer--active .panel-resizer__thumb {
		height: 72px;
		background: var(--primary);
	}

	/* ---------- Console ---------- */

	.terminal-pane {
		flex: 0 0 auto;
		width: 42%;
		min-width: 300px;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-card);
	}

	.pane-header {
		flex: 0 0 48px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 0 8px 0 16px;
		border-bottom: 1px solid var(--line-soft);
	}

	.pane-title {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}

	.pane-title strong {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.pane-title > .material-symbols-outlined {
		color: var(--text-3);
		font-size: 18px;
	}

	.pane-title strong {
		font-size: 14px;
		font-weight: 700;
	}

	.run-indicator {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 22px;
		padding: 0 8px;
		border-radius: 999px;
		background: var(--success-soft);
		color: var(--success);
		font-size: 11px;
		font-weight: 700;
	}

	.run-indicator i {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: currentColor;
		animation: pulse 1.2s ease-in-out infinite;
	}

	.run-indicator--debug {
		background: var(--debug-tone-soft);
		color: var(--debug-tone);
	}

	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}

	.console-controls {
		flex: none;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.action-button--icon {
		width: 30px;
		min-width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--text-2);
		box-shadow: none;
	}

	.action-button--icon:enabled:hover {
		background: var(--surface);
		color: var(--text);
		box-shadow: 0 1px 3px rgba(0, 23, 51, 0.08);
	}

	.action-button--icon:disabled {
		opacity: 0.32;
	}

	.action-button--icon .material-symbols-outlined {
		font-size: 18px;
		font-variation-settings:
			'FILL' 0,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.console-controls > .action-button--icon {
		background: var(--fill);
	}

	.console-body {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		overflow-y: auto;
	}

	.stdin-panel {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 10px;
		padding: 14px;
		border-radius: var(--radius-md);
		background: var(--warning-soft);
		color: var(--warning-text);
	}

	.stdin-panel > div {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		line-height: 1.5;
	}

	.stdin-panel strong {
		color: var(--text);
		font-size: 13px;
	}

	.stdin-panel textarea {
		width: 100%;
		min-height: 86px;
		resize: vertical;
		padding: 10px 12px;
		border: 1px solid transparent;
		border-radius: 10px;
		background: var(--surface);
		color: var(--text);
		font: 12px/1.5 var(--mono);
		outline: none;
		transition: border-color 0.15s ease;
	}

	.stdin-panel textarea:focus {
		border-color: var(--warning);
	}

	.workspace-share {
		grid-row: 3;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		padding: 12px 16px;
		background: var(--surface);
		border-bottom: 1px solid var(--line);
	}

	.workspace-share .args-chip {
		flex: 1 1 240px;
	}

	.workspace-share input {
		width: 100%;
	}

	.workspace-configuration {
		grid-row: 2;
		min-width: 0;
		max-height: 40dvh;
		overflow: auto;
	}

	.python-bytecode-options {
		border-bottom: 1px solid var(--line);
		background: var(--surface);
		color: var(--text);
	}

	.python-bytecode-options summary {
		cursor: pointer;
		padding: 8px 18px;
		font-weight: 600;
	}

	.python-bytecode-options__body {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 18px;
		padding: 4px 18px 14px;
	}

	.python-bytecode-options__field {
		display: grid;
		gap: 5px;
		max-width: 100%;
		font-size: 12px;
		font-weight: 600;
	}

	.python-bytecode-options select,
	.python-bytecode-options input {
		min-width: 0;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--fill);
		color: var(--text);
		padding: 6px 8px;
		font: inherit;
	}

	.python-bytecode-options p {
		flex-basis: 100%;
		margin: 0;
		color: var(--text-3);
		font-size: 12px;
	}

	.python-bytecode-options p[role='alert'] {
		color: var(--danger-text);
	}

	.workspace-save-error {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		padding: 12px 14px;
		border-radius: var(--radius-md);
		background: var(--danger-soft);
		color: var(--danger-text);
		font-size: 12px;
		font-weight: 600;
	}

	.workspace-save-error span {
		flex: 1 1 200px;
	}

	.workspace-save-error button {
		height: 30px;
		padding: 0 12px;
		border: 0;
		border-radius: 8px;
		background: var(--surface);
		color: var(--danger);
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
	}

	.progress-shell {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px;
		border-radius: var(--radius-md);
		background: var(--primary-soft);
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
		min-width: 0;
		color: var(--text);
	}

	.progress-copy__text .material-symbols-outlined {
		color: var(--primary);
		font-size: 18px;
	}

	.progress-copy__text strong {
		font-size: 13px;
		font-weight: 650;
	}

	.progress-percent {
		color: var(--primary);
		font-size: 13px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.progress-track {
		height: 6px;
		overflow: hidden;
		border-radius: 999px;
		background: rgba(49, 130, 246, 0.16);
	}

	.progress-fill {
		width: 100%;
		height: 100%;
		border-radius: inherit;
		transform-origin: left center;
		background: var(--primary);
		transition: transform 0.2s ease;
	}

	.progress-track--indeterminate .progress-fill {
		transform: scaleX(1);
		transform-origin: center;
		animation: progress-activity 1.4s ease-in-out infinite;
	}

	@keyframes progress-activity {
		0%,
		100% {
			opacity: 0.35;
		}

		50% {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.progress-track--indeterminate .progress-fill {
			animation: none;
			opacity: 0.65;
		}

		.run-indicator i {
			animation: none;
		}
	}

	.terminal-shell {
		letter-spacing: normal;
		flex: 1 1 auto;
		min-width: 0;
		min-height: 260px;
		overflow: hidden;
	}

	.terminal-shell :global(.xterm .xterm-viewport) {
		scrollbar-width: thin;
		scrollbar-color: var(--fill-strong) transparent;
	}

	.terminal-shell :global(.xterm .xterm-viewport::-webkit-scrollbar) {
		width: 10px;
	}

	.terminal-shell :global(.xterm .xterm-viewport::-webkit-scrollbar-track) {
		background: transparent;
	}

	.terminal-shell :global(.xterm .xterm-viewport::-webkit-scrollbar-thumb) {
		border: 3px solid transparent;
		border-radius: 999px;
		background: var(--fill-strong) padding-box;
	}

	.terminal-shell :global(.xterm:hover .xterm-viewport::-webkit-scrollbar-thumb),
	.terminal-shell :global(.xterm .xterm-viewport::-webkit-scrollbar-thumb:hover) {
		background: var(--text-4) padding-box;
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
		width: 1em;
		flex: none;
		overflow: hidden;
		white-space: nowrap;
		word-wrap: normal;
		direction: ltr;
		font-feature-settings: 'liga';
		-webkit-font-feature-settings: 'liga';
		-webkit-font-smoothing: antialiased;
		font-variation-settings:
			'FILL' 0,
			'wght' 450,
			'GRAD' 0,
			'opsz' 24;
	}

	/* ---------- Status bar ---------- */

	.statusbar {
		grid-row: 5;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 36px;
		padding: 0 16px 8px;
		color: var(--text-3);
		font-size: 12px;
		white-space: nowrap;
	}

	.statusbar__group {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}

	.statusbar__group--end {
		flex: 0 0 auto;
	}

	.statusbar__message {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-2);
	}

	.statusbar__meta {
		font-variant-numeric: tabular-nums;
	}

	.save-state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
		color: var(--text-2);
	}

	.save-state i {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		background: var(--success);
	}

	.save-state--saving i {
		background: var(--warning);
	}

	.save-state--error,
	.save-state--conflict {
		color: var(--danger);
	}

	.save-state--error i,
	.save-state--conflict i {
		background: var(--danger);
	}

	.switch {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-2);
		font-weight: 600;
		cursor: pointer;
		user-select: none;
	}

	.switch input {
		appearance: none;
		-webkit-appearance: none;
		position: relative;
		width: 28px;
		height: 16px;
		margin: 0;
		flex: 0 0 auto;
		border-radius: 999px;
		background: var(--fill-strong);
		cursor: pointer;
		transition: background-color 0.2s ease;
	}

	.switch input::before {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 12px;
		height: 12px;
		border-radius: 999px;
		background: white;
		box-shadow: 0 1px 3px rgba(0, 23, 51, 0.2);
		transition: transform 0.2s cubic-bezier(0.3, 0.7, 0.4, 1.2);
	}

	.switch input:checked {
		background: var(--primary);
	}

	.switch input:checked::before {
		transform: translateX(12px);
	}

	.lsp-status {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: min(280px, 36vw);
		height: 24px;
		padding: 0 9px;
		border-radius: 999px;
		background: var(--surface);
		color: var(--text-2);
		font-weight: 600;
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
		color: var(--primary);
	}

	.lsp-status--ready {
		color: var(--success);
	}

	.lsp-status--error {
		background: var(--danger-soft);
		color: var(--danger);
	}

	.lsp-status__spinner {
		flex: 0 0 auto;
		width: 10px;
		height: 10px;
		border: 2px solid rgba(49, 130, 246, 0.22);
		border-top-color: currentColor;
		border-radius: 999px;
		animation: lsp-status-spin 0.8s linear infinite;
	}

	.lsp-status__progress {
		position: absolute;
		right: 9px;
		bottom: 2px;
		left: 9px;
		height: 2px;
		overflow: hidden;
		border-radius: 999px;
		background: rgba(49, 130, 246, 0.16);
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
		inset: 12px;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 2px dashed var(--primary);
		border-radius: 20px;
		background: var(--overlay);
		backdrop-filter: blur(6px);
		color: var(--primary-strong);
		font-size: 17px;
		font-weight: 700;
		pointer-events: none;
	}

	/* ---------- Debugger ---------- */

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	.console-body:has(> .debug-shell) {
		overflow: hidden;
	}

	.console-body:has(> .debug-shell) > .terminal-shell {
		flex: 1 1 38%;
		min-height: 160px;
	}

	.debug-shell {
		--debug-accent: var(--primary);
		--debug-accent-soft: var(--primary-soft);
		flex: 0 1 auto;
		max-height: 64%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-radius: var(--radius-md);
		background: var(--surface-muted);
		box-shadow: inset 0 0 0 1px var(--line-soft);
		overflow: hidden;
	}

	.debug-shell--active {
		--debug-accent: var(--success);
		--debug-accent-soft: var(--success-soft);
	}

	.debug-shell--paused {
		--debug-accent: var(--debug-tone);
		--debug-accent-soft: var(--debug-tone-soft);
	}

	/* Session header: status, target and the stepping toolbar. */
	.debug-hero {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px 12px;
		padding: 10px 10px 8px 12px;
	}

	.debug-hero__intro {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1 1 160px;
		min-width: 0;
	}

	.debug-hero__copy {
		min-width: 0;
	}

	.debug-hero__copy h2 {
		margin: 0;
		overflow: hidden;
		color: var(--text);
		font-size: 13px;
		font-weight: 700;
		line-height: 1.3;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.debug-status-pill {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 26px;
		padding: 0 10px 0 8px;
		border-radius: 999px;
		background: var(--fill);
		color: var(--text-2);
		font-size: 12px;
		font-weight: 700;
	}

	.debug-status-pill .material-symbols-outlined {
		font-size: 16px;
		font-variation-settings:
			'FILL' 1,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.debug-status-pill--active {
		background: var(--success-soft);
		color: var(--success);
	}

	.debug-status-pill--paused {
		background: var(--debug-tone-soft);
		color: var(--debug-tone);
	}

	.debug-controls {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		max-width: 100%;
		align-items: center;
		gap: 2px;
		padding: 3px;
		border-radius: 12px;
		background: var(--surface);
		box-shadow: var(--shadow-card);
	}

	.debug-controls__divider {
		width: 1px;
		height: 18px;
		margin: 0 3px;
		background: var(--line);
	}

	.debug-control {
		width: 32px;
		min-width: 32px;
		height: 32px;
		padding: 0;
		border-radius: 9px;
		background: transparent;
		color: var(--text-2);
		box-shadow: none;
	}

	.debug-control .material-symbols-outlined {
		font-size: 20px;
		font-variation-settings:
			'FILL' 0,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.debug-control:enabled:hover {
		background: var(--fill);
		color: var(--text);
	}

	.debug-control:disabled {
		opacity: 0.3;
	}

	.debug-control__label {
		display: none;
	}

	.debug-control--primary {
		width: auto;
		padding: 0 12px 0 8px;
		background: var(--debug-tone);
		color: white;
	}

	.debug-control--primary .debug-control__label {
		display: inline;
		font-size: 13px;
	}

	.debug-control--primary .material-symbols-outlined {
		font-variation-settings:
			'FILL' 1,
			'wght' 500,
			'GRAD' 0,
			'opsz' 24;
	}

	.debug-control--primary:enabled:hover {
		background: var(--debug-tone);
		color: white;
		filter: brightness(1.08);
	}

	/* Session facts as a quiet, scannable strip. */
	.debug-hero__stats {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		padding: 0 12px 10px;
		border-bottom: 1px solid var(--line-soft);
	}

	.debug-metric {
		display: inline-flex;
		align-items: baseline;
		gap: 5px;
		font-size: 12px;
	}

	.debug-metric span {
		color: var(--text-3);
		font-weight: 500;
	}

	.debug-metric strong {
		color: var(--text);
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	/* Stacked, collapsible sections like an IDE run-and-debug sidebar. */
	.debug-panels {
		flex: 1 1 auto;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.debug-panel {
		flex: none;
		display: flex;
		flex-direction: column;
		min-width: 0;
		font-size: 12px;
	}

	.debug-panel + .debug-panel {
		border-top: 1px solid var(--line-soft);
	}

	.debug-panel__header {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		padding: 0 12px 0 6px;
		background: var(--surface-muted);
	}

	.debug-panel__toggle {
		position: static;
		width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		flex: none;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
	}

	/* Let the whole header row act as the toggle target. */
	.debug-panel__toggle::after {
		content: '';
		position: absolute;
		inset: 0;
	}

	.debug-panel__header:hover {
		background: var(--fill);
	}

	.debug-panel__chevron {
		font-size: 18px;
		transform: rotate(-90deg);
		transition: transform 0.15s ease;
	}

	.debug-panel__toggle[aria-expanded='true'] .debug-panel__chevron {
		transform: none;
	}

	.debug-panel__title {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.debug-panel__title > .material-symbols-outlined {
		color: var(--debug-accent);
		font-size: 16px;
	}

	.debug-panel h3 {
		margin: 0;
		color: var(--text);
		font-size: 12px;
		font-weight: 700;
	}

	.debug-count {
		min-width: 20px;
		height: 18px;
		display: inline-grid;
		place-items: center;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--fill);
		color: var(--text-3);
		font-size: 11px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.debug-panel__body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 2px 8px 12px;
	}

	.debug-panel ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.debug-scopes {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.debug-scope {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.debug-scope summary {
		padding: 4px 4px;
		border-radius: 6px;
		color: var(--text-3);
		cursor: pointer;
	}

	.debug-scope summary:hover {
		background: var(--fill);
	}

	.debug-scope h4 {
		display: inline;
		margin: 0;
		color: var(--text-3);
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}

	.debug-load-scope {
		align-self: flex-start;
		margin: 2px 0 2px 8px;
		padding: 4px 10px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--primary);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}

	.debug-load-scope:enabled:hover {
		background: var(--primary-soft);
	}

	.debug-load-scope:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	/* Variable, watch and frame rows share one dense row style. */
	.debug-entry {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 30px;
		padding: 4px 6px 4px 10px;
		border-radius: 8px;
	}

	.debug-entry:hover {
		background: var(--surface);
	}
	.debug-entry--changed {
		background: color-mix(in srgb, #d6a63c 18%, var(--surface));
	}
	.debug-previous-value {
		color: var(--text-3);
		font-family: var(--mono);
		font-size: 11px;
		overflow-wrap: anywhere;
	}
	.debug-feature-panel {
		display: block;
		padding: 10px;
		font-size: 12px;
	}
	.debug-feature-panel summary {
		cursor: pointer;
		font-weight: 600;
		margin-bottom: 8px;
	}
	.debug-breakpoint-editor {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 8px;
		margin-top: 8px;
	}
	.debug-breakpoint-editor label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.debug-entry__body {
		display: flex;
		align-items: baseline;
		gap: 6px;
		flex: 0 1 auto;
		min-width: 0;
	}

	.debug-entry--local .debug-value {
		flex: 1 1 auto;
		text-align: right;
	}

	.debug-entry--watch .debug-entry__body {
		flex: 1 1 auto;
		justify-content: space-between;
	}

	.debug-key,
	.stack-line,
	.debug-value {
		min-width: 0;
		font-family: var(--mono);
		font-size: 12px;
	}

	.debug-key {
		color: var(--debug-accent);
		font-weight: 600;
		white-space: nowrap;
	}

	.debug-value {
		color: var(--text);
		overflow-wrap: anywhere;
	}

	.debug-variable-type {
		color: var(--text-4);
		font-family: var(--mono);
		font-size: 11px;
		white-space: nowrap;
	}

	.debug-expression,
	.stack-function {
		min-width: 0;
		color: var(--text);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.debug-variable-children {
		margin-left: 14px;
		padding-left: 6px;
		border-left: 1px solid var(--line);
	}

	.debug-memory-inspect,
	.debug-expand {
		width: 24px;
		height: 24px;
		display: inline-grid;
		flex: none;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
	}

	.debug-memory-inspect:hover,
	.debug-expand:enabled:hover {
		background: var(--debug-accent-soft);
		color: var(--debug-accent);
	}

	.debug-expand:disabled {
		cursor: default;
		opacity: 0.55;
	}

	.debug-memory-inspect .material-symbols-outlined,
	.debug-expand .material-symbols-outlined {
		font-size: 16px;
	}

	.debug-entry--stack {
		padding: 0;
	}

	.debug-frame-select {
		width: 100%;
		min-height: 30px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 4px 10px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.debug-frame-select:disabled {
		cursor: default;
	}

	.debug-entry--current {
		background: var(--debug-accent-soft);
		box-shadow: inset 3px 0 0 var(--debug-accent);
	}

	.debug-entry--current:hover {
		background: var(--debug-accent-soft);
	}

	.stack-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.stack-order {
		width: 18px;
		flex: none;
		color: var(--text-4);
		font-family: var(--mono);
		font-size: 11px;
		text-align: right;
	}

	.stack-line {
		flex: none;
		color: var(--text-3);
	}

	.watch-row {
		display: flex;
		gap: 6px;
	}

	.watch-row input {
		flex: 1;
	}

	.watch-add {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		height: 32px;
		padding: 0 12px 0 8px;
		border: 0;
		border-radius: 8px;
		background: var(--primary-soft);
		color: var(--primary);
		font-size: 12px;
		font-weight: 700;
		cursor: pointer;
	}

	.watch-add:hover {
		background: var(--primary-soft-strong);
	}

	.watch-add .material-symbols-outlined {
		font-size: 16px;
	}

	.remove {
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		flex: none;
		padding: 0;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
	}

	.remove:hover {
		background: var(--danger-soft);
		color: var(--danger);
	}

	.remove .material-symbols-outlined {
		font-size: 15px;
	}

	.empty {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		padding: 6px 10px;
		color: var(--text-3);
	}

	.empty .material-symbols-outlined {
		font-size: 15px;
	}

	/* Memory inspector */
	.debug-memory-controls {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 0.8fr) auto;
		gap: 6px;
		align-items: end;
	}

	.debug-memory-controls label,
	.debug-memory-watch-controls label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		color: var(--text-3);
		font-size: 11px;
		font-weight: 600;
	}

	.debug-memory-watch-controls label {
		flex: 1 1 120px;
	}

	.debug-memory-controls input,
	.debug-memory-watch-controls select,
	.debug-memory-write-field input,
	.watch-row input {
		width: 100%;
		min-width: 0;
		height: 32px;
		padding: 0 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font-size: 12px;
		outline: none;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.debug-memory-controls input,
	.debug-memory-write-field input,
	.watch-row input {
		font-family: var(--mono);
	}

	.debug-memory-controls input:focus,
	.debug-memory-watch-controls select:focus,
	.debug-memory-write-field input:focus,
	.watch-row input:focus {
		border-color: var(--primary);
		box-shadow: 0 0 0 3px var(--primary-soft);
	}

	.debug-memory-watch-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 6px;
	}

	.debug-memory-write-field {
		flex: 1 1 160px;
	}

	.debug-memory-read,
	.debug-memory-toolbar button,
	.debug-memory-write,
	.debug-data-breakpoint-set,
	.debug-data-breakpoint-clear {
		height: 32px;
		padding: 0 12px;
		border: 0;
		border-radius: 8px;
		background: var(--primary-soft);
		color: var(--primary);
		font-size: 12px;
		font-weight: 700;
		white-space: nowrap;
		cursor: pointer;
	}

	.debug-memory-read:enabled:hover,
	.debug-memory-toolbar button:hover,
	.debug-memory-write:enabled:hover,
	.debug-data-breakpoint-set:enabled:hover {
		background: var(--primary-soft-strong);
	}

	.debug-data-breakpoint-clear {
		background: var(--danger-soft);
		color: var(--danger);
	}

	.debug-memory-read:disabled,
	.debug-memory-write:disabled,
	.debug-data-breakpoint-set:disabled,
	.debug-data-breakpoint-clear:disabled {
		cursor: wait;
		opacity: 0.6;
	}

	.debug-data-breakpoint-status,
	.debug-memory-write-status,
	.debug-memory-error {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
		padding: 8px 10px;
		border-radius: 8px;
		font-size: 12px;
	}

	.debug-data-breakpoint-status {
		background: var(--debug-tone-soft);
		color: var(--debug-tone);
	}

	.debug-memory-write-status {
		background: var(--primary-soft);
		color: var(--primary-strong);
	}

	.debug-memory-error {
		background: var(--danger-soft);
		color: var(--danger);
	}

	.debug-memory-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.debug-memory-toolbar code {
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--text-2);
		font-family: var(--mono);
		font-size: 11px;
	}

	.debug-memory-table {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 100%;
		overflow-x: auto;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--line-soft);
	}

	.debug-memory-row {
		display: grid;
		min-width: max-content;
		grid-template-columns: minmax(72px, auto) auto minmax(16ch, auto);
		gap: 12px;
		align-items: center;
	}

	.debug-memory-address,
	.debug-memory-ascii {
		color: var(--text-3);
		font-family: var(--mono);
		font-size: 11px;
	}

	.debug-memory-hex {
		display: grid;
		grid-template-columns: repeat(16, 2ch);
		gap: 4px;
	}

	.debug-memory-byte {
		color: var(--text);
		font-family: var(--mono);
		font-size: 11px;
		text-align: center;
	}

	.debug-memory-byte--unreadable {
		color: var(--danger);
	}

	.debug-memory-ascii {
		white-space: pre;
	}

	/* ---------- Responsive ---------- */

	@media (max-width: 1280px) {
		.topbar__actions .tool-button span:not(.material-symbols-outlined) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}

		.topbar__actions .tool-button {
			width: 36px;
			justify-content: center;
			padding: 0;
		}
	}

	@media (max-width: 960px) {
		.ide {
			height: auto;
			min-height: 100vh;
			min-height: 100dvh;
			overflow: visible;
		}

		.topbar {
			position: sticky;
			top: 0;
			flex-wrap: wrap;
			padding: 10px 12px;
		}

		.topbar__lead {
			flex: 1 1 100%;
			flex-wrap: wrap;
		}

		.topbar__lead > .topbar__divider {
			display: none;
		}

		.topbar__actions {
			flex: 1 1 100%;
			justify-content: space-between;
		}

		.topbar__actions > .topbar__divider {
			display: none;
		}

		.topbar__actions {
			gap: 2px;
		}

		.topbar__actions .icon-button,
		.topbar__actions .tool-button {
			width: 32px;
		}

		.action-group {
			margin-left: auto;
			gap: 6px;
		}

		.action-button {
			padding: 0 12px;
		}

		.action-button--run,
		.action-button--stop {
			min-width: 0;
		}

		.workbench {
			flex-direction: column;
		}

		.sidebar-backdrop {
			position: fixed;
			inset: 0;
			z-index: 20;
			display: block;
			border: 0;
			background: rgba(0, 23, 51, 0.32);
			backdrop-filter: blur(2px);
		}

		.workspace-sidebar {
			position: fixed;
			inset: 12px auto 12px 12px;
			z-index: 21;
			width: min(320px, calc(100vw - 24px));
			box-shadow: 0 20px 48px rgba(0, 23, 51, 0.2);
		}

		.workspace-sidebar__close {
			display: grid !important;
		}

		.workbench-split {
			flex-direction: column;
			gap: 8px;
		}

		.editor-column {
			flex: 0 0 auto;
			height: 62vh;
			min-height: 380px;
		}

		.terminal-pane {
			width: 100% !important;
			min-width: 0;
			min-height: 460px;
		}

		.panel-resizer {
			display: none;
		}

		.statusbar {
			flex-wrap: wrap;
			padding: 4px 12px 12px;
			white-space: normal;
		}

		.statusbar__group--end {
			flex: 1 1 100%;
			flex-wrap: wrap;
		}

		.statusbar__meta,
		.statusbar__divider {
			display: none;
		}

		.args-chip input {
			width: 140px;
			font-size: 16px;
		}

		.debug-hero__stats {
			width: 100%;
			justify-content: flex-start;
		}
	}

	@media (max-width: 600px) {
		.action-group .action-button:not(.action-button--run) {
			width: 36px;
			padding: 0;
		}

		.action-group .action-button:not(.action-button--run) span:not(.material-symbols-outlined) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
	}
</style>
