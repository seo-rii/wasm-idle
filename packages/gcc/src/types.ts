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
	readonly compiler: Readonly<{ family: 'gcc'; version: '13.3.0' | '16.2.0' }>;
	/** Producer v1 capabilities; the request-only `avx2` profile is a subset of `avx2-fma`. */
	readonly cpuProfiles: readonly ['x86-64', 'avx2-fma'];
	readonly linkMode: 'static';
	readonly sysrootPath: '/sysroot';
	readonly gccInstallation: `/sysroot/usr/lib/gcc/x86_64-linux-gnu/${'13' | '16'}`;
	readonly resourceDir: `${CrossGccManifest['gccInstallation']}/include`;
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
	/** Object-like macro definitions passed as real -D arguments, e.g. ONLINE_JUDGE=1. */
	readonly defines?: readonly string[];
}

/** The C++ profile a precompiled header serves; defaults match compile(). */
export type CrossGccPrecompileRequest = Pick<
	CrossGccCompileRequest,
	'cpu' | 'optimization' | 'standard'
>;

export interface CrossGccIdentity {
	readonly compiler: 'gcc';
	readonly compilerVersion: CrossGccManifest['compiler']['version'];
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
	/** Invalidates the Worker and requests termination. Engine CPU work may stop later. */
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
		/** Embedded GNU C++20 time zones for ordinary private-memory execution. */
		timezoneDatabase?: boolean;
		/** Qualified IEEE binary128 ABI, arithmetic and WASI long-double library interfaces. */
		longDouble?: boolean;
		/** Qualified signed/unsigned __int128 operations and ABI. */
		int128?: boolean;
		/** Qualified GCC single-thread gcov instrumentation and normal-exit profile writes. */
		coverage?: boolean;
		/** Qualified embedded DWARF4 source/type/location information at O0. */
		debug?: boolean;
		/** Qualified GNU C++26 debugger functions with explicit observer registration.
		 * Independent of DWARF debug information; std::breakpoint() traps without resumption. */
		debugger?: boolean;
		/** Qualified modern Wasm EH and the matching GNU C++ runtime. */
		exceptions: boolean;
		/** GNU RTTI; exception-dependent failures require the exception profile. */
		rtti: boolean;
		threads: false;
		dynamicLinking: false;
		/** True only for a producer bundle qualified with the GCC simd128 backend patch. */
		simd: boolean;
		/** Qualified relaxed SIMD backend; absent is false and true requires simd. */
		relaxedSimd?: boolean;
		/** Qualified native atomic lowering and the matching GNU libatomic provider. */
		atomics?: boolean;
		/** Qualified freestanding shared-entry linking; does not imply pthread. */
		sharedMemory?: boolean;
		/** Qualified local-exec TLS ABI and runtime. Legacy absence means false. */
		tls?: boolean;
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
	/** Explicit modern Wasm EH for ordinary C++; omitted/false preserves -fno-exceptions. */
	readonly exceptions?: boolean;
	/** Opt in to qualified C++ RTTI. Omitted/false retains -fno-rtti. */
	readonly rtti?: boolean;
	readonly threads?: false;
	readonly dynamicLinking?: false;
	/** Opt in to the bundle's qualified baseline Wasm SIMD operations; never selects x86 AVX. */
	readonly simd?: boolean;
	/** Explicit relaxed SIMD profile. Requires simd: true, a capable bundle and engine. */
	readonly relaxedSimd?: boolean;
	/** Explicit native atomic instruction and libatomic profile; omitted means false. */
	readonly atomics?: boolean;
	/** Explicit local-exec TLS profile, independent of native atomic lowering. */
	readonly tls?: boolean;
	/** Separate freestanding C/C++ executable contract. Requires atomics: true. */
	readonly sharedMemory?: GccSharedMemoryProfile;
	/** Source-only GCC gcov instrumentation. Requires a qualified bundle and no linkInputs. */
	readonly coverage?: boolean;
	/** Embed standard DWARF4 in WAT/object/executable output. Requires a qualified bundle;
	 * defaults to optimization=0 and rejects explicitly selected nonzero optimization. */
	readonly debug?: boolean;
	/** Explicit static link inputs, after source objects and before runtime libraries, in this order. */
	readonly linkInputs?: readonly WasiGccLinkInput[];
}

/** Caller-declared ABI provenance. Wasm bytes cannot prove source-level C/C++ compatibility. */
export interface WasiGccLinkProfile {
	readonly target: 'wasm32-wasi';
	readonly abi: 'wasm32-wasi-preview1';
	readonly simd: boolean;
	/** Modern Wasm EH profile. Legacy omission means false. */
	readonly exceptions?: boolean;
	/** Relaxed SIMD compilation profile. Legacy omission means false. */
	readonly relaxedSimd?: boolean;
	/** Native atomic compilation profile. Legacy omission means false. */
	readonly atomics?: boolean;
	/** Local-exec TLS compilation profile. Legacy omission means false. */
	readonly tls?: boolean;
	/** Known source language. Legacy omission cannot establish that an input is pure C. */
	readonly language?: 'c' | 'cpp';
	/** C++ RTTI profile; legacy omission means false. Pure C inputs are RTTI-neutral. */
	readonly rtti?: boolean;
	/** Instrumented object provenance. Covered external inputs are currently unsupported. */
	readonly coverage?: boolean;
	readonly compatibility:
		| Readonly<{ kind: 'gcc-bundle'; manifestSha256: string; sysrootSha256: string }>
		| Readonly<{
				/** Nonvariadic scalar C interfaces only; no aggregates, vectors, long double or C++ ABI. */
				kind: 'clang-c-scalar-v1';
				compilerVersion: '22.1.0';
				compilerCommit: '4434dabb69916856b824f68a64b029c67175e532';
				sysrootSha256: string;
		  }>;
}

/** Object outputs supply this receipt for reuse; external inputs require independently known provenance. */
export interface WasiGccLinkInputReceipt {
	readonly format: 'wasm-object' | 'wasm-archive';
	readonly sha256: string;
	readonly profile: WasiGccLinkProfile;
}

export interface WasiGccLinkInput extends WasiGccLinkInputReceipt {
	/** Relative .o/.a name in a separate linker namespace; never a source or a driver option. */
	readonly path: string;
	readonly bytes: Uint8Array;
}

export interface WasiGccLinkedInput extends WasiGccLinkInputReceipt {
	readonly path: string;
	readonly bytes: number;
	readonly members?: readonly Readonly<{ path: string; bytes: number; sha256: string }>[];
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
	/** Instruction/type features and, when present, independently validated TLS ABI metadata. */
	readonly features: Readonly<{
		simd128: boolean;
		relaxedSimd: boolean;
		atomics: boolean;
		bulkMemory: boolean;
		/** Actual modern EH instructions, exception references or tag metadata. */
		exceptions?: boolean;
		/** Actual TLS object metadata or validated executable TLS ABI; absence means false. */
		tls?: boolean;
	}>;
	readonly memory?: Readonly<{ initialPages: number; maximumPages?: number; shared: boolean }>;
	/** Present only after validating the separate freestanding shared-entry ABI. */
	readonly sharedEntry?: Readonly<{
		name: string;
		parameterCount: number;
		dataEnd: number;
		heapBase: number;
		/** Present only for the validated TLS shared-entry contract. */
		tls?: Readonly<{
			size: number;
			alignment: number;
			reservedLow: number;
			reservedHigh: number;
		}>;
	}>;
}

export interface WasiGccArtifact extends Omit<CrossGccArtifact, 'target' | 'format' | 'cpu'> {
	readonly target: 'wasm32-wasi';
	readonly format: 'assembly' | 'wasm-object' | 'wasm-executable';
	readonly cpu: 'wasm32';
	readonly wasm?: GccWasmInspection;
	/** Retains explicit compile-time modern EH selection for checked execution. */
	readonly exceptions?: boolean;
	/** Retains explicit compile-time relaxed SIMD selection for checked execution. */
	readonly relaxedSimd?: boolean;
	/** Retains explicit compile-time atomic selection for checked execution. */
	readonly atomics?: boolean;
	/** Retains explicit compile-time TLS selection for checked execution. */
	readonly tls?: boolean;
	readonly sharedMemory?: GccSharedMemoryProfile;
	/** Present for object output. Reuse with {path, bytes: artifact.bytes, ...artifact.linkInput!}. */
	readonly linkInput?: WasiGccLinkInputReceipt;
	/** Present on covered executables. run() requires an exact writable /profile preopen. */
	readonly coverage?: Readonly<{
		format: 'gcc-gcov';
		directory: '/profile';
		dataPaths: readonly string[];
	}>;
}

export interface WasiGccCoverageNote {
	/** Stable relative filename, in source/link order: program.gcno, program.1.gcno, ... */
	readonly path: string;
	/** Absolute guest path emitted on normal exit; returned in run().files when written. */
	readonly dataPath: string;
	/** Independent exact binary GCC notes; interpret with the matching official gcov. */
	readonly contents: Uint8Array;
}

export interface WasiGccCompileResult extends Omit<CrossGccCompileResult, 'artifact'> {
	readonly artifact?: WasiGccArtifact;
	/** Validated external inputs in the exact linker order, including archive member identities. */
	readonly linkInputs?: readonly WasiGccLinkedInput[];
	/** Present after successful coverage compilation. Notes are bounded to 16 MiB each, 64 MiB total. */
	readonly coverage?: Readonly<{
		format: 'gcc-gcov';
		compilerVersion: string;
		compilerCommit: string;
		notes: readonly WasiGccCoverageNote[];
	}>;
}

export interface WasiGccPreopen {
	/** Canonical absolute guest path, e.g. /work. Mounts must not overlap. */
	readonly path: string;
	/** Denies all guest filesystem mutations in this mount. Default: false. */
	readonly readonly?: boolean;
	/** Canonical relative paths. Missing parent directories are created before execution. */
	readonly files?: readonly {
		readonly path: string;
		readonly contents: string | Uint8Array;
	}[];
	/** Additional empty directories, using canonical relative paths. */
	readonly directories?: readonly string[];
}

export interface WasiGccFilesystemLimits {
	/** Live files and directories, including mount roots and open unlinked files. Default: 1024. */
	readonly maxEntries?: number;
	/** Default: 16 MiB per file. */
	readonly maxFileBytes?: number;
	/** Default: 64 MiB across all mounts, including open unlinked files. */
	readonly maxTotalBytes?: number;
	/** Maximum absolute guest path length in UTF-8 bytes. Default: 4096. */
	readonly maxPathBytes?: number;
	/** Open filesystem descriptors, including preopens. Default: 256. */
	readonly maxOpenFiles?: number;
}

export interface WasiGccResultFile {
	readonly path: string;
	readonly contents: Uint8Array;
}

export interface WasiGccRunOptions {
	/** Complete input; EOF follows these bytes. */
	readonly stdin?: string | Uint8Array;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	/** Combined stdout and stderr limit. Default: four MiB. */
	readonly maxOutputBytes?: number;
	/** Fresh, copied in-memory mounts for this run only; absent means no filesystem access. */
	readonly preopens?: readonly WasiGccPreopen[];
	readonly filesystemLimits?: WasiGccFilesystemLimits;
}

export interface WasiGccRunResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly milliseconds: number;
	readonly peakMemoryBytes: number;
	/** Sorted absolute paths and copied final bytes of every remaining file, including inputs. */
	readonly files: readonly WasiGccResultFile[];
}

/** Fresh fixed-size shared memory for one freestanding exported entry, never WASI _start. */
export interface GccSharedMemoryProfile {
	readonly entry: string;
	/** TLS-only LLD reservation for all Worker stacks, TLS blocks and guards. */
	readonly reservedBytes?: number;
	readonly initialPages: number;
	/** Must equal initialPages; shared execution does not grow memory. */
	readonly maximumPages: number;
}

export interface GccSharedRunOptions {
	/** One row per Worker; rows must match the exported i32-arguments -> i32 signature. */
	readonly workerArguments: readonly (readonly number[])[];
	/** Per-Worker stack reservation, aligned to sixteen bytes. */
	readonly stackBytes: number;
	readonly signal?: AbortSignal;
	/** Bounds host acceptance of the entire cohort, including initialization. */
	readonly timeoutMs?: number;
}

export interface GccSharedRunResult {
	readonly values: readonly number[];
	/** Copied only after all entries return successfully; never a live shared buffer. */
	readonly memory: Uint8Array;
	readonly stackRegions: readonly Readonly<{ low: number; high: number }>[];
	/** Present only for TLS execution; each region lies below the allocator's heap. */
	readonly tlsRegions?: readonly Readonly<{ low: number; high: number; alignment: number }>[];
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
	/** Invalidates the Worker and requests termination; physical execution may stop later. */
	cancel(): void;
}
