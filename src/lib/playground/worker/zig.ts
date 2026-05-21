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
import { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile, ZigTargetTriple } from '$lib/playground/options';

declare var self: any;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

function addFile(root: Directory, filePath: string, data: Uint8Array) {
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
		addFile(root, file.path, encoder.encode(file.path === activePath ? code : file.content));
	}
	addFile(root, entryPath, encoder.encode(code));
	return { root, entryPath };
}

async function fetchBytes(url: string, label: string, progressStart: number, progressEnd: number) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`failed to load ${label} from ${url}: ${response.status}`);
	}
	const total = Number(response.headers.get('content-length') || 0);
	const body = response.body?.getReader();
	if (!body) {
		const data = new Uint8Array(await response.arrayBuffer());
		postProgress(progressEnd);
		return data;
	}

	const chunks: Uint8Array[] = [];
	let loaded = 0;
	while (true) {
		const { done, value } = await body.read();
		if (done) break;
		if (!value) continue;
		chunks.push(value);
		loaded += value.byteLength;
		if (total > 0) {
			postProgress(progressStart + ((progressEnd - progressStart) * loaded) / total);
		}
	}
	const data = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.byteLength;
	}
	postProgress(progressEnd);
	return data;
}

async function unzipStdDirectory(source: Uint8Array) {
	const reader = new ZipReader(new Uint8ArrayReader(source));
	const entries = await reader.getEntries();
	const root = new Directory(new Map());
	for (const entry of entries) {
		if (!entry.filename || entry.directory) continue;
		const data = await entry.getData?.(new Uint8ArrayWriter());
		if (!data) continue;
		addFile(root, entry.filename, data);
	}
	await reader.close();
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
			unzipStdDirectory(stdlibBytes)
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
