import { beforeEach, describe, expect, it, vi } from 'vitest';

const shim = vi.hoisted(() => {
	const state = {
		constructed: [] as { args: string[]; env: string[]; fds: any[]; wasi: any }[],
		extractCount: 0,
		nextExtractExitCode: 0,
		nextSymlink: null as null | { target: string; path: string },
		pathLookups: [] as string[],
		pathLinks: [] as { path: string; inode: any; allowDir: boolean }[]
	};

	class File {
		data: Uint8Array;

		constructor(data: ArrayBuffer | Uint8Array | number[]) {
			this.data = new Uint8Array(data as ArrayBuffer | Uint8Array);
		}
	}

	class OpenFile {
		constructor(public file: File) {}
	}

	class PreopenDirectory {
		targetFile = new File(new Uint8Array([1]));
		dir = {
			get_entry_for_path: () => ({ ret: 0, entry: this.targetFile })
		};
		constructor(
			public name: string,
			public contents: Map<string, any>
		) {}

		path_lookup(path: string) {
			state.pathLookups.push(path);
			return { ret: 0, inode_obj: this.targetFile };
		}

		path_link(path: string, inode: any, allowDir: boolean) {
			state.pathLinks.push({ path, inode, allowDir });
			return 0;
		}
	}

	class ConsoleStdout {
		constructor(public write: (chunk: Uint8Array) => void) {}

		static lineBuffered(writeLine: (line: string) => void) {
			return new ConsoleStdout((chunk) => writeLine(new TextDecoder().decode(chunk)));
		}
	}

	class WASI {
		wasiImport = {};
		args: string[];
		env: string[];
		fds: any[];
		inst = {
			exports: {
				memory: new WebAssembly.Memory({ initial: 1 })
			}
		};

		constructor(args: string[], env: string[], fds: any[]) {
			this.args = args;
			this.env = env;
			this.fds = fds;
			state.constructed.push({ args, env, fds, wasi: this });
		}

		start(instance: { exports?: { memory?: WebAssembly.Memory } }) {
			if (instance.exports?.memory) {
				this.inst.exports.memory = instance.exports.memory;
			}
			state.extractCount += 1;
			if (state.nextSymlink) {
				const encoder = new TextEncoder();
				const target = encoder.encode(state.nextSymlink.target);
				const path = encoder.encode(state.nextSymlink.path);
				const memory = new Uint8Array(this.inst.exports.memory.buffer);
				memory.set(target, 16);
				memory.set(path, 128);
				(this.wasiImport as any).fd_filestat_set_times?.();
				(this.wasiImport as any).path_filestat_set_times?.();
				(this.wasiImport as any).path_symlink?.(
					16,
					target.byteLength,
					3,
					128,
					path.byteLength
				);
			}
			return state.nextExtractExitCode;
		}
	}

	return {
		state,
		File,
		OpenFile,
		PreopenDirectory,
		ConsoleStdout,
		WASI
	};
});

vi.mock('@bjorn3/browser_wasi_shim', () => ({
	File: shim.File,
	OpenFile: shim.OpenFile,
	PreopenDirectory: shim.PreopenDirectory,
	ConsoleStdout: shim.ConsoleStdout,
	WASI: shim.WASI,
	wasi: {
		ERRNO_SUCCESS: 0,
		ERRNO_BADF: 8
	}
}));

function responseFor(data: Uint8Array) {
	return {
		ok: true,
		status: 200,
		headers: {
			get(name: string) {
				return name.toLowerCase() === 'content-length' ? String(data.byteLength) : null;
			}
		},
		async arrayBuffer() {
			return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
		}
	};
}

function createMockDyldModule(source: string) {
	return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}

describe('Haskell worker', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).__lastDyldOptions = undefined;
		(globalThis as any).__lastHostOptions = undefined;
		(globalThis as any).__lastMainCall = undefined;
		(globalThis as any).fetch = vi.fn(async (url: string) => {
			if (url.endsWith('bsdtar.wasm')) return responseFor(new Uint8Array([0, 97, 115, 109]));
			if (url.endsWith('rootfs.tar.zst'))
				return responseFor(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]));
			return { ok: false, status: 404, headers: { get: () => null } };
		});
		vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
			instance: {
				exports: {
					memory: new WebAssembly.Memory({ initial: 1 }),
					_start() {}
				}
			}
		} as unknown as WebAssembly.Instance);
		shim.state.constructed = [];
		shim.state.extractCount = 0;
		shim.state.nextExtractExitCode = 0;
		shim.state.nextSymlink = null;
		shim.state.pathLookups = [];
		shim.state.pathLinks = [];
	});

	it('loads the wasm GHC rootfs, starts dyld, and runs Haskell source', async () => {
		const moduleUrl = createMockDyldModule(`
			export class DyLDBrowserHost {
				constructor(options) {
					globalThis.__lastHostOptions = options;
					this.options = options;
				}
			}

			export async function main(options) {
				globalThis.__lastDyldOptions = options;
				return {
					exportFuncs: {
						async myMain(libdir) {
							globalThis.__lastLibdir = libdir;
							return async (ghcArgs, source) => {
								globalThis.__lastMainCall = { ghcArgs, source };
								options.rpc.options.stdout('hello from haskell');
							};
						}
					}
				};
			}
		`);

		await import('./haskell');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl,
				rootfsUrl: '/wasm-haskell/rootfs.tar.zst',
				bsdtarUrl: '/wasm-haskell/bsdtar.wasm',
				mainSoPath: '/tmp/libplayground001.so',
				searchDirs: ['/tmp/clib', '/tmp/hslib/lib/wasm32-wasi-ghc'],
				log: false
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'main = putStrLn "hello"',
				prepare: false,
				ghcArgs: '-Wall',
				activePath: 'main.hs',
				workspaceFiles: [{ path: 'main.hs', content: 'main = putStrLn "hello"' }]
			}
		});
		await Promise.resolve();

		expect((globalThis as any).fetch).toHaveBeenCalledWith('/wasm-haskell/bsdtar.wasm');
		expect((globalThis as any).fetch).toHaveBeenCalledWith('/wasm-haskell/rootfs.tar.zst');
		expect(shim.state.constructed[0].args).toEqual(['bsdtar.wasm', '-x']);
		expect(shim.state.extractCount).toBe(1);
		expect(shim.state.constructed[0].wasi.wasiImport.fd_filestat_set_times()).toBe(0);
		expect(shim.state.constructed[0].wasi.wasiImport.path_filestat_set_times()).toBe(0);
		expect((globalThis as any).__lastDyldOptions.searchDirs).toEqual([
			'/tmp/clib',
			'/tmp/hslib/lib/wasm32-wasi-ghc'
		]);
		expect((globalThis as any).__lastDyldOptions.mainSoPath).toBe('/tmp/libplayground001.so');
		expect(typeof (globalThis as any).__lastHostOptions.stdin.fd_read).toBe('function');
		expect((globalThis as any).__lastLibdir).toBe('/tmp/hslib/lib');
		expect((globalThis as any).__lastMainCall).toEqual({
			ghcArgs: '-Wall',
			source: 'main = putStrLn "hello"'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'hello from haskell\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('connects run stdin to the dyld browser host fd0 implementation', async () => {
		const moduleUrl = createMockDyldModule(`
			const decoder = new TextDecoder();
			export class DyLDBrowserHost {
				constructor(options) {
					globalThis.__lastHostOptions = options;
					this.options = options;
				}
			}

			export async function main(options) {
				return {
					exportFuncs: {
						async myMain() {
							return async () => {
								const first = options.rpc.options.stdin.fd_read(2).data;
								const second = options.rpc.options.stdin.fd_read(64).data;
								const eof = options.rpc.options.stdin.fd_read(64).data;
								options.rpc.options.stdout(
									'stdin=' + JSON.stringify(decoder.decode(first) + decoder.decode(second)) + ';eof=' + eof.byteLength
								);
							};
						}
					}
				};
			}
		`);

		await import('./haskell');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl,
				rootfsUrl: '/wasm-haskell/rootfs.tar.zst',
				bsdtarUrl: '/wasm-haskell/bsdtar.wasm'
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'main = getLine >>= putStrLn',
				prepare: false,
				stdin: '68\n'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			output: 'stdin="68\\n";eof=0\n'
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('materializes rootfs symlinks as in-memory hard links after extraction', async () => {
		const moduleUrl = createMockDyldModule(`
			export class DyLDBrowserHost {
				constructor(options) { this.options = options; }
			}
			export async function main() {
				return {
					exportFuncs: {
						async myMain() {
							return async () => {};
						}
					}
				};
			}
		`);
		shim.state.nextSymlink = {
			target: 'libHSrts-1.0.3-ghc9.14.0.20251031.so',
			path: 'tmp/hslib/lib/wasm32-wasi-ghc-9.14.0.20251031-inplace/libHSrts-ghc9.14.0.20251031.so'
		};

		await import('./haskell');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl,
				rootfsUrl: '/wasm-haskell/rootfs.tar.zst',
				bsdtarUrl: '/wasm-haskell/bsdtar.wasm'
			}
		});
		await Promise.resolve();

		expect(shim.state.pathLookups).toEqual([
			'tmp/hslib/lib/wasm32-wasi-ghc-9.14.0.20251031-inplace/libHSrts-1.0.3-ghc9.14.0.20251031.so'
		]);
		expect(shim.state.pathLinks).toMatchObject([
			{
				path: 'tmp/hslib/lib/wasm32-wasi-ghc-9.14.0.20251031-inplace/libHSrts-ghc9.14.0.20251031.so',
				allowDir: false
			}
		]);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
	});

	it('treats prepare as a load-only success and caches the rootfs runtime', async () => {
		const moduleUrl = createMockDyldModule(`
			export class DyLDBrowserHost {
				constructor(options) { this.options = options; }
			}
			export async function main(options) {
				return {
					exportFuncs: {
						async myMain() {
							return async () => options.rpc.options.stdout('cached');
						}
					}
				};
			}
		`);

		await import('./haskell');
		const loadMessage = {
			load: true,
			moduleUrl,
			rootfsUrl: '/wasm-haskell/rootfs.tar.zst',
			bsdtarUrl: '/wasm-haskell/bsdtar.wasm',
			mainSoPath: '/tmp/libplayground001.so',
			searchDirs: ['/tmp/clib']
		};
		await (globalThis as any).self.onmessage({ data: loadMessage });
		await (globalThis as any).self.onmessage({
			data: {
				code: 'main = pure ()',
				prepare: true
			}
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: 'main = pure ()',
				prepare: false
			}
		});
		await Promise.resolve();

		expect(shim.state.extractCount).toBe(1);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'cached\n' });
	});

	it('normalizes GHC diagnostics from stderr output', async () => {
		const moduleUrl = createMockDyldModule(`
			export class DyLDBrowserHost {
				constructor(options) {
					this.options = options;
				}
			}

			export async function main(options) {
				return {
					exportFuncs: {
						async myMain() {
							return async () => {
								options.rpc.options.stderr('main.hs:2:1: error: Variable not in scope: nope');
								throw new Error('compile failed');
							};
						}
					}
				};
			}
		`);

		await import('./haskell');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				moduleUrl,
				rootfsUrl: '/wasm-haskell/rootfs.tar.zst',
				bsdtarUrl: '/wasm-haskell/bsdtar.wasm'
			}
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: 'main = nope',
				prepare: false,
				activePath: 'main.hs'
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				fileName: 'main.hs',
				lineNumber: 2,
				columnNumber: 1,
				severity: 'error',
				message: 'Variable not in scope: nope'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'main.hs:2:1: error: Variable not in scope: nope'
		});
	});

	it('parses multiline GHC diagnostics without running the worker', async () => {
		const { parseHaskellDiagnostics } = await import('./haskell');

		expect(
			parseHaskellDiagnostics(`main.hs:4:7: warning:
    Defined but not used: 'value'
  |
4 | value = 1
  |       ^`)
		).toEqual([
			{
				fileName: 'main.hs',
				lineNumber: 4,
				columnNumber: 7,
				severity: 'warning',
				message: "Defined but not used: 'value'"
			}
		]);
	});
});
