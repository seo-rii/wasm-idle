import { ConsoleStdout, Fd, WASI, WASIProcExit, wasi } from '@bjorn3/browser_wasi_shim';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';

declare var self: any;

self.document = {
	querySelectorAll() {
		return [];
	}
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let stdinBufferTinyGo: Int32Array | null = null;
let stdinChunkTinyGo = new Uint8Array(0);
let stdinChunkOffsetTinyGo = 0;

class TinyGoStdin extends Fd {
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
		if (stdinBufferTinyGo === null) {
			return {
				ret: wasi.ERRNO_SUCCESS,
				data: new Uint8Array(0)
			};
		}

		if (stdinChunkOffsetTinyGo >= stdinChunkTinyGo.length) {
			const nextChunk = waitForBufferedStdin(stdinBufferTinyGo, () => postMessage({ buffer: true }));
			if (nextChunk === null) {
				stdinChunkTinyGo = new Uint8Array(0);
				stdinChunkOffsetTinyGo = 0;
				return {
					ret: wasi.ERRNO_SUCCESS,
					data: new Uint8Array(0)
				};
			}
			stdinChunkTinyGo = encoder.encode(nextChunk);
			stdinChunkOffsetTinyGo = 0;
		}

		const end = Math.min(stdinChunkOffsetTinyGo + size, stdinChunkTinyGo.length);
		const data = stdinChunkTinyGo.slice(stdinChunkOffsetTinyGo, end);
		stdinChunkOffsetTinyGo = end;
		return {
			ret: wasi.ERRNO_SUCCESS,
			data
		};
	}
}

self.onmessage = async (event: { data: any }) => {
	const { load, artifact, buffer, args = [], log } = event.data;

	try {
		if (load) {
			postMessage({ load: true });
			return;
		}

		const bytes =
			artifact instanceof Uint8Array
				? artifact
				: artifact instanceof ArrayBuffer
					? new Uint8Array(artifact)
					: ArrayBuffer.isView(artifact)
						? new Uint8Array(artifact.buffer, artifact.byteOffset, artifact.byteLength)
						: null;
		if (!bytes) {
			throw new Error('TinyGo worker expected a wasm artifact');
		}

		stdinBufferTinyGo = new Int32Array(buffer);
		stdinChunkTinyGo = new Uint8Array(0);
		stdinChunkOffsetTinyGo = 0;

		const stdout = new ConsoleStdout((chunk) => {
			const text = decoder.decode(chunk);
			if (text) postMessage({ output: text });
		});
		const stderr = new ConsoleStdout((chunk) => {
			const text = decoder.decode(chunk);
			if (text) postMessage({ output: text });
		});
		const wasiRuntime = new WASI(args, ['USER=jungol'], [new TinyGoStdin(), stdout, stderr]);
		const wasmModule = (await WebAssembly.instantiate(bytes, {
			wasi_snapshot_preview1: wasiRuntime.wasiImport,
			wasi_unstable: wasiRuntime.wasiImport
		})) as WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource;
		const instance =
			typeof WebAssembly.Instance === 'function' && wasmModule instanceof WebAssembly.Instance
				? wasmModule
				: 'instance' in wasmModule
					? wasmModule.instance
					: wasmModule;

		let exitCode = 0;
		try {
			exitCode = wasiRuntime.start(
				instance as { exports: { memory: WebAssembly.Memory; _start: () => unknown } }
			);
		} catch (error) {
			if (error instanceof WASIProcExit) {
				exitCode = error.code;
			} else {
				throw error;
			}
		}

		if (log) {
			console.log(`[wasm-idle:tinygo-worker] wasi run complete exitCode=${String(exitCode)}`);
		}
		if (exitCode !== 0) {
			throw new Error(`TinyGo program exited with code ${exitCode}`);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:tinygo-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
