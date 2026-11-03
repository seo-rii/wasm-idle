import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { flushQueuedStdin } from '$lib/playground/stdinBuffer';
import { decompressGzip } from '@wasm-idle/llvm-core';

vi.mock('@wasm-idle/llvm-core', async (importOriginal) => {
	const original = await importOriginal<typeof import('@wasm-idle/llvm-core')>();
	return { ...original, decompressGzip: vi.fn(original.decompressGzip) };
});

const debugPipeline = vi.hoisted(() => ({ compileZigDebugArtifact: vi.fn() }));
vi.mock('./zigDebug', async (importOriginal) => ({
	...(await importOriginal<typeof import('./zigDebug')>()),
	compileZigDebugArtifact: debugPipeline.compileZigDebugArtifact
}));

const encoder = new TextEncoder();
const compilerAsset = new Uint8Array([0, 97, 115, 109]);
const stdlibFile = strToU8('pub const std = true;');
const stdlibArchive = zipSync({
	'std/std.zig': stdlibFile
});
function createTar(entries: { path: string; contents: Uint8Array }[]) {
	const blocks: Buffer[] = [];
	for (const { path, contents } of entries) {
		const header = Buffer.alloc(512);
		header.write(path, 0, 100, 'utf8');
		header.write('0000644\0', 100, 8, 'ascii');
		header.write('0000000\0', 108, 8, 'ascii');
		header.write('0000000\0', 116, 8, 'ascii');
		header.write(`${contents.byteLength.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
		header.write('00000000000\0', 136, 12, 'ascii');
		header.fill(0x20, 148, 156);
		header.write('0', 156, 1, 'ascii');
		header.write('ustar\0', 257, 6, 'ascii');
		header.write('00', 263, 2, 'ascii');
		header.write(
			`${header
				.reduce((total, byte) => total + byte, 0)
				.toString(8)
				.padStart(6, '0')}\0 `,
			148,
			8,
			'ascii'
		);
		blocks.push(
			header,
			Buffer.from(contents),
			Buffer.alloc((512 - (contents.byteLength % 512)) % 512)
		);
	}
	blocks.push(Buffer.alloc(1024));
	return Buffer.concat(blocks);
}
const stdlibTar = createTar([
	{ path: 'lib/std/std.zig', contents: stdlibFile },
	{ path: 'lib/compiler_rt.zig', contents: strToU8('pub const compiler_rt = true;') }
]);
const stdlibTarGzip = gzipSync(stdlibTar, { level: 9 });
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const runtimeIntegrity = {
	'zig_small.wasm': {
		bytes: compilerAsset.byteLength,
		sha256: sha256(compilerAsset)
	},
	'std.tar.gz': {
		bytes: stdlibTarGzip.byteLength,
		sha256: sha256(stdlibTarGzip),
		uncompressedBytes: stdlibTar.byteLength,
		uncompressedSha256: sha256(stdlibTar)
	}
};
const maxAssetBytes = 128 * 1024 * 1024;

const shim = vi.hoisted(() => {
	const encoder = new TextEncoder();
	const state = {
		constructed: [] as { args: string[]; env: string[]; fds: any[] }[],
		nextCompileExitCode: 0,
		compileCount: 0,
		runCount: 0,
		compileOutput: null as ((fds: any[]) => void) | null,
		runOutput: null as ((fds: any[]) => void) | null
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
				if (state.compileOutput) state.compileOutput(this.fds);
				else this.fds[1].write(encoder.encode('compile log\n'));
				if (state.nextCompileExitCode !== 0) return state.nextCompileExitCode;
				const outputPath =
					this.args.find((argument) => argument.startsWith('-femit-'))?.split('=')[1] ||
					'output.wasm';
				this.fds[3].dir.contents.set(outputPath, new File(encoder.encode('wasm-out')));
				return 0;
			}
			state.runCount += 1;
			if (state.runOutput) {
				state.runOutput(this.fds);
				return 0;
			}
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
		ERRNO_SPIPE: 70,
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

function responseFor(data: Uint8Array, url: string) {
	return {
		ok: true,
		status: 200,
		url,
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
			if (url.endsWith('zig_small.wasm')) return responseFor(compilerAsset, url);
			if (url.endsWith('std.tar.gz')) return responseFor(stdlibTarGzip, url);
			if (url.endsWith('std.zip')) return responseFor(stdlibArchive, url);
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
		shim.state.compileOutput = null;
		shim.state.runOutput = null;
		debugPipeline.compileZigDebugArtifact.mockReset();
		vi.mocked(decompressGzip).mockClear();
	});

	it('compiles verified compiler bytes while the library download is still pending', async () => {
		let finishLibrary!: (response: ReturnType<typeof responseFor>) => void;
		const libraryResponse = new Promise<ReturnType<typeof responseFor>>((resolve) => {
			finishLibrary = resolve;
		});
		vi.mocked(globalThis.fetch).mockImplementation(async (url) =>
			String(url).endsWith('zig_small.wasm')
				? (responseFor(compilerAsset, String(url)) as Response)
				: (libraryResponse as unknown as Promise<Response>)
		);
		await import('./zig');
		const request = {
			data: {
				load: true,
				compilerUrl: 'https://assets.example.test/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/std.tar.gz',
				integrity: runtimeIntegrity,
				maxAssetBytes,
				log: false
			}
		};
		const first = (globalThis as any).self.onmessage(request);
		const concurrent = (globalThis as any).self.onmessage(request);
		try {
			await vi.waitFor(() => expect(WebAssembly.compile).toHaveBeenCalledOnce());
			expect(globalThis.fetch).toHaveBeenCalledTimes(2);
			expect(globalThis.postMessage).not.toHaveBeenCalledWith({ load: true });
		} finally {
			finishLibrary(responseFor(stdlibTarGzip, request.data.stdlibUrl));
			await Promise.all([first, concurrent]);
		}
		expect(globalThis.postMessage).toHaveBeenCalledWith({ load: true });
		await (globalThis as any).self.onmessage(request);
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		expect(WebAssembly.compile).toHaveBeenCalledOnce();
	});

	it('unpacks the library without waiting for the compiler and aborts it on an archive error', async () => {
		const missingStdTar = createTar([{ path: 'lib/compiler_rt.zig', contents: stdlibFile }]);
		const missingStdGzip = gzipSync(missingStdTar);
		let compilerSignal: AbortSignal | undefined;
		vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
			if (String(url).endsWith('zig_small.wasm')) {
				compilerSignal = init?.signal ?? undefined;
				return new Promise<Response>((_resolve, reject) => {
					compilerSignal?.addEventListener(
						'abort',
						() => reject(compilerSignal?.reason),
						{
							once: true
						}
					);
				});
			}
			return responseFor(missingStdGzip, String(url)) as Response;
		});
		await import('./zig');
		const load = (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: 'https://assets.example.test/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/std.tar.gz',
				integrity: {
					...runtimeIntegrity,
					'std.tar.gz': {
						bytes: missingStdGzip.byteLength,
						sha256: sha256(missingStdGzip),
						uncompressedBytes: missingStdTar.byteLength,
						uncompressedSha256: sha256(missingStdTar)
					}
				},
				maxAssetBytes,
				log: false
			}
		});
		await vi.waitFor(() =>
			expect(globalThis.postMessage).toHaveBeenCalledWith({
				error: 'Zig library archive must contain lib/std/'
			})
		);
		await load;
		expect(compilerSignal?.aborted).toBe(true);
		expect(WebAssembly.compile).not.toHaveBeenCalled();
		expect(globalThis.postMessage).not.toHaveBeenCalledWith({ load: true });
	});

	it('aborts a pending library download after compilation fails and allows a fresh retry', async () => {
		const compileFailure = new Error('compiler wasm failed to compile');
		vi.mocked(WebAssembly.compile).mockRejectedValueOnce(compileFailure);
		let librarySignal: AbortSignal | undefined;
		vi.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
			if (String(url).endsWith('zig_small.wasm')) {
				return responseFor(compilerAsset, String(url)) as Response;
			}
			librarySignal = init?.signal ?? undefined;
			return new Promise<Response>((_resolve, reject) => {
				librarySignal?.addEventListener('abort', () => reject(librarySignal?.reason), {
					once: true
				});
			});
		});
		await import('./zig');
		const request = {
			data: {
				load: true,
				compilerUrl: 'https://assets.example.test/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/std.tar.gz',
				integrity: runtimeIntegrity,
				maxAssetBytes,
				log: false
			}
		};
		const load = (globalThis as any).self.onmessage(request);
		await vi.waitFor(() =>
			expect(globalThis.postMessage).toHaveBeenCalledWith({ error: compileFailure.message })
		);
		await load;
		expect(librarySignal?.aborted).toBe(true);
		expect(globalThis.postMessage).not.toHaveBeenCalledWith({ load: true });
		vi.mocked(globalThis.fetch).mockImplementation(
			async (url) =>
				responseFor(
					String(url).endsWith('zig_small.wasm') ? compilerAsset : stdlibTarGzip,
					String(url)
				) as Response
		);
		await (globalThis as any).self.onmessage(request);
		expect(globalThis.postMessage).toHaveBeenCalledWith({ load: true });
		expect(WebAssembly.compile).toHaveBeenCalledTimes(2);
	});

	it('cancels library decompression when compiler preparation fails', async () => {
		let failCompilation!: (error: Error) => void;
		vi.mocked(WebAssembly.compile).mockImplementationOnce(
			() =>
				new Promise((_resolve, reject) => {
					failCompilation = reject;
				})
		);
		let decompressionSignal: AbortSignal | undefined;
		vi.mocked(decompressGzip).mockImplementationOnce((_bytes, _url, _limit, signal) => {
			decompressionSignal = signal;
			return new Promise((_resolve, reject) => {
				signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
			});
		});
		await import('./zig');
		const load = (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: 'https://assets.example.test/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/std.tar.gz',
				integrity: runtimeIntegrity,
				maxAssetBytes,
				log: false
			}
		});
		await vi.waitFor(() => {
			expect(decompressGzip).toHaveBeenCalledOnce();
			expect(WebAssembly.compile).toHaveBeenCalledOnce();
		});
		const failure = new Error('compiler preparation failed');
		failCompilation(failure);
		await load;
		expect(decompressionSignal?.aborted).toBe(true);
		expect(decompressionSignal?.reason).toBe(failure);
		expect(globalThis.postMessage).toHaveBeenCalledWith({ error: failure.message });
		expect(globalThis.postMessage).not.toHaveBeenCalledWith({ load: true });
	});

	it('does not unpack library files after cancellation during expanded-byte verification', async () => {
		const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
		let finishVerification!: () => void;
		const verification = new Promise<void>((resolve) => {
			finishVerification = resolve;
		});
		let verifyingExpandedBytes = false;
		vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => {
			if (bytes.byteLength === stdlibTar.byteLength) {
				verifyingExpandedBytes = true;
				await verification;
			}
			return originalDigest(algorithm, bytes);
		});
		const { loadLibDirectory } = await import('./zig');
		const controller = new AbortController();
		const loading = loadLibDirectory(
			stdlibTarGzip,
			'https://assets.example.test/std.tar.gz',
			{ signal: controller.signal },
			runtimeIntegrity['std.tar.gz']
		);
		await vi.waitFor(() => expect(verifyingExpandedBytes).toBe(true));
		const failure = new Error('compiler branch failed during library verification');
		controller.abort(failure);
		finishVerification();
		await expect(loading).rejects.toBe(failure);
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
				compilerUrl: 'https://assets.example.test/wasm-zig/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/wasm-zig/std.tar.gz',
				integrity: runtimeIntegrity,
				maxAssetBytes,
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
				targetTriple: 'wasm32-wasi',
				log: false
			}
		});
		await Promise.resolve();

		const compileWasi = shim.state.constructed[0];
		const runWasi = shim.state.constructed[1];
		expect((globalThis as any).fetch).toHaveBeenCalledWith(
			'https://assets.example.test/wasm-zig/zig_small.wasm',
			{
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: expect.any(AbortSignal)
			}
		);
		expect((globalThis as any).fetch).toHaveBeenCalledWith(
			'https://assets.example.test/wasm-zig/std.tar.gz',
			{
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: expect.any(AbortSignal)
			}
		);
		expect(compileWasi.args).toEqual([
			'zigc.wasm',
			'build-exe',
			'src/main.zig',
			'-target',
			'wasm32-wasi',
			'-fno-llvm',
			'-fno-lld',
			'-O',
			'fast',
			'-femit-bin=output.wasm',
			'-O',
			'Debug'
		]);
		expect(compileWasi.env).toEqual(['ZIG_LOCAL_CACHE_DIR=.zig-cache/local']);
		expect(compileWasi.fds.slice(3).map((fd) => fd.name)).toEqual(['.', '/lib', '/cache']);
		expect(compileWasi.fds[4].dir.contents.has('compiler_rt.zig')).toBe(true);
		expect(compileWasi.fds[4].dir.contents.get('std').contents.has('std.zig')).toBe(true);
		expect(runWasi.fds[3].name).toBe('.');
		expect(runWasi.fds[0].fd_pread(10, 0n)).toEqual({ ret: 70, data: new Uint8Array(0) });
		for (const stream of [...compileWasi.fds.slice(1, 3), ...runWasi.fds.slice(1, 3)]) {
			expect(stream.fd_pwrite(encoder.encode('must not be written'), 0n)).toEqual({
				ret: 70,
				nwritten: 0
			});
		}
		for (const stream of runWasi.fds.slice(0, 3)) {
			expect(stream.fd_seek(0n, 0)).toEqual({ ret: 70, offset: 0n });
			expect(stream.fd_tell()).toEqual({ ret: 70, offset: 0n });
		}
		expect(runWasi.args).toEqual(['output.wasm', 'demo']);
		expect(runWasi.env).toEqual(['USER=jungol']);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'compile log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ buffer: true });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: '5\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'zig-worker\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ results: true });
		const messages = (globalThis as any).postMessage.mock.calls.map(
			([message]: [any]) => message
		);
		const readyIndex = messages.findIndex((message: any) => message.progress?.kind === 'ready');
		expect(messages.filter((message: any) => message.progress?.kind === 'ready')).toEqual([
			{
				progress: {
					kind: 'ready',
					state: 'running',
					reason: 'started',
					label: 'Zig program started'
				}
			}
		]);
		expect(readyIndex).toBeGreaterThanOrEqual(0);
		expect(readyIndex).toBeLessThan(
			messages.findIndex((message: any) => message.output === '5\n')
		);
		expect(shim.state.compileCount).toBe(1);
		expect(shim.state.runCount).toBe(1);
	});

	it('uses the cached compiled artifact for the run after prepare', async () => {
		const buffer = new SharedArrayBuffer(1024);

		await import('./zig');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: 'https://assets.example.test/wasm-zig/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/wasm-zig/std.tar.gz',
				integrity: runtimeIntegrity,
				maxAssetBytes,
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
			targetTriple: 'wasm32-wasi',
			log: false
		};
		await (globalThis as any).self.onmessage({
			data: {
				...request,
				prepare: true
			}
		});
		await Promise.resolve();
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({
			progress: expect.objectContaining({ kind: 'ready' })
		});
		await (globalThis as any).self.onmessage({
			data: {
				...request,
				prepare: false
			}
		});
		await Promise.resolve();

		expect(shim.state.compileCount).toBe(1);
		expect(shim.state.runCount).toBe(1);
		expect(
			(globalThis as any).postMessage.mock.calls.filter(
				([message]: [any]) => message.progress?.kind === 'ready'
			)
		).toHaveLength(1);
	});

	it('prepares real IR inputs and returns the cached LLDB artifact without running it', async () => {
		const bytes = encoder.encode('debug-wasm');
		const lldbArtifact = { bytes, descriptor: { kind: 'dwarf' }, sources: [] };
		debugPipeline.compileZigDebugArtifact.mockResolvedValue(lldbArtifact);
		await import('./zig');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: 'https://assets.example.test/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/std.tar.gz',
				integrity: runtimeIntegrity,
				maxAssetBytes
			}
		});
		const request = {
			code: 'pub fn main() void {}',
			activePath: 'src/main.zig',
			workspaceFiles: [
				{ path: 'src/main.zig', content: 'old source' },
				{ path: 'src/helper.zig', content: 'pub const n = 7;' }
			],
			buffer: new SharedArrayBuffer(1024),
			debugMode: 'lldb',
			debugClangPath: 'https://assets.example.test/clang/',
			debugClangIntegrity: {
				'runtime-manifest.v1.json': {
					bytes: 1,
					sha256: 'a'.repeat(64),
					uncompressedBytes: 1,
					uncompressedSha256: 'a'.repeat(64)
				}
			}
		};
		await (globalThis as any).self.onmessage({ data: { ...request, prepare: true } });
		expect(shim.state.compileCount).toBe(2);
		expect(shim.state.runCount).toBe(0);
		const invocations = shim.state.constructed.filter(
			(invocation) => invocation.args[0] === 'zigc.wasm'
		);
		expect(invocations[0].args).toEqual([
			'zigc.wasm',
			'build-exe',
			'src/main.zig',
			'-target',
			'wasm32-wasi',
			'-mcpu=mvp',
			'-O',
			'debug',
			'-fllvm',
			'-fno-libllvm',
			'-fno-lld',
			'-fno-emit-bin',
			'-fno-compiler-rt',
			'-femit-llvm-bc=output.bc'
		]);
		expect(invocations[1].args).toEqual(
			expect.arrayContaining([
				'build-obj',
				'/lib/compiler_rt.zig',
				'-femit-llvm-bc=compiler_rt.bc'
			])
		);
		for (const invocation of invocations) {
			expect(invocation.fds.slice(3).map((fd) => fd.name)).toEqual(['.', '/lib', '/cache']);
		}
		const compiled = debugPipeline.compileZigDebugArtifact.mock.calls[0][0];
		expect(compiled.bitcode.map((bytes: Uint8Array) => Array.from(bytes))).toEqual([
			Array.from(encoder.encode('wasm-out')),
			Array.from(encoder.encode('wasm-out'))
		]);
		expect(compiled.sources).toEqual([
			{ path: '/workspace/src/helper.zig', content: 'pub const n = 7;' },
			{ path: '/workspace/src/main.zig', content: request.code }
		]);
		expect(compiled.zigReceipts).toEqual(runtimeIntegrity);
		expect((globalThis as any).postMessage).not.toHaveBeenCalledWith({ lldbArtifact });
		await (globalThis as any).self.onmessage({ data: request });
		expect(debugPipeline.compileZigDebugArtifact).toHaveBeenCalledTimes(1);
		expect(shim.state.compileCount).toBe(2);
		expect(shim.state.runCount).toBe(0);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ lldbArtifact });
		await (globalThis as any).self.onmessage({
			data: { ...request, debugMode: 'none', stdin: '' }
		});
		expect(shim.state.compileCount).toBe(3);
		expect(shim.state.runCount).toBe(1);
	});

	it.each(['none', 'lldb'])(
		'mounts byte-backed Zig imports and binary embedFile data in %s mode',
		async (debugMode) => {
			const helper = new Uint8Array(encoder.encode('\ufeffpub const greeting = "안녕";'));
			const binary = new Uint8Array([0, 255, 128, 13, 10, 0]);
			debugPipeline.compileZigDebugArtifact.mockResolvedValue({
				bytes: encoder.encode('debug-wasm'),
				descriptor: { kind: 'dwarf' },
				sources: []
			});
			await import('./zig');
			await (globalThis as any).self.onmessage({
				data: {
					load: true,
					compilerUrl: 'https://assets.example.test/zig_small.wasm',
					stdlibUrl: 'https://assets.example.test/std.tar.gz',
					integrity: runtimeIntegrity,
					maxAssetBytes
				}
			});
			const code =
				'const helper = @import("nested/helper.zig"); const data = @embedFile("data.bin"); pub fn main() void { _ = helper; _ = data; }';
			await (globalThis as any).self.onmessage({
				data: {
					code,
					prepare: true,
					buffer: new SharedArrayBuffer(1024),
					activePath: 'main.zig',
					debugMode,
					workspaceFiles: [
						{ path: 'main.zig', content: new Uint8Array([255]) },
						{ path: 'nested/helper.zig', content: helper },
						{ path: 'data.bin', content: binary }
					],
					debugClangPath: 'https://assets.example.test/clang/',
					debugClangIntegrity: {
						'runtime-manifest.v1.json': {
							bytes: 1,
							sha256: 'a'.repeat(64),
							uncompressedBytes: 1,
							uncompressedSha256: 'a'.repeat(64)
						}
					}
				}
			});
			const root = shim.state.constructed[0].fds[3].dir.contents;
			expect(Array.from(root.get('main.zig').data)).toEqual(Array.from(encoder.encode(code)));
			expect(Array.from(root.get('nested').contents.get('helper.zig').data)).toEqual(
				Array.from(helper)
			);
			expect(Array.from(root.get('data.bin').data)).toEqual(Array.from(binary));
			expect(shim.state.compileCount).toBe(debugMode === 'lldb' ? 2 : 1);
			if (debugMode === 'lldb') {
				const { sources } = debugPipeline.compileZigDebugArtifact.mock.calls[0][0];
				expect(sources.map((source: any) => source.path)).toEqual([
					'/workspace/main.zig',
					'/workspace/nested/helper.zig'
				]);
				const source = sources.find((file: any) => file.path.endsWith('helper.zig'));
				expect(source.content).toBe('\ufeffpub const greeting = "안녕";');
				expect(sha256(encoder.encode(source.content))).toBe(sha256(helper));
			}
		}
	);

	it('rejects invalid UTF-8 byte-backed Zig debug source before compilation', async () => {
		await import('./zig');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: 'https://assets.example.test/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/std.tar.gz',
				integrity: runtimeIntegrity,
				maxAssetBytes
			}
		});
		await (globalThis as any).self.onmessage({
			data: {
				code: 'pub fn main() void {}',
				prepare: true,
				buffer: new SharedArrayBuffer(1024),
				debugMode: 'lldb',
				workspaceFiles: [{ path: 'nested/helper.zig', content: new Uint8Array([255]) }],
				debugClangPath: 'https://assets.example.test/clang/',
				debugClangIntegrity: {
					'runtime-manifest.v1.json': {
						bytes: 1,
						sha256: 'a'.repeat(64),
						uncompressedBytes: 1,
						uncompressedSha256: 'a'.repeat(64)
					}
				}
			}
		});
		expect(shim.state.compileCount).toBe(0);
		expect(debugPipeline.compileZigDebugArtifact).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: 'Zig debug source is not valid UTF-8: /workspace/nested/helper.zig'
		});
	});

	it('rejects debug compiler overrides before invoking the frontend', async () => {
		await import('./zig');
		await (globalThis as any).self.onmessage({
			data: {
				code: 'pub fn main() void {}',
				buffer: new SharedArrayBuffer(1024),
				debugMode: 'lldb',
				compileArgs: ['-fstrip']
			}
		});
		expect(shim.state.compileCount).toBe(0);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: expect.stringContaining('does not accept compiler argument overrides')
		});
	});

	it('requires pinned Clang assets before compiling debug source', async () => {
		await import('./zig');
		await (globalThis as any).self.onmessage({
			data: {
				code: 'pub fn main() void {}',
				buffer: new SharedArrayBuffer(1024),
				debugMode: 'lldb',
				debugClangPath: 'https://assets.example.test/clang/'
			}
		});
		expect(shim.state.compileCount).toBe(0);
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({
			error: expect.stringContaining('verified Clang runtime asset receipts')
		});
	});

	it('decodes compiler and program UTF-8 per stream without leaking into the next run', async () => {
		const stdoutBytes = encoder.encode('안녕\n');
		const stderrBytes = encoder.encode('é\n');
		const writeInterleaved = (fds: any[]) => {
			fds[1].write(stdoutBytes.slice(0, 2));
			fds[2].write(stderrBytes.slice(0, 1));
			fds[1].write(stdoutBytes.slice(2));
			fds[2].write(stderrBytes.slice(1));
		};
		shim.state.compileOutput = writeInterleaved;
		shim.state.runOutput = (fds) => {
			writeInterleaved(fds);
			fds[1].write(encoder.encode('끝').slice(0, 1));
		};

		await import('./zig');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: 'https://assets.example.test/wasm-zig/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/wasm-zig/std.tar.gz',
				integrity: runtimeIntegrity,
				maxAssetBytes,
				log: false
			}
		});
		const request = {
			code: 'pub fn main() void {}',
			buffer: new SharedArrayBuffer(1024),
			stdin: '',
			activePath: 'main.zig',
			targetTriple: 'wasm32-wasi',
			log: false
		};
		const outputs = () =>
			(globalThis as any).postMessage.mock.calls
				.map(([message]: [any]) => message)
				.filter((message: any) => 'output' in message);

		await (globalThis as any).self.onmessage({ data: request });
		expect(outputs()).toEqual([
			{ output: '안녕\né\n' },
			{ output: '안녕\n' },
			{ output: 'é\n' },
			{ output: '\uFFFD' }
		]);

		(globalThis as any).postMessage.mockClear();
		shim.state.runOutput = (fds) => fds[1].write(encoder.encode('ok\n'));
		await (globalThis as any).self.onmessage({ data: request });
		expect(outputs()).toEqual([{ output: 'ok\n' }]);
		expect((globalThis as any).postMessage).toHaveBeenLastCalledWith({ results: true });
		expect(shim.state.compileCount).toBe(1);
	});

	it('posts a compile error when the Zig compiler exits non-zero', async () => {
		shim.state.nextCompileExitCode = 1;

		await import('./zig');
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: 'https://assets.example.test/wasm-zig/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/wasm-zig/std.tar.gz',
				integrity: runtimeIntegrity,
				maxAssetBytes,
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
				targetTriple: 'wasm32-wasi',
				log: false
			}
		});
		await Promise.resolve();

		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ output: 'compile log\n' });
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ error: 'compile log\n' });
		expect(shim.state.runCount).toBe(0);
	});

	it('rejects corrupt compiler bytes before compilation and permits a clean retry', async () => {
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		const corruptCompiler = Uint8Array.from(compilerAsset);
		corruptCompiler[3] ^= 1;
		fetchMock.mockImplementation(async (url: string) => {
			if (url.endsWith('zig_small.wasm')) return responseFor(corruptCompiler, url);
			return responseFor(stdlibTarGzip, url);
		});

		await import('./zig');
		const loadRequest = {
			load: true,
			compilerUrl: 'https://assets.example.test/wasm-zig/zig_small.wasm',
			stdlibUrl: 'https://assets.example.test/wasm-zig/std.tar.gz',
			integrity: runtimeIntegrity,
			maxAssetBytes,
			log: false
		};
		await (globalThis as any).self.onmessage({ data: loadRequest });

		expect(WebAssembly.compile).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ error: expect.stringContaining('SHA-256 mismatch') })
		);

		fetchMock.mockImplementation(async (url: string) => {
			if (url.endsWith('zig_small.wasm')) return responseFor(compilerAsset, url);
			return responseFor(stdlibTarGzip, url);
		});
		await (globalThis as any).self.onmessage({ data: loadRequest });

		expect(WebAssembly.compile).toHaveBeenCalledOnce();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith({ load: true });
	});

	it('rejects incomplete receipts and oversized expanded metadata before fetching', async () => {
		await import('./zig');
		const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: 'https://assets.example.test/wasm-zig/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/wasm-zig/std.tar.gz',
				integrity: { 'zig_small.wasm': runtimeIntegrity['zig_small.wasm'] },
				maxAssetBytes,
				log: false
			}
		});
		expect(fetchMock).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				error: expect.stringContaining('exactly two asset receipts')
			})
		);

		(globalThis as any).postMessage.mockClear();
		await (globalThis as any).self.onmessage({
			data: {
				load: true,
				compilerUrl: 'https://assets.example.test/wasm-zig/zig_small.wasm',
				stdlibUrl: 'https://assets.example.test/wasm-zig/std.tar.gz',
				integrity: runtimeIntegrity,
				maxAssetBytes: stdlibTar.byteLength - 1,
				log: false
			}
		});
		expect(fetchMock).not.toHaveBeenCalled();
		expect((globalThis as any).postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ error: expect.stringContaining('byte limit') })
		);
	});

	it('rejects a ZIP entry whose declared output exceeds the expanded-byte budget', async () => {
		const archive = zipSync({ 'std/large.zig': new Uint8Array(5) });
		const { loadLibDirectory } = await import('./zig');

		await expect(
			loadLibDirectory(archive, 'https://assets.example.test/std.zip', {
				maxExpandedBytes: 4,
				maxFiles: 10
			})
		).rejects.toThrow('Zig standard library archive exceeds the 4 byte expanded-size limit');
	});

	it('loads the matching full library and retains legacy std-only archives', async () => {
		const { loadLibDirectory } = await import('./zig');
		const library = await loadLibDirectory(
			new Uint8Array(stdlibTarGzip),
			'https://assets.example.test/std.tar.gz',
			{},
			runtimeIntegrity['std.tar.gz']
		);
		expect(library.contents.get('std')).toHaveProperty('contents');
		expect(library.contents.has('compiler_rt.zig')).toBe(true);
		const legacy = await loadLibDirectory(stdlibArchive, 'https://assets.example.test/std.zip');
		expect(legacy.contents.get('std')).toHaveProperty('contents');
	});

	it('rejects ambiguous archive roots and lib archives without std', async () => {
		const { loadLibDirectory } = await import('./zig');
		await expect(
			loadLibDirectory(
				zipSync({
					'lib/std/std.zig': stdlibFile,
					'std/std.zig': stdlibFile
				}),
				'https://assets.example.test/std.zip'
			)
		).rejects.toThrow('single lib/ or std/ root');
		await expect(
			loadLibDirectory(
				zipSync({
					'lib/compiler_rt.zig': stdlibFile
				}),
				'https://assets.example.test/std.zip'
			)
		).rejects.toThrow('must contain lib/std/');
	});

	it('rejects a ZIP archive that exceeds the standard-library file-count budget', async () => {
		const archive = zipSync({
			'std/a.zig': new Uint8Array([1]),
			'std/b.zig': new Uint8Array([2])
		});
		const { loadLibDirectory } = await import('./zig');

		await expect(
			loadLibDirectory(archive, 'https://assets.example.test/std.zip', {
				maxExpandedBytes: 16,
				maxFiles: 1
			})
		).rejects.toThrow('Zig standard library archive exceeds the 1 file limit');
	});

	it('rejects unsafe ZIP paths instead of normalizing traversal', async () => {
		const archive = zipSync({ 'std/../escape.zig': new Uint8Array([1]) });
		const { loadLibDirectory } = await import('./zig');

		await expect(
			loadLibDirectory(archive, 'https://assets.example.test/std.zip')
		).rejects.toThrow('Zig standard library archive has an unsafe path: std/../escape.zig');
	});

	it('rejects ZIP file and directory path collisions', async () => {
		const archive = zipSync({
			'std/collision': new Uint8Array([1]),
			'std/collision/nested.zig': new Uint8Array([2])
		});
		const { loadLibDirectory } = await import('./zig');

		await expect(
			loadLibDirectory(archive, 'https://assets.example.test/std.zip')
		).rejects.toThrow('Zig standard library archive path collision: std/collision/nested.zig');
	});

	it('bounds gzip-expanded TAR bytes before materializing the standard library', async () => {
		const { loadLibDirectory } = await import('./zig');

		await expect(
			loadLibDirectory(
				new Uint8Array(stdlibTarGzip),
				'https://assets.example.test/std.tar.gz',
				{
					maxExpandedBytes: 512,
					maxFiles: 10
				}
			)
		).rejects.toThrow('512 byte limit');
	});

	it('accepts a transparently decoded TAR only after uncompressed receipt verification', async () => {
		const { loadLibDirectory } = await import('./zig');

		await expect(
			loadLibDirectory(
				new Uint8Array(stdlibTar),
				'https://assets.example.test/std.tar.gz',
				{ maxExpandedBytes: maxAssetBytes, maxFiles: 10 },
				runtimeIntegrity['std.tar.gz']
			)
		).resolves.toBeInstanceOf(shim.Directory);

		const corruptTar = Uint8Array.from(stdlibTar);
		corruptTar[512] ^= 1;
		await expect(
			loadLibDirectory(
				corruptTar,
				'https://assets.example.test/std.tar.gz',
				{ maxExpandedBytes: maxAssetBytes, maxFiles: 10 },
				runtimeIntegrity['std.tar.gz']
			)
		).rejects.toThrow('uncompressed SHA-256 mismatch');
	});

	it('rejects corrupt gzip and alternate ZIP encodings under the receipt-backed path', async () => {
		const { loadLibDirectory } = await import('./zig');
		const corruptGzip = Uint8Array.from(stdlibTarGzip);
		corruptGzip[corruptGzip.length - 1] ^= 1;

		await expect(
			loadLibDirectory(
				corruptGzip,
				'https://assets.example.test/std.tar.gz',
				{ maxExpandedBytes: maxAssetBytes, maxFiles: 10 },
				runtimeIntegrity['std.tar.gz']
			)
		).rejects.toThrow('compressed SHA-256 mismatch');
		await expect(
			loadLibDirectory(
				stdlibArchive,
				'https://assets.example.test/std.tar.gz',
				{ maxExpandedBytes: maxAssetBytes, maxFiles: 10 },
				runtimeIntegrity['std.tar.gz']
			)
		).rejects.toThrow('must be a gzip archive or TAR');
	});
});
