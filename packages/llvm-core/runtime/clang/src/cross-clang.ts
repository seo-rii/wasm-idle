import { verifyRuntimeAssetIntegrity } from '@wasm-idle/core';
import { ConsoleStdout, Directory, File, PreopenDirectory, WASI, wasi } from '@bjorn3/browser_wasi_shim';
import untar from '../../core/src/tar.js';
import { readBuffer } from '../../core/src/wasm.js';
import { createLlvmToolHost, type LlvmToolHost } from './tool-host.js';

export type CrossClangCpu = 'x86-64' | 'x86-64-v3';
export type CrossClangEmit = 'executable' | 'object' | 'assembly';
export interface CrossClangAsset {
	readonly path: string;
	readonly sha256: string;
	readonly bytes: number;
}
export interface CrossClangManifest {
	readonly schemaVersion: 1;
	readonly kind: 'clang-x86_64-linux-gnu';
	readonly host: 'wasm32-wasip1';
	readonly target: 'x86_64-unknown-linux-gnu';
	readonly sysrootPath: '/sysroot';
	readonly gccToolchain: '/sysroot/usr';
	readonly resourceDir: string;
	readonly compilerPath: '/bin/clang';
	readonly linkerPath: '/bin/ld.lld';
	readonly cpuProfiles: readonly CrossClangCpu[];
	readonly assets: Readonly<Record<'clang' | 'lld' | 'sysroot', CrossClangAsset>>;
	readonly gnu: Readonly<{ gccVersion: string; glibcVersion: string; distribution: string; source: string; licenses: readonly string[] }>;
	readonly qualification: Readonly<{ status: 'unverified' | 'verified' }>;
}
export interface CreateCrossClangCompilerOptions {
	readonly manifestUrl: string | URL;
	/** Pin the exact manifest bytes, separately from the assets described by it. */
	readonly manifestSha256: string;
	readonly fetchImpl?: typeof fetch;
	readonly signal?: AbortSignal;
	/** Per-asset limit, including the unpacked sysroot. Default: 512 MiB. */
	readonly maxAssetBytes?: number;
}
export interface CrossClangCompileRequest {
	readonly code: string;
	readonly language?: 'c' | 'cpp';
	readonly cpu?: CrossClangCpu;
	readonly emit?: CrossClangEmit;
	readonly optimization?: '0' | '1' | '2' | '3' | 's';
	/** GNU C/C++ dialect for the selected language. Defaults to gnu17 / gnu++20. */
	readonly standard?: string;
	/** Additional headers/data, relative to /workspace. The main file is reserved. */
	readonly files?: readonly { readonly path: string; readonly contents: string | Uint8Array }[];
}
export interface CrossClangArtifact {
	readonly target: 'x86_64-unknown-linux-gnu';
	readonly format: 'elf-executable' | 'elf-object' | 'assembly';
	readonly fileName: string;
	readonly bytes: Uint8Array;
	readonly cpu: CrossClangCpu;
}
export interface CrossClangCompileResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly argv: readonly string[];
	readonly artifact?: CrossClangArtifact;
}
export interface CrossClangCompiler {
	readonly manifest: CrossClangManifest;
	readonly identity: Readonly<{ manifestSha256: string; compilerSha256: string; linkerSha256: string; sysrootSha256: string }>;
	/** Synchronous compiler execution. Own this compiler in a Worker to cancel CPU work. */
	compile(request: CrossClangCompileRequest): CrossClangCompileResult;
	dispose(): void;
}

const encoder = new TextEncoder();
const target = 'x86_64-unknown-linux-gnu' as const;
const maxWorkspaceBytes = 16 * 1024 * 1024;
const maxDiagnosticsBytes = 4 * 1024 * 1024;
const fixedManifest = {
	schemaVersion: 1, kind: 'clang-x86_64-linux-gnu', host: 'wasm32-wasip1', target,
	sysrootPath: '/sysroot', gccToolchain: '/sysroot/usr', compilerPath: '/bin/clang', linkerPath: '/bin/ld.lld'
} as const;

/** WASI libc derives access()/stat() permissions from a preopen's capabilities. */
class CompilerRootDirectory extends PreopenDirectory {
	override fd_fdstat_get() {
		const result = super.fd_fdstat_get();
		if (result.fdstat) {
			const directories = BigInt(wasi.RIGHTS_PATH_OPEN | wasi.RIGHTS_PATH_FILESTAT_GET |
				wasi.RIGHTS_FD_FILESTAT_GET | wasi.RIGHTS_FD_READDIR | wasi.RIGHTS_PATH_CREATE_DIRECTORY |
				wasi.RIGHTS_PATH_CREATE_FILE | wasi.RIGHTS_PATH_LINK_SOURCE | wasi.RIGHTS_PATH_LINK_TARGET |
				wasi.RIGHTS_PATH_RENAME_SOURCE | wasi.RIGHTS_PATH_RENAME_TARGET |
				wasi.RIGHTS_PATH_REMOVE_DIRECTORY | wasi.RIGHTS_PATH_UNLINK_FILE);
			result.fdstat.fs_rights_base = directories;
			// The shim defaults both masks to zero despite supporting these operations.
			// That makes Clang reject a mounted linker as non-executable. File.readonly
			// still rejects write opens for compiler binaries and sysroot files.
			result.fdstat.fs_rights_inherited = directories | BigInt(wasi.RIGHTS_FD_READ |
				wasi.RIGHTS_FD_WRITE | wasi.RIGHTS_FD_SEEK | wasi.RIGHTS_FD_TELL |
				wasi.RIGHTS_FD_FILESTAT_SET_SIZE | wasi.RIGHTS_FD_ALLOCATE |
				wasi.RIGHTS_FD_SYNC | wasi.RIGHTS_FD_DATASYNC);
		}
		return result;
	}
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid cross Clang ${label}`);
	return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0') || encoder.encode(value).length > 4096 || new TextDecoder('utf-8', { fatal: true }).decode(encoder.encode(value)) !== value) throw new Error(`Invalid cross Clang ${label}`);
	return value;
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new Error('Invalid cross Clang SHA-256');
	return value;
}
function relativePath(value: unknown): string {
	const path = text(value, 'path');
	if (path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Invalid cross Clang relative path: ${path}`);
	return path;
}

/** Parse an independent, immutable snapshot of the supported producer contract. */
export function parseCrossClangManifest(value: unknown): CrossClangManifest {
	const root = record(value, 'manifest');
	for (const [key, expected] of Object.entries(fixedManifest)) {
		if (root[key] !== expected) throw new Error(`Unsupported cross Clang manifest ${key}`);
	}
	const resourceDir = text(root.resourceDir, 'resource directory');
	if (!/^\/sysroot\/lib\/clang\/[1-9][0-9]*$/u.test(resourceDir)) throw new Error('Invalid cross Clang resource directory');
	if (!Array.isArray(root.cpuProfiles) || root.cpuProfiles.length !== 2 || root.cpuProfiles[0] !== 'x86-64' || root.cpuProfiles[1] !== 'x86-64-v3') throw new Error('Unsupported cross Clang CPU profiles');
	const inputAssets = record(root.assets, 'assets');
	const assets = Object.fromEntries((['clang', 'lld', 'sysroot'] as const).map(name => {
		const asset = record(inputAssets[name], `${name} asset`);
		const path = relativePath(asset.path);
		if (path !== `${name}.${name === 'sysroot' ? 'tar' : 'wasm'}`) throw new Error(`Unsupported cross Clang asset path: ${path}`);
		if (!Number.isSafeInteger(asset.bytes) || (asset.bytes as number) < 8) throw new Error(`Invalid cross Clang ${name} asset size`);
		return [name, Object.freeze({ path, bytes: asset.bytes as number, sha256: digest(asset.sha256) })];
	})) as Record<'clang' | 'lld' | 'sysroot', CrossClangAsset>;
	const inputGnu = record(root.gnu, 'GNU provenance');
	if (!Array.isArray(inputGnu.licenses) || inputGnu.licenses.length === 0 || inputGnu.licenses.length > 64) throw new Error('Invalid cross Clang GNU licenses');
	const gnu = Object.freeze({
		gccVersion: text(inputGnu.gccVersion, 'GCC version'), glibcVersion: text(inputGnu.glibcVersion, 'glibc version'),
		distribution: text(inputGnu.distribution, 'distribution'), source: text(inputGnu.source, 'GNU source'),
		licenses: Object.freeze(inputGnu.licenses.map(value => text(value, 'GNU license')))
	});
	const status = record(root.qualification, 'qualification').status;
	if (status !== 'unverified' && status !== 'verified') throw new Error('Invalid cross Clang qualification status');
	return Object.freeze({ ...fixedManifest, resourceDir, assets: Object.freeze(assets),
		cpuProfiles: Object.freeze(['x86-64', 'x86-64-v3'] as const), gnu, qualification: Object.freeze({ status }) });
}

function directory(root: Directory, path: string): Directory {
	let current = root;
	for (const part of path.split('/').filter(Boolean)) {
		const entry = current.contents.get(part);
		if (entry && !(entry instanceof Directory)) throw new Error(`Cross Clang directory collides with file: ${path}`);
		const next = entry ?? new Directory(new Map());
		current.contents.set(part, next);
		current = next as Directory;
	}
	return current;
}
function addFile(root: Directory, path: string, bytes: Uint8Array, readonly: boolean) {
	const parts = path.split('/');
	const name = parts.pop()!;
	const parent = directory(root, parts.join('/'));
	if (parent.contents.has(name)) throw new Error(`Duplicate cross Clang file: ${path}`);
	parent.contents.set(name, new File(bytes, { readonly }));
}

function compilePlan(request: CrossClangCompileRequest, manifest: CrossClangManifest) {
	if (!request || typeof request.code !== 'string') throw new Error('Cross Clang requires source text');
	const language = request.language ?? 'cpp', cpu = request.cpu ?? 'x86-64';
	const emit = request.emit ?? 'executable', optimization = request.optimization ?? '2';
	if (!['c', 'cpp'].includes(language) || !manifest.cpuProfiles.includes(cpu) || !['executable', 'object', 'assembly'].includes(emit) || !['0', '1', '2', '3', 's'].includes(optimization)) throw new Error('Invalid cross Clang compilation profile');
	const standard = request.standard ?? (language === 'c' ? 'gnu17' : 'gnu++20');
	const standards = language === 'c' ? ['c99', 'gnu99', 'c11', 'gnu11', 'c17', 'gnu17', 'c23', 'gnu23'] : ['c++11', 'gnu++11', 'c++14', 'gnu++14', 'c++17', 'gnu++17', 'c++20', 'gnu++20', 'c++23', 'gnu++23'];
	if (!standards.includes(standard)) throw new Error('Unsupported cross Clang language standard');
	const fileName = emit === 'assembly' ? 'program.s' : emit === 'object' ? 'program.o' : 'program.elf';
	const main = language === 'c' ? 'main.c' : 'main.cpp';
	const code = encoder.encode(request.code);
	let totalBytes = code.length;
	if (totalBytes > maxWorkspaceBytes || request.files && (!Array.isArray(request.files) || request.files.length > 1024)) throw new Error('Cross Clang workspace exceeds its limit');
	const files = [{ path: main, contents: code }];
	for (const file of request.files ?? []) {
		const path = relativePath(file.path);
		if (path === fileName || path.startsWith(`${fileName}/`)) throw new Error('Cross Clang output path is reserved');
		if (typeof file.contents !== 'string' && !(file.contents instanceof Uint8Array)) throw new Error('Invalid cross Clang workspace contents');
		const contents = typeof file.contents === 'string' ? encoder.encode(file.contents) : Uint8Array.from(file.contents);
		totalBytes += contents.length;
		if (totalBytes > maxWorkspaceBytes) throw new Error('Cross Clang workspace exceeds its limit');
		files.push({ path, contents });
	}
	const argv = [manifest.compilerPath, `--target=${target}`, `--sysroot=${manifest.sysrootPath}`,
		`--gcc-toolchain=${manifest.gccToolchain}`, `-resource-dir=${manifest.resourceDir}`,
		`-march=${cpu}`, `-O${optimization}`, `-std=${standard}`, '-fdiagnostics-color=never',
		'-x', language === 'c' ? 'c' : 'c++'];
	if (language === 'cpp') argv.push('--driver-mode=g++', '-stdlib=libstdc++');
	if (emit === 'executable') argv.push('-fuse-ld=lld', `--ld-path=${manifest.linkerPath}`, '--rtlib=libgcc', '--unwindlib=libgcc', '-static', '-fno-pie');
	else argv.push(emit === 'object' ? '-c' : '-S');
	argv.push(main, '-o', fileName);
	return { cpu, emit, fileName, files, argv: Object.freeze(argv) };
}

function validateOutput(bytes: Uint8Array, emit: CrossClangEmit) {
	if (emit === 'assembly') {
		if (!bytes.length) throw new Error('Cross Clang produced empty assembly');
		new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		return;
	}
	if (bytes.length < 64 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46 || bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1) throw new Error('Cross Clang did not produce little-endian ELF64');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint16(18, true) !== 62 || view.getUint16(16, true) !== (emit === 'object' ? 1 : 2) || view.getUint32(20, true) !== 1 || view.getUint16(52, true) !== 64) throw new Error('Cross Clang produced an unexpected ELF target or artifact type');
}

/**
 * Load an opt-in Wasm-hosted compiler and GNU/Linux sysroot. The generated x86-64
 * bytes are returned for download; this API has no native execution method.
 */
export async function createCrossClangCompiler(options: CreateCrossClangCompilerOptions): Promise<CrossClangCompiler> {
	const manifestSha256 = digest(options.manifestSha256);
	const manifestUrl = new URL(options.manifestUrl.toString());
	if (!['https:', 'http:'].includes(manifestUrl.protocol) || manifestUrl.username || manifestUrl.password || manifestUrl.hash) throw new Error('Cross Clang requires an HTTP(S) manifest URL');
	const maxAssetBytes = options.maxAssetBytes ?? 512 * 1024 * 1024;
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 1024) throw new Error('Invalid cross Clang asset byte limit');
	const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis), signal = options.signal;
	const manifestBytes = new Uint8Array(await readBuffer(manifestUrl.href, undefined, 1024 * 1024, signal, fetchImpl));
	await verifyRuntimeAssetIntegrity({ asset: manifestUrl.href, bytes: manifestBytes, expected: manifestSha256 });
	const manifest = parseCrossClangManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)));
	for (const asset of Object.values(manifest.assets)) if (asset.bytes > maxAssetBytes) throw new Error('Cross Clang asset exceeds the configured byte limit');
	const loaded = await Promise.all((['clang', 'lld', 'sysroot'] as const).map(async name => {
		const receipt = manifest.assets[name];
		const url = new URL(receipt.path, manifestUrl).href;
		const bytes = new Uint8Array(await readBuffer(url, undefined, receipt.bytes, signal, fetchImpl));
		await verifyRuntimeAssetIntegrity({ asset: url, bytes, expected: receipt });
		return bytes;
	}));
	const [clang, lld, sysrootBytes] = loaded;
	signal?.throwIfAborted();
	let sysroot = new Directory(new Map());
	let extractedBytes = 0, entries = 0;
	const seen = new Set<string>();
	untar(sysrootBytes, {
		addDirectory(path) {
			if (path === '.' || path === './') return;
			const normalized = relativePath(path.replace(/^\.\//u, '').replace(/\/$/u, ''));
			if (++entries > 100_000) throw new Error('Cross Clang sysroot has too many entries');
			directory(sysroot, normalized);
		},
		addFile(path, contents) {
			const normalized = relativePath(path.replace(/^\.\//u, ''));
			extractedBytes += contents.length;
			if (++entries > 100_000 || extractedBytes > maxAssetBytes) throw new Error('Cross Clang sysroot exceeds its extraction limit');
			if (seen.has(normalized)) throw new Error(`Duplicate cross Clang sysroot entry: ${normalized}`);
			seen.add(normalized);
			addFile(sysroot, normalized, contents, true);
		}
	});
	if (!seen.size) throw new Error('Cross Clang sysroot is empty');
	let active: { root: Directory; stdout: string; stderr: string; diagnosticBytes: number } | undefined;
	let host: LlvmToolHost | undefined;
	const toolsDirectory = new Directory(new Map([
		['clang', new File(clang, { readonly: true })], ['ld.lld', new File(lld, { readonly: true })]
	]));
	const importNames = new Set(Object.keys(new WASI([], [], [], { debug: false }).wasiImport));
	host = await createLlvmToolHost({
		tools: { clang: { bytes: clang, sha256: manifest.assets.clang.sha256 }, 'wasm-ld': { bytes: lld, sha256: manifest.assets.lld.sha256 } },
		allowClangCc1: true, compilerPaths: [manifest.compilerPath], linkerPaths: [manifest.linkerPath],
		validateModule(_executable, module) {
			const imports = WebAssembly.Module.imports(module), exports = WebAssembly.Module.exports(module);
			if (imports.some(entry => entry.kind !== 'function' || !(entry.module === 'wasi_snapshot_preview1' && importNames.has(entry.name) || entry.module === 'wasm_idle_process_v1' && entry.name === 'initial_cwd' || entry.module === 'wasm_idle_tool_host' && entry.name === 'exec_v1')) || !exports.some(entry => entry.name === 'memory' && entry.kind === 'memory') || !exports.some(entry => entry.name === '_start' && entry.kind === 'function') || !imports.some(entry => entry.module === 'wasm_idle_process_v1' && entry.name === 'initial_cwd')) throw new Error('Unsupported cross Clang Wasm host module profile');
		},
		createBindings(context) {
			if (!active) throw new Error('Cross Clang has no active workspace');
			const run = active;
			const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
			const output = (stream: 'stdout' | 'stderr') => new ConsoleStdout(bytes => {
				run.diagnosticBytes += bytes.length;
				if (run.diagnosticBytes > maxDiagnosticsBytes) throw new Error('Cross Clang diagnostics exceeded four MiB');
				run[stream] += decoders[stream].decode(bytes, { stream: true });
			});
			// The pinned multicall driver may prepend its "clang" subcommand even
			// when realpath resolves argv[0] to /bin/clang, which already selects
			// Clang. Adapt that exact child form here; keep the tool-host packet intact.
			const argv = context.argv;
			const wasiArgv = context.depth === 2 && context.executable === 'clang' &&
				argv[0] === manifest.compilerPath && argv[1] === 'clang' && (argv[2] === '-cc1' || argv[2] === '-cc1as')
				? [argv[0], ...argv.slice(2)] : [...argv];
			const wasiHost = new WASI(wasiArgv, Object.entries(context.env).map(([key, value]) => `${key}=${value}`), [
				new File([]).path_open(0, BigInt(wasi.RIGHTS_FD_READ), 0).fd_obj,
				output('stdout'), output('stderr'), new CompilerRootDirectory('/', run.root.contents)
			], { debug: false });
			let memory: WebAssembly.Memory | undefined;
			return {
				imports: { wasi_snapshot_preview1: wasiHost.wasiImport, wasm_idle_process_v1: {
					initial_cwd(ptr: number, capacity: number) {
						const cwd = encoder.encode(`${context.cwd}\0`), start = ptr >>> 0, size = capacity >>> 0;
						if (!memory || size < cwd.length || start + size > memory.buffer.byteLength) return -1;
						new Uint8Array(memory.buffer, start, cwd.length).set(cwd);
						return cwd.length;
					}
				} },
				run(instance) {
					memory = instance.exports.memory as WebAssembly.Memory;
					return { code: wasiHost.start(instance as unknown as Parameters<WASI['start']>[0]) };
				},
				dispose() {
					run.stdout += decoders.stdout.decode(); run.stderr += decoders.stderr.decode();
					for (const fd of wasiHost.fds) fd?.fd_close();
				}
			};
		}
	});
	if (signal?.aborted) { host.dispose(); signal.throwIfAborted(); }
	return {
		manifest,
		identity: Object.freeze({ manifestSha256, compilerSha256: manifest.assets.clang.sha256, linkerSha256: manifest.assets.lld.sha256, sysrootSha256: manifest.assets.sysroot.sha256 }),
		compile(request) {
			if (!host) throw new Error('Cross Clang compiler is disposed');
			if (active) throw new Error('Cross Clang compiler is busy');
			const plan = compilePlan(request, manifest), workspace = new Directory(new Map());
			for (const file of plan.files) addFile(workspace, file.path, file.contents, false);
			active = { root: new Directory(new Map([['sysroot', sysroot], ['bin', toolsDirectory], ['tmp', new Directory(new Map())], ['workspace', workspace]])), stdout: '', stderr: '', diagnosticBytes: 0 };
			try {
				const result = host.run({ executable: 'clang', argv: plan.argv, cwd: '/workspace', env: { PWD: '/workspace', TMPDIR: '/tmp', PATH: '/bin', LC_ALL: 'C' } });
				const captured = { exitCode: result.code, stdout: active.stdout, stderr: active.stderr, argv: plan.argv };
				if (result.code !== 0) return captured;
				const output = workspace.contents.get(plan.fileName);
				if (!(output instanceof File)) throw new Error('Cross Clang exited successfully without producing the requested output');
				const bytes = Uint8Array.from(output.data);
				validateOutput(bytes, plan.emit);
				return { ...captured, artifact: { target, format: plan.emit === 'assembly' ? 'assembly' : plan.emit === 'object' ? 'elf-object' : 'elf-executable', fileName: plan.fileName, bytes, cpu: plan.cpu } };
			} finally { active = undefined; }
		},
		dispose() {
			host?.dispose(); host = undefined;
			sysroot = new Directory(new Map()); toolsDirectory.contents.clear();
		}
	};
}
