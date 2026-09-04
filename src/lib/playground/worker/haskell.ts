import {
	ConsoleStdout,
	Directory,
	File,
	OpenFile,
	PreopenDirectory,
	WASI,
	wasi
} from '@bjorn3/browser_wasi_shim';
import { installWasiExtractionQuota } from '@wasm-idle/llvm-core';
import {
	loadVerifiedHaskellRuntimeAssets,
	snapshotHaskellRuntimeAssetConfig,
	type HaskellRuntimeAssetReceipts
} from '$lib/playground/haskellAssets';
import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';

declare const self: any;

type HaskellRuntime = {
	mainFunc: (ghcArgs: string, source: string) => Promise<void> | void;
	rootfs: PreopenDirectory;
	stdin: HaskellStdin;
};

let moduleUrl = '';
let rootfsUrl = '';
let bsdtarUrl = '';
let integrity: HaskellRuntimeAssetReceipts | null = null;
let maxAssetBytes = 128 * 1024 * 1024;
let mainSoPath = '/tmp/libplayground001.so';
let searchDirs = ['/tmp/clib', '/tmp/hslib/lib/wasm32-wasi-ghc-9.14.0.20251031-inplace'];
let loadedAssetKey = '';
let runtimePromise: Promise<HaskellRuntime> | null = null;
let activeStderrCollector: ((line: string) => void) | null = null;
let activeDiagnosticPaths: ReadonlyMap<string, string> | null = null;
const encoder = new TextEncoder();
const workspaceRootName = 'wasm-idle-workspace';
const workspaceRootPath = `/tmp/${workspaceRootName}`;

class HaskellStdin {
	private fixedStdin = false;
	private initialStdinPending = false;
	private initialStdin: string | null = null;
	private buffer: Int32Array | null = null;
	private chunk = new Uint8Array(0);
	private offset = 0;
	private log = false;

	reset({
		stdin,
		buffer,
		log
	}: {
		stdin: string | undefined;
		buffer: ArrayBufferLike | undefined;
		log: boolean;
	}) {
		this.fixedStdin = typeof stdin === 'string';
		this.initialStdinPending = this.fixedStdin;
		this.initialStdin = typeof stdin === 'string' ? stdin : null;
		this.buffer = buffer ? new Int32Array(buffer) : null;
		this.chunk = new Uint8Array(0);
		this.offset = 0;
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
		if (this.offset >= this.chunk.length) {
			const nextChunk = this.readNextChunk();
			if (nextChunk === null) {
				this.chunk = new Uint8Array(0);
				this.offset = 0;
				return { ret: wasi.ERRNO_SUCCESS, data: new Uint8Array(0) };
			}
			this.chunk = encoder.encode(nextChunk);
			this.offset = 0;
		}

		const end = Math.min(this.offset + size, this.chunk.length);
		const data = this.chunk.slice(this.offset, end);
		this.offset = end;
		return { ret: wasi.ERRNO_SUCCESS, data };
	}

	private readNextChunk() {
		if (this.initialStdinPending) {
			this.initialStdinPending = false;
			const chunk = this.initialStdin ?? '';
			this.initialStdin = null;
			this.logRead(chunk);
			return chunk;
		}
		if (this.fixedStdin) {
			this.logRead(null);
			return null;
		}
		if (!this.buffer) {
			this.logRead(null);
			return null;
		}
		const chunk = waitForBufferedStdin(this.buffer, () => postMessage({ buffer: true }));
		this.logRead(chunk);
		return chunk;
	}

	private logRead(chunk: string | null) {
		if (!this.log) return;
		if (chunk === null) {
			console.log('[wasm-idle:haskell-stdin] fd_read(bytes=0, eof=true)');
			return;
		}
		console.log(
			`[wasm-idle:haskell-stdin] fd_read(bytes=${encoder.encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
		);
	}
}

type PendingSymlink = {
	target: string;
	resolvedTarget: string;
	path: string;
};

function postProgress(percent: number) {
	postMessage({ progress: { percent: Math.max(0, Math.min(100, percent)) } });
}

function outputLine(line: string) {
	postMessage({ output: line.endsWith('\n') ? line : `${line}\n` });
}

function remapDiagnosticPath(line: string) {
	const match = /^(.*?)(:\d+:\d+:\s+(?:error|warning):)/i.exec(line);
	if (!match) return line;
	const workspacePath = activeDiagnosticPaths?.get(match[1]);
	return workspacePath ? `${workspacePath}${line.slice(match[1].length)}` : line;
}

function formatError(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function instantiateResult(
	result: WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource
) {
	return result instanceof WebAssembly.Instance ? result : result.instance;
}

function installRootfsExtractionWasiPatches(tarWasi: WASI, pendingSymlinks: PendingSymlink[]) {
	const extractionQuota = installWasiExtractionQuota(tarWasi, {
		label: 'Haskell rootfs'
	});
	tarWasi.wasiImport.fd_filestat_set_times = () => wasi.ERRNO_SUCCESS;
	tarWasi.wasiImport.path_filestat_set_times = () => wasi.ERRNO_SUCCESS;
	tarWasi.wasiImport.path_symlink = (
		oldPathPointer: number,
		oldPathLength: number,
		fd: number,
		newPathPointer: number,
		newPathLength: number
	) => {
		if (!tarWasi.fds[fd]) return wasi.ERRNO_BADF;
		const symlink = extractionQuota.readSymlink(
			tarWasi,
			oldPathPointer,
			oldPathLength,
			newPathPointer,
			newPathLength
		);
		extractionQuota.recordEntry(symlink.path);
		pendingSymlinks.push(symlink);
		return wasi.ERRNO_SUCCESS;
	};
}

function materializeRootfsSymlinks(rootfs: PreopenDirectory, pendingSymlinks: PendingSymlink[]) {
	for (const symlink of pendingSymlinks) {
		const linkPath = symlink.path;
		const { ret, inode_obj: inode } = rootfs.path_lookup(symlink.resolvedTarget, 0);
		if (ret !== wasi.ERRNO_SUCCESS || !inode) {
			throw new Error(
				`failed to resolve Haskell rootfs symlink ${linkPath} -> ${symlink.target}`
			);
		}
		const linkRet = rootfs.path_link(linkPath, inode, false);
		if (linkRet !== wasi.ERRNO_SUCCESS) {
			throw new Error(`failed to materialize Haskell rootfs symlink ${linkPath}`);
		}
	}
}

async function unpackRootfs(bsdtarBytes: Uint8Array, rootfsBytes: Uint8Array) {
	const rootfs = new PreopenDirectory('/', new Map());
	const pendingSymlinks: PendingSymlink[] = [];
	let tarOutput = '';
	const tarStdout = ConsoleStdout.lineBuffered((line) => {
		tarOutput += `${line}\n`;
	});
	const tarStderr = ConsoleStdout.lineBuffered((line) => {
		tarOutput += `${line}\n`;
	});
	const tarWasi = new WASI(
		['bsdtar.wasm', '-x'],
		[],
		[
			new OpenFile(new File(new Uint8Array(), { readonly: true })),
			tarStdout,
			tarStderr,
			rootfs
		],
		{ debug: false }
	);
	installRootfsExtractionWasiPatches(tarWasi, pendingSymlinks);
	postProgress(75);
	const tarInstance = instantiateResult(
		await WebAssembly.instantiate(bsdtarBytes, {
			wasi_snapshot_preview1: tarWasi.wasiImport
		})
	);
	tarWasi.fds[0] = new OpenFile(new File(rootfsBytes, { readonly: true }));
	const exitCode = tarWasi.start(tarInstance as unknown as Parameters<WASI['start']>[0]);
	if (typeof exitCode === 'number' && exitCode !== 0) {
		throw new Error(tarOutput || `bsdtar exited with code ${exitCode}`);
	}
	materializeRootfsSymlinks(rootfs, pendingSymlinks);
	postProgress(90);
	return rootfs;
}

async function createRuntime() {
	if (!moduleUrl || !rootfsUrl || !bsdtarUrl || !integrity) {
		throw new Error(
			'Haskell runtime is not configured. Set PUBLIC_WASM_HASKELL_MODULE_URL, PUBLIC_WASM_HASKELL_ROOTFS_URL, and PUBLIC_WASM_HASKELL_BSDTAR_URL, or runtimeAssets.haskell.'
		);
	}
	const assetKey = JSON.stringify({
		moduleUrl,
		rootfsUrl,
		bsdtarUrl,
		integrity,
		maxAssetBytes,
		mainSoPath,
		searchDirs
	});
	if (loadedAssetKey === assetKey && runtimePromise) {
		return await runtimePromise;
	}
	const pendingRuntime = (async () => {
		postProgress(5);
		const verified = await loadVerifiedHaskellRuntimeAssets(
			{
				moduleUrl,
				rootfsUrl,
				bsdtarUrl,
				integrity,
				maxAssetBytes
			},
			{
				onProgress({ asset, loaded, total }) {
					if (!total || total <= 0) return;
					const [start, end] =
						asset === 'dyld.mjs'
							? [5, 15]
							: asset === 'bsdtar.wasm'
								? [15, 25]
								: [25, 70];
					postProgress(start + ((end - start) * loaded) / total);
				}
			}
		);
		const rootfs = await unpackRootfs(verified.bsdtarBytes, verified.rootfsBytes);
		const verifiedModuleUrl = URL.createObjectURL(
			new Blob([verified.moduleSource], { type: 'text/javascript' })
		);
		let dyldModule: Record<string, any>;
		try {
			dyldModule = await import(/* @vite-ignore */ verifiedModuleUrl);
		} finally {
			URL.revokeObjectURL(verifiedModuleUrl);
		}
		if (
			typeof dyldModule.main !== 'function' ||
			typeof dyldModule.DyLDBrowserHost !== 'function'
		) {
			throw new Error('wasm-haskell module must export main and DyLDBrowserHost');
		}
		const stdin = new HaskellStdin();
		const host = new dyldModule.DyLDBrowserHost({
			rootfs,
			stdin,
			stdout: outputLine,
			stderr(line: string) {
				const mappedLine = remapDiagnosticPath(line);
				activeStderrCollector?.(mappedLine);
				outputLine(mappedLine);
			}
		});
		const dyld = await dyldModule.main({
			rpc: host,
			searchDirs,
			mainSoPath,
			args: [mainSoPath.split('/').pop() || 'libplayground001.so', '+RTS', '-c', '-RTS'],
			isIserv: false
		});
		const exportedMain = dyld?.exportFuncs?.myMain;
		if (typeof exportedMain !== 'function') {
			throw new Error('wasm-haskell runtime did not export myMain');
		}
		const mainFunc = await exportedMain('/tmp/hslib/lib');
		if (typeof mainFunc !== 'function') {
			throw new Error('wasm-haskell myMain did not return a callable function');
		}
		postProgress(100);
		return { mainFunc, rootfs, stdin };
	})();
	loadedAssetKey = assetKey;
	runtimePromise = pendingRuntime;
	try {
		return await pendingRuntime;
	} catch (error) {
		if (runtimePromise === pendingRuntime) {
			runtimePromise = null;
			loadedAssetKey = '';
		}
		throw error;
	}
}

export function parseHaskellDiagnostics(output: string) {
	const diagnostics = [];
	const lines = output.split(/\r\n|\r|\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^(.*?):(\d+):(\d+):\s+(error|warning):\s*(.*)$/i.exec(lines[index]);
		if (!match) continue;
		let message = match[5].trim();
		if (!message) {
			for (const extraLine of lines.slice(index + 1)) {
				const trimmed = extraLine.trim();
				if (!trimmed || trimmed === '|' || /^\d+\s+\|/.test(trimmed)) continue;
				message = trimmed;
				break;
			}
		}
		diagnostics.push({
			fileName: match[1] || null,
			lineNumber: Math.max(1, Number(match[2] || 1)),
			columnNumber: Math.max(1, Number(match[3] || 1)),
			severity: match[4].toLowerCase() === 'warning' ? 'warning' : 'error',
			message: message || lines[index]
		});
	}
	return diagnostics;
}

type WorkspaceTree = {
	directories: Map<string, WorkspaceTree>;
	files: Map<string, Uint8Array>;
};

function createWorkspaceTree(): WorkspaceTree {
	return { directories: new Map(), files: new Map() };
}

function encodeWorkspacePath(path: string) {
	return path
		.split('/')
		.map((segment) => encodeURIComponent(segment))
		.join('/');
}

function addWorkspaceFile(tree: WorkspaceTree, encodedPath: string, content: string) {
	const pathParts = encodedPath.split('/');
	const fileName = pathParts.pop();
	if (!fileName) throw new Error(`Invalid Haskell workspace path: ${encodedPath}`);
	let directory = tree;
	for (const pathPart of pathParts) {
		if (directory.files.has(pathPart)) {
			throw new Error(`Haskell workspace path collides with a file: ${encodedPath}`);
		}
		let child = directory.directories.get(pathPart);
		if (!child) {
			child = createWorkspaceTree();
			directory.directories.set(pathPart, child);
		}
		directory = child;
	}
	if (directory.directories.has(fileName)) {
		throw new Error(`Haskell workspace path collides with a directory: ${encodedPath}`);
	}
	directory.files.set(fileName, encoder.encode(content));
}

function materializeWorkspaceTree(tree: WorkspaceTree): Directory {
	const contents: [string, File | Directory][] = [];
	for (const [name, directory] of tree.directories) {
		contents.push([name, materializeWorkspaceTree(directory)]);
	}
	for (const [name, content] of tree.files) {
		contents.push([name, new File(content, { readonly: true })]);
	}
	return new Directory(contents);
}

function addImportRoot(importRoots: string[], seen: Set<string>, encodedDirectory: string) {
	const root = encodedDirectory ? `${workspaceRootPath}/${encodedDirectory}` : workspaceRootPath;
	if (seen.has(root)) return;
	seen.add(root);
	importRoots.push(root);
}

function addFileImportRoots(importRoots: string[], seen: Set<string>, encodedPath: string) {
	const directoryParts = encodedPath.split('/').slice(0, -1);
	for (let length = directoryParts.length; length >= 0; length -= 1) {
		addImportRoot(importRoots, seen, directoryParts.slice(0, length).join('/'));
	}
}

function mountWorkspace(
	rootfs: PreopenDirectory,
	code: string,
	activePath: string,
	workspaceFiles: SandboxWorkspaceFile[]
) {
	const sourceFiles = new Map<string, string>();
	for (const file of workspaceFiles) {
		if (file.path !== activePath) sourceFiles.set(file.path, file.content);
	}
	sourceFiles.set(activePath, code);

	const tree = createWorkspaceTree();
	const diagnosticPaths = new Map<string, string>([
		['/tmp/Main.hs', activePath],
		['tmp/Main.hs', activePath],
		['Main.hs', activePath]
	]);
	const encodedPaths = new Map<string, string>();
	for (const [path, content] of sourceFiles) {
		const encodedPath = encodeWorkspacePath(path);
		encodedPaths.set(path, encodedPath);
		addWorkspaceFile(tree, encodedPath, content);
		const absolutePath = `${workspaceRootPath}/${encodedPath}`;
		diagnosticPaths.set(absolutePath, path);
		diagnosticPaths.set(absolutePath.slice(1), path);
	}

	let tmp = rootfs.dir.contents.get('tmp');
	if (tmp === undefined) {
		tmp = new Directory(new Map());
		rootfs.dir.contents.set('tmp', tmp);
	}
	if (!(tmp instanceof Directory)) {
		throw new Error('Haskell runtime rootfs /tmp entry is not a directory');
	}
	tmp.contents.set(workspaceRootName, materializeWorkspaceTree(tree));

	const importRoots: string[] = [];
	const seenImportRoots = new Set<string>();
	const encodedActivePath = encodedPaths.get(activePath);
	if (encodedActivePath) {
		addFileImportRoots(importRoots, seenImportRoots, encodedActivePath);
	}
	for (const [path, encodedPath] of encodedPaths) {
		if (path !== activePath) addFileImportRoots(importRoots, seenImportRoots, encodedPath);
	}

	return {
		diagnosticPaths,
		importRoots,
		hasAuxiliaryFiles: sourceFiles.size > 1
	};
}

function appendWorkspaceCompilerArgs(
	ghcArgs: string,
	workspace: ReturnType<typeof mountWorkspace>
) {
	if (!workspace.hasAuxiliaryFiles) return ghcArgs;
	const internalArgs = ['-fforce-recomp', `-i${workspace.importRoots.join(':')}`];
	return [...internalArgs, ghcArgs].filter(Boolean).join(' ');
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		rootfsUrl: nextRootfsUrl,
		bsdtarUrl: nextBsdtarUrl,
		integrity: nextIntegrity,
		maxAssetBytes: nextMaxAssetBytes,
		mainSoPath: nextMainSoPath,
		searchDirs: nextSearchDirs,
		code,
		prepare,
		buffer,
		stdin,
		ghcArgs = '',
		activePath = 'main.hs',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			const nextConfig = snapshotHaskellRuntimeAssetConfig({
				moduleUrl: nextModuleUrl,
				rootfsUrl: nextRootfsUrl,
				bsdtarUrl: nextBsdtarUrl,
				integrity: nextIntegrity,
				maxAssetBytes: nextMaxAssetBytes
			});
			moduleUrl = nextConfig.moduleUrl;
			rootfsUrl = nextConfig.rootfsUrl;
			bsdtarUrl = nextConfig.bsdtarUrl;
			integrity = nextConfig.integrity;
			maxAssetBytes = nextConfig.maxAssetBytes;
			mainSoPath = nextMainSoPath || mainSoPath;
			searchDirs =
				Array.isArray(nextSearchDirs) && nextSearchDirs.length
					? nextSearchDirs
					: searchDirs;
			if (log) {
				console.log(
					`[wasm-idle:haskell-worker] load moduleUrl=${moduleUrl} rootfsUrl=${rootfsUrl} bsdtarUrl=${bsdtarUrl}`
				);
			}
			await createRuntime();
			postMessage({ load: true });
			return;
		}

		if (prepare) {
			postMessage({ results: true });
			return;
		}

		const runtime = await createRuntime();
		const source = String(code ?? '');
		const workspace = mountWorkspace(runtime.rootfs, source, activePath, workspaceFiles);
		const compilerArgs = appendWorkspaceCompilerArgs(String(ghcArgs || ''), workspace);
		runtime.stdin.reset({ stdin, buffer, log: !!log });
		let stderrText = '';
		try {
			activeDiagnosticPaths = workspace.diagnosticPaths;
			activeStderrCollector = (line: string) => {
				stderrText += line.endsWith('\n') ? line : `${line}\n`;
			};
			if (log) {
				console.log(
					`[wasm-idle:haskell-worker] run start activePath=${activePath} ghcArgs=${JSON.stringify(compilerArgs)} bytes=${source.length}`
				);
			}
			await runtime.mainFunc(compilerArgs, source);
		} catch (error) {
			for (const diagnostic of parseHaskellDiagnostics(stderrText)) {
				postMessage({ diagnostic });
			}
			throw new Error(stderrText.trim() || formatError(error), { cause: error });
		} finally {
			activeStderrCollector = null;
			activeDiagnosticPaths = null;
		}
		for (const diagnostic of parseHaskellDiagnostics(stderrText)) {
			postMessage({ diagnostic });
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:haskell-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
