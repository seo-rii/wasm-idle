export type CompileTarget = 'js' | 'wasm';
export type EffectsMode = 'cps' | 'jspi';
export type WasmBinaryenMode = 'fast' | 'full';
export type CompileArtifactKind = 'js' | 'wasm' | 'asset' | 'map' | 'text';
export type DiagnosticSeverity = 'error' | 'warning' | 'other';

export interface CompileRequest {
	files: Record<string, string>;
	entry: string;
	target: CompileTarget;
	packages?: string[];
	effectsMode?: EffectsMode;
	wasmBinaryenMode?: WasmBinaryenMode;
	sourcemap?: boolean;
}

export interface CompileArtifact {
	path: string;
	kind: CompileArtifactKind;
	data: Uint8Array | string;
}

export interface CompileDiagnostic {
	file?: string;
	line?: number;
	column?: number;
	severity: DiagnosticSeverity;
	message: string;
}

export interface CompileResult {
	success: boolean;
	stdout: string;
	stderr: string;
	diagnostics: CompileDiagnostic[];
	artifacts: CompileArtifact[];
}

export interface CompilePlanCommand {
	stage: 'ocamlc' | 'js_of_ocaml' | 'wasm_of_ocaml';
	argv: string[];
	cwd: string;
}

export interface ToolchainManifestRuntimeVariant {
	name: string;
	effectsMode: EffectsMode;
	path: string;
}

export interface ToolchainManifestPackage {
	name: string;
	path: string;
	runtimeAssets?: string[];
}

export interface ToolchainManifest {
	version: 1;
	generatedAt: string;
	toolchainRoot: string;
	findlibConfig: string;
	bins: Record<string, string>;
	libDirs: string[];
	runtimeVariants: ToolchainManifestRuntimeVariant[];
	packages: ToolchainManifestPackage[];
	notes?: string[];
}
