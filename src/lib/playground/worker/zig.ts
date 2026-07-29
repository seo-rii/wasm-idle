import {
	ConsoleStdout,
	Directory,
	Fd,
	File,
	OpenFile,
	PreopenDirectory,
	WASI,
	wasi
} from '@bjorn3/browser_wasi_shim';
import { decompressGzip, untar } from '@wasm-idle/llvm-core';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile, ZigTargetTriple } from '$lib/playground/options';
import { fetchRuntimeAssetBytes } from './runtimeAssetFetch';

declare var self: any;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_ZIG_STDLIB_MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
const DEFAULT_ZIG_STDLIB_MAX_FILES = 4096;
const DEFAULT_ZIP_FILE_BUFFER_BYTES = 64 * 1024;

interface ZigStdlibArchiveLimits {
	maxExpandedBytes?: number;
	maxFiles?: number;
}

let stdinBufferZig: Int32Array | null = null;
let stdinChunkZig = new Uint8Array(0);
let stdinChunkOffsetZig = 0;
let compilerUrl = '';
let stdlibUrl = '';
let loadedAssetKey = '';
let assetsPromise: Promise<{
	compilerModule: WebAssembly.Module;
	stdDirectory: Directory;
}> | null = null;
let compiledArtifact: Uint8Array | null = null;
let compiledCacheKey = '';

class ZigStdin extends Fd {
	private initialStdin: string | null;
	private readonly hasInitialStdin: boolean;
	private readonly log: boolean;

	constructor(initialStdin: string | undefined, log: boolean) {
		super();
		this.initialStdin = typeof initialStdin === 'string' ? initialStdin : null;
		this.hasInitialStdin = typeof initialStdin === 'string';
		this.log = log;
	}

	fd_fdstat_get() {
		const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
		fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_READ);
		fdstat.fs_rights_inherited = 0n;
		return { ret: wasi.ERRNO_SUCCESS, fdstat };
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: new wasi.Filestat(0n, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
		};
	}

	fd_read(size: number) {
		if (stdinChunkOffsetZig >= stdinChunkZig.length) {
			const nextChunk = this.readNextChunk();
			if (nextChunk === null) {
				stdinChunkZig = new Uint8Array(0);
				stdinChunkOffsetZig = 0;
				return {
					ret: wasi.ERRNO_SUCCESS,
					data: new Uint8Array(0)
				};
			}
			stdinChunkZig = encoder.encode(nextChunk);
			stdinChunkOffsetZig = 0;
		}

		const end = Math.min(stdinChunkOffsetZig + size, stdinChunkZig.length);
		const data = stdinChunkZig.slice(stdinChunkOffsetZig, end);
		stdinChunkOffsetZig = end;
		return {
			ret: wasi.ERRNO_SUCCESS,
			data
		};
	}

	private readNextChunk() {
		if (this.hasInitialStdin) {
			const chunk = this.initialStdin;
			this.initialStdin = null;
			this.logRead(chunk);
			return chunk;
		}

		if (stdinBufferZig === null) {
			this.logRead(null);
			return null;
		}

		const chunk = waitForBufferedStdin(stdinBufferZig, () => postMessage({ buffer: true }));
		this.logRead(chunk);
		return chunk;
	}

	private logRead(chunk: string | null) {
		if (!this.log) return;
		if (chunk === null) {
			console.log('[wasm-idle:zig-stdin] fd_read(bytes=0, eof=true)');
			return;
		}
		console.log(
			`[wasm-idle:zig-stdin] fd_read(bytes=${encoder.encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
		);
	}
}

function normalizeWorkspacePath(value: string, fallback = 'main.zig') {
	const normalized = value
		.trim()
		.replaceAll('\\', '/')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..')
		.join('/');
	return normalized || fallback;
}

function addFileToDirectory(root: Directory, filePath: string, data: Uint8Array) {
	const parts = normalizeWorkspacePath(filePath).split('/').filter(Boolean);
	let current = root;
	for (const part of parts.slice(0, -1)) {
		const next = current.contents.get(part);
		if (next instanceof Directory) {
			current = next;
			continue;
		}
		const directory = new Directory(new Map());
		current.contents.set(part, directory);
		current = directory;
	}
	current.contents.set(parts.at(-1) || 'main.zig', new File(data));
}

function getFile(root: Directory, filePath: string) {
	const parts = normalizeWorkspacePath(filePath).split('/').filter(Boolean);
	let current: Directory | File = root;
	for (const part of parts) {
		if (!(current instanceof Directory)) return null;
		const next = current.contents.get(part);
		if (!(next instanceof Directory) && !(next instanceof File)) return null;
		current = next;
	}
	return current instanceof File ? current : null;
}

function buildWorkspaceRoot(
	code: string,
	activePath: string,
	workspaceFiles: SandboxWorkspaceFile[]
) {
	const root = new Directory(new Map());
	const entryPath = normalizeWorkspacePath(activePath || 'main.zig');
	for (const file of workspaceFiles) {
		if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') continue;
		addFileToDirectory(
			root,
			file.path,
			encoder.encode(file.path === activePath ? code : file.content)
		);
	}
	addFileToDirectory(root, entryPath, encoder.encode(code));
	return { root, entryPath };
}

async function fetchBytes(url: string, label: string, progressStart: number, progressEnd: number) {
	const data = await fetchRuntimeAssetBytes({
		url,
		label,
		onProgress: ({ loaded, total }) => {
			if (total && total > 0) {
				postProgress(progressStart + ((progressEnd - progressStart) * loaded) / total);
			}
		}
	});
	postProgress(progressEnd);
	return data;
}

class ZigStdlibArchiveBudget {
	private declaredBytes = 0;
	private expandedBytes = 0;
	private fileCount = 0;
	private readonly entries = new Map<string, 'directory' | 'file'>();

	constructor(
		private readonly maxExpandedBytes: number,
		private readonly maxFiles: number
	) {}

	addDirectory(path: string) {
		const normalized = this.normalizePath(path, true);
		const parts = normalized.split('/');
		for (let index = 1; index <= parts.length; index += 1) {
			const directoryPath = parts.slice(0, index).join('/');
			if (this.entries.get(directoryPath) === 'file') {
				throw new Error(`Zig standard library archive path collision: ${normalized}`);
			}
			this.entries.set(directoryPath, 'directory');
		}
	}

	startFile(path: string, declaredBytes?: number) {
		const normalized = this.normalizePath(path, false);
		if (this.entries.has(normalized)) {
			throw new Error(`Zig standard library archive repeats path: ${normalized}`);
		}
		const parts = normalized.split('/');
		for (let index = 1; index < parts.length; index += 1) {
			const parent = parts.slice(0, index).join('/');
			if (this.entries.get(parent) === 'file') {
				throw new Error(`Zig standard library archive path collision: ${normalized}`);
			}
		}
		const nextFileCount = this.fileCount + 1;
		if (nextFileCount > this.maxFiles) {
			throw new Error(`Zig standard library archive exceeds the ${this.maxFiles} file limit`);
		}
		if (
			declaredBytes !== undefined &&
			(!Number.isSafeInteger(declaredBytes) || declaredBytes < 0)
		) {
			throw new Error(`Zig standard library archive has an invalid size for ${normalized}`);
		}
		const nextDeclaredBytes = this.declaredBytes + (declaredBytes ?? 0);
		if (nextDeclaredBytes > this.maxExpandedBytes) {
			throw new Error(
				`Zig standard library archive exceeds the ${this.maxExpandedBytes} byte expanded-size limit`
			);
		}
		for (let index = 1; index < parts.length; index += 1) {
			const parent = parts.slice(0, index).join('/');
			if (!this.entries.has(parent)) this.entries.set(parent, 'directory');
		}
		this.entries.set(normalized, 'file');
		this.fileCount = nextFileCount;
		this.declaredBytes = nextDeclaredBytes;
		return normalized;
	}

	addExpandedBytes(byteLength: number) {
		const nextExpandedBytes = this.expandedBytes + byteLength;
		if (nextExpandedBytes > this.maxExpandedBytes) {
			throw new Error(
				`Zig standard library archive exceeds the ${this.maxExpandedBytes} byte expanded-size limit`
			);
		}
		this.expandedBytes = nextExpandedBytes;
	}

	private normalizePath(path: string, directory: boolean) {
		const candidate = directory ? path.replace(/\/+$/u, '') : path;
		if (
			!candidate ||
			candidate.includes('\\') ||
			candidate.includes('\0') ||
			candidate.startsWith('/') ||
			/%2f|%5c/iu.test(candidate)
		) {
			throw new Error(`Zig standard library archive has an unsafe path: ${path}`);
		}
		const parts = candidate.split('/');
		if (parts.some((part) => !part || part === '.' || part === '..')) {
			throw new Error(`Zig standard library archive has an unsafe path: ${path}`);
		}
		const normalized = parts.join('/');
		if (normalized !== 'std' && !normalized.startsWith('std/')) {
			throw new Error(`Zig standard library archive path is outside std/: ${path}`);
		}
		if (!directory && normalized === 'std') {
			throw new Error(`Zig standard library archive has an unsafe file path: ${path}`);
		}
		return normalized;
	}
}

export async function loadStdDirectory(
	source: Uint8Array,
	assetUrl: string,
	limits: ZigStdlibArchiveLimits = {}
) {
	const maxExpandedBytes = limits.maxExpandedBytes ?? DEFAULT_ZIG_STDLIB_MAX_EXPANDED_BYTES;
	const maxFiles = limits.maxFiles ?? DEFAULT_ZIG_STDLIB_MAX_FILES;
	if (!Number.isSafeInteger(maxExpandedBytes) || maxExpandedBytes <= 0) {
		throw new TypeError(
			'Zig standard library maxExpandedBytes must be a positive safe integer'
		);
	}
	if (!Number.isSafeInteger(maxFiles) || maxFiles <= 0) {
		throw new TypeError('Zig standard library maxFiles must be a positive safe integer');
	}
	const root = new Directory(new Map());
	const budget = new ZigStdlibArchiveBudget(maxExpandedBytes, maxFiles);
	if (source.byteLength >= 2 && source[0] === 0x50 && source[1] === 0x4b) {
		const { Unzip, UnzipInflate } = await import('fflate');
		let archiveError: unknown;
		const unzip = new Unzip((file) => {
			const stopFile = (error: unknown) => {
				archiveError ??= error;
				try {
					file.terminate();
				} catch {
					// Preserve the archive validation or decompression error.
				}
			};
			if (archiveError) {
				stopFile(archiveError);
				return;
			}
			if (file.name.endsWith('/')) {
				try {
					budget.addDirectory(file.name);
				} catch (error) {
					stopFile(error);
				}
				return;
			}
			let normalizedPath: string;
			try {
				normalizedPath = budget.startFile(file.name, file.originalSize);
			} catch (error) {
				stopFile(error);
				return;
			}
			let contents = new Uint8Array(
				Math.min(
					maxExpandedBytes,
					file.originalSize ?? DEFAULT_ZIP_FILE_BUFFER_BYTES,
					DEFAULT_ZIP_FILE_BUFFER_BYTES
				)
			);
			let length = 0;
			file.ondata = (error, data, final) => {
				if (error) {
					stopFile(error);
					return;
				}
				if (archiveError) return;
				const nextLength = length + data.byteLength;
				try {
					budget.addExpandedBytes(data.byteLength);
				} catch (budgetError) {
					stopFile(budgetError);
					return;
				}
				if (nextLength > contents.byteLength) {
					const nextCapacity = Math.min(
						maxExpandedBytes,
						Math.max(nextLength, Math.max(1, contents.byteLength * 2))
					);
					const grown = new Uint8Array(nextCapacity);
					grown.set(contents.subarray(0, length));
					contents = grown;
				}
				contents.set(data, length);
				length = nextLength;
				if (!final) return;
				if (file.originalSize !== undefined && length !== file.originalSize) {
					stopFile(
						new Error(
							`Zig standard library archive size mismatch for ${normalizedPath}: expected ${file.originalSize}, received ${length}`
						)
					);
					return;
				}
				addFileToDirectory(root, normalizedPath, contents.slice(0, length));
			};
			file.start();
		});
		unzip.register(UnzipInflate);
		unzip.push(source, true);
		if (archiveError) throw archiveError;
	} else {
		untar(await decompressGzip(source, assetUrl, maxExpandedBytes), {
			addDirectory(directoryPath) {
				budget.addDirectory(directoryPath);
			},
			addFile(filePath, contents) {
				const normalizedPath = budget.startFile(filePath, contents.byteLength);
				budget.addExpandedBytes(contents.byteLength);
				addFileToDirectory(root, normalizedPath, contents);
			}
		});
	}
	const stdDirectory = root.contents.get('std');
	if (!(stdDirectory instanceof Directory)) {
		throw new Error('Zig standard library archive must contain a std/ directory.');
	}
	return stdDirectory;
}

function postProgress(percent: number) {
	postMessage({ progress: { percent: Math.max(0, Math.min(100, percent)) } });
}

async function loadAssets(nextCompilerUrl: string, nextStdlibUrl: string) {
	if (!nextCompilerUrl || !nextStdlibUrl) {
		throw new Error(
			'Zig runtime is not configured. Set PUBLIC_WASM_ZIG_COMPILER_URL and PUBLIC_WASM_ZIG_STDLIB_URL, or runtimeAssets.zig.compilerUrl and runtimeAssets.zig.stdlibUrl.'
		);
	}
	const nextAssetKey = `${nextCompilerUrl}\n${nextStdlibUrl}`;
	if (loadedAssetKey === nextAssetKey && assetsPromise) {
		return await assetsPromise;
	}
	loadedAssetKey = nextAssetKey;
	compiledArtifact = null;
	compiledCacheKey = '';
	assetsPromise = (async () => {
		postProgress(5);
		const [compilerBytes, stdlibBytes] = await Promise.all([
			fetchBytes(nextCompilerUrl, 'zig compiler', 5, 45),
			fetchBytes(nextStdlibUrl, 'zig standard library', 45, 70)
		]);
		const [compilerModule, stdDirectory] = await Promise.all([
			WebAssembly.compile(compilerBytes),
			loadStdDirectory(stdlibBytes, nextStdlibUrl)
		]);
		postProgress(100);
		return { compilerModule, stdDirectory };
	})();
	return await assetsPromise;
}

function instantiateResult(
	result: WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource
) {
	return result instanceof WebAssembly.Instance ? result : result.instance;
}

async function compileZig({
	code,
	activePath,
	workspaceFiles,
	targetTriple,
	compileArgs,
	log
}: {
	code: string;
	activePath: string;
	workspaceFiles: SandboxWorkspaceFile[];
	targetTriple: ZigTargetTriple;
	compileArgs: string[];
	log: boolean;
}) {
	const { compilerModule, stdDirectory } = await loadAssets(compilerUrl, stdlibUrl);
	const { root, entryPath } = buildWorkspaceRoot(code, activePath, workspaceFiles);
	let compilerOutput = '';
	const outputFd = new ConsoleStdout((chunk) => {
		compilerOutput += decoder.decode(chunk, { stream: true });
	});
	const errorFd = new ConsoleStdout((chunk) => {
		compilerOutput += decoder.decode(chunk, { stream: true });
	});
	const args = [
		'zigc.wasm',
		'build-exe',
		entryPath,
		`-Dtarget=${targetTriple}`,
		'-fno-llvm',
		'-fno-lld',
		'-O',
		'ReleaseSmall',
		'-femit-bin=output.wasm',
		...compileArgs
	];
	const zigWasi = new WASI(
		args,
		[],
		[
			new OpenFile(new File([])),
			outputFd,
			errorFd,
			new PreopenDirectory('.', root.contents),
			new PreopenDirectory('/lib', new Map([['std', stdDirectory]])),
			new PreopenDirectory('/cache', new Map())
		],
		{ debug: false }
	);
	if (log) {
		console.log(
			`[wasm-idle:zig-worker] compile start target=${targetTriple} activePath=${entryPath} bytes=${code.length}`
		);
	}
	const instance = instantiateResult(
		await WebAssembly.instantiate(compilerModule, {
			wasi_snapshot_preview1: zigWasi.wasiImport
		})
	);
	const exitCode = zigWasi.start(
		instance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } }
	);
	if (compilerOutput) postMessage({ output: compilerOutput });
	if (exitCode !== 0) {
		throw new Error(compilerOutput || `Zig compilation failed with code ${exitCode}`);
	}
	const outputFile = getFile(root, 'output.wasm');
	if (!outputFile?.data?.byteLength) {
		throw new Error('Zig compiler did not emit output.wasm');
	}
	if (log) {
		console.log(
			`[wasm-idle:zig-worker] compile complete artifactBytes=${outputFile.data.byteLength}`
		);
	}
	return new Uint8Array(outputFile.data);
}

async function runZigArtifact({
	artifact,
	args,
	stdin,
	log
}: {
	artifact: Uint8Array;
	args: string[];
	stdin?: string;
	log: boolean;
}) {
	stdinChunkZig = new Uint8Array(0);
	stdinChunkOffsetZig = 0;
	const stdout = new ConsoleStdout((chunk) => {
		const text = decoder.decode(chunk, { stream: true });
		if (text) postMessage({ output: text });
	});
	const stderr = new ConsoleStdout((chunk) => {
		const text = decoder.decode(chunk, { stream: true });
		if (text) postMessage({ output: text });
	});
	const zigWasi = new WASI(
		['output.wasm', ...args],
		['USER=jungol'],
		[new ZigStdin(stdin, log), stdout, stderr],
		{ debug: false }
	);
	const instance = instantiateResult(
		await WebAssembly.instantiate(artifact, {
			wasi_snapshot_preview1: zigWasi.wasiImport,
			wasi_unstable: zigWasi.wasiImport
		})
	);
	const exitCode = zigWasi.start(
		instance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } }
	);
	if (log) {
		console.log(`[wasm-idle:zig-worker] wasi run complete exitCode=${String(exitCode)}`);
	}
	if (exitCode !== 0) {
		throw new Error(`Zig program exited with code ${exitCode}`);
	}
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		compilerUrl: nextCompilerUrl,
		stdlibUrl: nextStdlibUrl,
		buffer,
		code,
		prepare,
		args = [],
		compileArgs = [],
		stdin,
		activePath = 'main.zig',
		workspaceFiles = [],
		targetTriple = 'wasm64-wasi',
		log
	} = event.data;
	try {
		if (load) {
			compilerUrl = nextCompilerUrl;
			stdlibUrl = nextStdlibUrl;
			if (log) {
				console.log(
					`[wasm-idle:zig-worker] load compilerUrl=${compilerUrl} stdlibUrl=${stdlibUrl}`
				);
			}
			await loadAssets(compilerUrl, stdlibUrl);
			postMessage({ load: true });
			return;
		}

		stdinBufferZig = new Int32Array(buffer);
		const compileCacheKey = JSON.stringify({
			targetTriple,
			activePath,
			code,
			workspaceFiles,
			compileArgs
		});
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			compiledArtifact = await compileZig({
				code,
				activePath,
				workspaceFiles,
				targetTriple,
				compileArgs,
				log
			});
			compiledCacheKey = compileCacheKey;
		}

		if (prepare) {
			postMessage({ results: true });
			return;
		}

		await runZigArtifact({
			artifact: compiledArtifact,
			args,
			stdin,
			log
		});
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:zig-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
