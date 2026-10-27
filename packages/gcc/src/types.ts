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
	readonly compiler: Readonly<{ family: 'gcc'; version: '13.3.0' }>;
	/** Producer v1 capabilities; the request-only `avx2` profile is a subset of `avx2-fma`. */
	readonly cpuProfiles: readonly ['x86-64', 'avx2-fma'];
	readonly linkMode: 'static';
	readonly sysrootPath: '/sysroot';
	readonly gccInstallation: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/13';
	readonly resourceDir: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/13/include';
	readonly assets: Readonly<Record<CrossGccAssetName, CrossGccAsset>>;
	readonly gnu: Readonly<{ gccVersion: string; glibcVersion: string; distribution: string }>;
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
	/** Object-like macro definitions passed as real -D arguments, e.g. ONLINE_JUDGE=1. */
	readonly defines?: readonly string[];
}

export interface CrossGccIdentity {
	readonly compiler: 'gcc';
	readonly compilerVersion: '13.3.0';
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

export interface CrossGccCompiler {
	readonly manifest: CrossGccManifest;
	readonly identity: CrossGccIdentity;
	/** Tool main() blocks its thread. Use createCrossGccWorker for interruptible compilation. */
	compile(request: CrossGccCompileRequest): Promise<CrossGccCompileResult>;
	dispose(): void;
}

export interface CrossGccWorker extends Omit<CrossGccCompiler, 'compile'> {
	compile(
		request: CrossGccCompileRequest,
		options?: { signal?: AbortSignal }
	): Promise<CrossGccCompileResult>;
	/** Terminates the Worker immediately. Create a new Worker to compile again. */
	cancel(): void;
}

export type GccOutputTarget = 'x86_64-linux-gnu' | 'wasm32-wasi';
export type WasiGccAssetName = Exclude<CrossGccAssetName, 'ldJs'>;

export interface GccSourceRevision {
	readonly repository: string;
	readonly commit: string;
	readonly version: string;
}

/** Separate contract: the Emscripten compiler host does not describe its output ABI. */
export interface WasiGccManifest {
	readonly schemaVersion: 2;
	readonly kind: 'gcc-wasm32-wasi';
	readonly host: 'wasm32-emscripten';
	readonly target: 'wasm32-wasi';
	readonly compiler: GccSourceRevision & Readonly<{ family: 'gcc' }>;
	readonly assembler: GccSourceRevision & Readonly<{ family: 'wabt' }>;
	readonly linker: GccSourceRevision & Readonly<{ family: 'lld'; host: 'wasm32-wasi' }>;
	readonly sysroot: GccSourceRevision & Readonly<{ family: 'wasi-libc' }>;
	readonly abi: 'wasm32-wasi-preview1';
	readonly linkMode: 'static';
	readonly sysrootPath: '/sysroot';
	readonly gccInstallation: string;
	readonly resourceDir: string;
	readonly assets: Readonly<Record<WasiGccAssetName, CrossGccAsset>>;
	/** Exact archive paths inside the sysroot, appended after libc/libm at link time. */
	readonly runtimeLibraries: readonly string[];
	readonly capabilities: Readonly<{
		c: true;
		cpp: boolean;
		libc: boolean;
		libm: boolean;
		libstdcxx: boolean;
		staticInitialization: boolean;
		/** Qualified IEEE binary128 ABI, arithmetic and WASI long-double library interfaces. */
		longDouble?: boolean;
		exceptions: false;
		rtti: false;
		threads: false;
		dynamicLinking: false;
		/** True only for a producer bundle qualified with the GCC simd128 backend patch. */
		simd: boolean;
	}>;
	readonly qualification: Readonly<{ status: 'unverified' | 'verified' }>;
}

export interface CreateGccCompilerOptions extends CreateCrossGccCompilerOptions {
	/** Required: a wasm32 compiler host can produce x86 ELF or wasm32 WASI output. */
	readonly target: GccOutputTarget;
}

export interface WasiGccCompileRequest extends Omit<CrossGccCompileRequest, 'cpu'> {
	/** Baseline Wasm only. An x86 AVX2/FMA profile is not Wasm SIMD. */
	readonly cpu?: 'wasm32';
	readonly exceptions?: false;
	readonly rtti?: false;
	readonly threads?: false;
	readonly dynamicLinking?: false;
	/** Opt in to the bundle's qualified baseline Wasm SIMD operations; never selects x86 AVX. */
	readonly simd?: boolean;
}

export interface WasiGccIdentity extends Omit<CrossGccIdentity, 'target' | 'compilerVersion'> {
	readonly target: 'wasm32-wasi';
	readonly compilerVersion: string;
	readonly compilerCommit: string;
}

export interface GccWasmInspection {
	readonly imports: readonly WebAssembly.ModuleImportDescriptor[];
	readonly exports: readonly WebAssembly.ModuleExportDescriptor[];
	readonly hasLinkingMetadata: boolean;
	/** Detected from validated instructions and types, independently of optional custom metadata. */
	readonly features: Readonly<{ simd128: boolean }>;
	readonly memory?: Readonly<{ initialPages: number; maximumPages?: number; shared: false }>;
}

export interface WasiGccArtifact extends Omit<CrossGccArtifact, 'target' | 'format' | 'cpu'> {
	readonly target: 'wasm32-wasi';
	readonly format: 'assembly' | 'wasm-object' | 'wasm-executable';
	readonly cpu: 'wasm32';
	readonly wasm?: GccWasmInspection;
}

export interface WasiGccCompileResult extends Omit<CrossGccCompileResult, 'artifact'> {
	readonly artifact?: WasiGccArtifact;
}

export interface WasiGccRunOptions {
	/** Complete input; EOF follows these bytes. */
	readonly stdin?: string | Uint8Array;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	/** Combined stdout and stderr limit. Default: four MiB. */
	readonly maxOutputBytes?: number;
}

export interface WasiGccRunResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly milliseconds: number;
	readonly peakMemoryBytes: number;
}

export interface WasiGccCompiler {
	readonly manifest: WasiGccManifest;
	readonly identity: WasiGccIdentity;
	compile(request: WasiGccCompileRequest): Promise<WasiGccCompileResult>;
	/** Runs only a linked WASI artifact. Use a Worker to interrupt synchronous guest code. */
	run(artifact: WasiGccArtifact, options?: WasiGccRunOptions): Promise<WasiGccRunResult>;
	dispose(): void;
}

export interface WasiGccWorker extends Omit<WasiGccCompiler, 'compile' | 'run'> {
	compile(
		request: WasiGccCompileRequest,
		options?: { signal?: AbortSignal }
	): Promise<WasiGccCompileResult>;
	run(
		artifact: WasiGccArtifact,
		options?: WasiGccRunOptions & { signal?: AbortSignal }
	): Promise<WasiGccRunResult>;
	/** Terminates compilation or guest execution immediately; the Worker cannot be reused. */
	cancel(): void;
}
