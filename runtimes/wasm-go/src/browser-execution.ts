import {
	Directory,
	Fd,
	Inode,
	OpenFile,
	PreopenDirectory,
	WASI,
	wasi
} from '@bjorn3/browser_wasi_shim';

import { resolveVersionedAssetUrl } from './asset-url.js';
import { fetchRuntimeAssetBytes } from './runtime-asset.js';
import { loadRuntimeManifest, normalizeRuntimeManifest, resolveTargetManifest } from './runtime-manifest.js';
import type {
	BrowserGoArtifact,
	BrowserGoSourceFile,
	NormalizedRuntimeManifest,
	RuntimeManifestV1
} from './types.js';
import { CaptureFd, toStandaloneBytes, writeGuestFile } from './wasi-guest.js';

export interface BrowserExecutionResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface BrowserExecutionOptions {
	args?: string[];
	env?: Record<string, string>;
	stdin?: () => string | Uint8Array | ArrayBuffer | null;
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
	files?: Array<BrowserGoSourceFile | { path: string; contents: string | Uint8Array | ArrayBuffer }>;
	manifest?: RuntimeManifestV1 | NormalizedRuntimeManifest;
	runtimeManifestUrl?: string | URL;
	runtimeBaseUrl?: string | URL;
	fetchImpl?: typeof fetch;
}

export interface BrowserWasiHost {
	args: string[];
	envEntries: string[];
	fds: Fd[];
	rootDirectory: Directory;
	stdout: CaptureFd;
	stderr: CaptureFd;
}

const DEFAULT_RUNTIME_MANIFEST_URL = new URL('./runtime/runtime-manifest.v1.json', import.meta.url);
const DEFAULT_RUNTIME_BASE_URL = new URL('./runtime/', import.meta.url);

function createRuntimeFetch(): typeof fetch {
	return (async (input: string | URL) => {
		const url = new URL(input.toString());
		if (url.protocol !== 'file:') {
			return fetch(url);
		}
		const [{ readFile }, { fileURLToPath }] = await Promise.all([
			import('node:fs/promises'),
			import('node:url')
		]);
		try {
			return new Response(await readFile(fileURLToPath(url)));
		} catch (error) {
			const code =
				error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : '';
			return new Response(null, {
				status: code === 'ENOENT' ? 404 : 500
			});
		}
	}) as typeof fetch;
}

class BufferedExecutionInput {
	private currentChunk = new Uint8Array(0);
	private currentOffset = 0;
	private readonly readInput: BrowserExecutionOptions['stdin'];

	constructor(readInput: BrowserExecutionOptions['stdin']) {
		this.readInput = readInput;
	}

	read(size: number) {
		while (this.currentOffset >= this.currentChunk.length) {
			const nextChunk = this.readInput?.();
			if (nextChunk == null) {
				return new Uint8Array(0);
			}
			this.currentChunk = toStandaloneBytes(nextChunk);
			this.currentOffset = 0;
			if (this.currentChunk.byteLength === 0) {
				continue;
			}
		}
		const data = this.currentChunk.slice(this.currentOffset, this.currentOffset + size);
		this.currentOffset += data.byteLength;
		return data;
	}
}

class StdinFd extends Fd {
	ino = Inode.issue_ino();
	private readonly source: BufferedExecutionInput;

	constructor(source: BufferedExecutionInput) {
		super();
		this.source = source;
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
		};
	}

	fd_fdstat_get() {
		const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
		fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_READ);
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat
		};
	}

	fd_read(size: number) {
		return {
			ret: wasi.ERRNO_SUCCESS,
			data: this.source.read(size)
		};
	}
}

export function createBrowserWasiHost(options: BrowserExecutionOptions = {}): BrowserWasiHost {
	const rootDirectory = new Directory(new Map());
	for (const file of options.files || []) {
		writeGuestFile(rootDirectory, file.path, file.contents);
	}
	const stdin = new BufferedExecutionInput(options.stdin);
	const stdout = new CaptureFd(options.stdout);
	const stderr = new CaptureFd(options.stderr);
	const env = new Map<string, string>([['PWD', '/']]);
	for (const [key, value] of Object.entries(options.env || {})) {
		env.set(key, value);
	}
	return {
		args: ['main.wasm', ...(options.args || [])],
		envEntries: Array.from(env.entries()).map(([key, value]) => `${key}=${value}`),
		rootDirectory,
		stdout,
		stderr,
		fds: [
			new StdinFd(stdin),
			stdout,
			stderr,
			new PreopenDirectory('/tmp', new Map()),
			new PreopenDirectory('/', rootDirectory.contents)
		]
	};
}

export async function executeBrowserGoArtifact(
	artifact: BrowserGoArtifact,
	options: BrowserExecutionOptions = {}
): Promise<BrowserExecutionResult> {
	if (artifact.target === 'js/wasm' && artifact.format === 'js-wasm') {
		const fetchImpl = options.fetchImpl || createRuntimeFetch();
		const runtimeManifestUrl = options.runtimeManifestUrl || DEFAULT_RUNTIME_MANIFEST_URL;
		const runtimeBaseUrl =
			options.runtimeBaseUrl || new URL('./', runtimeManifestUrl.toString());
		const stdin = new BufferedExecutionInput(options.stdin);
		const manifest = options.manifest
			? normalizeRuntimeManifest(options.manifest)
			: await loadRuntimeManifest(runtimeManifestUrl, fetchImpl);
		const target = resolveTargetManifest(manifest, artifact.target);
		if (target.execution.kind !== 'js-wasm-exec' || !target.execution.wasmExecJs) {
			throw new Error(`wasm-go target ${artifact.target} is not configured for wasm_exec.js execution.`);
		}
		const wasmExecSource = new TextDecoder().decode(
			toStandaloneBytes(
				await fetchRuntimeAssetBytes(
					resolveVersionedAssetUrl(runtimeBaseUrl, target.execution.wasmExecJs),
					'wasm_exec.js',
					fetchImpl
				)
			)
		);
		const stdoutChunks: string[] = [];
		const stderrChunks: string[] = [];
		const decoder = new TextDecoder();
		const previousGo = (globalThis as Record<string, unknown>).Go;
		const previousFs = (globalThis as Record<string, unknown>).fs;
		const enosys = () => {
			const error = new Error('not implemented');
			(error as Error & { code?: string }).code = 'ENOSYS';
			return error;
		};
		const fsShim = {
			...(previousFs && typeof previousFs === 'object'
				? (previousFs as Record<string, unknown>)
				: {}),
			constants:
				previousFs &&
				typeof previousFs === 'object' &&
				'constants' in previousFs &&
				(previousFs as { constants?: unknown }).constants
					? (previousFs as { constants: Record<string, number> }).constants
					: {
							O_WRONLY: -1,
							O_RDWR: -1,
							O_CREAT: -1,
							O_TRUNC: -1,
							O_APPEND: -1,
							O_EXCL: -1,
							O_DIRECTORY: -1
						},
			writeSync(fd: number, buf: Uint8Array) {
				const text = decoder.decode(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
				if (fd === 2) {
					stderrChunks.push(text);
					options.stderr?.(text);
				} else {
					stdoutChunks.push(text);
					options.stdout?.(text);
				}
				return buf.length;
			},
			write(
				fd: number,
				buf: Uint8Array,
				offset: number,
				length: number,
				position: number | null,
				callback: (error: Error | null, written?: number) => void
			) {
				if (offset !== 0 || position !== null) {
					callback(new Error('unsupported fs.write signature'));
					return;
				}
				callback(null, this.writeSync(fd, buf.subarray(0, length)));
			},
			chmod(_path: string, _mode: number, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			chown(_path: string, _uid: number, _gid: number, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			close(_fd: number, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			fchmod(_fd: number, _mode: number, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			fchown(_fd: number, _uid: number, _gid: number, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			fstat(_fd: number, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			fsync(_fd: number, callback: (error: Error | null) => void) {
				callback(null);
			},
			ftruncate(_fd: number, _length: number, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			lchown(_path: string, _uid: number, _gid: number, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			link(_path: string, _link: string, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			lstat(_path: string, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			mkdir(_path: string, _perm: number, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			open(_path: string, _flags: number, _mode: number, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			read(
				fd: number,
				buffer: Uint8Array,
				offset: number,
				length: number,
				position: number | null,
				callback: (error: Error | null, bytesRead?: number) => void
			) {
				if (fd !== 0) {
					callback(enosys());
					return;
				}
				if (
					position !== null ||
					offset < 0 ||
					length < 0 ||
					offset > buffer.length ||
					offset + length > buffer.length
				) {
					callback(new Error('unsupported fs.read signature'));
					return;
				}
				const bytes = stdin.read(length);
				buffer.set(bytes, offset);
				callback(null, bytes.byteLength);
			},
			readdir(_path: string, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			readlink(_path: string, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			rename(_from: string, _to: string, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			rmdir(_path: string, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			stat(_path: string, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			symlink(_path: string, _link: string, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			truncate(_path: string, _length: number, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			unlink(_path: string, callback: (error: Error | null) => void) {
				callback(enosys());
			},
			utimes(
				_path: string,
				_atime: number,
				_mtime: number,
				callback: (error: Error | null) => void
			) {
				callback(enosys());
			}
		};
		let exitCode = 0;
		try {
			(globalThis as Record<string, unknown>).fs = fsShim;
			delete (globalThis as Record<string, unknown>).Go;
			Function(wasmExecSource)();
			const GoRuntime = (globalThis as Record<string, unknown>).Go;
			if (typeof GoRuntime !== 'function') {
				throw new Error('wasm_exec.js did not register a Go runtime constructor');
			}
			const go = new (GoRuntime as new () => {
				argv: string[];
				env: Record<string, string>;
				exit: (code: number) => void;
				importObject: WebAssembly.Imports;
				run: (instance: WebAssembly.Instance) => Promise<void>;
			})();
			go.argv = ['main.wasm', ...(options.args || [])];
			go.env = { ...(options.env || {}) };
			go.exit = (code) => {
				exitCode = code;
			};
			const instantiated = (await WebAssembly.instantiate(
				artifact.bytes instanceof Uint8Array
					? artifact.bytes
					: new Uint8Array(artifact.bytes),
				go.importObject
			)) as WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource;
			await go.run(
				('instance' in instantiated ? instantiated.instance : instantiated) as WebAssembly.Instance
			);
		} finally {
			if (previousGo === undefined) {
				delete (globalThis as Record<string, unknown>).Go;
			} else {
				(globalThis as Record<string, unknown>).Go = previousGo;
			}
			if (previousFs === undefined) {
				delete (globalThis as Record<string, unknown>).fs;
			} else {
				(globalThis as Record<string, unknown>).fs = previousFs;
			}
		}
		return {
			exitCode,
			stdout: stdoutChunks.join(''),
			stderr: stderrChunks.join('')
		};
	}
	if (
		(artifact.target !== 'wasip1/wasm' &&
			artifact.target !== 'wasip2/wasm' &&
			artifact.target !== 'wasip3/wasm') ||
		artifact.format !== 'wasi-core-wasm'
	) {
		throw new Error('wasm-go currently executes only wasi core-wasm or js/wasm artifacts in-process.');
	}
	const host = createBrowserWasiHost(options);
	const wasiInstance = new WASI(host.args, host.envEntries, host.fds, { debug: false });
	const bytes =
		artifact.bytes instanceof Uint8Array
			? new Uint8Array(artifact.bytes)
			: new Uint8Array(artifact.bytes);
	const module = await WebAssembly.compile(bytes);
	const instance = await WebAssembly.instantiate(module, {
		wasi_snapshot_preview1: wasiInstance.wasiImport
	});
	const exitCode = wasiInstance.start(instance as unknown as {
		exports: {
			memory: WebAssembly.Memory;
			_start: () => unknown;
		};
	});
	return {
		exitCode,
		stdout: host.stdout.getText(),
		stderr: host.stderr.getText()
	};
}
