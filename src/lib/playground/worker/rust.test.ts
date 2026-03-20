import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushQueuedStdin } from '$lib/playground/stdinBuffer';

const wasiInstances: MockWASI[] = [];
let wasiStartBehavior: ((instance: MockWASI) => number) | null = null;
let lastStdinRead = '';

class MockFd {}

class MockFile {
	data: Uint8Array;
	options: { readonly?: boolean };

	constructor(data: Uint8Array, options: { readonly?: boolean } = {}) {
		this.data = data;
		this.options = options;
	}
}

class MockOpenFile {
	file: MockFile;

	constructor(file: MockFile) {
		this.file = file;
	}
}

class MockPreopenDirectory {
	name: string;
	contents: Map<string, unknown>;

	constructor(name: string, contents: Map<string, unknown>) {
		this.name = name;
		this.contents = contents;
	}
}

class MockWASI {
	args: string[];
	env: string[];
	fds: any[];
	wasiImport = {};

	constructor(args: string[], env: string[], fds: any[]) {
		this.args = args;
		this.env = env;
		this.fds = fds;
		wasiInstances.push(this);
	}

	start() {
		if (wasiStartBehavior) {
			return wasiStartBehavior(this);
		}
		this.fds[1]?.fd_write?.(new TextEncoder().encode('hi\n'));
		return 0;
	}
}

vi.mock('@bjorn3/browser_wasi_shim', () => ({
	Fd: MockFd,
	File: MockFile,
	OpenFile: MockOpenFile,
	PreopenDirectory: MockPreopenDirectory,
	WASI: MockWASI,
		wasi: {
			ERRNO_SUCCESS: 0,
			FILETYPE_CHARACTER_DEVICE: 2,
			RIGHTS_FD_READ: 2,
			RIGHTS_FD_WRITE: 64,
			Fdstat: class {
				fs_rights_base = 0n;
			constructor(
				public readonly filetype: number,
				public readonly flags: number
			) {}
		},
		Filestat: class {
			constructor(
				public readonly ino: bigint,
				public readonly filetype: number,
				public readonly size: bigint
			) {}
		}
	}
}));

describe('Rust worker', () => {
	beforeEach(() => {
		vi.resetModules();
		wasiInstances.length = 0;
		wasiStartBehavior = null;
		lastStdinRead = '';
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
	});

	it('loads a wasm-rust-style compiler module and runs the returned wasm artifact', async () => {
		const compilerModuleUrl = `data:text/javascript;base64,${btoa(
			`export async function createRustCompiler() {
				return {
					async compile(options) {
						if (!options.log) {
							throw new Error('expected log option');
						}
						return {
							stdout: 'build log\\n',
							success: true,
							diagnostics: [
								{
									lineNumber: 1,
									columnNumber: 1,
									severity: 'warning',
									message: 'demo warning'
								}
							],
							artifact: {
								wasm: new Uint8Array([0,97,115,109,1,0,0,0])
							}
						};
					}
				};
			}
			export default createRustCompiler;`
		)}`;

		await import('./rust');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl,
				path: '/absproxy/5173'
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				code: 'fn main() { println!("hi"); }',
				prepare: false,
				buffer: new SharedArrayBuffer(1024),
				args: ['one'],
				log: true
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			diagnostic: {
				lineNumber: 1,
				columnNumber: 1,
				severity: 'warning',
				message: 'demo warning'
			}
		});
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'build log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'hi\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect(wasiInstances[0]?.args).toEqual(['main.wasm', 'one']);
		expect(wasiInstances[0]?.env).toEqual(['USER=jungol']);
	});

	it('reads stdin from the shared buffer when the wasi program requests input', async () => {
		const compilerModuleUrl = `data:text/javascript;base64,${btoa(
			`export async function createRustCompiler() {
				return {
					async compile() {
						return {
							success: true,
							artifact: {
								wasm: new Uint8Array([0,97,115,109,1,0,0,0])
							}
						};
					}
				};
			}
			export default createRustCompiler;`
		)}`;
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['5\n'];

		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				flushQueuedStdin(queuedInput, buffer);
			}
		});
		wasiStartBehavior = (instance) => {
			const read = instance.fds[0]?.fd_read?.(16);
			const data =
				read?.data && typeof read.data.byteLength === 'number'
					? new Uint8Array(read.data)
					: new Uint8Array(0);
			lastStdinRead = new TextDecoder().decode(data);
			instance.fds[1]?.fd_write?.(data);
			return 0;
		};

		await import('./rust');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: compilerModuleUrl,
				path: '/absproxy/5173'
			}
		});
		await Promise.resolve();
		await (globalThis as any).self.onmessage({
			data: {
				code: 'use std::io::{self, Read}; fn main() { let mut input = String::new(); io::stdin().read_to_string(&mut input).unwrap(); print!("{input}"); }',
				prepare: false,
				buffer
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect(lastStdinRead).toBe('5\n');
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});
});
