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
import { compile, readBuffer } from '../../core/src/wasm.js';
import untar from '../../core/src/tar.js';

const COBOL_MANIFEST_NAME = 'runtime-manifest.v1.json';
const textDecoder = new TextDecoder();
const runtimeDirectories = new WeakMap<BrowserClangRuntime, Set<string>>();
let buildCounter = 0;

export const COBOL_LLVM_PROFILE = {
	name: 'gnucobol-wasi-clang',
	version: 1,
	gnucobolVersion: '3.2',
	gmpVersion: '6.3.0',
	frontendTarget: 'wasm32-wasi',
	backend: 'wasm-llvm-clang',
	unsupported: ['dynamic CALL', 'CALL SYSTEM', 'fork', 'SCREEN SECTION', 'indexed I/O']
} as const;

export type CobolSourceFormat = 'free' | 'fixed';
export type CobolCompileStage = 'bootstrap' | 'translate' | 'compile' | 'link' | 'done';

export interface CobolWorkspaceFile {
	path: string;
	content: string;
}

export interface BrowserCobolCompileProgress {
	stage: CobolCompileStage;
	percent: number;
	message: string;
}

export interface BrowserCobolCompileRequest {
	code: string;
	fileName?: string;
	sourceFormat?: CobolSourceFormat;
	compileArgs?: string[];
	cCompileArgs?: string[];
	workspaceFiles?: CobolWorkspaceFile[];
	log?: boolean;
	onProgress?: (progress: BrowserCobolCompileProgress) => void;
}

export type BrowserCobolArtifact = BrowserClangArtifact & {
	sourceLanguage: 'COBOL';
};

export interface BrowserCobolCompilerResult {
	success: boolean;
	artifact?: BrowserCobolArtifact;
	stdout?: string;
	stderr?: string;
}

export interface BrowserCobolCompiler {
	compile(request: BrowserCobolCompileRequest): Promise<BrowserCobolCompilerResult>;
}

export interface CobolRuntimeManifestV1 {
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
	profile: typeof COBOL_LLVM_PROFILE;
}

export type CobolRuntimeLocation =
	| {
			runtimeBaseUrl: string | URL;
			manifestUrl?: string | URL;
	  }
	| {
			runtimeBaseUrl?: never;
			manifestUrl: string | URL;
	  };

export type CobolClangRuntimeLocation =
	| {
			clangRuntimeBaseUrl: string | URL;
			clangManifestUrl?: string | URL;
	  }
	| {
			clangRuntimeBaseUrl?: never;
			clangManifestUrl: string | URL;
	  };

export type CreateCobolCompilerOptions = CobolRuntimeLocation &
	CobolClangRuntimeLocation & {
		manifest?: CobolRuntimeManifestV1;
		clangManifest?: RuntimeManifestV1;
		fetchImpl?: typeof fetch;
		log?: boolean;
	};

export interface CobolRuntimeAssetUrls {
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
	const resolved = resolveHostedRuntimeUrl(baseUrl, 'wasm-cobol runtime base URL');
	if (!resolved.pathname.endsWith('/')) resolved.pathname += '/';
	resolved.hash = '';
	return resolved;
}

function resolveCobolRuntimeBaseUrlFromManifestUrl(manifestUrl: string | URL) {
	return normalizeBaseUrl(
		new URL('./', resolveHostedRuntimeUrl(manifestUrl, 'wasm-cobol runtime manifest URL'))
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
		throw new Error(`invalid ${label} in wasm-cobol runtime manifest`);
	}
	return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || !value) {
		throw new Error(`invalid ${label} in wasm-cobol runtime manifest`);
	}
	return value;
}

export function parseCobolRuntimeManifest(value: unknown): CobolRuntimeManifestV1 {
	const root = expectObject(value, 'root');
	if (root.manifestVersion !== 1) {
		throw new Error('invalid root.manifestVersion in wasm-cobol runtime manifest');
	}
	const frontend = expectObject(root.frontend, 'root.frontend');
	const rootfs = expectObject(root.rootfs, 'root.rootfs');
	const cSysroot = expectObject(root.cSysroot, 'root.cSysroot');
	const profile = expectObject(root.profile, 'root.profile');
	if (
		profile.name !== COBOL_LLVM_PROFILE.name ||
		profile.version !== COBOL_LLVM_PROFILE.version
	) {
		throw new Error('unsupported root.profile in wasm-cobol runtime manifest');
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
		profile: COBOL_LLVM_PROFILE
	};
}

export function resolveCobolRuntimeManifestUrl(baseUrl: string | URL) {
	return new URL(COBOL_MANIFEST_NAME, normalizeBaseUrl(baseUrl));
}

export function resolveCobolRuntimeAssetUrls(
	baseUrl: string | URL,
	manifest?: CobolRuntimeManifestV1
): CobolRuntimeAssetUrls {
	const normalized = normalizeBaseUrl(baseUrl);
	return {
		manifest: new URL(COBOL_MANIFEST_NAME, normalized).toString(),
		frontend: new URL(manifest?.frontend.asset || 'cobc.zip', normalized).toString(),
		rootfs: new URL(manifest?.rootfs.asset || 'rootfs.tar.zip', normalized).toString(),
		cSysroot: new URL(manifest?.cSysroot.asset || 'c-sysroot.tar.zip', normalized).toString()
	};
}

export async function loadCobolRuntimeManifest(
	manifestUrl: string | URL,
	fetchImpl: typeof fetch = fetch
): Promise<CobolRuntimeManifestV1> {
	const url = resolveHostedRuntimeUrl(manifestUrl, 'wasm-cobol runtime manifest URL');
	const response = await fetchImpl(url.toString());
	if (!response.ok) {
		throw new Error(`failed to load wasm-cobol runtime manifest: ${response.status}`);
	}
	return parseCobolRuntimeManifest(await response.json());
}

function emitProgress(
	request: BrowserCobolCompileRequest,
	stage: CobolCompileStage,
	percent: number,
	message: string
) {
	request.onProgress?.({ stage, percent, message });
}

function addDirectory(runtime: BrowserClangRuntime, path: string) {
	if (!path) return;
	let known = runtimeDirectories.get(runtime);
	if (!known) {
		known = new Set<string>();
		runtimeDirectories.set(runtime, known);
	}
	const parts = normalizeWorkspacePath(path).split('/');
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (known.has(current)) continue;
		try {
			runtime.memfs.addDirectory(current);
		} catch {
			// A previous build may already have created it.
		}
		known.add(current);
	}
}

function addFile(runtime: BrowserClangRuntime, path: string, content: string | Uint8Array) {
	const safePath = normalizeWorkspacePath(path);
	addDirectory(runtime, safePath.split('/').slice(0, -1).join('/'));
	runtime.memfs.addFile(safePath, content);
}

function readTextFile(runtime: BrowserClangRuntime, path: string) {
	return textDecoder.decode(Uint8Array.from(runtime.memfs.getFileContents(path)));
}

function dirname(path: string) {
	return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function joinPath(left: string, right: string) {
	return normalizeWorkspacePath(left ? `${left}/${right}` : right);
}

function collectGeneratedHeaders(runtime: BrowserClangRuntime, cPath: string, cSource: string) {
	const headers: CobolWorkspaceFile[] = [];
	const visited = new Set<string>();
	const visit = (sourcePath: string, source: string) => {
		const sourceDirectory = dirname(sourcePath);
		for (const match of source.matchAll(/^\s*#\s*include\s+"([^"]+)"/gm)) {
			const headerPath = joinPath(sourceDirectory, match[1]);
			if (visited.has(headerPath)) continue;
			visited.add(headerPath);
			const content = readTextFile(runtime, headerPath);
			headers.push({ path: headerPath, content });
			visit(headerPath, content);
		}
	};
	visit(cPath, cSource);
	return headers;
}

function inputName(fileName?: string) {
	const normalized = normalizeWorkspacePath(fileName || 'main.cob');
	if (!normalized) return 'main.cob';
	return /\.[A-Za-z0-9_-]+$/.test(normalized) ? normalized : `${normalized}.cob`;
}

function normalizeTopLevelMainProgramId(code: string) {
	const programId = /(\bPROGRAM-ID\s*\.\s*)(?:(["'])MAIN\2|MAIN)(?=[\s.]|$)/i;
	if (!programId.test(code)) return code;
	return code
		.replace(programId, '$1WASM-IDLE-MAIN')
		.replace(/(\bEND\s+PROGRAM\s+)(?:(["'])MAIN\2|MAIN)(?=[\s.]|$)/gi, '$1WASM-IDLE-MAIN');
}

class CobolCompiler implements BrowserCobolCompiler {
	private readonly runtime: BrowserClangRuntime;
	private readonly frontend: WebAssembly.Module;

	private constructor(runtime: BrowserClangRuntime, frontend: WebAssembly.Module) {
		this.runtime = runtime;
		this.frontend = frontend;
	}

	static async create(options: CreateCobolCompilerOptions) {
		const fetchImpl = options.fetchImpl || fetch;
		const runtimeBaseUrl =
			options.runtimeBaseUrl !== undefined
				? normalizeBaseUrl(options.runtimeBaseUrl).toString()
				: resolveCobolRuntimeBaseUrlFromManifestUrl(options.manifestUrl);
		const manifest =
			options.manifest ||
			(await loadCobolRuntimeManifest(
				options.manifestUrl || resolveCobolRuntimeManifestUrl(runtimeBaseUrl),
				fetchImpl
			));
		const assets = resolveCobolRuntimeAssetUrls(runtimeBaseUrl, manifest);
		const clangRuntimeBaseUrl =
			options.clangRuntimeBaseUrl !== undefined
				? resolveRuntimeBaseUrl(options.clangRuntimeBaseUrl)
				: resolveRuntimeBaseUrlFromManifestUrl(options.clangManifestUrl);
		const clangManifest =
			options.clangManifest ||
			(await loadRuntimeManifest(
				options.clangManifestUrl || resolveRuntimeManifestUrl(clangRuntimeBaseUrl),
				fetchImpl
			));
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
			stdout: () => {}
		});
		const [frontend, rootfs] = await Promise.all([
			compile(assets.frontend),
			readBuffer(assets.rootfs)
		]);
		await runtime.ready;
		untar(rootfs, runtime.memfs);
		addDirectory(runtime, 'tmp');
		return new CobolCompiler(runtime, frontend);
	}

	async compile(request: BrowserCobolCompileRequest): Promise<BrowserCobolCompilerResult> {
		if (!request.code?.trim()) {
			return { success: false, stderr: 'wasm-cobol requires a non-empty source string' };
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
			emitProgress(request, 'bootstrap', 5, 'preparing GnuCOBOL workspace');
			const prefix = `__wasm_cobol_${++buildCounter}`;
			const requestedInput = inputName(request.fileName);
			const sourcePath = `${prefix}/${requestedInput}`;
			const stem = (requestedInput.split('/').pop() || 'main.cob').replace(/\.[^.]+$/, '');
			const cPath = `${prefix}/${stem}.c`;
			const clangStem = `${prefix}_${stem}`;
			const clangCPath = `${clangStem}.c`;
			const objPath = `${clangStem}.o`;
			const linkDirectory = `${prefix}/link`;
			const linkObjPath = `${linkDirectory}/${stem}.o`;
			const wasmPath = `${linkDirectory}/${stem}.wasm`;
			addDirectory(runtime, `${prefix}/tmp`);
			addDirectory(runtime, linkDirectory);
			addFile(runtime, sourcePath, normalizeTopLevelMainProgramId(request.code));
			for (const file of request.workspaceFiles || []) {
				const safePath = normalizeWorkspacePath(file.path);
				if (!safePath || safePath === requestedInput) continue;
				addFile(runtime, `${prefix}/${safePath}`, file.content);
			}

			emitProgress(request, 'translate', 20, 'translating COBOL to C with GnuCOBOL');
			const formatArg = request.sourceFormat === 'fixed' ? '-fixed' : '-free';
			await runtime.runWithOptions(
				this.frontend,
				true,
				[
					'cobc',
					'-x',
					'-C',
					formatArg,
					'-I',
					prefix,
					'-o',
					cPath,
					...(request.compileArgs || []),
					sourcePath
				],
				{
					COB_CONFIG_DIR: 'share/gnucobol/config',
					COB_COPY_DIR: `${prefix}:share/gnucobol/copy`,
					TMPDIR: `${prefix}/tmp`,
					LC_ALL: 'C',
					SOURCE_DATE_EPOCH: '0'
				}
			);

			const generatedCSource = readTextFile(runtime, cPath);
			const translatedHeaders = collectGeneratedHeaders(runtime, cPath, generatedCSource);
			const renamedHeaders = new Map(
				translatedHeaders.map((file) => {
					const fileName = file.path.split('/').pop() || file.path;
					return [fileName, `${prefix}_${fileName}`];
				})
			);
			const rewriteGeneratedIncludes = (source: string) =>
				source.replace(/(#\s*include\s+")([^"]+)(")/g, (match, before, include, after) => {
					const renamed = renamedHeaders.get(include.split('/').pop() || include);
					return renamed ? `${before}${renamed}${after}` : match;
				});
			const cSource = rewriteGeneratedIncludes(generatedCSource);
			const generatedHeaders = translatedHeaders.map((file) => ({
				path: renamedHeaders.get(file.path.split('/').pop() || file.path) ?? file.path,
				content: rewriteGeneratedIncludes(file.content)
			}));
			emitProgress(request, 'compile', 55, 'compiling generated C with llvm-core Clang');
			const cCompilerOutputStart = compilerOutput.length;
			let cCompileError: unknown;
			try {
				await runtime.compile({
					input: clangCPath,
					code: cSource,
					obj: objPath,
					language: 'C',
					cVersion: '17',
					opt: '0',
					workspaceFiles: generatedHeaders,
					compileArgs: [
						'-I',
						'.',
						'-I',
						'include',
						'-D_WASI_EMULATED_SIGNAL',
						'-D_WASI_EMULATED_GETPID',
						...(request.cCompileArgs || [])
					]
				});
			} catch (error) {
				cCompileError = error;
			}
			const objectBytes = Uint8Array.from(runtime.memfs.getFileContents(objPath));
			const cDiagnostics = compilerOutput.slice(cCompilerOutputStart).join('');
			const completeObject =
				objectBytes[0] === 0 &&
				objectBytes[1] === 0x61 &&
				objectBytes[2] === 0x73 &&
				objectBytes[3] === 0x6d;
			const recoveredLateClose =
				completeObject &&
				cDiagnostics.includes('IO failure on output stream: Invalid argument');
			if (cCompileError && !recoveredLateClose) throw cCompileError;
			if (recoveredLateClose) {
				// clang 22 can report a late close error through the legacy memfs after it has
				// emitted a complete relocatable object. wasm-ld remains the final validator.
				compilerOutput.splice(cCompilerOutputStart);
			}
			if (objectBytes.length === 0) {
				throw new Error('wasm-clang did not produce the COBOL object file');
			}
			runtime.memfs.addFile(linkObjPath, objectBytes);

			emitProgress(request, 'link', 80, 'linking libcob and GMP');
			const lld = await runtime.getModule(runtime.assetUrls.lld);
			const compilerRuntimeLibDir =
				runtime.compilerConfig?.compilerRuntimeLibDir || 'lib/clang/8.0.1/lib/wasi';
			await runtime.run(
				lld,
				request.log ?? false,
				'wasm-ld',
				'--export-dynamic',
				'-z',
				'stack-size=1048576',
				'-Llib/wasm32-wasi/noeh',
				'-Llib/wasm32-wasi',
				'lib/wasm32-wasi/crt1.o',
				linkObjPath,
				'lib/libcobwasi.a',
				'lib/libcob.a',
				'lib/libgmp.a',
				'lib/libdl.a',
				'lib/libsetjmp.a',
				'lib/libwasi-emulated-signal.a',
				'lib/libwasi-emulated-getpid.a',
				'-lc',
				'-lm',
				`-L${compilerRuntimeLibDir}`,
				'-lclang_rt.builtins-wasm32',
				'-o',
				wasmPath
			);
			const bytes = Uint8Array.from(runtime.memfs.getFileContents(wasmPath));
			const artifact: BrowserCobolArtifact = {
				bytes,
				wasm: await WebAssembly.compile(bytes),
				target: 'wasm32-wasi',
				format: 'wasi-core-wasm',
				fileName: wasmPath,
				language: 'C',
				sourceLanguage: 'COBOL'
			};
			emitProgress(request, 'done', 100, 'done');
			return { success: true, artifact, stdout: compilerOutput.join('') };
		} catch (error) {
			const output = compilerOutput.join('');
			return {
				success: false,
				stdout: output,
				stderr: output || (error instanceof Error ? error.message : String(error))
			};
		} finally {
			runtime.stdout = originalStdout;
			runtime.memfs.stdout = originalMemfsStdout;
		}
	}
}

export async function createCobolCompiler(
	options: CreateCobolCompilerOptions
): Promise<BrowserCobolCompiler> {
	return CobolCompiler.create(options);
}

export async function compileCobol(
	request: BrowserCobolCompileRequest,
	options: CreateCobolCompilerOptions
) {
	return (await createCobolCompiler(options)).compile(request);
}

export async function preloadBrowserCobolRuntime(options: CreateCobolCompilerOptions) {
	await createCobolCompiler(options);
}

export function executeBrowserCobolArtifact(
	artifact: BrowserCobolArtifact,
	options: BrowserExecutionOptions = {}
) {
	return executeBrowserClangArtifact(artifact, options);
}

export default createCobolCompiler;
