export type CrossGccCpu = 'x86-64' | 'avx2' | 'avx2-fma';
export type CrossGccEmit = 'assembly' | 'object' | 'executable';
export type CrossGccTool = 'cc1' | 'cc1plus' | 'as' | 'ld';
export type CrossGccAssetName =
	| 'cc1Js'
	| 'cc1Wasm'
	| 'cc1plusJs'
	| 'cc1plusWasm'
	| 'asJs'
	| 'asWasm'
	| 'ldJs'
	| 'ldWasm'
	| 'sysroot';

export interface CrossGccAsset {
	readonly path: string;
	readonly sha256: string;
	readonly bytes: number;
}

export interface CrossGccManifest {
	readonly schemaVersion: 1;
	readonly kind: 'gcc-x86_64-linux-gnu';
	readonly host: 'wasm32-emscripten';
	readonly target: 'x86_64-linux-gnu';
	readonly compiler: Readonly<{ family: 'gcc'; version: '16.2.0' }>;
	/** Producer v1 capabilities; the request-only `avx2` profile is a subset of `avx2-fma`. */
	readonly cpuProfiles: readonly ['x86-64', 'avx2-fma'];
	readonly linkMode: 'static';
	readonly sysrootPath: '/sysroot';
	readonly gccInstallation: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/16';
	readonly resourceDir: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/16/include';
	readonly assets: Readonly<Record<CrossGccAssetName, CrossGccAsset>>;
	readonly gnu: Readonly<{ gccVersion: string; glibcVersion: string; distribution: string }>;
	/** Optional producer capabilities; absent fields are false for older bundles. */
	readonly capabilities: Readonly<{ precompiledHeaders: boolean }>;
	readonly qualification: Readonly<{ status: 'unverified' | 'verified' }>;
}

export interface CreateCrossGccCompilerOptions {
	readonly manifestUrl: string | URL;
	/** Obtained independently of the fetched manifest (for example, from the CI receipt). */
	readonly manifestSha256: string;
	readonly fetchImpl?: typeof fetch;
	readonly signal?: AbortSignal;
	/** Limit per asset and for the expanded GNU sysroot. Default: 512 MiB. */
	readonly maxAssetBytes?: number;
}

/** This is the complete option allowlist; arbitrary gcc driver flags are not accepted. */
export interface CrossGccCompileRequest {
	readonly code: string;
	readonly language?: 'c' | 'cpp';
	readonly cpu?: CrossGccCpu;
	readonly emit?: CrossGccEmit;
	readonly optimization?: '0' | '1' | '2' | '3' | 's';
	readonly standard?: string;
	/** Already preprocessed .i/.ii input. Ordinary source is the default. */
	readonly preprocessed?: boolean;
	readonly files?: readonly { readonly path: string; readonly contents: string | Uint8Array }[];
	/** Additional translation unit paths in files, in link order. Executable output only. */
	readonly sources?: readonly string[];
}

/** The C++ profile a precompiled header serves; defaults match compile(). */
export type CrossGccPrecompileRequest = Pick<
	CrossGccCompileRequest,
	'cpu' | 'optimization' | 'standard'
>;

export interface CrossGccIdentity {
	readonly compiler: 'gcc';
	readonly compilerVersion: '16.2.0';
	readonly compilerHost: 'wasm32-emscripten';
	readonly target: 'x86_64-linux-gnu';
	readonly manifestSha256: string;
	readonly sysrootSha256: string;
}

export interface CrossGccArtifact {
	readonly compiler: 'gcc';
	readonly compilerHost: 'wasm32-emscripten';
	readonly target: 'x86_64-linux-gnu';
	readonly format: 'assembly' | 'elf-object' | 'elf-executable';
	readonly fileName: string;
	readonly bytes: Uint8Array;
	readonly cpu: CrossGccCpu;
}

export interface CrossGccStageResult {
	readonly tool: CrossGccTool;
	/** Arguments passed directly to the real tool, without a shell or gcc driver. */
	readonly argv: readonly string[];
	readonly exitCode: number;
	readonly milliseconds: number;
	/** Final linear memory size (Wasm memory only grows); excludes JS/MEMFS allocations. */
	readonly peakMemoryBytes: number;
}

export interface CrossGccCompileResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly stages: readonly CrossGccStageResult[];
	readonly artifact?: CrossGccArtifact;
}

export interface CrossGccPrecompileResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly stages: readonly CrossGccStageResult[];
	/** Size of the retained precompiled header after a successful run. */
	readonly bytes?: number;
}

export interface CrossGccCompiler {
	readonly manifest: CrossGccManifest;
	readonly identity: CrossGccIdentity;
	/** Tool main() blocks its thread. Use createCrossGccWorker for interruptible compilation. */
	compile(request: CrossGccCompileRequest): Promise<CrossGccCompileResult>;
	/**
	 * Precompile GNU bits/stdc++.h for this C++ profile and retain it, replacing any earlier
	 * one. Later C++ compiles with identical front-end flags offer it to GCC, which uses it
	 * only where valid. Requires manifest.capabilities.precompiledHeaders.
	 */
	precompileHeader(request?: CrossGccPrecompileRequest): Promise<CrossGccPrecompileResult>;
	dispose(): void;
}

export interface CrossGccWorker extends Omit<CrossGccCompiler, 'compile' | 'precompileHeader'> {
	compile(
		request: CrossGccCompileRequest,
		options?: { signal?: AbortSignal }
	): Promise<CrossGccCompileResult>;
	precompileHeader(
		request?: CrossGccPrecompileRequest,
		options?: { signal?: AbortSignal }
	): Promise<CrossGccPrecompileResult>;
	/** Terminates the Worker immediately. Create a new Worker to compile again. */
	cancel(): void;
}
