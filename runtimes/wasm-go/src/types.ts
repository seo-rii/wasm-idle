export type SupportedGoWasiTarget = 'wasip1/wasm' | 'wasip2/wasm' | 'wasip3/wasm';
export type SupportedGoTarget = SupportedGoWasiTarget | 'js/wasm';
export type SupportedGoOs = 'wasip1' | 'wasip2' | 'wasip3' | 'js';
export type BrowserGoArtifactFormat = 'go-archive' | 'wasi-core-wasm' | 'js-wasm';
export type BrowserGoCompileStage = 'manifest' | 'plan' | 'compile' | 'link' | 'done';
export type CompilerLogLevel = 'log' | 'warn' | 'error' | 'debug';

export interface RuntimeAssetFile {
	asset: string;
	runtimePath: string;
	readonly?: boolean;
}

export interface RuntimeAssetPackReference {
	asset: string;
	index: string;
	fileCount: number;
	totalBytes: number;
}

export interface RuntimeStdlibIndexAsset {
	asset: string;
	packageCount: number;
}

export interface RuntimePackIndexEntry {
	runtimePath: string;
	offset: number;
	length: number;
}

export interface RuntimePackIndex {
	format: 'wasm-go-runtime-pack-index-v1';
	fileCount: number;
	totalBytes: number;
	entries: RuntimePackIndexEntry[];
}

export interface RuntimeStdlibPackageEntry {
	importPath: string;
	runtimePath: string;
	imports: string[];
}

export interface RuntimeStdlibIndex {
	format: 'wasm-go-stdlib-index-v1';
	packageCount: number;
	packages: RuntimeStdlibPackageEntry[];
}

export interface RuntimeToolMemoryConfig {
	initialPages: number;
	maximumPages: number;
}

export interface RuntimeToolConfig {
	asset: string;
	argv0: string;
	memory: RuntimeToolMemoryConfig;
}

export interface RuntimeHostConfig {
	rootDirectory: string;
	pwd: string;
	tmpDirectory: string;
	env: string[];
}

export interface RuntimePlannerConfig {
	workspaceRoot: string;
	importcfgPath: string;
	embedcfgPath: string;
	compileOutputPath: string;
	linkOutputPath: string;
	defaultLang: string;
	defaultTrimpath: string;
}

export interface RuntimeCompilerConfig {
	compile: RuntimeToolConfig;
	link: RuntimeToolConfig;
	compileTimeoutMs: number;
	linkTimeoutMs: number;
	host: RuntimeHostConfig;
}

export interface RuntimeTargetExecutionConfig {
	kind: 'wasi-preview1' | 'js-wasm-exec';
	wasmExecJs?: string;
}

export interface RuntimeTargetConfig {
	target: SupportedGoTarget;
	goos: SupportedGoOs;
	goarch: 'wasm';
	artifactFormat: Exclude<BrowserGoArtifactFormat, 'go-archive'>;
	sysrootFiles?: RuntimeAssetFile[];
	sysrootPack?: RuntimeAssetPackReference;
	stdlibIndex?: RuntimeStdlibIndexAsset;
	execution: RuntimeTargetExecutionConfig;
	planner: RuntimePlannerConfig;
}

export interface RuntimeManifestV1 {
	manifestVersion: 1;
	version: string;
	goVersion: string;
	defaultTarget: SupportedGoTarget;
	compiler: RuntimeCompilerConfig;
	targets: Partial<Record<SupportedGoTarget, Omit<RuntimeTargetConfig, 'target'>>>;
}

export interface NormalizedRuntimeManifest {
	manifestVersion: 1;
	version: string;
	goVersion: string;
	defaultTarget: SupportedGoTarget;
	compiler: RuntimeCompilerConfig;
	targets: Partial<Record<SupportedGoTarget, RuntimeTargetConfig>>;
}

export interface BrowserGoSourceFile {
	path: string;
	contents: string;
}

export interface BrowserGoGeneratedFile {
	path: string;
	contents: string;
}

export interface BrowserGoWorkspaceFile {
	path: string;
	contents: string | Uint8Array | ArrayBuffer;
}

export interface GoPackageArchive {
	importPath: string;
	archivePath: string;
	replaceImportPath?: string;
}

export interface GoEmbedFile {
	path: string;
	sourcePath?: string;
}

export interface GoEmbedPattern {
	pattern: string;
	files: GoEmbedFile[];
}

export interface BrowserGoToolInvocation {
	tool: 'compile' | 'link';
	toolAsset: string;
	argv0: string;
	args: string[];
	env: Record<string, string>;
	inputFiles: BrowserGoWorkspaceFile[];
	outputPath: string;
}

export interface BrowserGoBuildPlan {
	target: SupportedGoTarget;
	goVersion: string;
	packageImportPath: string;
	packageKind: 'main' | 'library';
	artifactFormat: BrowserGoArtifactFormat;
	workspaceRoot: string;
	sourceFiles: BrowserGoSourceFile[];
	generatedFiles: BrowserGoGeneratedFile[];
	importcfg: string;
	embedcfg?: string;
	sysrootFiles?: RuntimeAssetFile[];
	sysrootPack?: RuntimeAssetPackReference;
	execution: RuntimeTargetExecutionConfig;
	compile: BrowserGoToolInvocation;
	link?: BrowserGoToolInvocation;
	cacheKeys: {
		compile: string;
		link?: string;
	};
}

export interface BrowserGoArtifact {
	bytes: Uint8Array | ArrayBuffer;
	wasm?: Uint8Array | ArrayBuffer;
	target: SupportedGoTarget;
	format: BrowserGoArtifactFormat;
}

export interface BrowserGoToolResult {
	exitCode: number;
	stdout?: string;
	stderr?: string;
	outputs?: Record<string, Uint8Array | ArrayBuffer>;
}

export interface CompilerDiagnostic {
	fileName?: string;
	lineNumber?: number;
	columnNumber?: number;
	severity: 'error' | 'warning' | 'other';
	message: string;
}

export interface CompilerLogRecord {
	level: CompilerLogLevel;
	message: string;
}

export interface BrowserGoCompileProgress {
	stage: BrowserGoCompileStage;
	completed: number;
	total: number;
	percent: number;
	message?: string;
}

export interface BrowserGoCompileRequest {
	code?: string;
	files?: Record<string, string> | BrowserGoSourceFile[];
	fileName?: string;
	packageImportPath?: string;
	packageKind?: 'main' | 'library';
	target?: SupportedGoTarget;
	targetTriple?: SupportedGoTarget;
	mode?: string;
	channel?: string;
	lang?: string;
	trimpath?: string;
	dependencies?: GoPackageArchive[];
	autoDependencies?: 'sysroot' | 'none';
	embeds?: GoEmbedPattern[];
	log?: boolean;
	prepare?: boolean;
	onProgress?: (progress: BrowserGoCompileProgress) => void;
}

export interface BrowserGoCompilerResult {
	success: boolean;
	stdout?: string;
	stderr?: string;
	diagnostics?: CompilerDiagnostic[];
	logs?: string[];
	logRecords?: CompilerLogRecord[];
	plan?: BrowserGoBuildPlan;
	artifact?: BrowserGoArtifact;
}

export interface BrowserGoCompiler {
	plan: (request: BrowserGoCompileRequest) => Promise<BrowserGoBuildPlan>;
	compile: (request: BrowserGoCompileRequest) => Promise<BrowserGoCompilerResult>;
}

export type BrowserGoCompilerFactory = (
	options?: import('./compiler.js').CreateGoCompilerOptions
) => Promise<BrowserGoCompiler>;
