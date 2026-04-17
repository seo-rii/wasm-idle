import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushQueuedStdin } from '$lib/playground/stdinBuffer';

const encoder = new TextEncoder();

const wasiState = vi.hoisted(() => ({
	lastArgs: [] as string[],
	lastEnv: [] as string[],
	lastFds: [] as any[],
	initializeCalls: 0,
	instReady: false
}));

vi.mock('@bjorn3/browser_wasi_shim', () => {
	class Fd {}

	class ConsoleStdout {
		write: (chunk: Uint8Array) => void;

		constructor(write: (chunk: Uint8Array) => void) {
			this.write = write;
		}
	}

	class WASI {
		wasiImport = {};

		constructor(args: string[], env: string[], fds: any[]) {
			wasiState.lastArgs = args;
			wasiState.lastEnv = env;
			wasiState.lastFds = fds;
		}

		start() {
			wasiState.instReady = true;
			const stdinChunk = wasiState.lastFds[0].fd_read(1024).data;
			if (stdinChunk.byteLength) {
				wasiState.lastFds[1].write(stdinChunk);
			}
			wasiState.lastFds[1].write(encoder.encode('tinygo-worker\n'));
			return 0;
		}

		initialize() {
			wasiState.initializeCalls += 1;
			wasiState.instReady = true;
		}
	}

	class WASIProcExit extends Error {
		code: number;

		constructor(code: number) {
			super(`exit ${code}`);
			this.code = code;
		}
	}

	return {
		Fd,
		ConsoleStdout,
		WASI,
		WASIProcExit,
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
	};
});

describe('TinyGo worker', () => {
	beforeEach(() => {
		vi.resetModules();
		(globalThis as any).self = globalThis as any;
		(globalThis as any).document = undefined;
		(globalThis as any).postMessage = vi.fn();
		(globalThis as any).WebAssembly = {
			instantiate: vi.fn(async () => ({
				instance: {
					exports: {
						memory: {},
						_start() {}
					}
				}
			}))
		};
		wasiState.lastArgs = [];
		wasiState.lastEnv = [];
		wasiState.lastFds = [];
		wasiState.initializeCalls = 0;
		wasiState.instReady = false;
	});

	it('loads and executes a TinyGo wasm artifact through the WASI shim', async () => {
		const buffer = new SharedArrayBuffer(1024);
		const queuedInput = ['5\n'];
		(globalThis as any).postMessage = vi.fn((message: any) => {
			if (message?.buffer) {
				flushQueuedStdin(queuedInput, buffer);
			}
		});

		await import('./tinygo');
		await (globalThis as any).self.onmessage({
			data: {
				load: true
			}
		});
		await Promise.resolve();

		await (globalThis as any).self.onmessage({
			data: {
				artifact: new Uint8Array([0, 97, 115, 109]),
				buffer,
				args: ['demo'],
				log: true
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'tinygo-worker\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		expect(wasiState.lastArgs).toEqual(['demo']);
		expect(wasiState.lastEnv).toEqual(['USER=jungol']);
		expect((globalThis as any).WebAssembly.instantiate).toHaveBeenCalledWith(
			expect.any(Uint8Array),
			{
				wasi_snapshot_preview1: {},
				wasi_unstable: {}
			}
		);
	});

	it('initializes and runs a reactor-style TinyGo artifact when _start is absent', async () => {
		(globalThis as any).WebAssembly = {
			instantiate: vi.fn(async () => ({
				instance: {
					exports: {
						memory: {},
						_initialize() {},
						main() {
							return 0;
						}
					}
				}
			}))
		};

		await import('./tinygo');
		await (globalThis as any).self.onmessage({
			data: {
				artifact: new Uint8Array([0, 97, 115, 109]),
				buffer: new SharedArrayBuffer(1024),
				args: ['reactor'],
				log: false
			}
		});
		await Promise.resolve();

		expect(wasiState.initializeCalls).toBe(1);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('runs a main-only reactor-style TinyGo artifact when _initialize is absent', async () => {
		const callCtors = vi.fn();
		(globalThis as any).WebAssembly = {
			instantiate: vi.fn(async () => ({
				instance: {
					exports: {
						memory: {},
						__wasm_call_ctors: callCtors,
						main() {
							if (!wasiState.instReady) {
								throw new Error('wasi not initialized');
							}
							return 0;
						}
					}
				}
			}))
		};

		await import('./tinygo');
		await (globalThis as any).self.onmessage({
			data: {
				artifact: new Uint8Array([0, 97, 115, 109]),
				buffer: new SharedArrayBuffer(1024),
				args: ['reactor-main-only'],
				log: false
			}
		});
		await Promise.resolve();

		expect(wasiState.initializeCalls).toBe(1);
		expect(callCtors).toHaveBeenCalledTimes(1);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});

	it('accepts an initialize-only reactor-style TinyGo artifact', async () => {
		(globalThis as any).WebAssembly = {
			instantiate: vi.fn(async () => ({
				instance: {
					exports: {
						memory: {},
						_initialize() {}
					}
				}
			}))
		};

		await import('./tinygo');
		await (globalThis as any).self.onmessage({
			data: {
				artifact: new Uint8Array([0, 97, 115, 109]),
				buffer: new SharedArrayBuffer(1024),
				args: ['reactor-initialize-only'],
				log: false
			}
		});
		await Promise.resolve();

		expect(wasiState.initializeCalls).toBe(1);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
	});
});
