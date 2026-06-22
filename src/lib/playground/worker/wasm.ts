import { ConsoleStdout, Fd, WASI, WASIProcExit, wasi } from '@bjorn3/browser_wasi_shim';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile } from '$lib/playground/options';

declare var self: any;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let stdinChunkWasm = new Uint8Array(0);
let stdinChunkOffsetWasm = 0;

class WasmStdin extends Fd {
	private initialStdin: string | null;
	private readonly hasInitialStdin: boolean;

	constructor(
		initialStdin: string | undefined,
		private readonly buffer: Int32Array | null,
		private readonly log: boolean
	) {
		super();
		this.initialStdin = typeof initialStdin === 'string' ? initialStdin : null;
		this.hasInitialStdin = typeof initialStdin === 'string';
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
		if (stdinChunkOffsetWasm >= stdinChunkWasm.length) {
			const nextChunk = this.readNextChunk();
			if (nextChunk === null) {
				stdinChunkWasm = new Uint8Array(0);
				stdinChunkOffsetWasm = 0;
				return {
					ret: wasi.ERRNO_SUCCESS,
					data: new Uint8Array(0)
				};
			}
			stdinChunkWasm = encoder.encode(nextChunk);
			stdinChunkOffsetWasm = 0;
		}

		const end = Math.min(stdinChunkOffsetWasm + size, stdinChunkWasm.length);
		const data = stdinChunkWasm.slice(stdinChunkOffsetWasm, end);
		stdinChunkOffsetWasm = end;
		return {
			ret: wasi.ERRNO_SUCCESS,
			data
		};
	}

	readByte() {
		if (stdinChunkOffsetWasm >= stdinChunkWasm.length) {
			const nextChunk = this.readNextChunk();
			if (nextChunk === null) {
				stdinChunkWasm = new Uint8Array(0);
				stdinChunkOffsetWasm = 0;
				return -1;
			}
			stdinChunkWasm = encoder.encode(nextChunk);
			stdinChunkOffsetWasm = 0;
		}
		return stdinChunkWasm[stdinChunkOffsetWasm++] ?? -1;
	}

	private readNextChunk() {
		if (this.hasInitialStdin) {
			const chunk = this.initialStdin;
			this.initialStdin = null;
			this.logRead(chunk);
			return chunk;
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
			console.log('[wasm-idle:wasm-stdin] read(bytes=0, eof=true)');
			return;
		}
		console.log(
			`[wasm-idle:wasm-stdin] read(bytes=${encoder.encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
		);
	}
}

function normalizeWorkspacePath(path: string) {
	return path
		.replace(/^\/+/, '')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..' && !part.includes('\0'))
		.join('/');
}

function sourceFromWorkspace(
	code: string,
	activePath: string,
	workspaceFiles: SandboxWorkspaceFile[]
) {
	const normalizedActivePath = normalizeWorkspacePath(activePath || 'main.wasm');
	const file = workspaceFiles.find(
		(entry) => normalizeWorkspacePath(entry.path) === normalizedActivePath
	);
	return file?.content || code;
}

function decodeBase64(value: string) {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeHex(value: string) {
	const normalized = value.replace(/^0x/iu, '').replace(/\s+/gu, '');
	const bytes = new Uint8Array(normalized.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

function decodeWasmBytes(source: string) {
	const withoutComments = source
		.split(/\r?\n/u)
		.filter((line) => !line.trimStart().startsWith('#'))
		.join('\n')
		.trim();
	const dataUrlMatch = /^data:[^,]*,\s*([\s\S]+)$/iu.exec(withoutComments);
	const prefixedBase64 = /^(?:base64|wasm):\s*([\s\S]+)$/iu.exec(withoutComments);
	const candidate = (dataUrlMatch?.[1] || prefixedBase64?.[1] || withoutComments).replace(
		/\s+/gu,
		''
	);
	let bytes: Uint8Array;
	try {
		bytes =
			/^(?:0x)?[0-9a-f]+$/iu.test(candidate) &&
			candidate.replace(/^0x/iu, '').length % 2 === 0
				? decodeHex(candidate)
				: decodeBase64(candidate);
	} catch {
		throw new Error('WASM source must decode to a WebAssembly binary');
	}
	if (
		bytes.length < 4 ||
		bytes[0] !== 0x00 ||
		bytes[1] !== 0x61 ||
		bytes[2] !== 0x73 ||
		bytes[3] !== 0x6d
	) {
		throw new Error('WASM source must decode to a WebAssembly binary');
	}
	return bytes;
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		code,
		prepare,
		buffer,
		stdin,
		args = [],
		activePath = 'main.wasm',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			postMessage({ load: true });
			return;
		}

		const source = sourceFromWorkspace(code, activePath, workspaceFiles);
		const bytes = decodeWasmBytes(source);
		const wasmBuffer = new ArrayBuffer(bytes.byteLength);
		new Uint8Array(wasmBuffer).set(bytes);
		if (prepare) {
			await WebAssembly.compile(wasmBuffer);
			postMessage({ results: true });
			return;
		}

		stdinChunkWasm = new Uint8Array(0);
		stdinChunkOffsetWasm = 0;
		const stdinReader = new WasmStdin(
			stdin,
			buffer ? new Int32Array(buffer) : null,
			Boolean(log)
		);
		const stdout = new ConsoleStdout((chunk) => {
			const text = decoder.decode(chunk);
			if (text) postMessage({ output: text });
		});
		const stderr = new ConsoleStdout((chunk) => {
			const text = decoder.decode(chunk);
			if (text) postMessage({ output: text });
		});
		const wasiRuntime = new WASI(args, ['USER=wasm-idle'], [stdinReader, stdout, stderr]);
		const compiledModule = await WebAssembly.compile(wasmBuffer);
		const importModules = WebAssembly.Module.imports(compiledModule).map(
			(entry) => entry.module
		);
		const usesWasi =
			importModules.includes('wasi_snapshot_preview1') ||
			importModules.includes('wasi_unstable');
		const instance = await WebAssembly.instantiate(compiledModule, {
			env: {
				readByte() {
					return stdinReader.readByte();
				}
			},
			wasi_snapshot_preview1: wasiRuntime.wasiImport,
			wasi_unstable: wasiRuntime.wasiImport
		});
		const exportsObject = instance.exports as Record<string, unknown>;
		let exitCode = 0;
		let printed = false;

		try {
			if (usesWasi && typeof exportsObject._start === 'function') {
				exitCode = wasiRuntime.start(
					instance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } }
				);
			} else if (usesWasi && typeof exportsObject.memory === 'object') {
				wasiRuntime.initialize(
					instance as {
						exports: { memory: WebAssembly.Memory; _initialize?: () => unknown };
					}
				);
				if (typeof exportsObject.main === 'function') {
					const result = (exportsObject.main as () => unknown)();
					if (typeof result === 'number' || typeof result === 'bigint') {
						postMessage({ output: `main=${String(result)}\n` });
						printed = true;
					}
				}
			} else if (typeof exportsObject._start === 'function') {
				const result = (exportsObject._start as () => unknown)();
				if (typeof result === 'number' || typeof result === 'bigint') {
					postMessage({ output: `_start=${String(result)}\n` });
					printed = true;
				}
			} else if (typeof exportsObject.main === 'function') {
				const result = (exportsObject.main as () => unknown)();
				if (typeof result === 'number' || typeof result === 'bigint') {
					postMessage({ output: `main=${String(result)}\n` });
					printed = true;
				}
			} else {
				for (const [name, value] of Object.entries(exportsObject)) {
					if (name.startsWith('_') || typeof value !== 'function') continue;
					try {
						const result = (value as () => unknown)();
						if (typeof result === 'number' || typeof result === 'bigint') {
							postMessage({ output: `${name}=${String(result)}\n` });
							printed = true;
						}
					} catch {
						// Parameterized exports are still valid but cannot be auto-run.
					}
				}
			}
		} catch (error) {
			if (error instanceof WASIProcExit) {
				exitCode = error.code;
			} else {
				throw error;
			}
		}

		if (exitCode !== 0) {
			throw new Error(`WASM module exited with code ${exitCode}`);
		}
		if (!printed && !usesWasi && typeof exportsObject._start !== 'function') {
			const exportNames = Object.keys(exportsObject).sort().join(', ');
			postMessage({
				output: exportNames ? `exports: ${exportNames}\n` : 'compiled WebAssembly module\n'
			});
		}
		if (log) {
			console.log('[wasm-idle:wasm-worker] run settled');
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:wasm-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
