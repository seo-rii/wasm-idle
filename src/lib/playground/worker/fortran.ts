import { WASI } from '@bjorn3/browser_wasi_shim';
import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import {
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage,
	type WorkerRuntimeAssetConfig
} from '$lib/playground/worker/assets';
import type {
	BrowserClangArtifact,
	BrowserClangRuntime as Clang
} from '@seo-rii/wasm-llvm/runtime/clang';
import {
	BrowserClangRuntime,
	createBrowserWasiHost,
	executeBrowserClangArtifact,
	loadRuntimeManifest,
	resolveRuntimeManifestUrl
} from '@seo-rii/wasm-llvm/runtime/clang';

declare var self: any;
self.document = {
	querySelectorAll() {
		return [];
	}
};

interface FortranWorkerAssetConfig {
	f2cWasmUrl: string;
	libf2cUrl: string;
	f2cHeaderUrl: string;
}

const textDecoder = new TextDecoder();

const F2C_COMPAT_SOURCE = `#include <stdarg.h>
#include <stdio.h>

typedef void (*sighandler_t)(int);

int fiprintf(FILE *stream, const char *format, ...) {
    va_list ap;
    va_start(ap, format);
    int result = vfprintf(stream, format, ap);
    va_end(ap);
    return result;
}

int siprintf(char *str, const char *format, ...) {
    va_list ap;
    va_start(ap, format);
    int result = vsprintf(str, format, ap);
    va_end(ap);
    return result;
}

int __small_sprintf(char *str, const char *format, ...) {
    va_list ap;
    va_start(ap, format);
    int result = vsprintf(str, format, ap);
    va_end(ap);
    return result;
}

sighandler_t signal(int signum, sighandler_t handler) {
    (void)signum;
    return handler;
}

FILE *tmpfile(void) {
    return NULL;
}
`;

let stdinBufferFortran: Int32Array | null = null;
let clang: Clang | null = null;
let f2cModule: WebAssembly.Module | null = null;
let hasInitialStdinFortran = false;
let initialStdinFortran: string | null = null;
let initialStdinConsumedFortran = false;

const normalizeWorkspacePath = (value: string) =>
	value
		.replaceAll('\\', '/')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..')
		.join('/');

const basename = (value: string) => value.split('/').pop() || value;

const stemOf = (value: string) => basename(value).replace(/\.[^.]+$/, '') || 'main';

const ensureTrailingNewline = (source: string) => (source.endsWith('\n') ? source : `${source}\n`);

const resolveInputPath = (activePath?: string) => {
	const normalized = normalizeWorkspacePath(activePath || '');
	if (!normalized) return 'main.f';
	return /\.[A-Za-z0-9_-]+$/.test(normalized) ? normalized : `${normalized}.f`;
};

async function fetchBytes(url: string, label: string) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to load ${label}: ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}

async function fetchText(url: string, label: string) {
	return textDecoder.decode(await fetchBytes(url, label));
}

async function loadFortranRuntime(
	clangAssets: WorkerRuntimeAssetConfig | undefined,
	fortranAssets: FortranWorkerAssetConfig,
	log: boolean
) {
	configureWorkerRuntimeAssets(clangAssets || null);
	const clangBaseUrl = clangAssets?.baseUrl || '';
	const manifest = await loadRuntimeManifest(resolveRuntimeManifestUrl(clangBaseUrl));
	clang = new BrowserClangRuntime({
		stdout: (output) => postMessage({ output }),
		stdin: () => '',
		progress: (value) => postMessage({ progress: value }),
		log,
		runtimeBaseUrl: clangBaseUrl,
		manifest
	});

	const [f2cWasmBytes, libf2cBytes, f2cHeader] = await Promise.all([
		fetchBytes(fortranAssets.f2cWasmUrl, 'f2c.wasm'),
		fetchBytes(fortranAssets.libf2cUrl, 'libf2c.a'),
		fetchText(fortranAssets.f2cHeaderUrl, 'f2c.h')
	]);
	f2cModule = await WebAssembly.compile(f2cWasmBytes);
	await clang.ready;
	clang.memfs.addFile('f2c.h', f2cHeader);
	clang.memfs.addFile('libf2c.a', libf2cBytes);
}

function readProgramStdin() {
	if (hasInitialStdinFortran) {
		if (initialStdinConsumedFortran) return null;
		initialStdinConsumedFortran = true;
		return initialStdinFortran ?? '';
	}
	return waitForBufferedStdin(stdinBufferFortran, () => postMessage({ buffer: true }));
}

function workspaceFilesForF2c(
	code: string,
	inputPath: string,
	workspaceFiles: SandboxWorkspaceFile[] = []
) {
	const fileMap = new Map<string, string>();
	for (const file of workspaceFiles) {
		const safePath = normalizeWorkspacePath(file.path);
		if (safePath) fileMap.set(safePath, file.content);
	}
	fileMap.set(inputPath, ensureTrailingNewline(code));
	return Array.from(fileMap, ([path, contents]) => ({ path, contents }));
}

function readHostFileBytes(host: ReturnType<typeof createBrowserWasiHost>, path: string) {
	const segments = normalizeWorkspacePath(path).split('/').filter(Boolean);
	let node: any = host.rootDirectory;
	for (const segment of segments) {
		node = node?.contents?.get(segment);
		if (!node) return null;
	}
	const data = node?.data;
	if (data instanceof Uint8Array) return new Uint8Array(data);
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	return null;
}

function findFirstGeneratedCFile(directory: any, prefix = ''): Uint8Array | null {
	for (const [name, node] of directory.contents || []) {
		const nextPath = prefix ? `${prefix}/${name}` : name;
		if (node?.contents) {
			const nested = findFirstGeneratedCFile(node, nextPath);
			if (nested) return nested;
			continue;
		}
		if (nextPath.endsWith('.c') && node?.data instanceof Uint8Array) {
			return new Uint8Array(node.data);
		}
	}
	return null;
}

async function translateFortranToC(
	code: string,
	activePath: string | undefined,
	workspaceFiles: SandboxWorkspaceFile[]
) {
	if (!f2cModule) throw new Error('Fortran runtime is not loaded.');
	const inputPath = resolveInputPath(activePath);
	const outputPath = `${stemOf(inputPath)}.c`;
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	const host = createBrowserWasiHost({
		args: [inputPath],
		env: { TMPDIR: '/tmp' },
		files: workspaceFilesForF2c(code, inputPath, workspaceFiles),
		programName: 'f2c.wasm',
		stdout: (chunk) => stdoutChunks.push(chunk),
		stderr: (chunk) => stderrChunks.push(chunk)
	});
	const wasiInstance = new WASI(host.args, host.envEntries, host.fds, { debug: false });
	const instance = (await WebAssembly.instantiate(f2cModule, {
		wasi_snapshot_preview1: wasiInstance.wasiImport,
		wasi_unstable: wasiInstance.wasiImport
	})) as WebAssembly.Instance;
	const exitCode = wasiInstance.start(
		instance as unknown as {
			exports: {
				memory: WebAssembly.Memory;
				_start: () => unknown;
			};
		}
	);
	const stdout = stdoutChunks.join('');
	const stderr = stderrChunks.join('');
	if (exitCode) {
		throw new Error(`f2c exited with ${exitCode}${stderr ? `\n${stderr}` : ''}`);
	}
	const generated =
		readHostFileBytes(host, outputPath) || findFirstGeneratedCFile(host.rootDirectory);
	if (!generated) {
		throw new Error(
			`f2c did not produce ${outputPath}${stderr || stdout ? `\n${stderr}${stdout}` : ''}`
		);
	}
	return {
		cPath: outputPath,
		cSource: textDecoder.decode(generated)
	};
}

async function compileAndLinkFortran(cPath: string, cSource: string, compileArgs: string[] = []) {
	if (!clang) throw new Error('Fortran clang backend is not loaded.');
	const mainObj = `${stemOf(cPath)}.o`;
	const compatObj = 'f2c_compat.o';
	const wasmPath = `${stemOf(cPath)}.wasm`;
	await clang.compile({
		input: cPath,
		code: cSource,
		obj: mainObj,
		language: 'C',
		compileArgs: ['-I.', '-w', ...compileArgs]
	});
	await clang.compile({
		input: 'f2c_compat.c',
		code: F2C_COMPAT_SOURCE,
		obj: compatObj,
		language: 'C',
		compileArgs: ['-w']
	});

	const stackSize = 1024 * 1024;
	const libdir = 'lib/wasm32-wasi';
	const compilerRuntimeLibDir =
		(clang as any).compilerConfig?.compilerRuntimeLibDir || 'lib/clang/8.0.1/lib/wasi';
	const lld = await clang.getModule(clang.assetUrls.lld);
	await clang.run(
		lld,
		clang.log,
		'wasm-ld',
		'--export-dynamic',
		'-z',
		`stack-size=${stackSize}`,
		`-L${libdir}/noeh`,
		`-L${libdir}`,
		`${libdir}/crt1.o`,
		mainObj,
		compatObj,
		'libf2c.a',
		'-lc',
		'-lm',
		`-L${compilerRuntimeLibDir}`,
		'-lclang_rt.builtins-wasm32',
		'-o',
		wasmPath
	);
	const bytes = Uint8Array.from(clang.memfs.getFileContents(wasmPath));
	const wasm = await WebAssembly.compile(bytes);
	return {
		bytes,
		wasm,
		target: 'wasm32-wasi',
		format: 'wasi-core-wasm',
		fileName: wasmPath,
		language: 'C'
	} satisfies BrowserClangArtifact;
}

self.onmessage = async (event: { data: any }) => {
	if (handleWorkerAssetMessage(event.data)) return;
	const {
		code,
		buffer,
		load,
		log,
		prepare,
		compileArgs,
		programArgs,
		activePath,
		workspaceFiles,
		stdin,
		clangAssets,
		fortranAssets
	} = event.data;
	if (load) {
		try {
			await loadFortranRuntime(clangAssets, fortranAssets, log);
			postMessage({ load: true });
		} catch (error: any) {
			postMessage({ error: error.message });
		}
	} else if (typeof log === 'boolean' && !code) {
		if (clang) clang.log = log;
	} else if (code) {
		if (!clang) {
			postMessage({ error: 'Fortran runtime is not loaded.' });
			return;
		}
		clang.log = log;
		stdinBufferFortran = new Int32Array(buffer);
		hasInitialStdinFortran = typeof stdin === 'string';
		initialStdinFortran = hasInitialStdinFortran ? stdin : null;
		initialStdinConsumedFortran = false;

		try {
			const translated = await translateFortranToC(code, activePath, workspaceFiles || []);
			const artifact = await compileAndLinkFortran(
				translated.cPath,
				translated.cSource,
				compileArgs || []
			);
			if (!prepare) {
				const result = await executeBrowserClangArtifact(artifact, {
					args: programArgs || [],
					stdin: readProgramStdin,
					stdout: (output) => postMessage({ output }),
					stderr: (output) => postMessage({ output })
				});
				if (result.exitCode) {
					throw new Error(`Fortran program exited with ${result.exitCode}`);
				}
			}
			postMessage({ results: true });
		} catch (error: any) {
			postMessage({ error: error.message });
		}
	}
};
