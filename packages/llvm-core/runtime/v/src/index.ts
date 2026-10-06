import { Directory, File } from '@bjorn3/browser_wasi_shim';
import {
	BrowserClangRuntime,
	executeBrowserClangArtifact,
	loadRuntimeManifest,
	resolveRuntimeBaseUrl,
	resolveRuntimeBaseUrlFromManifestUrl,
	resolveRuntimeManifestUrl,
	type BrowserClangArtifact,
	type BrowserExecutionOptions,
	type RuntimeManifestV1
} from '../../clang/src/index.js';
import {
	DEFAULT_MAX_DECOMPRESSED_ASSET_BYTES,
	DEFAULT_MAX_RUNTIME_JSON_BYTES,
	compile,
	fetchRuntimeJson,
	readBuffer
} from '../../core/src/wasm.js';
import untar from '../../core/src/tar.js';

const V_MANIFEST_NAME = 'runtime-manifest.v1.json';
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
let buildCounter = 0;

export const V_LLVM_PROFILE = {
	name: 'v-wasi-clang',
	version: 1,
	vVersion: '0.5.2',
	vCommit: '7647ce1c6fad63b5578bc07883139906de74b2f8',
	frontendTarget: 'wasm32-wasi',
	backend: 'wasm-llvm-clang',
	unsupported: ['os.execute', 'processes', 'threads', 'network', 'C interop beyond wasi-libc']
} as const;

/** Arguments for the real V compiler: emit C for its WASI target without a garbage collector. */
export const V_TRANSLATE_ARGS = Object.freeze([
	'-os',
	'wasm32_wasi',
	'-gc',
	'none',
	'-no-parallel'
]);
/** Environment for the V compiler: VEXE locates /v/vlib in the packaged V root. */
export const V_COMPILER_ENV = Object.freeze({
	VEXE: '/v/v',
	VMODULES: '/tmp/vmodules',
	VTMP: '/tmp',
	TMPDIR: '/tmp',
	HOME: '/tmp'
});
/**
 * Generated-C flags matching the producer acceptance. These are clang -cc1 arguments: V's own
 * `-fwrapv -fno-strict-aliasing` driver flags become `-fwrapv -relaxed-aliasing`.
 */
export const V_C_FLAGS = Object.freeze([
	'-I',
	'include/v-wasi',
	'-include',
	'v_wasi_compat.h',
	'-D_WASI_EMULATED_MMAN',
	'-D_WASI_EMULATED_SIGNAL',
	'-D_WASI_EMULATED_PROCESS_CLOCKS',
	'-D_WASI_EMULATED_GETPID',
	'-fwrapv',
	'-relaxed-aliasing',
	'-Wno-everything'
]);
/**
 * V's builtin memory helpers treat addresses at or below 0xFFFF as invalid. Data and stack must
 * therefore start above the first 64 KiB of linear memory.
 */
export const V_LINK_FLAGS = Object.freeze([
	'-z',
	'stack-size=1048576',
	'--no-stack-first',
	'--global-base=65536'
]);
export const V_LINK_LIBRARIES = Object.freeze([
	'lib/wasm32-wasi/libvwasi.a',
	'lib/wasm32-wasi/libwasi-emulated-mman.a',
	'lib/wasm32-wasi/libwasi-emulated-signal.a',
	'lib/wasm32-wasi/libwasi-emulated-process-clocks.a',
	'lib/wasm32-wasi/libwasi-emulated-getpid.a',
	'-lc',
	'-lm'
]);

export type VCompileStage = 'bootstrap' | 'translate' | 'compile' | 'link' | 'done';

export interface VWorkspaceFile {
	path: string;
	content: string;
}

export interface BrowserVCompileProgress {
	stage: VCompileStage;
	percent: number;
	message: string;
}

export interface BrowserVCompileRequest {
	code: string;
	fileName?: string;
	compileArgs?: string[];
	cCompileArgs?: string[];
	workspaceFiles?: VWorkspaceFile[];
	log?: boolean;
	onProgress?: (progress: BrowserVCompileProgress) => void;
}

export type BrowserVArtifact = BrowserClangArtifact & {
	sourceLanguage: 'V';
};

export interface BrowserVCompilerResult {
	success: boolean;
	artifact?: BrowserVArtifact;
	stdout?: string;
	stderr?: string;
}

export interface BrowserVCompiler {
	compile(request: BrowserVCompileRequest): Promise<BrowserVCompilerResult>;
}

export interface VRuntimeManifestV1 {
	manifestVersion: 1;
	version: string;
	frontend: {
		asset: string;
		argv0: string;
	};
	rootfs: {
		asset: string;
	};
	cSysroot: {
		asset: string;
	};
	profile: typeof V_LLVM_PROFILE;
}

export type VRuntimeLocation =
	| {
			runtimeBaseUrl: string | URL;
			manifestUrl?: string | URL;
	  }
	| {
			runtimeBaseUrl?: never;
			manifestUrl: string | URL;
	  };

export type VClangRuntimeLocation =
	| {
			clangRuntimeBaseUrl: string | URL;
			clangManifestUrl?: string | URL;
	  }
	| {
			clangRuntimeBaseUrl?: never;
			clangManifestUrl: string | URL;
	  };

export type CreateVCompilerOptions = VRuntimeLocation &
	VClangRuntimeLocation & {
		manifest?: VRuntimeManifestV1;
		clangManifest?: RuntimeManifestV1;
		fetchImpl?: typeof fetch;
		log?: boolean;
		maxAssetBytes?: number;
		signal?: AbortSignal;
	};

export interface VRuntimeAssetUrls {
	manifest: string;
	frontend: string;
	rootfs: string;
	cSysroot: string;
}

function resolveHostedRuntimeUrl(value: string | URL, label: string) {
	const href = value?.toString().trim();
	if (!href) throw new Error(`${label} is required`);

	let resolved: URL;
	try {
		resolved = new URL(href, typeof location !== 'undefined' ? location.href : undefined);
	} catch {
		throw new Error(`${label} must be an absolute HTTP(S) URL`);
	}
	if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
		throw new Error(`${label} must use HTTP(S)`);
	}
	return resolved;
}

function normalizeBaseUrl(baseUrl: string | URL) {
	const resolved = resolveHostedRuntimeUrl(baseUrl, 'wasm-v runtime base URL');
	if (!resolved.pathname.endsWith('/')) resolved.pathname += '/';
	resolved.hash = '';
	return resolved;
}

function resolveVRuntimeBaseUrlFromManifestUrl(manifestUrl: string | URL) {
	return normalizeBaseUrl(
		new URL('./', resolveHostedRuntimeUrl(manifestUrl, 'wasm-v runtime manifest URL'))
	).toString();
}

function normalizeWorkspacePath(value: string) {
	return value
		.replaceAll('\\', '/')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..')
		.join('/');
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-v runtime manifest`);
	}
	return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || !value) {
		throw new Error(`invalid ${label} in wasm-v runtime manifest`);
	}
	return value;
}

export function parseVRuntimeManifest(value: unknown): VRuntimeManifestV1 {
	const root = expectObject(value, 'root');
	if (root.manifestVersion !== 1) {
		throw new Error('invalid root.manifestVersion in wasm-v runtime manifest');
	}
	const frontend = expectObject(root.frontend, 'root.frontend');
	const rootfs = expectObject(root.rootfs, 'root.rootfs');
	const cSysroot = expectObject(root.cSysroot, 'root.cSysroot');
	const profile = expectObject(root.profile, 'root.profile');
	if (
		profile.name !== V_LLVM_PROFILE.name ||
		profile.version !== V_LLVM_PROFILE.version ||
		profile.vCommit !== V_LLVM_PROFILE.vCommit
	) {
		throw new Error('unsupported root.profile in wasm-v runtime manifest');
	}
	return {
		manifestVersion: 1,
		version: expectString(root.version, 'root.version'),
		frontend: {
			asset: expectString(frontend.asset, 'root.frontend.asset'),
			argv0: expectString(frontend.argv0, 'root.frontend.argv0')
		},
		rootfs: {
			asset: expectString(rootfs.asset, 'root.rootfs.asset')
		},
		cSysroot: {
			asset: expectString(cSysroot.asset, 'root.cSysroot.asset')
		},
		profile: V_LLVM_PROFILE
	};
}

export function resolveVRuntimeManifestUrl(baseUrl: string | URL) {
	return new URL(V_MANIFEST_NAME, normalizeBaseUrl(baseUrl));
}

export function resolveVRuntimeAssetUrls(
	baseUrl: string | URL,
	manifest?: VRuntimeManifestV1
): VRuntimeAssetUrls {
	const normalized = normalizeBaseUrl(baseUrl);
	return {
		manifest: new URL(V_MANIFEST_NAME, normalized).toString(),
		frontend: new URL(manifest?.frontend.asset || 'v.wasm.gz', normalized).toString(),
		rootfs: new URL(manifest?.rootfs.asset || 'vroot.tar.gz', normalized).toString(),
		cSysroot: new URL(manifest?.cSysroot.asset || 'c-sysroot.tar.gz', normalized).toString()
	};
}

export async function loadVRuntimeManifest(
	manifestUrl: string | URL,
	fetchImpl: typeof fetch = fetch,
	signal?: AbortSignal,
	maxBytes = DEFAULT_MAX_RUNTIME_JSON_BYTES
): Promise<VRuntimeManifestV1> {
	const url = resolveHostedRuntimeUrl(manifestUrl, 'wasm-v runtime manifest URL');
	return parseVRuntimeManifest(
		await fetchRuntimeJson(url, {
			fetchImpl,
			label: 'wasm-v runtime manifest',
			maxBytes,
			signal
		})
	);
}

function emitProgress(
	request: BrowserVCompileRequest,
	stage: VCompileStage,
	percent: number,
	message: string
) {
	request.onProgress?.({ stage, percent, message });
}

/** Parse the packaged V root once; every compilation receives fresh copies of these files. */
export function readVRootArchive(archive: Uint8Array) {
	const files = new Map<string, Uint8Array>();
	untar(archive, {
		addDirectory() {},
		addFile(path, contents) {
			const normalized = normalizeWorkspacePath(path);
			if (normalized) files.set(normalized, Uint8Array.from(contents));
		}
	});
	if (!files.has('v/vlib/builtin/builtin.v')) {
		throw new Error('wasm-v root archive does not contain vlib/builtin');
	}
	return files;
}

function findGuestFile(root: Directory, path: string) {
	let current: Directory | File | undefined = root;
	for (const segment of normalizeWorkspacePath(path).split('/')) {
		if (!(current instanceof Directory)) return null;
		current = current.contents.get(segment) as Directory | File | undefined;
	}
	return current instanceof File ? current.data : null;
}

function inputName(fileName?: string) {
	const normalized = normalizeWorkspacePath(fileName || 'main.v');
	if (!normalized) return 'main.v';
	return /\.[A-Za-z0-9_-]+$/.test(normalized) ? normalized : `${normalized}.v`;
}

class VCompiler implements BrowserVCompiler {
	private readonly runtime: BrowserClangRuntime;
	private readonly frontend: WebAssembly.Module;
	private readonly vroot: Map<string, Uint8Array>;

	private constructor(
		runtime: BrowserClangRuntime,
		frontend: WebAssembly.Module,
		vroot: Map<string, Uint8Array>
	) {
		this.runtime = runtime;
		this.frontend = frontend;
		this.vroot = vroot;
	}

	static async create(options: CreateVCompilerOptions) {
		if (options.signal?.aborted) throw options.signal.reason;
		const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_DECOMPRESSED_ASSET_BYTES;
		if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes <= 0) {
			throw new TypeError('V maxAssetBytes must be a positive safe integer');
		}
		const fetchImpl = options.fetchImpl || fetch;
		const runtimeBaseUrl =
			options.runtimeBaseUrl !== undefined
				? normalizeBaseUrl(options.runtimeBaseUrl).toString()
				: resolveVRuntimeBaseUrlFromManifestUrl(options.manifestUrl);
		const manifest =
			options.manifest ||
			(await loadVRuntimeManifest(
				options.manifestUrl || resolveVRuntimeManifestUrl(runtimeBaseUrl),
				fetchImpl,
				options.signal,
				Math.min(maxAssetBytes, DEFAULT_MAX_RUNTIME_JSON_BYTES)
			));
		const assets = resolveVRuntimeAssetUrls(runtimeBaseUrl, manifest);
		const clangRuntimeBaseUrl =
			options.clangRuntimeBaseUrl !== undefined
				? resolveRuntimeBaseUrl(options.clangRuntimeBaseUrl)
				: resolveRuntimeBaseUrlFromManifestUrl(options.clangManifestUrl);
		const clangManifest =
			options.clangManifest ||
			(await loadRuntimeManifest(
				options.clangManifestUrl || resolveRuntimeManifestUrl(clangRuntimeBaseUrl),
				fetchImpl,
				options.signal,
				Math.min(maxAssetBytes, DEFAULT_MAX_RUNTIME_JSON_BYTES)
			));
		// The shared Clang/LLD host compiles V's C output; only its sysroot is replaced by the
		// producer's complete wasi-libc C sysroot with the V WASI compatibility archive.
		const runtime = new BrowserClangRuntime({
			runtimeBaseUrl: clangRuntimeBaseUrl,
			manifest: {
				...clangManifest,
				compiler: {
					...clangManifest.compiler,
					sysroot: { ...clangManifest.compiler.sysroot, asset: assets.cSysroot }
				}
			},
			log: options.log,
			maxAssetBytes,
			signal: options.signal,
			stdout: () => {}
		});
		const frontendReady = compile(assets.frontend, undefined, options.signal, maxAssetBytes);
		const rootfsReady = readBuffer(assets.rootfs, undefined, maxAssetBytes, options.signal);
		const [frontend, rootfs] = await Promise.all([frontendReady, rootfsReady]);
		await runtime.ready;
		if (options.signal?.aborted) throw options.signal.reason;
		return new VCompiler(runtime, frontend, readVRootArchive(rootfs));
	}

	private async translate(request: BrowserVCompileRequest, sourcePath: string) {
		const files: Array<{ path: string; contents: Uint8Array }> = [];
		for (const [path, contents] of this.vroot) files.push({ path, contents });
		const requestedInput = normalizeWorkspacePath(sourcePath);
		files.push({ path: `work/${requestedInput}`, contents: textEncoder.encode(request.code) });
		for (const file of request.workspaceFiles || []) {
			const safePath = normalizeWorkspacePath(file.path);
			if (!safePath || safePath === requestedInput) continue;
			files.push({ path: `work/${safePath}`, contents: textEncoder.encode(file.content) });
		}
		let root: Directory | null = null;
		const output: string[] = [];
		const result = await executeBrowserClangArtifact(
			{
				bytes: new Uint8Array(0),
				wasm: this.frontend,
				target: 'wasm32-wasi',
				format: 'wasi-core-wasm',
				fileName: 'v'
			},
			{
				programName: 'v',
				args: [
					...V_TRANSLATE_ARGS,
					...(request.compileArgs || []),
					'-o',
					'/work/__wasm_v_main.c',
					`/work/${requestedInput}`
				],
				env: V_COMPILER_ENV,
				files,
				stdout: (chunk) => output.push(chunk),
				stderr: (chunk) => output.push(chunk),
				extraImports: ({ host }) => {
					root = host.rootDirectory;
					return {};
				}
			}
		);
		// Report workspace paths as the user sees them (`main.v:3:1`), not the guest mount point.
		const diagnostics = output.join('').replaceAll('/work/', '');
		const generated = root ? findGuestFile(root, 'work/__wasm_v_main.c') : null;
		if (result.exitCode !== 0 || !generated) {
			throw new Error(
				diagnostics || `V compiler exited with ${result.exitCode ?? 'an unknown status'}`
			);
		}
		return { cSource: textDecoder.decode(generated), diagnostics };
	}

	async compile(request: BrowserVCompileRequest): Promise<BrowserVCompilerResult> {
		if (!request.code?.trim()) {
			return { success: false, stderr: 'wasm-v requires a non-empty source string' };
		}
		const compilerOutput: string[] = [];
		const runtime = this.runtime as BrowserClangRuntime & { stdout: (chunk: string) => void };
		const originalStdout = runtime.stdout;
		const originalMemfsStdout = runtime.memfs.stdout;
		runtime.stdout = (chunk) => compilerOutput.push(chunk);
		runtime.memfs.stdout = (chunk) => compilerOutput.push(chunk);
		runtime.log = request.log ?? runtime.log;
		runtime.beginTrace(!!request.log);

		try {
			emitProgress(request, 'bootstrap', 5, 'preparing V workspace');
			const stem = `__wasm_v_${++buildCounter}`;
			const requestedInput = inputName(request.fileName);

			emitProgress(request, 'translate', 20, 'translating V to C with the V compiler');
			const { cSource, diagnostics } = await this.translate(request, requestedInput);
			if (diagnostics) compilerOutput.push(diagnostics);

			emitProgress(request, 'compile', 55, 'compiling generated C with llvm-core Clang');
			const cPath = `${stem}.c`;
			const objPath = `${stem}.o`;
			const wasmPath = `${stem}.wasm`;
			const cCompilerOutputStart = compilerOutput.length;
			let cCompileError: unknown;
			try {
				await runtime.compile({
					input: cPath,
					code: cSource,
					obj: objPath,
					language: 'C',
					cVersion: '11',
					opt: '1',
					compileArgs: [...V_C_FLAGS, ...(request.cCompileArgs || [])]
				});
			} catch (error) {
				cCompileError = error;
			}
			const objectBytes = Uint8Array.from(runtime.memfs.getFileContents(objPath));
			const completeObject =
				objectBytes[0] === 0 &&
				objectBytes[1] === 0x61 &&
				objectBytes[2] === 0x73 &&
				objectBytes[3] === 0x6d;
			const cDiagnostics = compilerOutput.slice(cCompilerOutputStart).join('');
			const recoveredLateClose =
				completeObject &&
				cDiagnostics.includes('IO failure on output stream: Invalid argument');
			if (cCompileError && !recoveredLateClose) throw cCompileError;
			if (recoveredLateClose) {
				// clang 22 can report a late close error through the legacy memfs after it has
				// emitted a complete relocatable object. wasm-ld remains the final validator.
				compilerOutput.splice(cCompilerOutputStart);
			}
			if (!completeObject) {
				throw new Error('wasm-clang did not produce the V program object file');
			}

			emitProgress(request, 'link', 80, 'linking the V program');
			const lld = await runtime.getModule(runtime.assetUrls.lld);
			const compilerRuntimeLibDir =
				runtime.compilerConfig?.compilerRuntimeLibDir || 'lib/clang/22/lib/wasi';
			await runtime.run(
				lld,
				request.log ?? false,
				'wasm-ld',
				...V_LINK_FLAGS,
				'-Llib/wasm32-wasi',
				'lib/wasm32-wasi/crt1.o',
				objPath,
				...V_LINK_LIBRARIES,
				`-L${compilerRuntimeLibDir}`,
				'-lclang_rt.builtins-wasm32',
				'-o',
				wasmPath
			);
			const bytes = Uint8Array.from(runtime.memfs.getFileContents(wasmPath));
			const artifact: BrowserVArtifact = {
				bytes,
				wasm: await WebAssembly.compile(bytes),
				target: 'wasm32-wasi',
				format: 'wasi-core-wasm',
				fileName: wasmPath,
				language: 'C',
				sourceLanguage: 'V'
			};
			emitProgress(request, 'done', 100, 'done');
			return { success: true, artifact, stdout: compilerOutput.join('') };
		} catch (error) {
			const output = compilerOutput.join('');
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				stdout: output,
				stderr: output.includes(message) ? output : `${output}${message}`
			};
		} finally {
			runtime.stdout = originalStdout;
			runtime.memfs.stdout = originalMemfsStdout;
		}
	}
}

export async function createVCompiler(options: CreateVCompilerOptions): Promise<BrowserVCompiler> {
	return VCompiler.create(options);
}

export async function compileV(request: BrowserVCompileRequest, options: CreateVCompilerOptions) {
	return (await createVCompiler(options)).compile(request);
}

export async function preloadBrowserVRuntime(options: CreateVCompilerOptions) {
	await createVCompiler(options);
}

export function executeBrowserVArtifact(
	artifact: BrowserVArtifact,
	options: BrowserExecutionOptions = {}
) {
	return executeBrowserClangArtifact(artifact, options);
}

export default createVCompiler;
