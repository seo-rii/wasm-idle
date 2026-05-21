import {
	ConsoleStdout,
	File,
	OpenFile,
	PreopenDirectory,
	WASI,
	wasi
} from '@bjorn3/browser_wasi_shim';
import type { SandboxWorkspaceFile } from '$lib/playground/options';

declare var self: any;

type HaskellRuntime = {
	mainFunc: (ghcArgs: string, source: string) => Promise<void> | void;
	rootfs: PreopenDirectory;
};

let moduleUrl = '';
let rootfsUrl = '';
let bsdtarUrl = '';
let mainSoPath = '/tmp/libplayground001.so';
let searchDirs = ['/tmp/clib', '/tmp/hslib/lib/wasm32-wasi-ghc-9.14.0.20251031-inplace'];
let loadedAssetKey = '';
let runtimePromise: Promise<HaskellRuntime> | null = null;
let activeStderrCollector: ((line: string) => void) | null = null;

type PendingSymlink = {
	target: string;
	path: string;
};

function postProgress(percent: number) {
	postMessage({ progress: { percent: Math.max(0, Math.min(100, percent)) } });
}

function outputLine(line: string) {
	postMessage({ output: line.endsWith('\n') ? line : `${line}\n` });
}

function formatError(error: unknown) {
	return error instanceof Error ? error.message : String(error);
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

function instantiateResult(
	result: WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource
) {
	return result instanceof WebAssembly.Instance ? result : result.instance;
}

function normalizeRootfsPath(path: string) {
	const parts: string[] = [];
	for (const part of path.replace(/^\/+/, '').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return parts.join('/');
}

function dirname(path: string) {
	const normalized = normalizeRootfsPath(path);
	const slashIndex = normalized.lastIndexOf('/');
	return slashIndex === -1 ? '' : normalized.slice(0, slashIndex);
}

function resolveSymlinkTarget(target: string, linkPath: string) {
	if (target.startsWith('/')) return normalizeRootfsPath(target);
	const parent = dirname(linkPath);
	return normalizeRootfsPath(parent ? `${parent}/${target}` : target);
}

function readWasiString(tarWasi: WASI, pointer: number, length: number) {
	const bytes = new Uint8Array(tarWasi.inst.exports.memory.buffer, pointer, length);
	return new TextDecoder('utf-8').decode(bytes);
}

function installRootfsExtractionWasiPatches(tarWasi: WASI, pendingSymlinks: PendingSymlink[]) {
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
		pendingSymlinks.push({
			target: readWasiString(tarWasi, oldPathPointer, oldPathLength),
			path: readWasiString(tarWasi, newPathPointer, newPathLength)
		});
		return wasi.ERRNO_SUCCESS;
	};
}

function materializeRootfsSymlinks(rootfs: PreopenDirectory, pendingSymlinks: PendingSymlink[]) {
	for (const symlink of pendingSymlinks) {
		const linkPath = normalizeRootfsPath(symlink.path);
		const targetPath = resolveSymlinkTarget(symlink.target, linkPath);
		const { ret, inode_obj: inode } = rootfs.path_lookup(targetPath, 0);
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

async function unpackRootfs() {
	postProgress(5);
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
	const [bsdtarBytes, rootfsBytes] = await Promise.all([
		fetchBytes(bsdtarUrl, 'Haskell rootfs extractor', 5, 15),
		fetchBytes(rootfsUrl, 'Haskell GHC rootfs', 15, 70)
	]);
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
	if (!moduleUrl || !rootfsUrl || !bsdtarUrl) {
		throw new Error(
			'Haskell runtime is not configured. Set PUBLIC_WASM_HASKELL_MODULE_URL, PUBLIC_WASM_HASKELL_ROOTFS_URL, and PUBLIC_WASM_HASKELL_BSDTAR_URL, or runtimeAssets.haskell.'
		);
	}
	const assetKey = JSON.stringify({
		moduleUrl,
		rootfsUrl,
		bsdtarUrl,
		mainSoPath,
		searchDirs
	});
	if (loadedAssetKey === assetKey && runtimePromise) {
		return await runtimePromise;
	}
	loadedAssetKey = assetKey;
	runtimePromise = (async () => {
		const rootfs = await unpackRootfs();
		const dyldModule = await import(/* @vite-ignore */ moduleUrl);
		if (
			typeof dyldModule.main !== 'function' ||
			typeof dyldModule.DyLDBrowserHost !== 'function'
		) {
			throw new Error('wasm-haskell module must export main and DyLDBrowserHost');
		}
		const host = new dyldModule.DyLDBrowserHost({
			rootfs,
			stdout: outputLine,
			stderr(line: string) {
				activeStderrCollector?.(line);
				outputLine(line);
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
		return { mainFunc, rootfs };
	})();
	return await runtimePromise;
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

function normalizeWorkspaceSource(
	code: string,
	activePath: string,
	workspaceFiles: SandboxWorkspaceFile[]
) {
	const activeFile = workspaceFiles.find((file) => file.path === activePath);
	return activeFile ? code : code;
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		rootfsUrl: nextRootfsUrl,
		bsdtarUrl: nextBsdtarUrl,
		mainSoPath: nextMainSoPath,
		searchDirs: nextSearchDirs,
		code,
		prepare,
		ghcArgs = '',
		activePath = 'main.hs',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			moduleUrl = nextModuleUrl;
			rootfsUrl = nextRootfsUrl;
			bsdtarUrl = nextBsdtarUrl;
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
		const source = normalizeWorkspaceSource(code, activePath, workspaceFiles);
		let stderrText = '';
		try {
			activeStderrCollector = (line: string) => {
				stderrText += line.endsWith('\n') ? line : `${line}\n`;
			};
			if (log) {
				console.log(
					`[wasm-idle:haskell-worker] run start activePath=${activePath} ghcArgs=${JSON.stringify(ghcArgs)} bytes=${source.length}`
				);
			}
			await runtime.mainFunc(String(ghcArgs || ''), source);
		} catch (error) {
			for (const diagnostic of parseHaskellDiagnostics(stderrText)) {
				postMessage({ diagnostic });
			}
			throw new Error(stderrText.trim() || formatError(error));
		} finally {
			activeStderrCollector = null;
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
