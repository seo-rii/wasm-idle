export type {
	DebugArrayElementKind,
	DebugCommand,
	DebugFrame,
	DebugPauseReason,
	DebugSessionEvent,
	DebugStructFieldMetadata,
	DebugVariable,
	DebugVariableKind,
	DebugVariableMetadata
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

export type RustTargetTriple = 'wasm32-wasip1' | 'wasm32-wasip2' | 'wasm32-wasip3';
export type GoTarget = 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm' | 'js/wasm';
export type TinyGoTarget = 'wasm' | 'wasip1' | 'wasip2' | 'wasip3';
export type OcamlBackend = 'js' | 'wasm';
export type OcamlWasmBinaryenMode = 'fast' | 'full';
export type ZigTargetTriple = 'wasm64-wasi';

export interface SandboxWorkspaceFile {
	path: string;
	content: string;
}

export interface SandboxExecutionOptions {
	debug?: boolean;
	breakpoints?: number[];
	pauseOnEntry?: boolean;
	stdin?: string;
	activePath?: string;
	debugPath?: string;
	workspaceFiles?: SandboxWorkspaceFile[];
	compileArgs?: string[];
	programArgs?: string[];
	cppVersion?: string;
	cVersion?: string;
	rustTargetTriple?: RustTargetTriple;
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

const compileArgLanguages = new Set(['C', 'CPP', 'OBJC']);

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
