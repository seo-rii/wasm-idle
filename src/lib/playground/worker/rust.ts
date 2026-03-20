import { Fd, File, OpenFile, PreopenDirectory, WASI, wasi } from '@bjorn3/browser_wasi_shim';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';

declare var self: any;

self.document = {
	querySelectorAll() {
		return [];
	}
};

let stdinBufferRust: Int32Array | null = null;
let compilerUrl = '';
let assetPath = '';
let loadedCompilerUrl = '';
let compilerPromise: Promise<any> | null = null;
let compiledCode = '';
let compiledWasm: Uint8Array | null = null;

class TerminalFd extends Fd {
	private readonly decoder = new TextDecoder();

	constructor(
		private readonly output: (text: string) => void,
		private readonly trace?: (message: string) => void
	) {
		super();
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: new wasi.Filestat(0n, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
		};
	}

	fd_fdstat_get() {
		const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
		fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_WRITE);
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat
		};
	}

	fd_write(data: Uint8Array) {
		const text = this.decoder.decode(data, { stream: true });
		this.trace?.(`fd_write(bytes=${data.byteLength}, text=${JSON.stringify(text)})`);
		if (text) {
			this.output(text);
		}
		return {
			ret: wasi.ERRNO_SUCCESS,
			nwritten: data.byteLength
		};
	}

	flush() {
		const text = this.decoder.decode();
		if (!text) {
			return;
		}
		this.trace?.(`fd_flush(text=${JSON.stringify(text)})`);
		this.output(text);
	}
}

class StdinFd extends Fd {
	private readonly encoder = new TextEncoder();
	private currentChunk = new Uint8Array(0);
	private currentOffset = 0;

	constructor(
		private readonly readInput: () => string | null,
		private readonly trace?: (message: string) => void
	) {
		super();
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: new wasi.Filestat(0n, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
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
		while (this.currentOffset >= this.currentChunk.length) {
			const chunk = this.readInput();
			if (chunk == null) {
				this.trace?.('fd_read(bytes=0, eof=true)');
				return {
					ret: wasi.ERRNO_SUCCESS,
					data: new Uint8Array(0)
				};
			}
			this.currentChunk = this.encoder.encode(chunk);
			this.currentOffset = 0;
			this.trace?.(
				`fd_fill(bytes=${this.currentChunk.byteLength}, text=${JSON.stringify(chunk)})`
			);
		}

		const data = this.currentChunk.slice(this.currentOffset, this.currentOffset + size);
		this.currentOffset += data.byteLength;
		this.trace?.(`fd_read(bytes=${data.byteLength})`);
		return {
			ret: wasi.ERRNO_SUCCESS,
			data
		};
	}
}

async function loadCompiler(url: string) {
	if (!url) {
		throw new Error(
			'Rust runtime is not configured. Set PUBLIC_WASM_RUST_COMPILER_URL or runtimeAssets.rust.compilerUrl.'
		);
	}
	if (loadedCompilerUrl === url && compilerPromise) {
		return await compilerPromise;
	}
	loadedCompilerUrl = url;
	compiledCode = '';
	compiledWasm = null;
	compilerPromise = (async () => {
		const module = await import(/* @vite-ignore */ url);
		const factory =
			typeof module.createRustCompiler === 'function'
				? module.createRustCompiler
				: typeof module.default === 'function'
					? module.default
					: null;
		if (!factory) {
			throw new Error(
				'wasm-rust module must export createRustCompiler or a default factory'
			);
		}
		return await factory();
	})();
	return await compilerPromise;
}

self.onmessage = async (event: { data: any }) => {
	const { load, compilerUrl: nextCompilerUrl, path, buffer, code, prepare, args = [], log } =
		event.data;
	try {
		if (load) {
			compilerUrl = nextCompilerUrl;
			assetPath = path;
			if (log) {
				console.log(`[wasm-idle:rust-worker] load compilerUrl=${compilerUrl}`);
			}
			await loadCompiler(compilerUrl);
			postMessage({ load: true });
			return;
		}

		stdinBufferRust = new Int32Array(buffer);
		const compiler = await loadCompiler(compilerUrl);
		if (!compiledWasm || compiledCode !== code) {
			if (log) {
				console.log(
					`[wasm-idle:rust-worker] compile start prepare=${String(prepare)} bytes=${code.length}`
				);
			}
			const result = await compiler.compile({
				code,
				edition: '2024',
				crateType: 'bin',
				prepare,
				log
			});
			if (log) {
				console.log(
					`[wasm-idle:rust-worker] compile settled success=${String(result.success)} hasWasm=${String(Boolean(result.artifact?.wasm))} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
				);
			}
			for (const diagnostic of result.diagnostics || []) {
				postMessage({ diagnostic });
			}
			if (result.stdout) postMessage({ output: result.stdout });
			if (!result.success) {
				throw new Error(
					result.stderr ||
						result.diagnostics?.map((diagnostic: any) => diagnostic.message).join('\n') ||
						'Rust compilation failed'
				);
			}
			if (result.stderr) postMessage({ output: result.stderr });
			const wasm = result.artifact?.wasm;
			if (!wasm) {
				if (result.artifact?.wat) {
					throw new Error(
						'wasm-rust returned a WAT artifact, but this wasm-idle build expects wasm bytes'
					);
				}
				throw new Error('wasm-rust did not return a wasm artifact');
			}
			compiledWasm = wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm);
			compiledCode = code;
			if (log) {
				console.log(
					`[wasm-idle:rust-worker] cached wasm bytes=${compiledWasm.byteLength}`
				);
			}
		}

		if (prepare) {
			if (log) {
				console.log('[wasm-idle:rust-worker] prepare complete');
			}
			postMessage({ results: true });
			return;
		}

		if (log) {
			console.log('[wasm-idle:rust-worker] compiling wasm module');
		}
		const module = await WebAssembly.compile(Uint8Array.from(compiledWasm!));
		if (log) {
			console.log(
				`[wasm-idle:rust-worker] wasm module compiled imports=${JSON.stringify(WebAssembly.Module.imports(module))} exports=${JSON.stringify(WebAssembly.Module.exports(module))}`
			);
		}
		const stdout = new TerminalFd(
			(output) => postMessage({ output }),
			log ? (message) => console.log(`[wasm-idle:rust-stdout] ${message}`) : undefined
		);
		const stderr = new TerminalFd(
			(output) => postMessage({ output }),
			log ? (message) => console.log(`[wasm-idle:rust-stderr] ${message}`) : undefined
		);
		const stdin = new StdinFd(
			() => waitForBufferedStdin(stdinBufferRust!, () => postMessage({ buffer: true })),
			log ? (message) => console.log(`[wasm-idle:rust-stdin] ${message}`) : undefined
		);
		const wasiInstance = new WASI(
			['main.wasm', ...args],
			['USER=jungol'],
			[
				stdin,
				stdout,
				stderr,
				new PreopenDirectory('/tmp', new Map())
			]
		);
		const instance = await WebAssembly.instantiate(module, {
			wasi_snapshot_preview1: wasiInstance.wasiImport
		});
		if (log) {
			console.log('[wasm-idle:rust-worker] wasi instance ready');
		}
		const exitCode = wasiInstance.start(instance as any);
		stdout.flush();
		stderr.flush();
		if (log) {
			console.log(`[wasm-idle:rust-worker] wasi run complete exitCode=${String(exitCode)}`);
		}
		if (exitCode !== 0) {
			throw new Error(`Rust program exited with code ${exitCode}`);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:rust-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
