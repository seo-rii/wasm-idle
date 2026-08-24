import {
	ConsoleStdout,
	File,
	OpenDirectory,
	OpenFile,
	PreopenDirectory,
	WASI,
	WASIProcExit,
	wasi
} from '@bjorn3/browser_wasi_shim';

import {
	TINYGO_GO_VERSION,
	TINYGO_ROOT_PATH,
	TINYGO_RUNTIME_PROFILE_ID,
	TINYGO_UPSTREAM_COMPILER_PACKAGES,
	TINYGO_UPSTREAM_PACKAGE_GRAPH_FIELDS,
	TINYGO_UPSTREAM_PACKAGE_GRAPH_TAGS,
	TINYGO_WORK_PATH,
	TINYGO_WORKSPACE_PATH,
	parseTinyGoRuntimeClosure,
	sha256TinyGoBytes,
	validateTinyGoPackageJSON,
	verifyTinyGoUpstreamAssetSet,
	type TinyGoCompileProtocolVersion,
	type TinyGoRuntimeClosure
} from './upstream-contract.ts';
import {
	addTinyGoVfsDirectory,
	addTinyGoVfsFile,
	extractTinyGoRootArchive,
	hasTinyGoVfsPath,
	readTinyGoVfsFile,
	type TinyGoWasiDirectoryContents
} from './upstream-vfs.ts';
import {
	assertTinyGoFinalWasmModule,
	assertTinyGoLLVMBitcodeEnvelope,
	assertTinyGoRelocatableWasmObject
} from './upstream-binary.ts';
import { capTinyGoWasmMemory } from './upstream-worker.ts';

const RUNTIME_MANIFEST_PATH = `runtime/${TINYGO_RUNTIME_PROFILE_ID}/manifest.json`;
const MAX_DIAGNOSTIC_BYTES = 1024 * 1024;
const EXPECTED_EXTRA_SOURCES = [
	'src/runtime/asm_tinygowasm.S',
	'src/runtime/gc_boehm.c',
	'src/internal/task/task_asyncify_wasm.S'
] as const;
const WASM_MAGIC = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const TINYGO_LLVM_VALIDATION = {
	toolchain: 'llvm-20.1.1',
	moduleVerified: true,
	targetTriple: 'wasm32-unknown-wasi',
	dataLayout:
		'e-m:e-p:32:32-p10:8:8-p20:8:8-i64:64-i128:128-n32:64-S128-ni:1:10:20',
	threadLocalGlobals: 0,
	globalConstructors: 0,
	globalDestructors: 0,
	forbiddenAbiSymbols: []
} as const;
const TINYGO_WASM_OBJECT_VALIDATION = {
	profile: 'wasm-relocatable-object-v1',
	linkingVersion: 2,
	symbolTable: true
} as const;
const MAX_LINK_PLAN_BYTES = 1024 * 1024;
const MAX_OBJECT_COUNT = 1024;
// browser_wasi_shim 0.4.2 reports zero descriptor rights. wasi-libc uses
// fd_fdstat_get after path_open and rejects writable Clang outputs when those
// capability bits are absent, so report the operations its memory FDs support.
const openFileFdstatGet = OpenFile.prototype.fd_fdstat_get;
const openFileReadRights =
	BigInt(wasi.RIGHTS_FD_READ) |
	BigInt(wasi.RIGHTS_FD_SEEK) |
	BigInt(wasi.RIGHTS_FD_TELL) |
	BigInt(wasi.RIGHTS_FD_ADVISE) |
	BigInt(wasi.RIGHTS_FD_FILESTAT_GET);
const openFileWriteRights =
	BigInt(wasi.RIGHTS_FD_WRITE) |
	BigInt(wasi.RIGHTS_FD_DATASYNC) |
	BigInt(wasi.RIGHTS_FD_SYNC) |
	BigInt(wasi.RIGHTS_FD_ALLOCATE) |
	BigInt(wasi.RIGHTS_FD_FILESTAT_SET_SIZE) |
	BigInt(wasi.RIGHTS_FD_FILESTAT_SET_TIMES);
const openDirectoryRights =
	BigInt(wasi.RIGHTS_PATH_CREATE_DIRECTORY) |
	BigInt(wasi.RIGHTS_PATH_CREATE_FILE) |
	BigInt(wasi.RIGHTS_PATH_LINK_SOURCE) |
	BigInt(wasi.RIGHTS_PATH_LINK_TARGET) |
	BigInt(wasi.RIGHTS_PATH_OPEN) |
	BigInt(wasi.RIGHTS_FD_READDIR) |
	BigInt(wasi.RIGHTS_PATH_READLINK) |
	BigInt(wasi.RIGHTS_PATH_RENAME_SOURCE) |
	BigInt(wasi.RIGHTS_PATH_RENAME_TARGET) |
	BigInt(wasi.RIGHTS_PATH_FILESTAT_GET) |
	BigInt(wasi.RIGHTS_PATH_FILESTAT_SET_SIZE) |
	BigInt(wasi.RIGHTS_PATH_FILESTAT_SET_TIMES) |
	BigInt(wasi.RIGHTS_PATH_REMOVE_DIRECTORY) |
	BigInt(wasi.RIGHTS_PATH_UNLINK_FILE) |
	BigInt(wasi.RIGHTS_FD_FILESTAT_GET);
OpenFile.prototype.fd_fdstat_get = function () {
	const result = openFileFdstatGet.call(this);
	if (result.fdstat) {
		result.fdstat.fs_rights_base =
			openFileReadRights | (this.file.readonly ? 0n : openFileWriteRights);
	}
	return result;
};
const openDirectoryFdstatGet = OpenDirectory.prototype.fd_fdstat_get;
OpenDirectory.prototype.fd_fdstat_get = function () {
	const result = openDirectoryFdstatGet.call(this);
	if (result.fdstat) {
		result.fdstat.fs_rights_base = openDirectoryRights;
		result.fdstat.fs_rights_inherited =
			openDirectoryRights | openFileReadRights | openFileWriteRights;
	}
	return result;
};
const MAX_OBJECT_BYTES = 128 * 1024 * 1024;
const MAX_OBJECT_SET_BYTES = 256 * 1024 * 1024;
const MAX_NATIVE_INPUT_COUNT = 1024;
const MAX_NATIVE_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_NATIVE_DEPENDENCY_COUNT = 4096;
const MAX_NATIVE_DEPENDENCY_SET_BYTES = 64 * 1024 * 1024;

export interface TinyGoUpstreamToolchainAssets {
	manifest: unknown;
	producerReceipt: Uint8Array;
	packageGraphReceipt: Uint8Array;
	compiler: Uint8Array;
	packageGraph: Uint8Array;
	rootArchive: Uint8Array;
	lld: Uint8Array;
}

export interface PreparedTinyGoUpstreamToolchain {
	compiler: WebAssembly.Module;
	packageGraph: WebAssembly.Module;
	lld: WebAssembly.Module;
	compilerSha256: string;
	compileProtocolVersion: TinyGoCompileProtocolVersion;
	root: TinyGoWasiDirectoryContents;
	runtime: TinyGoRuntimeClosure;
	producerReceipt: Record<string, unknown>;
	packageGraphReceipt: Record<string, unknown>;
}

export interface TinyGoUpstreamCompileRequest {
	workspaceFiles: Record<string, string | Uint8Array>;
	package?: string;
	signal?: AbortSignal;
	onPhase?: (phase: 'graph' | 'validate' | 'compile' | 'link' | 'optimize') => void;
}

export interface TinyGoOptimizerRequest {
	wasm: Uint8Array;
	arguments: readonly string[];
	passes: readonly ['asyncify'];
	optimizeLevel: 1;
	preserveDebugInfo: true;
}

export type TinyGoWasmOptimizer = (
	request: TinyGoOptimizerRequest
) => Uint8Array | Promise<Uint8Array>;

export interface TinyGoUpstreamCompileResult {
	wasm: Uint8Array;
	unoptimizedWasm: Uint8Array;
	object: Uint8Array;
	objects: Uint8Array[];
	linkPlan: TinyGoLinkPlan;
	packageJSON: string;
	compilerStdout: Uint8Array;
	compilerStderr: Uint8Array;
	linkerStdout: Uint8Array;
	linkerStderr: Uint8Array;
}

export interface TinyGoExecutionResult {
	exitCode: number;
	stdout: Uint8Array;
	stderr: Uint8Array;
}

export interface TinyGoLinkPlanV1 {
	schemaVersion: 1;
	compilerPackages: string[];
	linker: 'wasm-ld';
	object: string;
	output: string;
	arguments: string[];
	runtimeInputs: Array<{ kind: string; source?: string; path: string }>;
	optimizer: {
		tool: 'wasm-opt';
		input: string;
		output: string;
		arguments: string[];
	};
}

export interface TinyGoLinkPlanObject {
	kind: 'program' | 'target-c' | 'target-cxx' | 'target-assembly' | 'embed';
	path: string;
	format: 'wasm-object' | 'llvm-bitcode';
	bytes: number;
	sha256: string;
	importPath?: string;
	sourceField?: 'CFiles' | 'CXXFiles' | 'SFiles';
	sourcePath?: string;
	sourceSha256?: string;
	embeddedFileHash?: string;
	dependencies?: TinyGoLinkPlanDependency[];
	compilerFlags?: string[];
	llvmValidation?: TinyGoLLVMValidation;
	wasmValidation?: TinyGoWasmObjectValidation;
}

export interface TinyGoLLVMValidation {
	toolchain: 'llvm-20.1.1';
	moduleVerified: true;
	targetTriple: 'wasm32-unknown-wasi';
	dataLayout: 'e-m:e-p:32:32-p10:8:8-p20:8:8-i64:64-i128:128-n32:64-S128-ni:1:10:20';
	threadLocalGlobals: 0;
	globalConstructors: 0;
	globalDestructors: 0;
	forbiddenAbiSymbols: [];
}

export interface TinyGoWasmObjectValidation {
	profile: 'wasm-relocatable-object-v1';
	linkingVersion: 2;
	symbolTable: true;
}

export interface TinyGoLinkPlanDependency {
	scope: 'root' | 'workspace';
	path: string;
	bytes: number;
	sha256: string;
}

export interface TinyGoLinkPlanCGoInput {
	importPath: string;
	sourcePath: string;
	bytes: number;
	sha256: string;
	dependencies: TinyGoLinkPlanDependency[];
}

export interface TinyGoLinkPlanV2 {
	schemaVersion: 2;
	format: 'wasm-llvm-tinygo-link-plan-v2';
	compilerSha256: string;
	capabilities: ['go-embed-objects'];
	compilerPackages: string[];
	linker: 'wasm-ld';
	objects: TinyGoLinkPlanObject[];
	output: string;
	arguments: string[];
	runtimeInputs: Array<{ kind: string; source?: string; path: string }>;
	optimizer: {
		tool: 'wasm-opt';
		input: string;
		output: string;
		arguments: string[];
	};
}

export interface TinyGoLinkPlanV3 {
	schemaVersion: 3;
	format: 'wasm-llvm-tinygo-link-plan-v3';
	compilerSha256: string;
	capabilities: ['go-embed-objects', 'target-cgo-c'];
	compilerPackages: string[];
	linker: 'wasm-ld';
	objects: TinyGoLinkPlanObject[];
	output: 'program.unoptimized.wasm';
	arguments: string[];
	runtimeInputs: Array<{ kind: string; source?: string; path: string }>;
	cgoInputs: TinyGoLinkPlanCGoInput[];
	optimizer: {
		tool: 'wasm-opt';
		input: 'program.unoptimized.wasm';
		output: 'program.wasm';
		arguments: string[];
	};
}

export interface TinyGoLinkPlanV4 {
	schemaVersion: 4;
	format: 'wasm-llvm-tinygo-link-plan-v4';
	compilerSha256: string;
	capabilities: [
		'go-embed-objects',
		'target-cgo-c',
		'target-cxx-freestanding',
		'target-clang-assembly'
	];
	compilerPackages: string[];
	linker: 'wasm-ld';
	objects: TinyGoLinkPlanObject[];
	output: 'program.unoptimized.wasm';
	arguments: string[];
	runtimeInputs: Array<{ kind: string; source?: string; path: string }>;
	cgoInputs: TinyGoLinkPlanCGoInput[];
	optimizer: {
		tool: 'wasm-opt';
		input: 'program.unoptimized.wasm';
		output: 'program.wasm';
		arguments: string[];
	};
}

export interface TinyGoLinkPlanV5 {
	schemaVersion: 5;
	format: 'wasm-llvm-tinygo-link-plan-v5';
	compilerSha256: string;
	capabilities: [
		'go-embed-objects',
		'target-cgo-c',
		'target-cxx-hosted-noeh',
		'target-clang-assembly'
	];
	compilerPackages: string[];
	linker: 'wasm-ld';
	objects: TinyGoLinkPlanObject[];
	output: 'program.unoptimized.wasm';
	arguments: string[];
	runtimeInputs: Array<{ kind: string; source?: string; path: string }>;
	cgoInputs: TinyGoLinkPlanCGoInput[];
	optimizer: {
		tool: 'wasm-opt';
		input: 'program.unoptimized.wasm';
		output: 'program.wasm';
		arguments: string[];
	};
}

export interface TinyGoLinkPlanV6 {
	schemaVersion: 6;
	format: 'wasm-llvm-tinygo-link-plan-v6';
	compilerSha256: string;
	capabilities: [
		'go-embed-objects',
		'target-cgo-c',
		'target-cxx-hosted-noeh',
		'target-clang-assembly',
		'target-cgo-cxxflags',
		'target-cgo-linker-flags'
	];
	compilerPackages: string[];
	linker: 'wasm-ld';
	objects: TinyGoLinkPlanObject[];
	output: 'program.unoptimized.wasm';
	arguments: string[];
	runtimeInputs: Array<{ kind: string; source?: string; path: string }>;
	cgoInputs: TinyGoLinkPlanCGoInput[];
	cgoLinkerFlags: string[];
	optimizer: {
		tool: 'wasm-opt';
		input: 'program.unoptimized.wasm';
		output: 'program.wasm';
		arguments: string[];
	};
}

export type TinyGoLinkPlan =
	| TinyGoLinkPlanV1
	| TinyGoLinkPlanV2
	| TinyGoLinkPlanV3
	| TinyGoLinkPlanV4
	| TinyGoLinkPlanV5
	| TinyGoLinkPlanV6;

export interface TinyGoExpectedEmbedObject {
	importPath: string;
	sourcePath: string;
	sourceSha256: string;
	embeddedFileHash: string;
}

export interface TinyGoExpectedNativeSource {
	importPath: string;
	sourcePath: string;
	bytes: number;
	sha256: string;
}

export interface TinyGoExpectedNativeSourceV4 extends TinyGoExpectedNativeSource {
	sourceField: 'CFiles' | 'CXXFiles' | 'SFiles';
}

interface BinaryenModuleLike {
	runPasses(passes: string[]): void;
	optimize(): void;
	validate(): boolean;
	emitBinary(): Uint8Array;
	dispose(): void;
}

export interface TinyGoBinaryenLike {
	readBinary(bytes: Uint8Array): BinaryenModuleLike;
	getOptimizeLevel(): number;
	setOptimizeLevel(level: number): number;
	getShrinkLevel(): number;
	setShrinkLevel(level: number): number;
	getDebugInfo(): boolean;
	setDebugInfo(enabled: boolean): void;
}

function assertNotAborted(signal?: AbortSignal) {
	if (signal?.aborted)
		throw signal.reason ?? new Error('upstream TinyGo compilation was aborted');
}

function assertWasm(bytes: Uint8Array, label: string) {
	if (
		bytes.byteLength < WASM_MAGIC.byteLength ||
		WASM_MAGIC.some((value, index) => bytes[index] !== value)
	) {
		throw new Error(`${label} does not have a WebAssembly header`);
	}
}

async function compileWasiModule(bytes: Uint8Array, label: string) {
	assertWasm(bytes, label);
	const compileBytes =
		bytes.buffer instanceof ArrayBuffer
			? (bytes as Uint8Array<ArrayBuffer>)
			: Uint8Array.from(bytes);
	const module = await WebAssembly.compile(compileBytes);
	const unsupported = WebAssembly.Module.imports(module).filter(
		(entry) => entry.module !== 'wasi_snapshot_preview1'
	);
	if (unsupported.length > 0) {
		throw new Error(
			`${label} imports unsupported modules: ${[...new Set(unsupported.map((entry) => entry.module))].join(', ')}`
		);
	}
	return module;
}

function collectOutput() {
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	let truncated = false;
	const fd = new ConsoleStdout((chunk) => {
		const originalLength = chunk.byteLength;
		if (bytes < MAX_DIAGNOSTIC_BYTES) {
			const remaining = MAX_DIAGNOSTIC_BYTES - bytes;
			const copy = Uint8Array.from(chunk.subarray(0, remaining));
			chunks.push(copy);
			bytes += copy.byteLength;
			if (copy.byteLength < originalLength) truncated = true;
		} else if (originalLength > 0) {
			truncated = true;
		}
	});
	return {
		fd,
		finish() {
			const output = new Uint8Array(bytes);
			let offset = 0;
			for (const chunk of chunks) {
				output.set(chunk, offset);
				offset += chunk.byteLength;
			}
			return { output, truncated };
		}
	};
}

async function runWasiModule(options: {
	module: WebAssembly.Module;
	args: string[];
	env?: string[];
	stdin?: Uint8Array;
	preopens?: Array<PreopenDirectory>;
	stdoutFile?: File;
}) {
	const stdout = collectOutput();
	const stderr = collectOutput();
	const wasi = new WASI(
		options.args,
		options.env ?? [],
		[
			new OpenFile(new File(options.stdin ?? [])),
			options.stdoutFile ? new OpenFile(options.stdoutFile) : stdout.fd,
			stderr.fd,
			...(options.preopens ?? [])
		],
		{ debug: false }
	);
	const instance = await WebAssembly.instantiate(options.module, {
		wasi_snapshot_preview1: wasi.wasiImport
	});
	let exitCode = 0;
	try {
		exitCode =
			wasi.start(
				instance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } }
			) ?? 0;
	} catch (error) {
		if (error instanceof WASIProcExit) exitCode = error.code;
		else throw error;
	}
	const stdoutResult = options.stdoutFile
		? { output: Uint8Array.from(options.stdoutFile.data), truncated: false }
		: stdout.finish();
	const stderrResult = stderr.finish();
	return {
		exitCode,
		stdout: stdoutResult.output,
		stderr: stderrResult.output,
		stdoutTruncated: stdoutResult.truncated,
		stderrTruncated: stderrResult.truncated
	};
}

function diagnosticText(bytes: Uint8Array, truncated: boolean) {
	const text = new TextDecoder().decode(bytes).trim();
	return truncated ? `${text}\n[diagnostic truncated]` : text;
}

async function verifyRuntimeClosureAssets(
	root: TinyGoWasiDirectoryContents,
	runtime: TinyGoRuntimeClosure
) {
	for (const asset of [
		runtime.compilerRT,
		runtime.wasiLibc,
		...(runtime.libCxx ? [runtime.libCxx] : []),
		...(runtime.libCxxAbi ? [runtime.libCxxAbi] : []),
		...Object.values(runtime.extraFiles)
	]) {
		const bytes = readTinyGoVfsFile(root, asset.path);
		if (bytes.byteLength !== asset.bytes || (await sha256TinyGoBytes(bytes)) !== asset.sha256) {
			throw new Error(
				`TinyGo runtime closure asset differs from its manifest: ${asset.path}`
			);
		}
	}
	const sources = Object.keys(runtime.extraFiles).sort();
	const expectedSources = [...EXPECTED_EXTRA_SOURCES].sort();
	if (
		sources.length !== expectedSources.length ||
		expectedSources.some((source, index) => sources[index] !== source)
	) {
		throw new Error(
			'TinyGo runtime closure extra-file sources differ from compile protocol v1'
		);
	}
}

export async function prepareTinyGoUpstreamToolchain(
	assets: TinyGoUpstreamToolchainAssets,
	options: { maxRootBytes?: number; maxRootFiles?: number; maxWasmMemoryBytes?: number } = {}
): Promise<PreparedTinyGoUpstreamToolchain> {
	const verified = await verifyTinyGoUpstreamAssetSet(assets);
	const root = await extractTinyGoRootArchive(assets.rootArchive, {
		...(options.maxRootBytes === undefined ? {} : { maxBytes: options.maxRootBytes }),
		...(options.maxRootFiles === undefined ? {} : { maxFiles: options.maxRootFiles })
	});
	for (const [path, type] of [
		['src', 'directory'],
		['targets', 'directory'],
		['runtime', 'directory'],
		['go.env', 'file'],
		['go.mod', 'file'],
		['go.sum', 'file'],
		['targets/wasip1.json', 'file'],
		[RUNTIME_MANIFEST_PATH, 'file']
	] as const) {
		if (!hasTinyGoVfsPath(root, path, type)) {
			throw new Error(`TinyGo root archive is missing required ${type} ${path}`);
		}
	}
	let runtimeValue: unknown;
	try {
		runtimeValue = JSON.parse(
			new TextDecoder().decode(readTinyGoVfsFile(root, RUNTIME_MANIFEST_PATH))
		);
	} catch (error) {
		throw new Error('TinyGo runtime closure manifest is not valid JSON', { cause: error });
	}
	const runtime = parseTinyGoRuntimeClosure(
		runtimeValue,
		verified.manifest.assets.compiler.sha256
	);
	await verifyRuntimeClosureAssets(root, runtime);
	const compilerBytes =
		options.maxWasmMemoryBytes === undefined
			? assets.compiler
			: capTinyGoWasmMemory(
					assets.compiler,
					options.maxWasmMemoryBytes,
					'upstream TinyGo compiler'
				);
	const packageGraphBytes =
		options.maxWasmMemoryBytes === undefined
			? assets.packageGraph
			: capTinyGoWasmMemory(
					assets.packageGraph,
					options.maxWasmMemoryBytes,
					'upstream Go package-graph provider'
				);
	const lldBytes =
		options.maxWasmMemoryBytes === undefined
			? assets.lld
			: capTinyGoWasmMemory(assets.lld, options.maxWasmMemoryBytes, 'raw WASI LLD');
	const [compiler, packageGraph, lld] = await Promise.all([
		compileWasiModule(compilerBytes, 'upstream TinyGo compiler'),
		compileWasiModule(packageGraphBytes, 'upstream Go package-graph provider'),
		compileWasiModule(lldBytes, 'raw WASI LLD')
	]);
	return {
		compiler,
		packageGraph,
		lld,
		compilerSha256: verified.manifest.assets.compiler.sha256,
		compileProtocolVersion: verified.compileProtocolVersion,
		root,
		runtime,
		producerReceipt: verified.receipt,
		packageGraphReceipt: verified.packageGraphReceipt
	};
}

function createWorkspace(files: Record<string, string | Uint8Array>) {
	const workspace: TinyGoWasiDirectoryContents = new Map();
	const encoder = new TextEncoder();
	for (const [path, value] of Object.entries(files)) {
		addTinyGoVfsFile(
			workspace,
			path,
			typeof value === 'string' ? encoder.encode(value) : value
		);
	}
	if (workspace.size === 0)
		throw new Error('upstream TinyGo workspace must contain source files');
	return workspace;
}

export function selectTinyGoOfflineModuleMode(
	workspace: TinyGoWasiDirectoryContents
): 'readonly' | 'vendor' {
	const hasVendorDirectory = hasTinyGoVfsPath(workspace, 'vendor', 'directory');
	const hasVendorManifest = hasTinyGoVfsPath(workspace, 'vendor/modules.txt', 'file');
	if (hasVendorDirectory && !hasVendorManifest) {
		throw new Error('TinyGo offline vendor directory requires vendor/modules.txt');
	}
	return hasVendorManifest ? 'vendor' : 'readonly';
}

function createWorkDirectory() {
	const work: TinyGoWasiDirectoryContents = new Map();
	for (const directory of ['output', 'tmp', 'cache', 'home', 'gopath', 'modcache']) {
		addTinyGoVfsDirectory(work, directory);
	}
	return work;
}

export function validateTinyGoLinkPlan(
	value: unknown,
	runtime: TinyGoRuntimeClosure
): TinyGoLinkPlan {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('TinyGo link plan must be an object');
	}
	const plan = value as Partial<TinyGoLinkPlanV1>;
	if (
		plan.schemaVersion !== 1 ||
		plan.linker !== 'wasm-ld' ||
		plan.object !== 'program.o' ||
		plan.output !== 'program.unoptimized.wasm'
	) {
		throw new Error('TinyGo link plan identity differs from compile protocol v1');
	}
	if (
		!Array.isArray(plan.compilerPackages) ||
		plan.compilerPackages.length !== TINYGO_UPSTREAM_COMPILER_PACKAGES.length ||
		TINYGO_UPSTREAM_COMPILER_PACKAGES.some(
			(name, index) => plan.compilerPackages?.[index] !== name
		)
	) {
		throw new Error(
			'TinyGo link plan does not identify the required upstream compiler packages'
		);
	}
	if (
		!Array.isArray(plan.arguments) ||
		plan.arguments.some((argument) => typeof argument !== 'string' || argument.length === 0)
	) {
		throw new Error('TinyGo link plan arguments must be non-empty strings');
	}
	if (plan.arguments[0] === 'wasm-ld') {
		throw new Error('TinyGo link plan must omit the wasm-ld executable name');
	}
	if (
		plan.arguments.some((argument) => /(?:^|[=,])--thinlto-cache-dir(?:$|[=,])/u.test(argument))
	) {
		throw new Error('TinyGo link plan contains forbidden --thinlto-cache-dir');
	}
	const allowedRuntimePaths = new Set(
		[
			runtime.compilerRT.path,
			runtime.wasiLibc.path,
			...Object.values(runtime.extraFiles).map((asset) => asset.path)
		].map((path) => `${TINYGO_ROOT_PATH}/${path}`)
	);
	const orderedRuntimePaths = [
		`${TINYGO_ROOT_PATH}/${runtime.compilerRT.path}`,
		...EXPECTED_EXTRA_SOURCES.map((source) => {
			const asset = runtime.extraFiles[source];
			if (!asset) throw new Error(`TinyGo runtime closure is missing ${source}`);
			return `${TINYGO_ROOT_PATH}/${asset.path}`;
		}),
		`${TINYGO_ROOT_PATH}/${runtime.wasiLibc.path}`
	];
	const expectedArguments = [
		'--stack-first',
		'--no-demangle',
		'-L',
		TINYGO_ROOT_PATH,
		'-o',
		'program.unoptimized.wasm',
		'--strip-debug',
		'--compress-relocations',
		'program.o',
		...orderedRuntimePaths,
		'-mllvm',
		'-mcpu=generic',
		'-mllvm',
		'-mattr=+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types',
		'--lto-O1'
	];
	for (const argument of plan.arguments) {
		if (
			argument.startsWith('/') &&
			argument !== TINYGO_ROOT_PATH &&
			!allowedRuntimePaths.has(argument)
		) {
			throw new Error(
				`TinyGo link plan references an unregistered absolute path: ${argument}`
			);
		}
	}
	if (
		plan.arguments.length !== expectedArguments.length ||
		expectedArguments.some((argument, index) => plan.arguments?.[index] !== argument)
	) {
		throw new Error('TinyGo link plan arguments differ from compile protocol v1');
	}
	if (plan.arguments.filter((argument) => argument === plan.object).length !== 1) {
		throw new Error('TinyGo link plan must reference its object exactly once');
	}
	if (plan.arguments.filter((argument) => argument === plan.output).length !== 1) {
		throw new Error('TinyGo link plan must reference its output exactly once');
	}
	for (const runtimePath of allowedRuntimePaths) {
		if (plan.arguments.filter((argument) => argument === runtimePath).length !== 1) {
			throw new Error(
				`TinyGo link plan must reference runtime input exactly once: ${runtimePath}`
			);
		}
	}
	if (
		!Array.isArray(plan.runtimeInputs) ||
		plan.runtimeInputs.length !== allowedRuntimePaths.size
	) {
		throw new Error('TinyGo link plan runtimeInputs do not match the runtime closure');
	}
	const expectedRuntimeInputs = new Map<string, { kind: string; source?: string }>([
		[`${TINYGO_ROOT_PATH}/${runtime.compilerRT.path}`, { kind: 'compiler-rt' }],
		...EXPECTED_EXTRA_SOURCES.map(
			(source) =>
				[
					`${TINYGO_ROOT_PATH}/${runtime.extraFiles[source]?.path}`,
					{ kind: 'extra-file', source }
				] as const
		),
		[`${TINYGO_ROOT_PATH}/${runtime.wasiLibc.path}`, { kind: 'wasi-libc' }]
	]);
	const runtimeInputPaths = new Set<string>();
	for (const input of plan.runtimeInputs) {
		if (!input || typeof input !== 'object' || typeof input.path !== 'string') {
			throw new Error('TinyGo link plan runtimeInputs are invalid');
		}
		const expected = expectedRuntimeInputs.get(input.path);
		if (
			!expected ||
			runtimeInputPaths.has(input.path) ||
			input.kind !== expected.kind ||
			input.source !== expected.source
		) {
			throw new Error(
				`TinyGo link plan contains an unregistered runtime input: ${input.path}`
			);
		}
		runtimeInputPaths.add(input.path);
	}
	const optimizer = plan.optimizer;
	const expectedOptimizerArguments = [
		'--asyncify',
		'-O1',
		'-g',
		'program.unoptimized.wasm',
		'--output',
		'program.wasm'
	];
	if (
		!optimizer ||
		optimizer.tool !== 'wasm-opt' ||
		optimizer.input !== 'program.unoptimized.wasm' ||
		optimizer.output !== 'program.wasm' ||
		!Array.isArray(optimizer.arguments) ||
		optimizer.arguments.length !== expectedOptimizerArguments.length ||
		expectedOptimizerArguments.some(
			(argument, index) => optimizer.arguments[index] !== argument
		)
	) {
		throw new Error('TinyGo optimizer plan differs from asyncify -O1 compile protocol v1');
	}
	return plan as TinyGoLinkPlanV1;
}

export function validateTinyGoLinkPlanV2(
	value: unknown,
	runtime: TinyGoRuntimeClosure,
	options: {
		compilerSha256: string;
		expectedEmbedObjects: readonly TinyGoExpectedEmbedObject[];
	}
): TinyGoLinkPlanV2 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('TinyGo link plan must be an object');
	}
	const plan = value as Partial<TinyGoLinkPlanV2>;
	if (
		plan.schemaVersion !== 2 ||
		plan.format !== 'wasm-llvm-tinygo-link-plan-v2' ||
		plan.compilerSha256 !== options.compilerSha256 ||
		JSON.stringify(plan.capabilities) !== JSON.stringify(['go-embed-objects']) ||
		plan.linker !== 'wasm-ld' ||
		plan.output !== 'program.unoptimized.wasm'
	) {
		throw new Error('TinyGo link plan identity differs from compile protocol v2');
	}
	if (
		!Array.isArray(plan.compilerPackages) ||
		plan.compilerPackages.length !== TINYGO_UPSTREAM_COMPILER_PACKAGES.length ||
		TINYGO_UPSTREAM_COMPILER_PACKAGES.some(
			(name, index) => plan.compilerPackages?.[index] !== name
		)
	) {
		throw new Error(
			'TinyGo link plan does not identify the required upstream compiler packages'
		);
	}
	if (
		!Array.isArray(plan.objects) ||
		plan.objects.length !== options.expectedEmbedObjects.length + 1 ||
		plan.objects.length > MAX_OBJECT_COUNT
	) {
		throw new Error('TinyGo link plan object set differs from the package graph');
	}
	let declaredObjectBytes = 0;
	const objectPaths = new Set<string>();
	for (const [index, object] of plan.objects.entries()) {
		const expectedKind = index === 0 ? 'program' : 'embed';
		const expectedPath = `objects/${String(index).padStart(4, '0')}-${expectedKind}.o`;
		if (
			!object ||
			typeof object !== 'object' ||
			object.kind !== expectedKind ||
			object.path !== expectedPath ||
			object.format !== 'wasm-object' ||
			!Number.isSafeInteger(object.bytes) ||
			object.bytes <= 0 ||
			object.bytes > MAX_OBJECT_BYTES ||
			!/^[0-9a-f]{64}$/u.test(object.sha256) ||
			objectPaths.has(object.path)
		) {
			throw new Error(`TinyGo link plan object ${index} is invalid`);
		}
		declaredObjectBytes += object.bytes;
		if (declaredObjectBytes > MAX_OBJECT_SET_BYTES) {
			throw new Error('TinyGo link plan object set exceeds the browser memory limit');
		}
		objectPaths.add(object.path);
		if (index === 0) {
			if (
				object.importPath !== undefined ||
				object.sourcePath !== undefined ||
				object.sourceSha256 !== undefined ||
				object.embeddedFileHash !== undefined
			) {
				throw new Error('TinyGo program object must not contain embed source evidence');
			}
			continue;
		}
		const expected = options.expectedEmbedObjects[index - 1];
		if (
			object.importPath !== expected?.importPath ||
			object.sourcePath !== expected.sourcePath ||
			object.sourceSha256 !== expected.sourceSha256 ||
			object.embeddedFileHash !== expected.embeddedFileHash
		) {
			throw new Error(`TinyGo embed object ${index} differs from the package graph`);
		}
	}
	if (
		!Array.isArray(plan.arguments) ||
		plan.arguments.some((argument) => typeof argument !== 'string' || argument.length === 0)
	) {
		throw new Error('TinyGo link plan arguments must be non-empty strings');
	}
	if (plan.arguments[0] === 'wasm-ld') {
		throw new Error('TinyGo link plan must omit the wasm-ld executable name');
	}
	if (
		plan.arguments.some((argument) => /(?:^|[=,])--thinlto-cache-dir(?:$|[=,])/u.test(argument))
	) {
		throw new Error('TinyGo link plan contains forbidden --thinlto-cache-dir');
	}
	const allowedRuntimePaths = new Set(
		[
			runtime.compilerRT.path,
			runtime.wasiLibc.path,
			...Object.values(runtime.extraFiles).map((asset) => asset.path)
		].map((path) => `${TINYGO_ROOT_PATH}/${path}`)
	);
	const orderedRuntimePaths = [
		`${TINYGO_ROOT_PATH}/${runtime.compilerRT.path}`,
		...EXPECTED_EXTRA_SOURCES.map((source) => {
			const asset = runtime.extraFiles[source];
			if (!asset) throw new Error(`TinyGo runtime closure is missing ${source}`);
			return `${TINYGO_ROOT_PATH}/${asset.path}`;
		}),
		`${TINYGO_ROOT_PATH}/${runtime.wasiLibc.path}`
	];
	const expectedArguments = [
		'--stack-first',
		'--no-demangle',
		'-L',
		TINYGO_ROOT_PATH,
		'-o',
		'program.unoptimized.wasm',
		'--strip-debug',
		'--compress-relocations',
		...plan.objects.map((object) => object.path),
		...orderedRuntimePaths,
		'-mllvm',
		'-mcpu=generic',
		'-mllvm',
		'-mattr=+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types',
		'--lto-O1'
	];
	for (const argument of plan.arguments) {
		if (
			argument.startsWith('/') &&
			argument !== TINYGO_ROOT_PATH &&
			!allowedRuntimePaths.has(argument)
		) {
			throw new Error(
				`TinyGo link plan references an unregistered absolute path: ${argument}`
			);
		}
	}
	if (
		plan.arguments.length !== expectedArguments.length ||
		expectedArguments.some((argument, index) => plan.arguments?.[index] !== argument)
	) {
		throw new Error('TinyGo link plan arguments differ from compile protocol v2');
	}
	if (
		!Array.isArray(plan.runtimeInputs) ||
		plan.runtimeInputs.length !== allowedRuntimePaths.size
	) {
		throw new Error('TinyGo link plan runtimeInputs do not match the runtime closure');
	}
	const expectedRuntimeInputs = new Map<string, { kind: string; source?: string }>([
		[`${TINYGO_ROOT_PATH}/${runtime.compilerRT.path}`, { kind: 'compiler-rt' }],
		...EXPECTED_EXTRA_SOURCES.map(
			(source) =>
				[
					`${TINYGO_ROOT_PATH}/${runtime.extraFiles[source]?.path}`,
					{ kind: 'extra-file', source }
				] as const
		),
		[`${TINYGO_ROOT_PATH}/${runtime.wasiLibc.path}`, { kind: 'wasi-libc' }]
	]);
	const runtimeInputPaths = new Set<string>();
	for (const input of plan.runtimeInputs) {
		if (!input || typeof input !== 'object' || typeof input.path !== 'string') {
			throw new Error('TinyGo link plan runtimeInputs are invalid');
		}
		const expected = expectedRuntimeInputs.get(input.path);
		if (
			!expected ||
			runtimeInputPaths.has(input.path) ||
			input.kind !== expected.kind ||
			input.source !== expected.source
		) {
			throw new Error(
				`TinyGo link plan contains an unregistered runtime input: ${input.path}`
			);
		}
		runtimeInputPaths.add(input.path);
	}
	const optimizer = plan.optimizer;
	const expectedOptimizerArguments = [
		'--asyncify',
		'-O1',
		'-g',
		'program.unoptimized.wasm',
		'--output',
		'program.wasm'
	];
	if (
		!optimizer ||
		optimizer.tool !== 'wasm-opt' ||
		optimizer.input !== 'program.unoptimized.wasm' ||
		optimizer.output !== 'program.wasm' ||
		!Array.isArray(optimizer.arguments) ||
		optimizer.arguments.length !== expectedOptimizerArguments.length ||
		expectedOptimizerArguments.some(
			(argument, index) => optimizer.arguments[index] !== argument
		)
	) {
		throw new Error('TinyGo optimizer plan differs from asyncify -O1 compile protocol v2');
	}
	return plan as TinyGoLinkPlanV2;
}

export async function validateTinyGoLinkPlanV3(
	value: unknown,
	runtime: TinyGoRuntimeClosure,
	options: {
		compilerSha256: string;
		expectedEmbedObjects: readonly TinyGoExpectedEmbedObject[];
		expectedCGoInputs: readonly TinyGoExpectedNativeSource[];
		expectedCObjects: readonly TinyGoExpectedNativeSource[];
		root: TinyGoWasiDirectoryContents;
		workspace: TinyGoWasiDirectoryContents;
	}
): Promise<TinyGoLinkPlanV3> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('TinyGo link plan must be an object');
	}
	const plan = value as Partial<TinyGoLinkPlanV3>;
	if (
		plan.schemaVersion !== 3 ||
		plan.format !== 'wasm-llvm-tinygo-link-plan-v3' ||
		plan.compilerSha256 !== options.compilerSha256 ||
		JSON.stringify(plan.capabilities) !==
			JSON.stringify(['go-embed-objects', 'target-cgo-c']) ||
		plan.linker !== 'wasm-ld' ||
		plan.output !== 'program.unoptimized.wasm'
	) {
		throw new Error('TinyGo link plan identity differs from compile protocol v3');
	}
	if (
		!Array.isArray(plan.compilerPackages) ||
		plan.compilerPackages.length !== TINYGO_UPSTREAM_COMPILER_PACKAGES.length ||
		TINYGO_UPSTREAM_COMPILER_PACKAGES.some(
			(name, index) => plan.compilerPackages?.[index] !== name
		)
	) {
		throw new Error(
			'TinyGo link plan does not identify the required upstream compiler packages'
		);
	}
	if (
		!Array.isArray(plan.cgoInputs) ||
		plan.cgoInputs.length !== options.expectedCGoInputs.length ||
		plan.cgoInputs.length > MAX_NATIVE_INPUT_COUNT
	) {
		throw new Error('TinyGo link plan CGo inputs differ from the package graph');
	}
	for (const [index, input] of plan.cgoInputs.entries()) {
		const expected = options.expectedCGoInputs[index];
		if (
			!input ||
			input.importPath !== expected?.importPath ||
			input.sourcePath !== expected.sourcePath ||
			input.bytes !== expected.bytes ||
			input.sha256 !== expected.sha256 ||
			!Array.isArray(input.dependencies) ||
			input.dependencies.length > MAX_NATIVE_DEPENDENCY_COUNT
		) {
			throw new Error(`TinyGo CGo input ${index} differs from the package graph`);
		}
		let previousDependency = '';
		let dependencyBytes = 0;
		for (const [dependencyIndex, dependency] of input.dependencies.entries()) {
			const identity = `${dependency?.scope ?? ''}\0${dependency?.path ?? ''}`;
			if (
				!dependency ||
				(dependency.scope !== 'root' && dependency.scope !== 'workspace') ||
				typeof dependency.path !== 'string' ||
				dependency.path.length === 0 ||
				dependency.path.startsWith('/') ||
				dependency.path.includes('\\') ||
				dependency.path
					.split('/')
					.some((part) => part === '' || part === '.' || part === '..') ||
				!Number.isSafeInteger(dependency.bytes) ||
				dependency.bytes < 0 ||
				dependency.bytes > MAX_NATIVE_SOURCE_BYTES ||
				!/^[0-9a-f]{64}$/u.test(dependency.sha256) ||
				(dependencyIndex > 0 && identity <= previousDependency)
			) {
				throw new Error(
					`TinyGo CGo input ${index} dependency ${dependencyIndex} is invalid`
				);
			}
			dependencyBytes += dependency.bytes;
			if (dependencyBytes > MAX_NATIVE_DEPENDENCY_SET_BYTES) {
				throw new Error(`TinyGo CGo input ${index} dependencies exceed the browser limit`);
			}
			const dependencyRoot = dependency.scope === 'root' ? options.root : options.workspace;
			const actual = readTinyGoVfsFile(dependencyRoot, dependency.path);
			if (
				actual.byteLength !== dependency.bytes ||
				(await sha256TinyGoBytes(actual)) !== dependency.sha256
			) {
				throw new Error(
					`TinyGo CGo input ${index} dependency differs from ${dependency.scope}:${dependency.path}`
				);
			}
			previousDependency = identity;
		}
	}
	if (
		!Array.isArray(plan.objects) ||
		plan.objects.length !==
			1 + options.expectedCObjects.length + options.expectedEmbedObjects.length ||
		plan.objects.length > MAX_OBJECT_COUNT
	) {
		throw new Error('TinyGo link plan object set differs from the package graph');
	}
	let declaredObjectBytes = 0;
	for (const [index, object] of plan.objects.entries()) {
		const kind =
			index === 0
				? 'program'
				: index <= options.expectedCObjects.length
					? 'target-c'
					: 'embed';
		const suffix = kind === 'target-c' ? 'target-c.bc' : `${kind}.o`;
		const expectedPath = `objects/${String(index).padStart(4, '0')}-${suffix}`;
		const expectedFormat = kind === 'target-c' ? 'llvm-bitcode' : 'wasm-object';
		if (
			!object ||
			object.kind !== kind ||
			object.path !== expectedPath ||
			object.format !== expectedFormat ||
			!Number.isSafeInteger(object.bytes) ||
			object.bytes <= 0 ||
			object.bytes > MAX_OBJECT_BYTES ||
			!/^[0-9a-f]{64}$/u.test(object.sha256)
		) {
			throw new Error(`TinyGo link plan object ${index} is invalid`);
		}
		declaredObjectBytes += object.bytes;
		if (declaredObjectBytes > MAX_OBJECT_SET_BYTES) {
			throw new Error('TinyGo link plan object set exceeds the browser memory limit');
		}
		if (kind === 'program') {
			if (
				object.importPath !== undefined ||
				object.sourceField !== undefined ||
				object.sourcePath !== undefined ||
				object.sourceSha256 !== undefined ||
				object.embeddedFileHash !== undefined ||
				object.dependencies !== undefined
			) {
				throw new Error('TinyGo program object must not contain native source evidence');
			}
			continue;
		}
		if (kind === 'embed') {
			const expected =
				options.expectedEmbedObjects[index - options.expectedCObjects.length - 1];
			if (
				object.importPath !== expected?.importPath ||
				object.sourceField !== undefined ||
				object.sourcePath !== expected.sourcePath ||
				object.sourceSha256 !== expected.sourceSha256 ||
				object.embeddedFileHash !== expected.embeddedFileHash ||
				object.dependencies !== undefined
			) {
				throw new Error(`TinyGo embed object ${index} differs from the package graph`);
			}
			continue;
		}
		const expected = options.expectedCObjects[index - 1];
		if (
			object.importPath !== expected?.importPath ||
			object.sourceField !== 'CFiles' ||
			object.sourcePath !== expected.sourcePath ||
			object.sourceSha256 !== expected.sha256 ||
			object.embeddedFileHash !== undefined ||
			(object.dependencies !== undefined && !Array.isArray(object.dependencies)) ||
			(object.dependencies?.length ?? 0) > MAX_NATIVE_DEPENDENCY_COUNT
		) {
			throw new Error(`TinyGo target C object ${index} differs from the package graph`);
		}
		let previousDependency = '';
		let dependencyBytes = 0;
		for (const [dependencyIndex, dependency] of (object.dependencies ?? []).entries()) {
			const identity = `${dependency?.scope ?? ''}\0${dependency?.path ?? ''}`;
			if (
				!dependency ||
				(dependency.scope !== 'root' && dependency.scope !== 'workspace') ||
				typeof dependency.path !== 'string' ||
				dependency.path.length === 0 ||
				dependency.path.startsWith('/') ||
				dependency.path.includes('\\') ||
				dependency.path
					.split('/')
					.some((part) => part === '' || part === '.' || part === '..') ||
				!Number.isSafeInteger(dependency.bytes) ||
				dependency.bytes < 0 ||
				dependency.bytes > MAX_NATIVE_SOURCE_BYTES ||
				!/^[0-9a-f]{64}$/u.test(dependency.sha256) ||
				(dependencyIndex > 0 && identity <= previousDependency)
			) {
				throw new Error(
					`TinyGo target C object ${index} dependency ${dependencyIndex} is invalid`
				);
			}
			dependencyBytes += dependency.bytes;
			if (dependencyBytes > MAX_NATIVE_DEPENDENCY_SET_BYTES) {
				throw new Error(
					`TinyGo target C object ${index} dependencies exceed the browser limit`
				);
			}
			const dependencyRoot = dependency.scope === 'root' ? options.root : options.workspace;
			const actual = readTinyGoVfsFile(dependencyRoot, dependency.path);
			if (
				actual.byteLength !== dependency.bytes ||
				(await sha256TinyGoBytes(actual)) !== dependency.sha256
			) {
				throw new Error(
					`TinyGo target C object ${index} dependency differs from ${dependency.scope}:${dependency.path}`
				);
			}
			previousDependency = identity;
		}
	}
	const runtimeInputs = [
		{ kind: 'compiler-rt', path: `${TINYGO_ROOT_PATH}/${runtime.compilerRT.path}` },
		...EXPECTED_EXTRA_SOURCES.map((source) => ({
			kind: 'extra-file',
			source,
			path: `${TINYGO_ROOT_PATH}/${runtime.extraFiles[source]?.path}`
		})),
		{ kind: 'wasi-libc', path: `${TINYGO_ROOT_PATH}/${runtime.wasiLibc.path}` }
	];
	if (JSON.stringify(plan.runtimeInputs) !== JSON.stringify(runtimeInputs)) {
		throw new Error('TinyGo link plan runtimeInputs do not match the runtime closure');
	}
	const targetCPaths = plan.objects
		.filter((object) => object.kind === 'target-c')
		.map((object) => object.path);
	const embedPaths = plan.objects
		.filter((object) => object.kind === 'embed')
		.map((object) => object.path);
	const expectedArguments = [
		'--stack-first',
		'--no-demangle',
		'-L',
		TINYGO_ROOT_PATH,
		'-o',
		'program.unoptimized.wasm',
		'--strip-debug',
		'--compress-relocations',
		'objects/0000-program.o',
		...runtimeInputs.slice(0, -1).map((input) => input.path),
		...targetCPaths,
		runtimeInputs.at(-1)!.path,
		...embedPaths,
		'-mllvm',
		'-mcpu=generic',
		'-mllvm',
		'-mattr=+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types',
		'--lto-O1'
	];
	if (
		!Array.isArray(plan.arguments) ||
		plan.arguments.length !== expectedArguments.length ||
		expectedArguments.some((argument, index) => plan.arguments?.[index] !== argument)
	) {
		throw new Error('TinyGo link plan arguments differ from compile protocol v3');
	}
	if (
		plan.arguments.some((argument) => /(?:^|[=,])--thinlto-cache-dir(?:$|[=,])/u.test(argument))
	) {
		throw new Error('TinyGo link plan contains forbidden --thinlto-cache-dir');
	}
	const expectedOptimizer = {
		tool: 'wasm-opt',
		input: 'program.unoptimized.wasm',
		output: 'program.wasm',
		arguments: [
			'--asyncify',
			'-O1',
			'-g',
			'program.unoptimized.wasm',
			'--output',
			'program.wasm'
		]
	};
	if (JSON.stringify(plan.optimizer) !== JSON.stringify(expectedOptimizer)) {
		throw new Error('TinyGo optimizer plan differs from asyncify -O1 compile protocol v3');
	}
	return plan as TinyGoLinkPlanV3;
}

async function validateTinyGoLinkPlanDependencies(
	value: unknown,
	options: {
		label: string;
		root: TinyGoWasiDirectoryContents;
		workspace: TinyGoWasiDirectoryContents;
	}
) {
	if (!Array.isArray(value) || value.length > MAX_NATIVE_DEPENDENCY_COUNT) {
		throw new Error(`${options.label} dependencies are invalid`);
	}
	let previousDependency = '';
	let dependencyBytes = 0;
	for (const [dependencyIndex, dependencyValue] of value.entries()) {
		const dependency = dependencyValue as Partial<TinyGoLinkPlanDependency> | null;
		const identity = `${dependency?.scope ?? ''}\0${dependency?.path ?? ''}`;
		const declaredBytes = dependency?.bytes;
		const declaredSha256 = dependency?.sha256;
		if (
			!dependency ||
			(dependency.scope !== 'root' && dependency.scope !== 'workspace') ||
			typeof dependency.path !== 'string' ||
			dependency.path.length === 0 ||
			dependency.path.startsWith('/') ||
			dependency.path.includes('\\') ||
			dependency.path
				.split('/')
				.some((part) => part === '' || part === '.' || part === '..') ||
			typeof declaredBytes !== 'number' ||
			!Number.isSafeInteger(declaredBytes) ||
			declaredBytes < 0 ||
			declaredBytes > MAX_NATIVE_SOURCE_BYTES ||
			typeof declaredSha256 !== 'string' ||
			!/^[0-9a-f]{64}$/u.test(declaredSha256) ||
			(dependencyIndex > 0 && identity <= previousDependency)
		) {
			throw new Error(`${options.label} dependency ${dependencyIndex} is invalid`);
		}
		dependencyBytes += declaredBytes;
		if (dependencyBytes > MAX_NATIVE_DEPENDENCY_SET_BYTES) {
			throw new Error(`${options.label} dependencies exceed the browser limit`);
		}
		const dependencyRoot = dependency.scope === 'root' ? options.root : options.workspace;
		const actual = readTinyGoVfsFile(dependencyRoot, dependency.path);
		if (
			actual.byteLength !== declaredBytes ||
			(await sha256TinyGoBytes(actual)) !== declaredSha256
		) {
			throw new Error(
				`${options.label} dependency differs from ${dependency.scope}:${dependency.path}`
			);
		}
		previousDependency = identity;
	}
}

function validateTinyGoCXXFlags(flags: unknown, expected: readonly string[], label: string) {
	if (
		!Array.isArray(flags) ||
		flags.length !== expected.length ||
		expected.some((flag, index) => flags[index] !== flag)
	) {
		throw new Error(`${label} CXXFLAGS differ from the package graph`);
	}
	for (const flag of flags) {
		if (typeof flag !== 'string' || flag.length === 0 || flag.length > 4096 || flag.includes('\0')) {
			throw new Error(`${label} contains invalid CXXFLAGS`);
		}
		for (const forbidden of [
			'@',
			'-o',
			'-x',
			'-target',
			'--target',
			'-stdlib',
			'-std=',
			'-flto',
			'-fno-lto',
			'-fexceptions',
			'-frtti',
			'-pthread',
			'-Xclang',
			'-mllvm'
		]) {
			if (flag === forbidden || flag.startsWith(`${forbidden}=`)) {
				throw new Error(`${label} CXXFLAGS override the browser C++ policy`);
			}
		}
	}
}

function tinyGoLinkerLibraryName(name: string) {
	return name !== '' && name !== '.' && name !== '..' && /^[A-Za-z0-9_.-]+$/u.test(name);
}

function validateTinyGoLinkerPath(
	path: string,
	directory: boolean,
	root: TinyGoWasiDirectoryContents,
	workspace: TinyGoWasiDirectoryContents
) {
	let vfsRoot: TinyGoWasiDirectoryContents;
	let relativePath: string;
	if (path === TINYGO_ROOT_PATH || path.startsWith(`${TINYGO_ROOT_PATH}/`)) {
		vfsRoot = root;
		relativePath = path === TINYGO_ROOT_PATH ? '' : path.slice(TINYGO_ROOT_PATH.length + 1);
	} else if (path === TINYGO_WORKSPACE_PATH || path.startsWith(`${TINYGO_WORKSPACE_PATH}/`)) {
		vfsRoot = workspace;
		relativePath =
			path === TINYGO_WORKSPACE_PATH ? '' : path.slice(TINYGO_WORKSPACE_PATH.length + 1);
	} else {
		throw new Error(`TinyGo CGo linker path escapes the mounted roots: ${path}`);
	}
	if (relativePath === '') {
		if (directory) return;
		throw new Error(`TinyGo CGo linker path is missing or has the wrong type: ${path}`);
	}
	if (!hasTinyGoVfsPath(vfsRoot, relativePath, directory ? 'directory' : 'file')) {
		throw new Error(`TinyGo CGo linker path is missing or has the wrong type: ${path}`);
	}
}

function validateTinyGoCGoLinkerFlags(
	value: unknown,
	expected: readonly string[],
	root: TinyGoWasiDirectoryContents,
	workspace: TinyGoWasiDirectoryContents
) {
	if (!Array.isArray(value) || value.length > 256 || value.some((flag) => typeof flag !== 'string')) {
		throw new Error('TinyGo CGo linker flags must be a bounded string array');
	}
	const flags = value as string[];
	if (
		[...flags].sort().join('\0') !== [...expected].sort().join('\0')
	) {
		throw new Error('TinyGo CGo linker flags differ from the package graph');
	}
	for (let index = 0; index < flags.length; index += 1) {
		const flag = flags[index]!;
		if (flag.length === 0 || flag.length > 4096 || flag.includes('\0')) {
			throw new Error('TinyGo CGo linker flags contain an invalid argument');
		}
		if (flag === '-L') {
			const path = flags[++index];
			if (!path) throw new Error('TinyGo CGo linker flag -L requires a directory');
			validateTinyGoLinkerPath(path, true, root, workspace);
			continue;
		}
		if (flag.startsWith('-L') && flag.length > 2) {
			validateTinyGoLinkerPath(flag.slice(2), true, root, workspace);
			continue;
		}
		if (flag.startsWith('-l') && tinyGoLinkerLibraryName(flag.slice(2))) continue;
		if (
			['--start-group', '--end-group', '--whole-archive', '--no-whole-archive', '-Bstatic', '-Bdynamic', '-static'].includes(flag)
		) {
			continue;
		}
		if (
			(flag.endsWith('.a') || flag.endsWith('.o')) &&
			(flag.startsWith(`${TINYGO_ROOT_PATH}/`) || flag.startsWith(`${TINYGO_WORKSPACE_PATH}/`))
		) {
			validateTinyGoLinkerPath(flag, false, root, workspace);
			continue;
		}
		throw new Error(`TinyGo CGo linker flag ${JSON.stringify(flag)} is outside the browser library-link policy`);
	}
	return flags;
}

async function validateTinyGoLinkPlanV4ToV6(
	value: unknown,
	runtime: TinyGoRuntimeClosure,
	protocolVersion: 4 | 5 | 6,
	options: {
		compilerSha256: string;
		expectedEmbedObjects: readonly TinyGoExpectedEmbedObject[];
		expectedCGoInputs: readonly TinyGoExpectedNativeSource[];
		expectedNativeObjects: readonly TinyGoExpectedNativeSourceV4[];
		root: TinyGoWasiDirectoryContents;
		workspace: TinyGoWasiDirectoryContents;
		expectedCXXFlags?: ReadonlyMap<string, readonly string[]>;
		expectedCGoLinkerFlags?: readonly string[];
	}
): Promise<TinyGoLinkPlanV4 | TinyGoLinkPlanV5 | TinyGoLinkPlanV6> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('TinyGo link plan must be an object');
	}
	const plan = value as Partial<TinyGoLinkPlanV4 | TinyGoLinkPlanV5 | TinyGoLinkPlanV6>;
	const expectedCapabilities =
		protocolVersion === 4
			? [
					'go-embed-objects',
					'target-cgo-c',
					'target-cxx-freestanding',
					'target-clang-assembly'
				]
			: protocolVersion === 5
				? [
					'go-embed-objects',
					'target-cgo-c',
					'target-cxx-hosted-noeh',
					'target-clang-assembly'
					]
				: [
						'go-embed-objects',
						'target-cgo-c',
						'target-cxx-hosted-noeh',
						'target-clang-assembly',
						'target-cgo-cxxflags',
						'target-cgo-linker-flags'
					];
	if (
		plan.schemaVersion !== protocolVersion ||
		plan.format !== `wasm-llvm-tinygo-link-plan-v${protocolVersion}` ||
		plan.compilerSha256 !== options.compilerSha256 ||
		JSON.stringify(plan.capabilities) !== JSON.stringify(expectedCapabilities) ||
		plan.linker !== 'wasm-ld' ||
		plan.output !== 'program.unoptimized.wasm'
	) {
		throw new Error(`TinyGo link plan identity differs from compile protocol v${protocolVersion}`);
	}
	if (
		!Array.isArray(plan.compilerPackages) ||
		plan.compilerPackages.length !== TINYGO_UPSTREAM_COMPILER_PACKAGES.length ||
		TINYGO_UPSTREAM_COMPILER_PACKAGES.some(
			(name, index) => plan.compilerPackages?.[index] !== name
		)
	) {
		throw new Error(
			'TinyGo link plan does not identify the required upstream compiler packages'
		);
	}
	if (
		!Array.isArray(plan.cgoInputs) ||
		plan.cgoInputs.length !== options.expectedCGoInputs.length ||
		plan.cgoInputs.length > MAX_NATIVE_INPUT_COUNT
	) {
		throw new Error('TinyGo link plan CGo inputs differ from the package graph');
	}
	for (const [index, input] of plan.cgoInputs.entries()) {
		const expected = options.expectedCGoInputs[index];
		if (
			!input ||
			input.importPath !== expected?.importPath ||
			input.sourcePath !== expected.sourcePath ||
			input.bytes !== expected.bytes ||
			input.sha256 !== expected.sha256
		) {
			throw new Error(`TinyGo CGo input ${index} differs from the package graph`);
		}
		await validateTinyGoLinkPlanDependencies(input.dependencies, {
			label: `TinyGo CGo input ${index}`,
			root: options.root,
			workspace: options.workspace
		});
	}
	if (
		!Array.isArray(plan.objects) ||
		plan.objects.length !==
			1 + options.expectedNativeObjects.length + options.expectedEmbedObjects.length ||
		plan.objects.length > MAX_OBJECT_COUNT
	) {
		throw new Error('TinyGo link plan object set differs from the package graph');
	}
	let declaredObjectBytes = 0;
	for (const [index, object] of plan.objects.entries()) {
		const nativeIndex = index - 1;
		const expectedNative =
			nativeIndex >= 0 && nativeIndex < options.expectedNativeObjects.length
				? options.expectedNativeObjects[nativeIndex]
				: undefined;
		const expectedKind =
			index === 0
				? 'program'
				: expectedNative?.sourceField === 'CFiles'
					? 'target-c'
					: expectedNative?.sourceField === 'CXXFiles'
						? 'target-cxx'
						: expectedNative?.sourceField === 'SFiles'
							? 'target-assembly'
							: 'embed';
		const suffix =
			expectedKind === 'target-c'
				? 'target-c.bc'
				: expectedKind === 'target-cxx'
					? 'target-cxx.bc'
					: expectedKind === 'target-assembly'
						? 'target-assembly.o'
						: `${expectedKind}.o`;
		const expectedPath = `objects/${String(index).padStart(4, '0')}-${suffix}`;
		const expectedFormat =
			expectedKind === 'target-c' || expectedKind === 'target-cxx'
				? 'llvm-bitcode'
				: 'wasm-object';
		if (
			!object ||
			object.kind !== expectedKind ||
			object.path !== expectedPath ||
			object.format !== expectedFormat ||
			!Number.isSafeInteger(object.bytes) ||
			object.bytes <= 0 ||
			object.bytes > MAX_OBJECT_BYTES ||
			!/^[0-9a-f]{64}$/u.test(object.sha256)
		) {
			throw new Error(`TinyGo link plan object ${index} is invalid`);
		}
		declaredObjectBytes += object.bytes;
		if (declaredObjectBytes > MAX_OBJECT_SET_BYTES) {
			throw new Error('TinyGo link plan object set exceeds the browser memory limit');
		}
		if (expectedKind === 'program') {
			if (
				object.importPath !== undefined ||
				object.sourceField !== undefined ||
				object.sourcePath !== undefined ||
				object.sourceSha256 !== undefined ||
				object.embeddedFileHash !== undefined ||
				object.dependencies !== undefined ||
				object.compilerFlags !== undefined ||
				object.llvmValidation !== undefined ||
				object.wasmValidation !== undefined
			) {
				throw new Error('TinyGo program object must not contain native source evidence');
			}
			continue;
		}
		if (expectedKind === 'embed') {
			const expectedEmbed =
				options.expectedEmbedObjects[index - options.expectedNativeObjects.length - 1];
			if (
				object.importPath !== expectedEmbed?.importPath ||
				object.sourceField !== undefined ||
				object.sourcePath !== expectedEmbed.sourcePath ||
				object.sourceSha256 !== expectedEmbed.sourceSha256 ||
				object.embeddedFileHash !== expectedEmbed.embeddedFileHash ||
				object.dependencies !== undefined ||
				object.compilerFlags !== undefined ||
				object.llvmValidation !== undefined ||
				object.wasmValidation !== undefined
			) {
				throw new Error(`TinyGo embed object ${index} differs from the package graph`);
			}
			continue;
		}
		if (!expectedNative) {
			throw new Error(`TinyGo native object ${index} has no package-graph source`);
		}
		if (
			object.importPath !== expectedNative?.importPath ||
			object.sourceField !== expectedNative.sourceField ||
			object.sourcePath !== expectedNative.sourcePath ||
			object.sourceSha256 !== expectedNative.sha256 ||
			object.embeddedFileHash !== undefined ||
			(expectedNative.sourceField === 'SFiles' && !object.sourcePath?.endsWith('.S'))
		) {
			throw new Error(`TinyGo native object ${index} differs from the package graph`);
		}
		if (expectedKind === 'target-c' || expectedKind === 'target-cxx') {
			const evidence = object.llvmValidation;
			if (
				!evidence ||
				Object.keys(evidence).sort().join('\0') !==
					Object.keys(TINYGO_LLVM_VALIDATION).sort().join('\0') ||
				evidence.toolchain !== TINYGO_LLVM_VALIDATION.toolchain ||
				evidence.moduleVerified !== TINYGO_LLVM_VALIDATION.moduleVerified ||
				evidence.targetTriple !== TINYGO_LLVM_VALIDATION.targetTriple ||
				evidence.dataLayout !== TINYGO_LLVM_VALIDATION.dataLayout ||
				evidence.threadLocalGlobals !== TINYGO_LLVM_VALIDATION.threadLocalGlobals ||
				evidence.globalConstructors !== TINYGO_LLVM_VALIDATION.globalConstructors ||
				evidence.globalDestructors !== TINYGO_LLVM_VALIDATION.globalDestructors ||
				!Array.isArray(evidence.forbiddenAbiSymbols) ||
				evidence.forbiddenAbiSymbols.length !== 0 ||
				object.wasmValidation !== undefined
			) {
				throw new Error(`TinyGo native object ${index} lacks exact LLVM validation evidence`);
			}
		} else {
			const evidence = object.wasmValidation;
			if (
				!evidence ||
				Object.keys(evidence).sort().join('\0') !==
					Object.keys(TINYGO_WASM_OBJECT_VALIDATION).sort().join('\0') ||
				evidence.profile !== TINYGO_WASM_OBJECT_VALIDATION.profile ||
				evidence.linkingVersion !== TINYGO_WASM_OBJECT_VALIDATION.linkingVersion ||
				evidence.symbolTable !== TINYGO_WASM_OBJECT_VALIDATION.symbolTable ||
				object.llvmValidation !== undefined
			) {
				throw new Error(`TinyGo native object ${index} lacks exact Wasm validation evidence`);
			}
		}
		if (protocolVersion === 6 && expectedKind === 'target-cxx') {
			validateTinyGoCXXFlags(
				object.compilerFlags,
				options.expectedCXXFlags?.get(`${expectedNative.importPath}\0${expectedNative.sourcePath}`) ?? [],
				`TinyGo native object ${index}`
			);
		} else if (object.compilerFlags !== undefined) {
			throw new Error(`TinyGo native object ${index} has unexpected compiler flags`);
		}
		await validateTinyGoLinkPlanDependencies(object.dependencies, {
			label: `TinyGo native object ${index}`,
			root: options.root,
			workspace: options.workspace
		});
	}
	const baseRuntimeInputs = [
		{ kind: 'compiler-rt', path: `${TINYGO_ROOT_PATH}/${runtime.compilerRT.path}` },
		...EXPECTED_EXTRA_SOURCES.map((source) => ({
			kind: 'extra-file',
			source,
			path: `${TINYGO_ROOT_PATH}/${runtime.extraFiles[source]?.path}`
		}))
	];
	if (protocolVersion >= 5 && (!runtime.libCxx || !runtime.libCxxAbi)) {
		throw new Error('TinyGo runtime closure lacks hosted C++ libraries');
	}
	const hasHostedCxx = plan.objects.some((object) => object.kind === 'target-cxx');
	const hostedCxxInputs =
		protocolVersion >= 5 && hasHostedCxx
			? [
					{ kind: 'libcxx', path: `${TINYGO_ROOT_PATH}/${runtime.libCxx!.path}` },
					{ kind: 'libcxxabi', path: `${TINYGO_ROOT_PATH}/${runtime.libCxxAbi!.path}` }
				]
			: [];
	const wasiLibcInput = {
		kind: 'wasi-libc',
		path: `${TINYGO_ROOT_PATH}/${runtime.wasiLibc.path}`
	};
	const runtimeInputs = [...baseRuntimeInputs, ...hostedCxxInputs, wasiLibcInput];
	if (JSON.stringify(plan.runtimeInputs) !== JSON.stringify(runtimeInputs)) {
		throw new Error('TinyGo link plan runtimeInputs do not match the runtime closure');
	}
	const nativePaths = plan.objects
		.filter(
			(object) =>
				object.kind === 'target-c' ||
				object.kind === 'target-cxx' ||
				object.kind === 'target-assembly'
		)
		.map((object) => object.path);
	const embedPaths = plan.objects
		.filter((object) => object.kind === 'embed')
		.map((object) => object.path);
	const cgoLinkerFlags =
		protocolVersion === 6
			? validateTinyGoCGoLinkerFlags(
					(plan as Partial<TinyGoLinkPlanV6>).cgoLinkerFlags,
					options.expectedCGoLinkerFlags ?? [],
					options.root,
					options.workspace
				)
			: [];
	if (protocolVersion !== 6 && 'cgoLinkerFlags' in plan) {
		throw new Error(`TinyGo link plan has unexpected CGo linker flags in protocol v${protocolVersion}`);
	}
	const expectedArguments = [
		'--stack-first',
		'--no-demangle',
		'-L',
		TINYGO_ROOT_PATH,
		...cgoLinkerFlags,
		'-o',
		'program.unoptimized.wasm',
		'--strip-debug',
		'--compress-relocations',
		'objects/0000-program.o',
		...baseRuntimeInputs.map((input) => input.path),
		...nativePaths,
		...hostedCxxInputs.map((input) => input.path),
		wasiLibcInput.path,
		...embedPaths,
		'-mllvm',
		'-mcpu=generic',
		'-mllvm',
		'-mattr=+bulk-memory,+bulk-memory-opt,+call-indirect-overlong,+mutable-globals,+nontrapping-fptoint,+sign-ext,-multivalue,-reference-types',
		'--lto-O1'
	];
	if (
		!Array.isArray(plan.arguments) ||
		plan.arguments.length !== expectedArguments.length ||
		expectedArguments.some((argument, index) => plan.arguments?.[index] !== argument)
	) {
		throw new Error(`TinyGo link plan arguments differ from compile protocol v${protocolVersion}`);
	}
	if (
		plan.arguments.some((argument) => /(?:^|[=,])--thinlto-cache-dir(?:$|[=,])/u.test(argument))
	) {
		throw new Error('TinyGo link plan contains forbidden --thinlto-cache-dir');
	}
	const expectedOptimizer = {
		tool: 'wasm-opt',
		input: 'program.unoptimized.wasm',
		output: 'program.wasm',
		arguments: [
			'--asyncify',
			'-O1',
			'-g',
			'program.unoptimized.wasm',
			'--output',
			'program.wasm'
		]
	};
	if (JSON.stringify(plan.optimizer) !== JSON.stringify(expectedOptimizer)) {
		throw new Error(
			`TinyGo optimizer plan differs from asyncify -O1 compile protocol v${protocolVersion}`
		);
	}
	return plan as TinyGoLinkPlanV4 | TinyGoLinkPlanV5 | TinyGoLinkPlanV6;
}

export async function validateTinyGoLinkPlanV4(
	value: unknown,
	runtime: TinyGoRuntimeClosure,
	options: Parameters<typeof validateTinyGoLinkPlanV4ToV6>[3]
): Promise<TinyGoLinkPlanV4> {
	return (await validateTinyGoLinkPlanV4ToV6(value, runtime, 4, options)) as TinyGoLinkPlanV4;
}

export async function validateTinyGoLinkPlanV5(
	value: unknown,
	runtime: TinyGoRuntimeClosure,
	options: Parameters<typeof validateTinyGoLinkPlanV4ToV6>[3]
): Promise<TinyGoLinkPlanV5> {
	return (await validateTinyGoLinkPlanV4ToV6(value, runtime, 5, options)) as TinyGoLinkPlanV5;
}

export async function validateTinyGoLinkPlanV6(
	value: unknown,
	runtime: TinyGoRuntimeClosure,
	options: Parameters<typeof validateTinyGoLinkPlanV4ToV6>[3]
): Promise<TinyGoLinkPlanV6> {
	return (await validateTinyGoLinkPlanV4ToV6(value, runtime, 6, options)) as TinyGoLinkPlanV6;
}

function runtimeRequest(runtime: TinyGoRuntimeClosure) {
	return {
		compilerRT: `${TINYGO_ROOT_PATH}/${runtime.compilerRT.path}`,
		wasiLibc: `${TINYGO_ROOT_PATH}/${runtime.wasiLibc.path}`,
		...(runtime.libCxx && runtime.libCxxAbi
			? {
					libCxx: `${TINYGO_ROOT_PATH}/${runtime.libCxx.path}`,
					libCxxAbi: `${TINYGO_ROOT_PATH}/${runtime.libCxxAbi.path}`
				}
			: {}),
		extraFiles: Object.fromEntries(
			Object.entries(runtime.extraFiles).map(([source, asset]) => [
				source,
				`${TINYGO_ROOT_PATH}/${asset.path}`
			])
		)
	};
}

export async function compileUpstreamTinyGo(
	toolchain: PreparedTinyGoUpstreamToolchain,
	request: TinyGoUpstreamCompileRequest,
	optimizer: TinyGoWasmOptimizer
): Promise<TinyGoUpstreamCompileResult> {
	assertNotAborted(request.signal);
	const workspace = createWorkspace(request.workspaceFiles);
	if (!hasTinyGoVfsPath(workspace, 'go.mod', 'file')) {
		throw new Error(
			'upstream TinyGo workspace must contain go.mod for browser package discovery'
		);
	}
	const packageName = request.package ?? '.';
	if (packageName !== '.') {
		throw new Error('package-graph protocol v1 requires the module-root package "."');
	}
	const moduleMode = selectTinyGoOfflineModuleMode(workspace);
	const work = createWorkDirectory();
	const encoder = new TextEncoder();

	request.onPhase?.('graph');
	const packageGraphStdout = new File([]);
	const packageGraphRun = await runWasiModule({
		module: toolchain.packageGraph,
		args: [
			'go',
			'list',
			`-json=${TINYGO_UPSTREAM_PACKAGE_GRAPH_FIELDS.join(',')}`,
			'-deps',
			'-e',
			`-mod=${moduleMode}`,
			`-tags=${TINYGO_UPSTREAM_PACKAGE_GRAPH_TAGS.join(' ')}`,
			'.'
		],
		env: [
			'GO111MODULE=on',
			'GOARCH=wasm',
			'CGO_ENABLED=1',
			'GOENV=off',
			`GOCACHE=${TINYGO_WORK_PATH}/cache`,
			`GOMODCACHE=${TINYGO_WORK_PATH}/modcache`,
			'GOOS=wasip1',
			`GOPATH=${TINYGO_WORK_PATH}/gopath`,
			'GOPROXY=off',
			'GOSUMDB=off',
			'GOTOOLCHAIN=local',
			'GOVCS=off',
			'GOWORK=off',
			`GOROOT=${TINYGO_ROOT_PATH}`,
			`HOME=${TINYGO_WORK_PATH}/home`,
			`PWD=${TINYGO_WORKSPACE_PATH}`,
			`TMPDIR=${TINYGO_WORK_PATH}/tmp`
		],
		preopens: [
			new PreopenDirectory(TINYGO_ROOT_PATH, toolchain.root),
			new PreopenDirectory(TINYGO_WORKSPACE_PATH, workspace),
			new PreopenDirectory(TINYGO_WORK_PATH, work)
		],
		stdoutFile: packageGraphStdout
	});
	if (packageGraphRun.exitCode !== 0 || packageGraphRun.stderr.byteLength !== 0) {
		const diagnostic = diagnosticText(packageGraphRun.stderr, packageGraphRun.stderrTruncated);
		throw new Error(
			`upstream Go package-graph provider failed with exit code ${packageGraphRun.exitCode}${diagnostic ? `: ${diagnostic}` : ''}`
		);
	}
	const packageJSON = new TextDecoder().decode(packageGraphRun.stdout);

	assertNotAborted(request.signal);
	request.onPhase?.('validate');
	const packages = validateTinyGoPackageJSON({
		packageJSON,
		root: toolchain.root,
		workspace,
		compileProtocolVersion: toolchain.compileProtocolVersion
	});
	const expectedEmbedObjects: TinyGoExpectedEmbedObject[] = [];
	const expectedCGoInputs: TinyGoExpectedNativeSource[] = [];
	const expectedCObjects: TinyGoExpectedNativeSource[] = [];
	const expectedCXXObjects: TinyGoExpectedNativeSource[] = [];
	const expectedAssemblyObjects: TinyGoExpectedNativeSource[] = [];
	const expectedCXXFlags = new Map<string, readonly string[]>();
	const expectedCGoLinkerFlags: string[] = [];
	for (const pkg of packages) {
		const importPath = pkg.ImportPath as string;
		const directory = pkg.Dir as string;
		const inRoot =
			directory === TINYGO_ROOT_PATH || directory.startsWith(`${TINYGO_ROOT_PATH}/`);
		const directoryRoot = inRoot ? TINYGO_ROOT_PATH : TINYGO_WORKSPACE_PATH;
		const vfsRoot = inRoot ? toolchain.root : workspace;
		const packageDirectory =
			directory === directoryRoot ? '' : directory.slice(directoryRoot.length + 1);
		expectedCGoLinkerFlags.push(...((pkg.CgoLDFLAGS ?? []) as string[]));
		for (const sourcePath of (pkg.EmbedFiles ?? []) as string[]) {
			const relativePath = packageDirectory
				? `${packageDirectory}/${sourcePath}`
				: sourcePath;
			const sourceSha256 = await sha256TinyGoBytes(readTinyGoVfsFile(vfsRoot, relativePath));
			expectedEmbedObjects.push({
				importPath,
				sourcePath,
				sourceSha256,
				embeddedFileHash: sourceSha256.slice(0, 32)
			});
		}
		for (const sourcePath of (pkg.CgoFiles ?? []) as string[]) {
			const relativePath = packageDirectory
				? `${packageDirectory}/${sourcePath}`
				: sourcePath;
			const sourceBytes = readTinyGoVfsFile(vfsRoot, relativePath);
			if (sourceBytes.byteLength > MAX_NATIVE_SOURCE_BYTES) {
				throw new Error(`TinyGo CGo source exceeds the browser limit: ${sourcePath}`);
			}
			expectedCGoInputs.push({
				importPath,
				sourcePath,
				bytes: sourceBytes.byteLength,
				sha256: await sha256TinyGoBytes(sourceBytes)
			});
		}
		for (const sourcePath of (pkg.CFiles ?? []) as string[]) {
			const relativePath = packageDirectory
				? `${packageDirectory}/${sourcePath}`
				: sourcePath;
			const sourceBytes = readTinyGoVfsFile(vfsRoot, relativePath);
			if (sourceBytes.byteLength > MAX_NATIVE_SOURCE_BYTES) {
				throw new Error(`TinyGo C source exceeds the browser limit: ${sourcePath}`);
			}
			expectedCObjects.push({
				importPath,
				sourcePath,
				bytes: sourceBytes.byteLength,
				sha256: await sha256TinyGoBytes(sourceBytes)
			});
		}
		for (const sourcePath of (pkg.CXXFiles ?? []) as string[]) {
			const relativePath = packageDirectory
				? `${packageDirectory}/${sourcePath}`
				: sourcePath;
			const sourceBytes = readTinyGoVfsFile(vfsRoot, relativePath);
			if (sourceBytes.byteLength > MAX_NATIVE_SOURCE_BYTES) {
				throw new Error(`TinyGo C++ source exceeds the browser limit: ${sourcePath}`);
			}
			expectedCXXObjects.push({
				importPath,
				sourcePath,
				bytes: sourceBytes.byteLength,
				sha256: await sha256TinyGoBytes(sourceBytes)
			});
			expectedCXXFlags.set(
				`${importPath}\0${sourcePath}`,
				[...((pkg.CgoCXXFLAGS ?? []) as string[])]
			);
		}
		if (!inRoot) {
			for (const sourcePath of (pkg.SFiles ?? []) as string[]) {
				const relativePath = packageDirectory
					? `${packageDirectory}/${sourcePath}`
					: sourcePath;
				const sourceBytes = readTinyGoVfsFile(workspace, relativePath);
				if (sourceBytes.byteLength > MAX_NATIVE_SOURCE_BYTES) {
					throw new Error(
						`TinyGo assembly source exceeds the browser limit: ${sourcePath}`
					);
				}
				expectedAssemblyObjects.push({
					importPath,
					sourcePath,
					bytes: sourceBytes.byteLength,
					sha256: await sha256TinyGoBytes(sourceBytes)
				});
			}
		}
	}
	if (
		expectedCGoInputs.length > MAX_NATIVE_INPUT_COUNT ||
		expectedCObjects.length > MAX_NATIVE_INPUT_COUNT ||
		expectedCXXObjects.length > MAX_NATIVE_INPUT_COUNT ||
		expectedAssemblyObjects.length > MAX_NATIVE_INPUT_COUNT ||
		(toolchain.compileProtocolVersion >= 4 &&
			expectedCGoInputs.length +
				expectedCObjects.length +
				expectedCXXObjects.length +
				expectedAssemblyObjects.length >
				MAX_NATIVE_INPUT_COUNT)
	) {
		throw new Error('TinyGo native source set exceeds the browser count limit');
	}
	expectedEmbedObjects.sort((left, right) => {
		if (left.importPath !== right.importPath) {
			return left.importPath < right.importPath ? -1 : 1;
		}
		if (left.sourcePath === right.sourcePath) return 0;
		return left.sourcePath < right.sourcePath ? -1 : 1;
	});
	for (const sources of [
		expectedCGoInputs,
		expectedCObjects,
		expectedCXXObjects,
		expectedAssemblyObjects
	]) {
		sources.sort((left, right) => {
			if (left.importPath !== right.importPath) {
				return left.importPath < right.importPath ? -1 : 1;
			}
			if (left.sourcePath === right.sourcePath) return 0;
			return left.sourcePath < right.sourcePath ? -1 : 1;
		});
	}
	const expectedNativeObjectsV4: TinyGoExpectedNativeSourceV4[] = [
		...expectedCObjects.map((source) => ({ ...source, sourceField: 'CFiles' as const })),
		...expectedCXXObjects.map((source) => ({
			...source,
			sourceField: 'CXXFiles' as const
		})),
		...expectedAssemblyObjects.map((source) => ({
			...source,
			sourceField: 'SFiles' as const
		}))
	];
	addTinyGoVfsFile(work, 'package-list.json', encoder.encode(packageJSON));
	const adapterRequest = {
		package: packageName,
		packageJSON: `${TINYGO_WORK_PATH}/package-list.json`,
		workingDirectory: TINYGO_WORKSPACE_PATH,
		outputDirectory: `${TINYGO_WORK_PATH}/output`,
		temporaryDirectory: `${TINYGO_WORK_PATH}/tmp`,
		target: 'wasip1',
		opt: '1',
		gc: 'precise',
		panicStrategy: 'print',
		scheduler: 'asyncify',
		debug: false,
		parallelism: 1,
		runtime: runtimeRequest(toolchain.runtime)
	};
	addTinyGoVfsFile(
		work,
		'request.json',
		encoder.encode(`${JSON.stringify(adapterRequest, null, 2)}\n`)
	);

	assertNotAborted(request.signal);
	request.onPhase?.('compile');
	const compilerRun = await runWasiModule({
		module: toolchain.compiler,
		args: ['tinygo-browser-adapter', `${TINYGO_WORK_PATH}/request.json`],
		env: [
			'GO111MODULE=off',
			`GOCACHE=${TINYGO_WORK_PATH}/cache`,
			`GOROOT=${TINYGO_ROOT_PATH}`,
			`GOVERSION=${TINYGO_GO_VERSION}`,
			'GOWORK=off',
			`HOME=${TINYGO_WORK_PATH}/home`,
			`PWD=${TINYGO_WORKSPACE_PATH}`,
			`TINYGOROOT=${TINYGO_ROOT_PATH}`,
			`TINYGO_BROWSER_COMPILER_BUILD_ID=${toolchain.compilerSha256}`,
			`TMPDIR=${TINYGO_WORK_PATH}/tmp`
		],
		preopens: [
			new PreopenDirectory(TINYGO_ROOT_PATH, toolchain.root),
			new PreopenDirectory(TINYGO_WORKSPACE_PATH, workspace),
			new PreopenDirectory(TINYGO_WORK_PATH, work)
		]
	});
	if (compilerRun.exitCode !== 0 || compilerRun.stderr.byteLength !== 0) {
		const diagnostic = diagnosticText(compilerRun.stderr, compilerRun.stderrTruncated);
		throw new Error(
			`upstream TinyGo compiler failed with exit code ${compilerRun.exitCode}${diagnostic ? `: ${diagnostic}` : ''}`
		);
	}
	const linkPlanBytes = readTinyGoVfsFile(work, 'output/link-plan.json');
	if (linkPlanBytes.byteLength > MAX_LINK_PLAN_BYTES) {
		throw new Error('upstream TinyGo compiler link plan exceeds the browser limit');
	}
	let linkPlanValue: unknown;
	try {
		linkPlanValue = JSON.parse(new TextDecoder().decode(linkPlanBytes));
	} catch (error) {
		throw new Error('upstream TinyGo compiler emitted an invalid link plan', { cause: error });
	}
	let linkPlan: TinyGoLinkPlan;
	if (toolchain.compileProtocolVersion === 1) {
		linkPlan = validateTinyGoLinkPlan(linkPlanValue, toolchain.runtime);
	} else if (toolchain.compileProtocolVersion === 2) {
		linkPlan = validateTinyGoLinkPlanV2(linkPlanValue, toolchain.runtime, {
			compilerSha256: toolchain.compilerSha256,
			expectedEmbedObjects
		});
	} else if (toolchain.compileProtocolVersion === 3) {
		linkPlan = await validateTinyGoLinkPlanV3(linkPlanValue, toolchain.runtime, {
			compilerSha256: toolchain.compilerSha256,
			expectedEmbedObjects,
			expectedCGoInputs,
			expectedCObjects,
			root: toolchain.root,
			workspace
		});
	} else if (toolchain.compileProtocolVersion === 4) {
		linkPlan = await validateTinyGoLinkPlanV4(linkPlanValue, toolchain.runtime, {
			compilerSha256: toolchain.compilerSha256,
			expectedEmbedObjects,
			expectedCGoInputs,
			expectedNativeObjects: expectedNativeObjectsV4,
			root: toolchain.root,
			workspace
		});
	} else if (toolchain.compileProtocolVersion === 5) {
		linkPlan = await validateTinyGoLinkPlanV5(linkPlanValue, toolchain.runtime, {
			compilerSha256: toolchain.compilerSha256,
			expectedEmbedObjects,
			expectedCGoInputs,
			expectedNativeObjects: expectedNativeObjectsV4,
			root: toolchain.root,
			workspace
		});
	} else {
		linkPlan = await validateTinyGoLinkPlanV6(linkPlanValue, toolchain.runtime, {
			compilerSha256: toolchain.compilerSha256,
			expectedEmbedObjects,
			expectedCGoInputs,
			expectedNativeObjects: expectedNativeObjectsV4,
			expectedCXXFlags,
			expectedCGoLinkerFlags,
			root: toolchain.root,
			workspace
		});
	}
	const objectEntries =
		linkPlan.schemaVersion === 1
			? [
					{
						kind: 'program' as const,
						path: linkPlan.object,
						format: 'wasm-object' as const,
						bytes: undefined,
						sha256: undefined,
						wasmValidation: undefined
					}
				]
			: linkPlan.objects;
	const objects: Uint8Array[] = [];
	let objectSetBytes = 0;
	for (const [index, entry] of objectEntries.entries()) {
		const bytes = readTinyGoVfsFile(work, `output/${entry.path}`);
		objectSetBytes += bytes.byteLength;
		if (bytes.byteLength > MAX_OBJECT_BYTES || objectSetBytes > MAX_OBJECT_SET_BYTES) {
			throw new Error('upstream TinyGo compiler object set exceeds the browser limit');
		}
		if (
			entry.bytes !== undefined &&
			(bytes.byteLength !== entry.bytes || (await sha256TinyGoBytes(bytes)) !== entry.sha256)
		) {
			throw new Error(`upstream TinyGo object ${index} differs from its link plan`);
		}
		if (entry.format === 'llvm-bitcode') {
			assertTinyGoLLVMBitcodeEnvelope(bytes, `upstream TinyGo object ${index}`);
		} else {
			const metadata = assertTinyGoRelocatableWasmObject(
				bytes,
				`upstream TinyGo object ${index}`,
				{ profile: entry.kind === 'program' ? 'upstream-program' : 'auxiliary' }
			);
			if (
				entry.wasmValidation !== undefined &&
				(metadata.linkingVersion !== entry.wasmValidation.linkingVersion ||
					metadata.symbolTable !== entry.wasmValidation.symbolTable)
			) {
				throw new Error(`upstream TinyGo object ${index} differs from its Wasm evidence`);
			}
		}
		objects.push(bytes);
	}
	const object = objects[0];
	if (!object) throw new Error('upstream TinyGo compiler emitted no program object');

	assertNotAborted(request.signal);
	request.onPhase?.('link');
	const linkWork: TinyGoWasiDirectoryContents = new Map();
	addTinyGoVfsDirectory(linkWork, 'output');
	addTinyGoVfsDirectory(linkWork, 'tmp');
	for (const [index, entry] of objectEntries.entries()) {
		const bytes = objects[index];
		if (!bytes) throw new Error(`upstream TinyGo object ${index} is missing`);
		addTinyGoVfsFile(linkWork, `output/${entry.path}`, bytes);
	}
	const objectPaths = new Set(objectEntries.map((entry) => entry.path));
	const linkArguments = linkPlan.arguments.map((argument) => {
		if (objectPaths.has(argument)) return `${TINYGO_WORK_PATH}/output/${argument}`;
		if (argument === linkPlan.output) return `${TINYGO_WORK_PATH}/output/${linkPlan.output}`;
		return argument;
	});
	const linkerRun = await runWasiModule({
		module: toolchain.lld,
		args: ['wasm-ld', ...linkArguments],
		env: [`TMPDIR=${TINYGO_WORK_PATH}/tmp`],
		preopens: [
			new PreopenDirectory(TINYGO_ROOT_PATH, toolchain.root),
			new PreopenDirectory(TINYGO_WORK_PATH, linkWork)
		]
	});
	if (linkerRun.exitCode !== 0) {
		const diagnostic = diagnosticText(linkerRun.stderr, linkerRun.stderrTruncated);
		throw new Error(
			`raw WASI LLD failed with exit code ${linkerRun.exitCode}${diagnostic ? `: ${diagnostic}` : ''}`
		);
	}
	const unoptimizedWasm = readTinyGoVfsFile(linkWork, 'output/program.unoptimized.wasm');
	await assertTinyGoFinalWasmModule(unoptimizedWasm, 'raw WASI LLD output', {
		phase: 'pre-asyncify'
	});

	assertNotAborted(request.signal);
	request.onPhase?.('optimize');
	const wasm = Uint8Array.from(
		await optimizer({
			wasm: unoptimizedWasm,
			arguments: linkPlan.optimizer.arguments,
			passes: ['asyncify'],
			optimizeLevel: 1,
			preserveDebugInfo: true
		})
	);
	await assertTinyGoFinalWasmModule(wasm, 'Binaryen TinyGo output');
	return {
		wasm,
		unoptimizedWasm,
		object,
		objects,
		linkPlan,
		packageJSON,
		compilerStdout: compilerRun.stdout,
		compilerStderr: compilerRun.stderr,
		linkerStdout: linkerRun.stdout,
		linkerStderr: linkerRun.stderr
	};
}

export function createBinaryenTinyGoOptimizer(binaryen: TinyGoBinaryenLike): TinyGoWasmOptimizer {
	return ({ wasm, passes, optimizeLevel, preserveDebugInfo }) => {
		const previousOptimizeLevel = binaryen.getOptimizeLevel();
		const previousShrinkLevel = binaryen.getShrinkLevel();
		const previousDebugInfo = binaryen.getDebugInfo();
		binaryen.setOptimizeLevel(optimizeLevel);
		binaryen.setShrinkLevel(0);
		binaryen.setDebugInfo(preserveDebugInfo);
		let module: BinaryenModuleLike | undefined;
		try {
			module = binaryen.readBinary(wasm);
			module.runPasses([...passes]);
			module.optimize();
			if (!module.validate())
				throw new Error('Binaryen rejected the finalized TinyGo module');
			return Uint8Array.from(module.emitBinary());
		} finally {
			module?.dispose();
			binaryen.setOptimizeLevel(previousOptimizeLevel);
			binaryen.setShrinkLevel(previousShrinkLevel);
			binaryen.setDebugInfo(previousDebugInfo);
		}
	};
}

export async function executeUpstreamTinyGoWasm(options: {
	wasm: Uint8Array;
	stdin?: string | Uint8Array;
	args?: string[];
}): Promise<TinyGoExecutionResult> {
	const module = await compileWasiModule(options.wasm, 'TinyGo output');
	const stdin =
		typeof options.stdin === 'string' ? new TextEncoder().encode(options.stdin) : options.stdin;
	const result = await runWasiModule({
		module,
		args: options.args ?? ['program.wasm'],
		...(stdin ? { stdin } : {})
	});
	return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}
