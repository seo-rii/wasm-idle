import { Directory } from '@bjorn3/browser_wasi_shim';
import { resolveRuntimeBaseUrl, resolveVersionedAssetUrl } from './asset-url.js';
import { runEmscriptenLld, type EmscriptenLldAssets } from './emscripten-lld.js';
import { defaultFetch, fetchRuntimeAssetBytes } from './runtime-asset.js';
import { loadRuntimeManifest } from './runtime-manifest.js';
import { parseTar } from './tar.js';
import {
	ensureGuestDirectory,
	readGuestFile,
	runWasiModule,
	writeGuestFile
} from './wasi-guest.js';
import type {
	BrowserDCompiler,
	BrowserDCompileProgress,
	BrowserDCompileRequest,
	BrowserDCompilerResult,
	CompilerDiagnosticSeverity,
	RuntimeManifestV1
} from './types.js';

export interface CreateDCompilerOptions {
	runtimeBaseUrl?: string | URL;
	clangRuntimeBaseUrl?: string | URL;
	manifest?: RuntimeManifestV1;
	fetchImpl?: typeof fetch;
	log?: boolean;
}

function emitProgress(
	request: BrowserDCompileRequest,
	stage: BrowserDCompileProgress['stage'],
	percent: number,
	message: string
) {
	request.onProgress?.({
		stage,
		completed: Math.round(percent),
		total: 100,
		percent,
		message
	});
}

function extractDiagnostics(output: string) {
	const diagnostics = [];
	for (const line of output.split(/\r?\n/)) {
		const match = line.match(/^(.*?):(\d+):(?:(\d+):)?\s*(Error|Deprecation|Warning):\s*(.+)$/);
		if (!match) continue;
		const severity: CompilerDiagnosticSeverity =
			match[4] === 'Warning' || match[4] === 'Deprecation' ? 'warning' : 'error';
		diagnostics.push({
			fileName: match[1] || undefined,
			lineNumber: Number(match[2]),
			columnNumber: match[3] ? Number(match[3]) : undefined,
			severity,
			message: match[5]
		});
	}
	return diagnostics;
}

function defaultSourceFileName(fileName?: string) {
	const normalized = fileName?.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'main.d';
	return normalized.endsWith('.d') ? normalized : `${normalized}.d`;
}

function basenameWithoutExtension(fileName: string) {
	const base = fileName.split('/').at(-1) || fileName;
	return base.replace(/\.[^.]+$/, '') || 'main';
}

function addToolchainEntries(root: Directory, entries: ReturnType<typeof parseTar>) {
	ensureGuestDirectory(root, '/toolchain');
	for (const entry of entries) {
		const guestPath = `/toolchain/${entry.path}`;
		if (entry.type === 'directory') {
			ensureGuestDirectory(root, guestPath);
			continue;
		}
		writeGuestFile(root, guestPath, entry.bytes, true);
	}
}

function collectLinkerFiles(entries: ReturnType<typeof parseTar>) {
	const files = new Map<string, Uint8Array>();
	for (const entry of entries) {
		if (entry.type !== 'file') continue;
		if (!entry.path.startsWith('lib/')) continue;
		files.set(entry.path, entry.bytes);
	}
	return files;
}

function resultFromFailure(message: string, stdout = '', stderr = message): BrowserDCompilerResult {
	return {
		success: false,
		stdout,
		stderr,
		diagnostics: extractDiagnostics(`${stderr}\n${stdout}`)
	};
}

async function resolveManifest(options: CreateDCompilerOptions, request: BrowserDCompileRequest) {
	const fetchImpl = options.fetchImpl || defaultFetch;
	if (options.manifest) return options.manifest;
	emitProgress(request, 'manifest', 0, 'loading D runtime manifest');
	return await loadRuntimeManifest(options.runtimeBaseUrl, fetchImpl, (loaded, total) => {
		const fraction = total && total > 0 ? loaded / total : loaded > 0 ? 1 : 0;
		emitProgress(request, 'manifest', Math.min(8, fraction * 8), 'loading D runtime manifest');
	});
}

async function loadRuntimeAssets(
	manifest: RuntimeManifestV1,
	options: CreateDCompilerOptions,
	request: BrowserDCompileRequest
) {
	const fetchImpl = options.fetchImpl || defaultFetch;
	const runtimeBaseUrl = resolveRuntimeBaseUrl(options.runtimeBaseUrl);
	let lastAssetsPercent = 8;
	const report = (loaded: number, total?: number) => {
		const fraction = total && total > 0 ? loaded / total : loaded > 0 ? 1 : 0;
		lastAssetsPercent = Math.max(lastAssetsPercent, 8 + fraction * 17);
		emitProgress(request, 'assets', lastAssetsPercent, 'loading D compiler assets');
	};
	const linker = manifest.compiler.linker;
	const [ldc2Bytes, toolchainTarBytes, linkerWasmBytes, linkerDataBytes] = await Promise.all([
		fetchRuntimeAssetBytes(
			resolveVersionedAssetUrl(runtimeBaseUrl, manifest.compiler.ldc2.asset),
			'ldc2.wasm',
			fetchImpl,
			report,
			manifest.compiler.ldc2.compression
		),
		fetchRuntimeAssetBytes(
			resolveVersionedAssetUrl(runtimeBaseUrl, manifest.compiler.toolchain.asset),
			'D toolchain',
			fetchImpl,
			report,
			manifest.compiler.toolchain.compression
		),
		fetchRuntimeAssetBytes(
			resolveVersionedAssetUrl(runtimeBaseUrl, linker.wasm.asset),
			'wasm-ld.wasm',
			fetchImpl,
			report,
			linker.wasm.compression
		),
		fetchRuntimeAssetBytes(
			resolveVersionedAssetUrl(runtimeBaseUrl, linker.data.asset),
			'wasm-ld.data',
			fetchImpl,
			report,
			linker.data.compression
		)
	]);
	emitProgress(request, 'assets', 25, 'D compiler assets loaded');
	return {
		ldc2Bytes,
		toolchainEntries: parseTar(toolchainTarBytes),
		linkerAssets: {
			jsUrl: resolveVersionedAssetUrl(runtimeBaseUrl, linker.js.asset),
			wasmBytes: linkerWasmBytes,
			dataBytes: linkerDataBytes
		} satisfies EmscriptenLldAssets
	};
}

async function compileDObject(
	ldc2Bytes: Uint8Array,
	root: Directory,
	request: BrowserDCompileRequest,
	fileName: string,
	objectFileName: string,
	options: CreateDCompilerOptions
) {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const compileResult = await runWasiModule(ldc2Bytes, {
		root,
		programName: 'ldc2',
		args: [
			'-conf=/toolchain/etc/ldc2.conf',
			'-mtriple=wasm32-wasi',
			'-c',
			`/work/${fileName}`,
			`-of=/work/${objectFileName}`,
			...(request.compileArgs || [])
		],
		stdout: (chunk) => stdout.push(chunk),
		stderr: (chunk) => stderr.push(chunk),
		env: {
			HOME: '/',
			PWD: '/'
		}
	});
	if (options.log || request.log) {
		console.debug('[wasm-d] ldc2 exit', compileResult.exitCode);
	}
	return {
		...compileResult,
		stdout: stdout.join('') || compileResult.stdout,
		stderr: stderr.join('') || compileResult.stderr
	};
}

async function linkDArtifact(
	objectBytes: Uint8Array,
	linkerFiles: Map<string, Uint8Array>,
	linkerAssets: EmscriptenLldAssets,
	request: BrowserDCompileRequest,
	options: CreateDCompilerOptions,
	wasmFileName: string
) {
	const linkerOutput: string[] = [];
	const files = new Map<string, Uint8Array>([['/main.o', objectBytes]]);
	for (const [filePath, bytes] of linkerFiles) {
		files.set(`/d-toolchain/${filePath}`, bytes);
	}
	const linked = await runEmscriptenLld(
		[
			'--gc-sections',
			'--stack-first',
			'-z',
			'stack-size=1048576',
			'-o',
			`/${wasmFileName}`,
			'/lib/wasm32-wasi/crt1-command.o',
			'/main.o',
			'-L/lib/wasm32-wasi',
			'/d-toolchain/lib/libphobos2-ldc.a',
			'/d-toolchain/lib/libdruntime-ldc.a',
			'/d-toolchain/lib/eh/libunwind.a',
			'-lwasi-emulated-mman',
			'-lwasi-emulated-signal',
			'-lwasi-emulated-process-clocks',
			'-lwasi-emulated-getpid',
			'-lc',
			'-lm',
			'/lib/clang/16.0.4/lib/wasi/libclang_rt.builtins-wasm32.a',
			...(request.linkArgs || [])
		],
		files,
		`/${wasmFileName}`,
		linkerAssets,
		{
			stdout: (chunk) => linkerOutput.push(chunk),
			stderr: (chunk) => linkerOutput.push(chunk)
		}
	);
	if (linked.exitCode !== 0 || !linked.output) {
		throw new Error(
			linked.stderr || linked.stdout || `wasm-ld exited with code ${linked.exitCode}`
		);
	}
	return {
		bytes: linked.output,
		output: linkerOutput.join('') || linked.stdout || linked.stderr
	};
}

export async function compileD(
	request: BrowserDCompileRequest,
	options: CreateDCompilerOptions = {}
): Promise<BrowserDCompilerResult> {
	if (!request.code || typeof request.code !== 'string') {
		return {
			success: false,
			stderr: 'wasm-d requires a non-empty D source string'
		};
	}
	if (request.target && request.target !== 'wasm32-wasi') {
		return {
			success: false,
			stderr: `unsupported wasm-d target: ${request.target}`
		};
	}
	const fileName = defaultSourceFileName(request.fileName);
	const stem = basenameWithoutExtension(fileName);
	const objectFileName = `${stem}.o`;
	const wasmFileName = `${stem}.wasm`;
	try {
		const manifest = await resolveManifest(options, request);
		const { ldc2Bytes, toolchainEntries, linkerAssets } = await loadRuntimeAssets(
			manifest,
			options,
			request
		);
		const root = new Directory(new Map());
		ensureGuestDirectory(root, '/work');
		addToolchainEntries(root, toolchainEntries);
		writeGuestFile(root, `/work/${fileName}`, request.code);
		emitProgress(request, 'compile', 30, 'compiling D source');
		const compileResult = await compileDObject(
			ldc2Bytes,
			root,
			request,
			fileName,
			objectFileName,
			options
		);
		if (compileResult.exitCode !== 0) {
			return resultFromFailure(
				compileResult.stderr ||
					compileResult.stdout ||
					`ldc2 exited with code ${compileResult.exitCode}`,
				compileResult.stdout,
				compileResult.stderr
			);
		}
		const objectBytes = readGuestFile(root, `/work/${objectFileName}`);
		if (!objectBytes) {
			return resultFromFailure(
				`ldc2 did not emit /work/${objectFileName}`,
				compileResult.stdout,
				compileResult.stderr
			);
		}
		emitProgress(request, 'link', 55, 'linking D wasm');
		const linked = await linkDArtifact(
			objectBytes,
			collectLinkerFiles(toolchainEntries),
			linkerAssets,
			request,
			options,
			wasmFileName
		);
		const linkedBuffer = linked.bytes.buffer.slice(
			linked.bytes.byteOffset,
			linked.bytes.byteOffset + linked.bytes.byteLength
		) as ArrayBuffer;
		const wasm = await WebAssembly.compile(linkedBuffer);
		emitProgress(request, 'done', 100, 'done');
		return {
			success: true,
			stdout: compileResult.stdout || linked.output,
			stderr: compileResult.stderr,
			artifact: {
				bytes: linked.bytes,
				wasm,
				target: 'wasm32-wasi',
				format: 'wasi-core-wasm',
				fileName: wasmFileName
			}
		};
	} catch (error) {
		return resultFromFailure(error instanceof Error ? error.message : String(error));
	}
}

export async function createDCompiler(
	options: CreateDCompilerOptions = {}
): Promise<BrowserDCompiler> {
	return {
		compile: (request) => compileD(request, options)
	};
}
