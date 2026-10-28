import type {
	DebugSourceBreakpoints,
	DebugSteppingOptions,
	ExecutionLimits,
	WorkspaceLimits
} from '@wasm-idle/core';

export type {
	DebugArrayElementKind,
	DebugCommand,
	DebugEvaluateOptions,
	DebugEvaluateResult,
	DebugSourceBreakpoint,
	DebugSteppingOptions,
	DebugVariablePresentationHint,
	DebugDataBreakpoint,
	DebugDataBreakpointAccessType,
	DebugDataBreakpointInfo,
	DebugDataBreakpointInfoArguments,
	DebugFrame,
	DebugMemory,
	DebugPauseReason,
	DebugResolvedBreakpoint,
	DebugResolvedDataBreakpoint,
	DebugSessionCapabilities,
	DebugSessionEvent,
	DebugScope,
	DebugSourceBreakpoints,
	DebugStructFieldMetadata,
	DebugVariable,
	DebugVariableKind,
	DebugVariableMetadata,
	DebugWriteMemoryResult
} from '@wasm-idle/core';

export type CompilerDiagnosticSeverity = 'error' | 'warning' | 'other';

export interface CompilerDiagnostic {
	fileName?: string | null;
	lineNumber: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity: CompilerDiagnosticSeverity;
	message: string;
}

export type RustOptimizationProfile = 'interactive' | 'speed' | 'size';
export type RustTargetTriple = 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3';
export type BrowserDebugMode = 'none' | 'trace' | 'lldb' | 'mobdebug' | 'tracepoint';
export type GoTarget = 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' | 'js/wasm';
export type TinyGoTarget = 'wasm' | 'wasip1' | 'wasip2' | 'wasip3';
export type OcamlBackend = 'js' | 'wasm';
export type OcamlWasmBinaryenMode = 'fast' | 'full';
export type ZigTargetTriple = 'wasm32-wasi';

export interface SandboxWorkspaceFile {
	path: string;
	content: string;
}

export interface SandboxExecutionOptions {
	/** Overrides instance/global persistent asset caching for this operation. */
	persistentCache?: import('@wasm-idle/core').RuntimeAssetCacheOptions;
	debugMode?: BrowserDebugMode;
	/** @deprecated Use debugMode. true follows the language's compatibility backend. */
	debug?: boolean;
	/** Keep the final run alive until the host explicitly stops or disposes it. */
	interactive?: boolean;
	breakpoints?: number[];
	sourceBreakpoints?: DebugSourceBreakpoints[];
	debugSteppingOptions?: DebugSteppingOptions;
	pauseOnEntry?: boolean;
	stdin?: string;
	signal?: AbortSignal;
	limits?: Partial<ExecutionLimits>;
	workspaceLimits?: Partial<WorkspaceLimits>;
	activePath?: string;
	debugPath?: string;
	workspaceFiles?: SandboxWorkspaceFile[];
	compileArgs?: string[];
	programArgs?: string[];
	/** Requested environment overrides; a runtime may reject unsupported options. */
	env?: Record<string, string>;
	cppVersion?: string;
	cVersion?: string;
	/** Select GNU dialects for each C/C++ source unit in the Objective-C worker. */
	objectivecGnuExtensions?: boolean;
	rustTargetTriple?: RustTargetTriple;
	/** Optimizes the Rust user program while retaining overflow checks and debug assertions. */
	rustOptimizationProfile?: RustOptimizationProfile;
	goTarget?: GoTarget;
	tinygoTarget?: TinyGoTarget;
	ocamlBackend?: OcamlBackend;
	ocamlWasmBinaryenMode?: OcamlWasmBinaryenMode;
	zigTargetTriple?: ZigTargetTriple;
}

export interface ResolvedSandboxExecutionArgs {
	compileArgs: string[];
	programArgs: string[];
}

function cloneArgs(value?: string[]) {
	return Array.isArray(value) ? [...value] : [];
}

const compileArgLanguages = new Set(['C', 'CPP', 'OBJC', 'OBJECTIVECXX']);

export function resolveSandboxExecutionArgs(
	language: string,
	args: string[] = [],
	options: SandboxExecutionOptions = {}
): ResolvedSandboxExecutionArgs {
	if (compileArgLanguages.has(language)) {
		return {
			compileArgs: cloneArgs(options.compileArgs ?? args),
			programArgs: cloneArgs(options.programArgs)
		};
	}

	return {
		compileArgs: cloneArgs(options.compileArgs),
		programArgs: cloneArgs(options.programArgs ?? args)
	};
}
