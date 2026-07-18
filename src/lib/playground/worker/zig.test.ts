import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { flushQueuedStdin } from '$lib/playground/stdinBuffer';

const encoder = new TextEncoder();
const stdlibArchive = zipSync({
	'std/std.zig': strToU8('pub const std = true;')
});

const shim = vi.hoisted(() => {
	const encoder = new TextEncoder();
	const state = {
		constructed: [] as { args: string[]; env: string[]; fds: any[] }[],
		nextCompileExitCode: 0,
		compileCount: 0,
		runCount: 0
	};

	class Fd {}

	class File {
		data: Uint8Array;

		constructor(data: ArrayBuffer | Uint8Array | number[]) {
			this.data = new Uint8Array(data as ArrayBuffer | Uint8Array);
		}
	}

	class Directory {
		contents: Map<string, any>;

		constructor(contents: Map<string, any> | [string, any][]) {
			this.contents = contents instanceof Map ? contents : new Map(contents);
		}
	}

	class OpenFile {
		constructor(public file: File) {}
	}

	class PreopenDirectory {
		dir: Directory;

		constructor(
			public name: string,
			contents: Map<string, any>
		) {
			this.dir = new Directory(contents);
		}
	}

	class ConsoleStdout {
		constructor(public write: (chunk: Uint8Array) => void) {}
	}

	class WASI {
		wasiImport = {};
		args: string[];
		env: string[];
		fds: any[];

		constructor(args: string[], env: string[], fds: any[]) {
			this.args = args;
			this.env = env;
			this.fds = fds;
			state.constructed.push({ args, env, fds });
		}

		start() {
			if (this.args[0] === 'zigc.wasm') {
				state.compileCount += 1;
				this.fds[1].write(encoder.encode('compile log\n'));
				if (state.nextCompileExitCode !== 0) return state.nextCompileExitCode;
				this.fds[3].dir.contents.set('output.wasm', new File(encoder.encode('wasm-out')));
				return 0;
			}
			state.runCount += 1;
			const stdinChunk = this.fds[0].fd_read(1024).data;
			if (stdinChunk.byteLength) this.fds[1].write(stdinChunk);
			this.fds[1].write(encoder.encode('zig-worker\n'));
			return 0;
		}
	}

	return {
		state,
		Fd,
		File,
		Directory,
		OpenFile,
		PreopenDirectory,
		ConsoleStdout,
		WASI
	};
});

vi.mock('@bjorn3/browser_wasi_shim', () => ({
	Fd: shim.Fd,
	File: shim.File,
	Directory: shim.Directory,
	OpenFile: shim.OpenFile,
	PreopenDirectory: shim.PreopenDirectory,
	ConsoleStdout: shim.ConsoleStdout,
	WASI: shim.WASI,
	wasi: {
		ERRNO_SUCCESS: 0,
		FILETYPE_CHARACTER_DEVICE: 2,
		RIGHTS_FD_READ: 2,
		Fdstat: class {
			fs_rights_base = 0n;
			fs_rights_inherited = 0n;
			constructor(_filetype: number, _flags: number) {}
		},
		Filestat: class {
			constructor(_ino: bigint, _filetype: number, _size: bigint) {}
		}
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

describe('Zig worker', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).fetch = vi.fn(async (url: string) => {
			if (url.endsWith('zig_small.wasm'))
				return responseFor(new Uint8Array([0, 97, 115, 109]));
			if (url.endsWith('std.zip')) return responseFor(stdlibArchive);
			return { ok: false, status: 404, headers: { get: () => null } };
		});
		vi.spyOn(WebAssembly, 'compile').mockResolvedValue({} as WebAssembly.Module);
		(vi.spyOn(WebAssembly, 'instantiate') as any).mockResolvedValue({
			instance: {
				exports: {
					memory: {},
					_start() {}
				}
			},
			module: {} as WebAssembly.Module
		});
		shim.state.constructed = [];
		shim.state.nextCompileExitCode = 0;
		shim.state.compileCount = 0;
		shim.state.runCount = 0;
	});

	it('loads compiler assets, compiles Zig source, and runs the emitted WASI artifact', async () => {
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['5\n'];
		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				flushQueuedStdin(queuedInput, buffer);
			}
		});

		await import('./zig');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: '/wasm-zig/zig_small.wasm',
				stdlibUrl: '/wasm-zig/std.zip',
				log: false
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'const helper = @import("helper.zig"); pub fn main() void { _ = helper; }',
				prepare: false,
				buffer,
				args: ['demo'],
				compileArgs: ['-O', 'Debug'],
				activePath: 'src/main.zig',
				workspaceFiles: [
					{ path: 'src/main.zig', content: '' },
					{ path: 'src/helper.zig', content: 'pub const bonus = 3;' }
				],
				targetTriple: 'wasm64-wasi',
				log: false
			}
		});
		await Promise.resolve();

		const compileWasi = shim.state.constructed[0];
		const runWasi = shim.state.constructed[1];
		expect((globalThis as any).fetch).toHaveBeenCalledWith('/wasm-zig/zig_small.wasm');
		expect((globalThis as any).fetch).toHaveBeenCalledWith('/wasm-zig/std.zip');
		expect(compileWasi.args).toEqual([
			'zigc.wasm',
			'build-exe',
			'src/main.zig',
			'-Dtarget=wasm64-wasi',
			'-fno-llvm',
			'-fno-lld',
			'-O',
			'ReleaseSmall',
			'-femit-bin=output.wasm',
			'-O',
			'Debug'
		]);
		expect(runWasi.args).toEqual(['output.wasm', 'demo']);
		expect(runWasi.env).toEqual(['USER=jungol']);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'compile log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'zig-worker\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect(shim.state.compileCount).toBe(1);
		expect(shim.state.runCount).toBe(1);
	});

	it('uses the cached compiled artifact for the run after prepare', async () => {
		const buffer = new SharedArrayBuffer(1024);

		await import('./zig');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: '/wasm-zig/zig_small.wasm',
				stdlibUrl: '/wasm-zig/std.zip',
				log: false
			}
		});
		await Promise.resolve();

		const request = {
			code: 'pub fn main() void {}',
			buffer,
			stdin: '',
			activePath: 'main.zig',
			workspaceFiles: [{ path: 'main.zig', content: 'pub fn main() void {}' }],
			targetTriple: 'wasm64-wasi',
			log: false
		};
		await (globalThis as any).self.onmessage({
			data: {
				...request,
				prepare: true
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				...request,
				prepare: false
			}
		});
		await Promise.resolve();

		expect(shim.state.compileCount).toBe(1);
		expect(shim.state.runCount).toBe(1);
	});

	it('posts a compile error when the Zig compiler exits non-zero', async () => {
		shim.state.nextCompileExitCode = 1;

		await import('./zig');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: '/wasm-zig/zig_small.wasm',
				stdlibUrl: '/wasm-zig/std.zip',
				log: false
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'pub fn main() void {',
				prepare: true,
				buffer: new SharedArrayBuffer(1024),
				activePath: 'main.zig',
				targetTriple: 'wasm64-wasi',
				log: false
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'compile log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ error: 'compile log\n' });
		expect(shim.state.runCount).toBe(0);
	});
});
