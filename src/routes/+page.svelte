<script lang="ts">
	import Monaco from './Monaco.svelte';
	import Terminal, { type TerminalControl } from '@wasm-idle/terminal';
	import type { ProgressLike } from '@wasm-idle/core';
	import { createPlaygroundBinding, isSharedArrayBufferAvailable } from '$lib';
	import {
		createDebugSessionController,
		cppDebugLanguageAdapter,
		goDebugLanguageAdapter,
		pythonDebugLanguageAdapter,
		rustDebugLanguageAdapter,
		type DebugLanguageAdapter
	} from '@wasm-idle/debug';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { replaceState } from '$app/navigation';
	import { base } from '$app/paths';
	import { SvelteURL } from 'svelte/reactivity';
	import {
		createApplicationAssetResolver,
		createApplicationRuntimeAssets
	} from '$lib/playground/applicationAssets';
	import { createLoadingProgressController } from '$lib/playground/loadingProgress';
	import { resolveDebugRuntimeUrls } from '$lib/playground/assets';
	import { RUST_NON_DEBUG_RESOURCE_REQUIREMENTS } from '$lib/playground/rustWorkerLimits';
	import type {
		CompilerDiagnostic,
		DebugDataBreakpoint,
		DebugDataBreakpointAccessType,
		DebugDataBreakpointInfo,
		DebugDataBreakpointInfoArguments,
		DebugResolvedDataBreakpoint,
		GoTarget,
		OcamlBackend,
		OcamlWasmBinaryenMode,
		RustTargetTriple,
		SandboxExecutionOptions,
		DebugFrame,
		DebugSessionEvent,
		DebugScope,
		DebugVariable
	} from '$lib/playground/options';
	import type monaco from 'monaco-editor';
	import { executeTerminalRun } from './execute';
	import { parseArgs } from './parseArgs';
	import { createWorkspaceStorage, type WorkspaceSaveState } from './workspaceStorage';
	import { createExecutionPreflightGate } from './executionPreflight';
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

	import {
		isBinaryWorkspaceFile,
		workspaceFileBlob,
		workspaceFileFromBytes,
		type WorkspaceFile
	} from './workspaceCodec';
	type WorkspaceArchiveRequest =
		| { type: 'create'; files: WorkspaceFile[] }
		| { type: 'extract'; archive: ArrayBuffer };
	type WorkspaceArchiveResponse =
		| { type: 'created'; archive: ArrayBuffer }
		| { type: 'extracted'; files: WorkspaceFile[] }
		| { type: 'error'; message: string };

	type LanguageWorkspace = {
		activePath: string;
		files: WorkspaceFile[];
		openTabs: string[];
	};
	const knownCppVersions = [
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
		address: string;
		bytes: number;
		dataId: string;
		description: string;
		id?: number;
	};

	const WORKSPACE_STORAGE_KEY = 'wasm-idle:example-workspace:v3';
	const SHARE_PREFIX = 'workspace=';
	const MAX_DEBUG_MEMORY_BYTES = 256;
	const lldbDebugLanguages = new Set<PlaygroundLanguage>(['C', 'CPP', 'RUST']);
	const debugLanguageAdapters: Partial<Record<PlaygroundLanguage, DebugLanguageAdapter>> = {
		C: cppDebugLanguageAdapter,
		CPP: cppDebugLanguageAdapter,
		OBJC: cppDebugLanguageAdapter,
		GO: goDebugLanguageAdapter,
		RUST: rustDebugLanguageAdapter,
		PYTHON: pythonDebugLanguageAdapter
	};
	const debugTitles: Partial<Record<PlaygroundLanguage, string>> = {
		C: 'C · LLDB / WAMR',
		CPP: 'C++ · LLDB / WAMR',
		OBJC: 'Objective-C Trace',
		GO: 'Go Trace',
		RUST: 'Rust · LLDB / WAMR',
		PYTHON: 'Pyodide Trace'
	};

	let path = $derived(
		page.url.pathname.endsWith('/') ? page.url.pathname.slice(0, -1) : page.url.pathname
	);
	const applicationRootUrl = base;
	const resolveApplicationAsset = createApplicationAssetResolver(applicationRootUrl);
	let clangdBaseUrl = $derived(resolveApplicationAsset('clangd/'));
	let runtimeAssets = $derived.by(() => ({
		...createApplicationRuntimeAssets(applicationRootUrl),
		debug: {
			baseUrl: path ? `${path}/wasm-debug/` : '/wasm-debug/',
			manifestUrl: path
				? `${path}/wasm-debug/runtime-manifest.v2.json`
				: '/wasm-debug/runtime-manifest.v2.json'
		}
	}));
	const playground = $derived.by(() => createPlaygroundBinding(runtimeAssets));

	let editor = $state<monaco.editor.IStandaloneCodeEditor | null>(null),
		terminal = $state<TerminalControl | undefined>(undefined),
		compilerDiagnostics = $state<CompilerDiagnostic[]>([]),
		clangdRequested = $state(false),
		argsInput = $state(''),
		cppVersion = $state<CppVersion>('CPP20'),
		rustTargetTriple = $state<RustTargetTriple>('wasm32-wasip1'),
		goTarget = $state<GoTarget>('wasip1/wasm'),
		ocamlBackend = $state<OcamlBackend>('wasm'),
		ocamlWasmBinaryenMode = $state<OcamlWasmBinaryenMode>('fast'),
		log = $state(true),
		lspEnabled = $state(false),
		language = $state<PlaygroundLanguage>('CPP'),
		runningMode = $state<'run' | 'debug' | null>(null),
		activeDebugBackend = $state<'lldb' | 'trace' | null>(null),
		progressVisible = $state(false),
		progress = $state(0),
		progressStage = $state(''),
		progressIndeterminate = $state(false),
		stdinInput = $state(''),
		init = $state(false),
		editorLspStatus = $state<EditorLspStatusView | null>(null),
		examplePane = $state<HTMLElement | null>(null),
		examplePaneWidth = $state(0),
		terminalPaneWidth = $state<number | null>(null),
		resizingPane = $state(false);
	let restartDebugPending = $state(false);
	let executionStopPending = $state(false);
	let executionGeneration = 0;
	let restartRequestGeneration = 0;
	let activeExecution: Promise<void> | null = null;
	const executionPreflight = createExecutionPreflightGate();

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
	let workspaceSaveState = $state<WorkspaceSaveState>({
		phase: 'dirty',
		revision: 0,
		savedRevision: -1,
		error: null
	});
	const workspaceStorage = createWorkspaceStorage(
		(value) => localStorage.setItem(WORKSPACE_STORAGE_KEY, value),
		(state) => {
			workspaceSaveState = state;
		}
	);
	let workspaceInitialized = $state(false);
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
			limits: RUST_NON_DEBUG_RESOURCE_REQUIREMENTS
		}),
		GO: () => ({ goTarget }),
		TINYGO: () => ({ limits: { maxWasmMemoryBytes: 2 * 1024 * 1024 * 1024 } }),
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
	const sqlLspEnabled = $derived(lspEnabled && activeRuntimeLspCapability === 'sql');
	const sqlLspModuleUrl = $derived(sqlLspEnabled ? runtimeAssets.sqlite?.moduleUrl : undefined);
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
	const pythonLspBaseUrl = $derived(resolveApplicationAsset('pyodide/'));
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

	const debugLanguage = $derived(debugLanguageAdapters[language] ?? null);
	const selectedDebugMode = $derived(
		lldbDebugLanguages.has(language) ? ('lldb' as const) : ('trace' as const)
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
	const debug = createDebugSessionController({
		syncBreakpointsWhile: () => runningMode === 'debug'
	});
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
	type WasmGoRuntimeModule = {
		preloadBrowserGoRuntime?: (options?: { target?: GoTarget }) => Promise<void>;
	};

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
		if ((ext === '.m' || ext === '.h') && language === 'OBJC') return 'OBJC';
		const match: Record<string, PlaygroundLanguage> = {
			'.c': 'C',
			'.cc': 'CPP',
			'.cpp': 'CPP',
			'.cxx': 'CPP',
			'.objc': 'OBJC',
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
			'.sh': 'BASH',
			'.bash': 'BASH',
			'.cljs': 'CLOJURESCRIPT',
			'.cljc': 'CLOJURESCRIPT',
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
			'.cob': 'COBOL',
			'.cbl': 'COBOL',
			'.cpy': 'COBOL',
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
			OBJC: 'main.m',
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
			BASH: 'main.sh',
			CLOJURESCRIPT: 'main.cljs',
			TINYGO: 'main.go',
			OCAML: 'main.ml',
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
			FORTRAN: 'main.f',
			COBOL: 'main.cob',
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
			OBJC: 'objectivec',
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
			BASH: 'bash',
			CLOJURESCRIPT: 'clojurescript',
			TINYGO: 'go',
			OCAML: 'ocaml',
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
			COBOL: 'cobol',
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
			...file,
			content: isBinaryWorkspaceFile(file)
				? file.content
				: migrateWorkspaceFileContent(file.content, nextLanguage)
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
		if (compact) sidebarOpen = false;
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
		addWorkspaceFile(file.path, file.content, true, file.encoding);
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
			sidebarOpen,
			version: 6,
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
		sidebarOpen = value?.sidebarOpen ?? !compact;
		saveStatus = message;
	}

	function saveWorkspace(showStatus = false) {
		if (!browser || !workspaceInitialized) return false;
		const saved = workspaceStorage.save(workspaceSaveKey);
		if (saved && showStatus) saveStatus = 'Saved locally';
		return saved;
	}

	function readStoredValue(key: string) {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	}

	function downloadWorkspaceBackup() {
		downloadBlob(
			new Blob([workspaceSaveKey], { type: 'application/json' }),
			'wasm-idle-workspace.json'
		);
		saveStatus = 'Workspace backup downloaded';
	}

	function warnUnsavedChanges(event: BeforeUnloadEvent) {
		if (!workspaceInitialized) return;
		workspaceStorage.observe(workspaceSaveKey);
		const state = workspaceStorage.getState();
		if (state.revision === state.savedRevision || saveWorkspace()) return;
		event.preventDefault();
		event.returnValue = '';
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
		downloadBlob(workspaceFileBlob(file), basename(file.path));
		saveStatus = `${basename(file.path)} downloaded`;
	}

	async function runWorkspaceArchive(
		request: WorkspaceArchiveRequest,
		transfer: Transferable[] = []
	) {
		const { default: WorkspaceArchiveWorker } =
			await import('./workspaceArchive.worker?worker');
		const worker = new WorkspaceArchiveWorker();
		try {
			return await new Promise<WorkspaceArchiveResponse>((resolve, reject) => {
				worker.onmessage = ({ data }: MessageEvent<WorkspaceArchiveResponse>) => {
					if (data.type === 'error') reject(new Error(data.message));
					else resolve(data);
				};
				worker.onerror = (event) => reject(new Error(event.message || 'ZIP worker failed'));
				worker.postMessage(request, transfer);
			});
		} finally {
			worker.terminate();
		}
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

	async function importZip(file: File) {
		const archive = new Uint8Array(await file.arrayBuffer());
		const archiveBuffer = archive.slice().buffer;
		const response = await runWorkspaceArchive({ type: 'extract', archive: archiveBuffer }, [
			archiveBuffer
		]);
		if (response.type !== 'extracted') {
			throw new Error('ZIP worker returned an invalid response');
		}
		const imported: string[] = [];
		for (const importedFile of response.files) {
			imported.push(
				addWorkspaceFile(
					importedFile.path,
					importedFile.content,
					false,
					importedFile.encoding
				)
			);
		}
		return imported;
	}

	async function importFiles(fileList: File[]) {
		const imported: string[] = [];
		for (const file of fileList) {
			if (file.name === 'wasm-idle-workspace.json') {
				const backup = JSON.parse(await file.text());
				if (!backup.workspaces || typeof backup.version !== 'number')
					throw new Error('Invalid workspace backup');
				applySnapshot(backup, 'Workspace backup restored');
				continue;
			}
			if (file.name.toLowerCase().endsWith('.zip')) {
				imported.push(...(await importZip(file)));
			} else {
				const decoded = workspaceFileFromBytes(
					(file as File & { webkitRelativePath?: string }).webkitRelativePath ||
						file.name,
					new Uint8Array(await file.arrayBuffer())
				);
				imported.push(
					addWorkspaceFile(decoded.path, decoded.content, false, decoded.encoding)
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
			objc: 'OBJC',
			objectivec: 'OBJC',
			'objective-c': 'OBJC',
			objective_c: 'OBJC',
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
			bash: 'BASH',
			sh: 'BASH',
			shell: 'BASH',
			clojurescript: 'CLOJURESCRIPT',
			cljs: 'CLOJURESCRIPT',
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
			cobol: 'COBOL',
			cob: 'COBOL',
			cbl: 'COBOL',
			gnucobol: 'COBOL',
			tinygo: 'TINYGO',
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
		const offsetPattern = /^-?(?:0[xX][0-9a-fA-F]+|(?:0|[1-9][0-9]*))$/u;
		const countPattern = /^(?:[1-9][0-9]*)$/u;
		const requestedOffset = offsetPattern.test(offsetText) ? Number(offsetText) : Number.NaN;
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
		const offsetPattern = /^-?(?:0[xX][0-9a-fA-F]+|(?:0|[1-9][0-9]*))$/u;
		const offset = offsetPattern.test(offsetText) ? Number(offsetText) : Number.NaN;
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
		const offsetPattern = /^-?(?:0[xX][0-9a-fA-F]+|(?:0|[1-9][0-9]*))$/u;
		const countPattern = /^(?:[1-9][0-9]*)$/u;
		const offset = offsetPattern.test(offsetText) ? Number(offsetText) : Number.NaN;
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

	function exec(enableDebug = false): Promise<void> {
		const args = parsedArgs.args;
		if (!args) return Promise.resolve();
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
			const progressSession = loadingProgress.start(`Loading ${language} runtime`);
			executionAbortController = abortController;
			activeProgressSession = progressSession;
			let progressOutcome: 'completed' | 'failed' | 'cancelled' | 'timed-out' = 'completed';
			let executionDebugMode: NonNullable<SandboxExecutionOptions['debugMode']> = enableDebug
				? selectedDebugMode
				: 'none';
			runningMode = enableDebug ? 'debug' : 'run';
			activeDebugBackend = enableDebug ? selectedDebugMode : null;
			if (enableDebug && debugLspLanguages.has(language)) clangdRequested = true;
			if (enableDebug) {
				invalidateMemoryInspector();
				debug.begin();
			} else {
				debug.reset();
			}
			compilerDiagnostics = [];
			const codeToRun = activeFile.content;
			if (browser) {
				saveWorkspace();
				try {
					localStorage.setItem('code', codeToRun);
					localStorage.setItem('language', language);
					localStorage.setItem('argsInput', argsInput);
					localStorage.setItem('rustTargetTriple', rustTargetTriple);
					localStorage.setItem('goTarget', goTarget);
					localStorage.setItem('ocamlBackend', ocamlBackend);
					localStorage.setItem('ocamlWasmBinaryenMode', ocamlWasmBinaryenMode);
				} catch {
					// The complete workspace above is authoritative; legacy keys are optional.
				}
			}
			try {
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
					sharedBufferAvailable && language !== 'BASH' ? undefined : stdinInput;
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
						breakpoints: [...debug.effectiveBreakpoints],
						sourceBreakpoints: debug.sourceBreakpoints.filter(({ sourcePath }) =>
							files.some(
								(file) => `/workspace/${normalizePath(file.path)}` === sourcePath
							)
						),
						activePath,
						workspaceFiles: files.map((file) => ({
							path: file.path,
							content: file.path === activePath ? codeToRun : file.content
						})),
						pauseOnEntry: enableDebug,
						...languageExecutionOptions,
						signal: abortController.signal,
						stdin: preloadedStdin
					}
				});
				if (result === false) {
					progressOutcome = abortController.signal.aborted ? 'cancelled' : 'failed';
				}
			} catch (error) {
				const executionWasCancelled = abortController.signal.aborted;
				const executionTimedOut = error instanceof Error && error.name === 'TimeoutError';
				progressOutcome = executionWasCancelled
					? 'cancelled'
					: executionTimedOut
						? 'timed-out'
						: 'failed';
				if (!executionWasCancelled && !executionTimedOut) throw error;
			} finally {
				progressSession.report?.({ kind: 'settled', outcome: progressOutcome });
				if (executionAbortController === abortController)
					executionAbortController = undefined;
				if (activeProgressSession === progressSession) activeProgressSession = undefined;
				executionPreflight.finish(preflight);
				completeExecutionGeneration(generation);
			}
		})();
		activeExecution = execution;
		return execution;
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

			const storedWorkspace = readStoredValue(WORKSPACE_STORAGE_KEY);
			if (storedWorkspace) {
				try {
					applySnapshot(JSON.parse(storedWorkspace), 'Workspace restored');
					workspaceInitialized = true;
					init = true;
					return;
				} catch {
					saveStatus = 'Stored workspace could not be restored';
				}
			}

			const code = readStoredValue('code');
			const lang = readStoredValue('language');
			const storedArgs = readStoredValue('argsInput');
			const storedGoTarget = readStoredValue('goTarget');
			const storedOcamlBackend = readStoredValue('ocamlBackend');
			const storedOcamlWasmBinaryenMode = readStoredValue('ocamlWasmBinaryenMode');
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
		workspaceStorage.observe(key);
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
				const storedRustTargetTriple = readStoredValue('rustTargetTriple');
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
				const storedRustTargetTriple = readStoredValue('rustTargetTriple');
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
				const storedGoTarget = readStoredValue('goTarget');
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
				const storedGoTarget = readStoredValue('goTarget');
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
		debug.setSourcePath(activeDebugSourcePath);
	});

	$effect(() => {
		if (!browser) return;
		const target = window as Window &
			typeof globalThis & { __wasmIdleDebug?: WasmIdleDebugTestApi };
		const debugHookVersion = ++browserDebugHookVersion;
		const debugApi: WasmIdleDebugTestApi = {
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
	onbeforeunload={warnUnsavedChanges}
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
						<button
							class="action-button action-button--stop"
							onclick={stopExecution}
							disabled={executionStopPending}
						>
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
						<button
							class="action-button action-button--debug-restart"
							onclick={restartDebugExecution}
							disabled={restartDebugPending || executionStopPending}
							aria-label="Restart Debug"
						>
							<span class="material-symbols-outlined">restart_alt</span>
							<span>{restartDebugPending ? 'Restarting…' : 'Restart Debug'}</span>
						</button>
						<button
							class="action-button action-button--stop"
							onclick={stopExecution}
							disabled={executionStopPending || restartDebugPending}
						>
							<span class="material-symbols-outlined">stop_circle</span>
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
						onclick={() => debug.pause()}
						disabled={selectedDebugMode !== 'lldb' || !debug.active || debug.paused}
						title="Pause"
						aria-label="Pause"
					>
						<span class="material-symbols-outlined">pause</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => debug.sendCommand('continue')}
						disabled={!debug.paused || dataBreakpointLoading}
						title="Continue"
						aria-label="Continue"
					>
						<span class="material-symbols-outlined">skip_next</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => runToCursorWhileDataBreakpointIdle()}
						disabled={!debug.canRunToCursor || dataBreakpointLoading}
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
						disabled={!debug.paused || dataBreakpointLoading}
						title="Step Into"
						aria-label="Step Into"
					>
						<span class="material-symbols-outlined">login</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => debug.sendCommand('nextLine')}
						disabled={!debug.paused || dataBreakpointLoading}
						title="Next Line"
						aria-label="Next Line"
					>
						<span class="material-symbols-outlined">redo</span>
					</button>
					<button
						class="action-button action-button--icon"
						onclick={() => debug.sendCommand('stepOut')}
						disabled={!debug.paused || dataBreakpointLoading}
						title="Step Out"
						aria-label="Step Out"
					>
						<span class="material-symbols-outlined">logout</span>
					</button>
				</div>
			</div>
			{#if !sharedBufferAvailable || language === 'BASH'}
				<div class="stdin-panel">
					<div>
						<strong>Preloaded stdin</strong>
						<span>
							{language === 'BASH'
								? 'The Bash WASIX package accepts stdin when the process starts. Enter it before Run; extra reads receive EOF.'
								: 'SharedArrayBuffer is unavailable here, so terminal input cannot be sent while the program is running. Enter stdin before Run; extra reads receive EOF.'}
						</span>
					</div>
					<textarea
						bind:value={stdinInput}
						placeholder="Input to pass before running"
						spellcheck={false}
					></textarea>
				</div>
			{/if}
			{#if workspaceSaveState.phase === 'error'}
				<div class="workspace-save-error" role="alert">
					<span
						>Not saved locally. Keep this tab open and retry or download a workspace
						backup.</span
					>
					<button onclick={() => saveWorkspace(true)}>Retry save</button>
					<button onclick={downloadWorkspaceBackup}>Export workspace</button>
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
				<button
					class="tool-button"
					onclick={restartRuntime}
					disabled={!terminal || !!runningMode || !executionAvailable}
					title="Restart runtime"
				>
					<span class="material-symbols-outlined">restart_alt</span>
					<span>Restart Runtime</span>
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
						{#each playgroundLanguages as languageOption (languageOption)}
							<option value={languageOption}>{languageLabels[languageOption]}</option>
						{/each}
					</select>
				</label>
				{#if argsHelpLanguages.has(language)}
					<label class="args-chip">
						<span class="material-symbols-outlined">list_alt</span>
						<input
							bind:value={argsInput}
							placeholder={'--name "Hong Gil" ""'}
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
				{#if language === 'CPP'}
					<label class="select-chip">
						<span class="material-symbols-outlined">tune</span>
						<select id="cpp-version" bind:value={cppVersion}>
							{#each knownCppVersions as version (version)}
								<option value={version}>{cppVersionLabels[version]}</option>
							{/each}
						</select>
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
							<span class="material-symbols-outlined">hourglass_top</span>
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
						data-progress-mode={progressIndeterminate ? 'indeterminate' : 'determinate'}
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
		{#if language === 'TINYGO'}
			<p class="hint">
				TinyGo 0.40.1 compiles locally through the receipt-verified upstream toolchain for
				`wasip1`. Compilation, package discovery, linking, and optimization run in a
				disposable worker with phase and WebAssembly memory limits. Add `vendor/modules.txt`
				to use offline vendored modules; network module downloads remain disabled.
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
		{#if language === 'BASH'}
			<p class="hint">
				Bash runs locally through the bundled GNU Bash WASIX binary and Wasmer browser
				runtime. Enter stdin in the preloaded input panel, use `read -r` to consume it, and
				read CLI args from `$1`, `$2`, …. Bash builtins are available; external coreutils
				are not bundled yet.
			</p>
		{/if}
		{#if language === 'CLOJURESCRIPT'}
			<p class="hint">
				ClojureScript is compiled and evaluated locally with the official self-hosted
				`cljs.js` compiler. Require `[wasm-idle.runtime :as runtime]` for `read-line`,
				`stdin`, and `args` helpers.
			</p>
		{/if}
		{#if language === 'COBOL'}
			<p class="hint">
				COBOL compiles locally with GnuCOBOL 3.2, then the llvm-core Clang runtime compiles
				and links the generated C to WebAssembly. Use `ACCEPT` for stdin and `DISPLAY` for
				stdout.
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
				Julia runs through the legacy Julia 1.3.0-DEV.560 WebAssembly runtime bundled in
				`@chriskoch/julia-wasm@1.0.4`. Use `readline()` for line input; the worker connects
				terminal stdin through a streaming channel when cross-origin isolation is available,
				and otherwise provides buffered input through a Julia `IOBuffer`.
			</p>
		{/if}
		{#if language === 'NIM'}
			<p class="hint">
				Nim runs through the bundled Nim 2.2.4 WebAssembly compiler, then links generated C
				with clang/lld WebAssembly assets. Use `readLine(stdin)` for line input.
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
				Ruby runs through a receipt-verified CRuby WebAssembly profile. Its manifest,
				module, and compressed Wasm are verified before the worker starts. Pass CLI args
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
				PHP 8.4 runs from the external static runtime in the browser worker. Pass CLI args
				here; terminal stdin is provided as `php://input`, so use Ctrl+D or the EOF button
				after typing full-input data.
			</p>
		{/if}
		{#if language === 'ZIG'}
			<p class="hint">
				Zig runs the bundled `zig_small.wasm` compiler. It uses the `std.tar.gz` standard
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
		{#snippet debugVariableRows(variables: DebugVariable[])}
			{#each variables as variable, index (`${variable.name}:${index}`)}
				{@const reference = variable.variablesReference || 0}
				{@const children = debug.variablesByReference.get(reference)}
				<li class="debug-entry debug-entry--local">
					<div class="debug-entry__body">
						<code class="debug-key">{variable.name}</code>
						{#if variable.type}<span class="debug-variable-type">{variable.type}</span
							>{/if}
					</div>
					<code class="debug-value">{variable.value}</code>
					{#if activeDebugBackend === 'lldb' && debug.paused && variable.memoryReference && (debug.capabilities.readMemory || debug.capabilities.writeMemory || debug.capabilities.dataBreakpoints)}
						<button
							class="debug-memory-inspect"
							onclick={() => inspectDebugVariable(variable)}
							aria-label={`Inspect memory for ${variable.name}`}
						>
							<span class="material-symbols-outlined">memory</span>
						</button>
					{/if}
					{#if reference > 0}
						<button
							class="debug-expand"
							onclick={() => debug.loadVariableChildren(reference)}
							disabled={children !== undefined}
							aria-label={`Load children for ${variable.name}`}
						>
							<span class="material-symbols-outlined">
								{children === undefined ? 'chevron_right' : 'expand_more'}
							</span>
						</button>
					{/if}
				</li>
				{#if children?.length}
					<li class="debug-variable-children">
						<ul>{@render debugVariableRows(children)}</ul>
					</li>
				{/if}
			{/each}
		{/snippet}
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
							<strong
								>{debug.pausedLine === null ? '—' : `L${debug.pausedLine}`}</strong
							>
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
				</div>
				<div class="debug-panels">
					<section class="debug-panel">
						<header class="debug-panel__header">
							<div class="debug-panel__title">
								<span class="material-symbols-outlined">data_object</span>
								<div class="debug-panel__copy">
									<h3>{debug.scopes.length ? 'Variables' : 'Locals'}</h3>
								</div>
							</div>
							<span class="debug-count">
								{debug.scopes.length
									? debug.scopes.reduce(
											(total, scope) => total + scope.variables.length,
											0
										)
									: debug.locals.length}
							</span>
						</header>
						{#if debug.scopes.length}
							<div class="debug-scopes">
								{#each debug.scopes as scope (scope.variablesReference)}
									{@const loadedScopeVariables =
										scope.variables.length > 0
											? scope.variables
											: debug.variablesByReference.get(
													scope.variablesReference
												)}
									<section class="debug-scope">
										<h4>{scope.name}</h4>
										{#if loadedScopeVariables?.length}
											<ul>
												{@render debugVariableRows(loadedScopeVariables)}
											</ul>
										{:else if loadedScopeVariables === undefined && scope.variablesReference > 0}
											<button
												class="debug-load-scope"
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
									</section>
								{/each}
							</div>
						{:else if debug.locals.length}
							<ul>
								{@render debugVariableRows(debug.locals)}
							</ul>
						{:else}
							<p class="empty">
								<span class="material-symbols-outlined">info</span>
								<span>No locals yet</span>
							</p>
						{/if}
					</section>
					{#if activeDebugBackend === 'lldb' && debug.paused && (debug.capabilities.readMemory || debug.capabilities.writeMemory || debug.capabilities.dataBreakpoints)}
						<section class="debug-panel debug-memory-panel">
							<header class="debug-panel__header">
								<div class="debug-panel__title">
									<span class="material-symbols-outlined">memory</span>
									<div class="debug-panel__copy">
										<h3>Memory</h3>
									</div>
								</div>
								<span class="debug-count">max {MAX_DEBUG_MEMORY_BYTES} B</span>
							</header>
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
									<strong>{memoryWriteStatus.bytesWritten} bytes written</strong>
									{#if memoryWriteStatus.bytesWritten < memoryWriteStatus.requestedBytes}
										<span>of {memoryWriteStatus.requestedBytes} requested</span>
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
									{#if activeDataBreakpoint}
										<button
											class="debug-data-breakpoint-clear"
											onclick={() => void clearMemoryDataBreakpoint()}
											disabled={dataBreakpointLoading}
											aria-label="Clear data breakpoint"
										>
											Clear
										</button>
									{/if}
								</div>
							{/if}
							{#if debug.capabilities.dataBreakpoints && activeDataBreakpoint}
								<p class="debug-data-breakpoint-status">
									<strong>{activeDataBreakpoint.accessType}</strong>
									<span>{activeDataBreakpoint.description}</span>
								</p>
							{/if}
							{#if debug.capabilities.dataBreakpoints && dataBreakpointError}
								<p class="debug-memory-error" role="alert">{dataBreakpointError}</p>
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
									<button onclick={() => void readDebugMemoryPage(1)}>Next</button
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
												<code class="debug-memory-ascii">{row.ascii}</code>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</section>
					{/if}
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
								maxlength={4096}
								placeholder="pair.first or items[2]"
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
											debug.frameId === frame.id && 'debug-entry--current'
										]}
									>
										<button
											class="debug-frame-select"
											disabled={!frame.id || dataBreakpointLoading}
											onclick={() => selectDebugFrame(frame)}
										>
											<div class="stack-meta">
												<span class="stack-order">{index + 1}</span>
												<span class="stack-function"
													>{frame.functionName || '(entry)'}</span
												>
											</div>
											<code class="stack-line">L{frame.line}</code>
										</button>
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
				ondebug={onDebugEvent}
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
				<span role="status" data-workspace-save-state={workspaceSaveState.phase}>
					{workspaceSaveState.phase === 'saved'
						? 'Saved locally'
						: workspaceSaveState.phase === 'saving'
							? 'Saving…'
							: 'Not saved locally'}
				</span>
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
				{elixirLspIntegrity}
				{erlangLspEnabled}
				{erlangLspBundleUrl}
				erlangLspWorkerUrl={beamLspWorkerUrl}
				{erlangLspIntegrity}
				{gleamLspEnabled}
				{gleamLspBaseUrl}
				{gleamLspManifestUrl}
				{gleamLspManifestFingerprint}
				{dLspEnabled}
				{dLspModuleUrl}
				{dLspManifestUrl}
				{dLspIntegrity}
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
				{sqlLspEnabled}
				{sqlLspModuleUrl}
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

	.workspace-save-error {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		padding: 0.75rem;
		border: 1px solid #d97706;
		border-radius: 0.5rem;
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

	.debug-scopes {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.debug-scope {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.debug-scope h4 {
		margin: 0;
		color: #475569;
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.debug-load-scope {
		align-self: flex-start;
		border: 1px solid rgba(37, 99, 235, 0.18);
		border-radius: 7px;
		background: rgba(37, 99, 235, 0.06);
		padding: 5px 9px;
		color: #1d4ed8;
		font-size: 11px;
		font-weight: 650;
		cursor: pointer;
	}

	.debug-variable-type {
		color: #64748b;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 10px;
	}

	.debug-memory-inspect {
		display: inline-grid;
		width: 24px;
		height: 24px;
		flex: 0 0 auto;
		place-items: center;
		border: 0;
		border-radius: 8px;
		background: rgba(14, 116, 144, 0.09);
		color: #0e7490;
		cursor: pointer;
	}

	.debug-memory-inspect .material-symbols-outlined {
		font-size: 16px;
	}

	.debug-memory-controls {
		display: grid;
		grid-template-columns: minmax(120px, 2fr) minmax(72px, 1fr) minmax(64px, 0.7fr) auto;
		gap: 8px;
		align-items: end;
	}

	.debug-memory-controls label {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 4px;
		color: #64748b;
		font-size: 10px;
		font-weight: 650;
	}

	.debug-memory-controls input {
		min-width: 0;
		height: 34px;
		box-sizing: border-box;
		border: 1px solid rgba(148, 163, 184, 0.35);
		border-radius: 9px;
		background: rgba(255, 255, 255, 0.94);
		padding: 0 9px;
		color: #0f172a;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 11px;
	}

	.debug-memory-watch-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 8px;
	}

	.debug-memory-watch-controls label {
		display: flex;
		min-width: 120px;
		flex-direction: column;
		gap: 4px;
		color: #64748b;
		font-size: 10px;
		font-weight: 650;
	}

	.debug-memory-watch-controls select,
	.debug-memory-write-field input,
	.debug-memory-write,
	.debug-data-breakpoint-set,
	.debug-data-breakpoint-clear {
		height: 34px;
		box-sizing: border-box;
		border: 1px solid rgba(99, 102, 241, 0.24);
		border-radius: 9px;
		background: rgba(99, 102, 241, 0.08);
		padding: 0 11px;
		color: #4338ca;
		font: inherit;
		font-size: 11px;
		font-weight: 700;
	}

	.debug-data-breakpoint-set,
	.debug-memory-write,
	.debug-data-breakpoint-clear {
		cursor: pointer;
	}

	.debug-memory-write-field {
		flex: 1 1 180px;
	}

	.debug-memory-write-field input {
		min-width: 0;
		width: 100%;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-weight: 500;
	}

	.debug-data-breakpoint-clear {
		border-color: rgba(239, 68, 68, 0.2);
		background: rgba(239, 68, 68, 0.08);
		color: #b91c1c;
	}

	.debug-data-breakpoint-set:disabled,
	.debug-memory-write:disabled,
	.debug-data-breakpoint-clear:disabled {
		cursor: wait;
		opacity: 0.65;
	}

	.debug-data-breakpoint-status {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
		border-radius: 9px;
		background: rgba(99, 102, 241, 0.08);
		padding: 8px 10px;
		color: #4338ca;
		font-size: 11px;
	}

	.debug-memory-write-status {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
		border-radius: 9px;
		background: rgba(14, 116, 144, 0.08);
		padding: 8px 10px;
		color: #0e7490;
		font-size: 11px;
	}

	.debug-memory-read,
	.debug-memory-toolbar button {
		height: 34px;
		border: 0;
		border-radius: 9px;
		background: rgba(14, 116, 144, 0.1);
		padding: 0 11px;
		color: #0e7490;
		font: inherit;
		font-size: 11px;
		font-weight: 700;
		cursor: pointer;
	}

	.debug-memory-read:disabled {
		cursor: wait;
		opacity: 0.65;
	}

	.debug-memory-error {
		margin: 0;
		border-radius: 9px;
		background: rgba(239, 68, 68, 0.08);
		padding: 8px 10px;
		color: #b91c1c;
		font-size: 11px;
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
		color: #475569;
		font-size: 10px;
	}

	.debug-memory-table {
		display: flex;
		max-width: 100%;
		flex-direction: column;
		gap: 4px;
		overflow-x: auto;
		padding-bottom: 2px;
	}

	.debug-memory-row {
		display: grid;
		min-width: max-content;
		grid-template-columns: minmax(72px, auto) auto minmax(16ch, auto);
		gap: 10px;
		align-items: center;
	}

	.debug-memory-address,
	.debug-memory-ascii {
		color: #64748b;
		font-size: 10px;
	}

	.debug-memory-hex {
		display: grid;
		grid-template-columns: repeat(16, 2ch);
		gap: 4px;
	}

	.debug-memory-byte {
		color: #0f172a;
		font-size: 10px;
		text-align: center;
	}

	.debug-memory-byte--unreadable {
		color: #dc2626;
	}

	.debug-memory-ascii {
		white-space: pre;
	}

	.debug-expand {
		display: inline-grid;
		width: 24px;
		height: 24px;
		flex: 0 0 auto;
		place-items: center;
		border: 0;
		border-radius: 8px;
		background: rgba(99, 102, 241, 0.08);
		color: var(--debug-accent);
		cursor: pointer;
	}

	.debug-expand:disabled {
		cursor: default;
		opacity: 0.65;
	}

	.debug-expand .material-symbols-outlined {
		font-size: 17px;
	}

	.debug-variable-children {
		margin-left: 14px;
		padding-left: 10px;
		border-left: 1px solid rgba(99, 102, 241, 0.18);
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

	.debug-frame-select {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 0;
		border: 0;
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
